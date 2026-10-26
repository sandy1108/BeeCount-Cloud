"""月份下钻只负责汇总；权限、精确分类、排除统计及日期条件沿用读取层。"""
from decimal import Decimal

from fastapi import HTTPException

from ._shared import *  # noqa: F401,F403
from .statistics_filter import statistics_filters


@router.get('/workspace/month-statistics')
def month_statistics(
    ledger_id: str = Query(...),
    date_from: datetime = Query(...),
    date_to: datetime = Query(...),
    tx_type: str = Query(default='cashflow'),
    category_group: str | None = Query(default=None),
    tz_offset_minutes: int = Query(default=0, ge=-720, le=840),
    _scopes: set[str] = Depends(_READ_SCOPE_DEP),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """完整匹配集十进制汇总，不以明细页或前1000笔代替统计；整月也允许父范围裁剪。"""
    start, end = _to_utc(date_from), _to_utc(date_to)
    offset = timedelta(minutes=tz_offset_minutes)
    if (start >= end or (start + offset).strftime('%Y-%m') !=
            (end - timedelta(microseconds=1) + offset).strftime('%Y-%m')):
        raise HTTPException(status_code=400, detail='Range must stay within one natural month')
    if tx_type not in ('cashflow', 'expense', 'income'):
        raise HTTPException(status_code=400, detail='Month statistics requires income or expense')
    # 管理员也须有账本成员权限，与A批分类统计一致；不开放跨账本混币汇总。
    ledgers = _visible_workspace_ledgers(db, current_user=current_user, is_admin=False,
                                         ledger_id=ledger_id, user_id=None)
    if not ledgers:
        raise HTTPException(status_code=404, detail='Ledger not found')
    query = select(ReadTxProjection).where(
        ReadTxProjection.ledger_id.in_([ledger.id for ledger in ledgers]),
        *statistics_filters(db, category_group=category_group, statistics_only=True,
                            tx_type=tx_type, date_from=start, date_to=end),
    )
    daily, categories, accounts, tags = {}, {'income': {}, 'expense': {}}, {}, {}
    income, expense, count = Decimal(0), Decimal(0), 0

    def add(target, key, amount):
        slot = target.setdefault(key, {'amount': Decimal(0), 'count': 0})
        slot['amount'] += amount
        slot['count'] += 1

    for row in db.scalars(query).yield_per(1000):
        amount = Decimal(str(row.native_amount if row.native_amount is not None else row.amount))
        count += 1
        if row.tx_type == 'income':
            income += amount
        else:
            expense += amount
        bucket = (_to_utc(row.happened_at) + offset).strftime('%Y-%m-%d')
        slot = daily.setdefault(bucket, {'income': Decimal(0), 'expense': Decimal(0), 'count': 0})
        slot[row.tx_type] += amount
        slot['count'] += 1
        add(categories[row.tx_type], (row.category_name or '').strip() or 'Uncategorized', amount)
        account = row.account_name or row.from_account_name or row.to_account_name
        if account:
            add(accounts, account, amount)
        for tag in set(_tags_list(row.tags_csv)):
            add(tags, tag, amount)

    def ranked(kind):
        return [dict(category_name=name, category_group=name, total=float(data['amount']), tx_count=data['count'])
                for name, data in sorted(categories[kind].items(), key=lambda item: (-item[1]['amount'], item[0]))]

    def named(rows):
        return [dict(name=name, amount=float(data['amount']), count=data['count'])
                for name, data in sorted(rows.items(), key=lambda item: (-item[1]['amount'], item[0]))]

    return dict(
        summary=dict(income=float(income), expense=float(expense), balance=float(income - expense), count=count),
        daily=[dict(bucket=bucket, income=float(data['income']), expense=float(data['expense']),
                    balance=float(data['income'] - data['expense']), count=data['count'])
               for bucket, data in sorted(daily.items())],
        expenseCategories=ranked('expense'), incomeCategories=ranked('income'),
        topAccounts=named(accounts), topTags=named(tags),
    )
