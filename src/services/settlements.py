"""关联回款领域服务：原流水不变，净承担只在详情计算。

使用交易原币amount，不用折算快照抵扣。组内沿用首次建立关系时的统计偏移；
旧端普通写入不会清空关联，所有projection入口统一校验破坏性变更。
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from ..concurrency import lock_ledger_for_materialize
from ..models import Ledger, ReadTxProjection, TransactionRepayment
from .statistics_period import ski_season_range


def conflict(message: str):
    raise HTTPException(409, detail={'message': message, 'error_code': 'SETTLEMENT_CONFLICT'})


def money(value) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        conflict('关联交易金额必须是有效正数')
    if not result.is_finite() or result <= 0:
        conflict('关联交易金额必须是有效正数')
    return result


def amount_text(value: Decimal) -> str:
    return format(value.normalize(), 'f')


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def currency(tx, ledger: Ledger) -> str:
    return (tx.currency_code or ledger.currency or 'CNY').strip().upper()


def season(tx, offset: int) -> str:
    if tx.happened_at is None:
        conflict('关联交易必须有有效日期')
    return ski_season_range(period=None, tz_offset_minutes=offset, now=utc(tx.happened_at))[2]


def lock(db: Session, ledger: Ledger):
    """D写接口先取写锁再读取，SQLite也不能依赖读后写的隐式串行化。"""
    lock_ledger_for_materialize(db, ledger.id)
    if db.get_bind().dialect.name == 'sqlite':
        db.execute(update(Ledger).where(Ledger.id == ledger.id).values(id=Ledger.id))
    db.expire_all()


def get_tx(db: Session, ledger: Ledger, sid: str):
    row = db.get(ReadTxProjection, (ledger.id, sid), populate_existing=True)
    if row is None:
        raise HTTPException(404, 'Entity not found')
    return row


def links(db: Session, ledger_id: str, expense_id: str | None = None):
    q = select(TransactionRepayment).where(TransactionRepayment.ledger_id == ledger_id)
    if expense_id is not None:
        q = q.where(TransactionRepayment.expense_id == expense_id)
    return list(db.scalars(q.order_by(TransactionRepayment.created_at, TransactionRepayment.income_id)))


def validate_group(ledger: Ledger, expense, incomes: list, offset: int):
    if expense is None or expense.tx_type != 'expense':
        conflict('关联支出不存在或类型已改变，请先解除关联回款')
    original = money(expense.amount)
    total = Decimal(0)
    target_currency = currency(expense, ledger)
    target_season = season(expense, offset)
    for income in incomes:
        if income is None or income.tx_type != 'income':
            conflict('关联收入不存在或类型已改变，请先解除关联回款')
        if currency(income, ledger) != target_currency:
            conflict('只能关联同一账本、同一原币种的收入和支出，请先解除已有关系')
        if season(income, offset) != target_season:
            conflict('只能关联同一雪季的回款（5月1日至次年4月30日），请先解除已有关系')
        total += money(income.amount)
    if total > original:
        conflict('关联回款合计不能超过原支出，请先解除或调整关联')
    return original, total


def add(db: Session, ledger: Ledger, expense_id: str, income_id: str, offset: int, note: str, actor: str):
    lock(db, ledger)
    expense = get_tx(db, ledger, expense_id)
    income = get_tx(db, ledger, income_id)
    existing = db.get(TransactionRepayment, (ledger.id, income_id))
    if existing is not None:
        if existing.expense_id == expense_id and existing.note == note:
            return False  # 重试不新增；说明发生变化须先解除再明确建立。
        conflict('这笔收入已经关联，请先解除原关联')
    group = links(db, ledger.id, expense_id)
    offset = group[0].tz_offset_minutes if group else offset
    validate_group(ledger, expense, [get_tx(db, ledger, r.income_id) for r in group] + [income], offset)
    db.add(TransactionRepayment(ledger_id=ledger.id, expense_id=expense_id, income_id=income_id,
        tz_offset_minutes=offset, note=note, created_by_user_id=actor))
    db.flush()
    return True


def remove(db: Session, ledger: Ledger, expense_id: str, income_id: str):
    lock(db, ledger)
    get_tx(db, ledger, expense_id)
    db.execute(delete(TransactionRepayment).where(TransactionRepayment.ledger_id == ledger.id,
        TransactionRepayment.expense_id == expense_id, TransactionRepayment.income_id == income_id))


def tx_out(tx, ledger):
    return {'sync_id': tx.sync_id, 'tx_type': tx.tx_type, 'amount': amount_text(money(tx.amount)),
        'currency': currency(tx, ledger), 'happened_at': utc(tx.happened_at).isoformat(),
        'note': tx.note or '', 'category_name': tx.category_name,
        'exclude_from_stats': bool(tx.exclude_from_stats)}


def summary(db: Session, ledger: Ledger, sid: str, can_manage: bool):
    tx = get_tx(db, ledger, sid)
    related = db.get(TransactionRepayment, (ledger.id, sid))
    expense = tx if tx.tx_type == 'expense' else get_tx(db, ledger, related.expense_id) if related else None
    group = links(db, ledger.id, expense.sync_id) if expense is not None else []
    incomes = [get_tx(db, ledger, row.income_id) for row in group]
    offset = group[0].tz_offset_minutes if group else None
    # 未关联流水（含存量负数）也能查看，不因新功能阻塞旧详情。
    original, total = validate_group(ledger, expense, incomes, offset) if group else (Decimal(str(expense.amount)) if expense else Decimal(0), Decimal(0))
    return {'transaction_id': sid, 'expense': tx_out(expense, ledger) if expense and expense.amount > 0 else None,
        'original_amount': amount_text(original), 'repaid_amount': amount_text(total), 'own_amount': amount_text(original - total),
        'currency': currency(expense or tx, ledger), 'tz_offset_minutes': offset,
        'season': season(expense, offset) if expense and offset is not None else None,
        'can_manage': can_manage, 'repayments': [dict(tx_out(inc, ledger), relation_note=r.note) for r, inc in zip(group, incomes)]}


def candidates(db: Session, ledger: Ledger, expense_id: str, offset: int, limit: int, page_offset: int, q: str):
    expense = get_tx(db, ledger, expense_id)
    group = links(db, ledger.id, expense_id)
    offset = group[0].tz_offset_minutes if group else offset
    original, total = validate_group(ledger, expense, [get_tx(db, ledger, r.income_id) for r in group], offset)
    start, end, year = ski_season_range(period=season(expense, offset), tz_offset_minutes=offset)
    linked = select(TransactionRepayment.income_id).where(TransactionRepayment.ledger_id == ledger.id)
    criteria = [ReadTxProjection.ledger_id == ledger.id, ReadTxProjection.tx_type == 'income',
        ReadTxProjection.amount > 0, ReadTxProjection.amount <= float(original - total),
        func.upper(func.coalesce(ReadTxProjection.currency_code, ledger.currency)) == currency(expense, ledger),
        ReadTxProjection.happened_at >= start, ReadTxProjection.happened_at < end,
        ReadTxProjection.sync_id.not_in(linked)]
    if q:
        # contains的autoescape避免把用户的%/_误当通配符。
        criteria.append(or_(ReadTxProjection.note.contains(q, autoescape=True), ReadTxProjection.category_name.contains(q, autoescape=True)))
    count = db.scalar(select(func.count()).select_from(ReadTxProjection).where(*criteria)) or 0
    rows = db.scalars(select(ReadTxProjection).where(*criteria).order_by(ReadTxProjection.happened_at.desc(), ReadTxProjection.sync_id).offset(page_offset).limit(limit))
    return {'items': [tx_out(row, ledger) for row in rows], 'total': count, 'tz_offset_minutes': offset, 'season': year,
        'remaining_amount': amount_text(original - total)}


def guard_tx(db: Session, ledger_id: str, sid: str, proposed: dict | None):
    """所有写入入口只校验实际关联组，不影响无关联旧流水。"""
    affected = list(db.scalars(select(TransactionRepayment).where(TransactionRepayment.ledger_id == ledger_id,
        or_(TransactionRepayment.expense_id == sid, TransactionRepayment.income_id == sid))))
    if not affected:
        return
    if proposed is None:
        conflict('此交易有关联回款，请先在交易详情中解除关联后再删除')
    ledger = db.get(Ledger, ledger_id)
    replacement = SimpleNamespace(**proposed)
    for expense_id in {r.expense_id for r in affected}:
        group = links(db, ledger_id, expense_id)
        def tx(tx_id):
            return replacement if tx_id == sid else db.get(ReadTxProjection, (ledger_id, tx_id), populate_existing=True)
        validate_group(ledger, tx(expense_id), [tx(r.income_id) for r in group], group[0].tz_offset_minutes)


def guard_snapshot(db: Session, ledger_id: str, values: dict[str, dict]):
    """先验证完整替换集合，再清表；旧快照不能留下悬空或超额关联。"""
    ledger = db.get(Ledger, ledger_id)
    by_expense = {}
    for row in links(db, ledger_id):
        by_expense.setdefault(row.expense_id, []).append(row)
    def tx(sid):
        return SimpleNamespace(**values[sid]) if sid in values else None
    for sid, group in by_expense.items():
        validate_group(ledger, tx(sid), [tx(r.income_id) for r in group], group[0].tz_offset_minutes)


def guard_currency(db: Session, ledger: Ledger, new_currency: str):
    """旧手机更改本位币时，NULL原币的含义会改变，先验证组仍同币。"""
    target = SimpleNamespace(currency=new_currency)
    grouped = {}
    for row in links(db, ledger.id):
        grouped.setdefault(row.expense_id, []).append(row)
    for sid, group in grouped.items():
        validate_group(target, get_tx(db, ledger, sid), [get_tx(db, ledger, r.income_id) for r in group], group[0].tz_offset_minutes)


def pin_original_currencies(db: Session, ledger: Ledger):
    """Web更改本位币会整批显式化原币；先固定关联端，避免逐条重算时暂时异币。"""
    group = links(db, ledger.id)
    ids = {r.expense_id for r in group} | {r.income_id for r in group}
    if ids:
        db.execute(update(ReadTxProjection).where(ReadTxProjection.ledger_id == ledger.id,
            ReadTxProjection.sync_id.in_(ids), ReadTxProjection.currency_code.is_(None))
            .values(currency_code=ledger.currency))
