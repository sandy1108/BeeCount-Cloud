"""服务端逻辑备份扩展。旧手机快照未声明关系时保留并校验现有关系。"""
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from ..models import Ledger
from . import settlements

KEY = 'cloudRepayments'


class BackupLink(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expense_id: str = Field(min_length=1, max_length=128)
    income_id: str = Field(min_length=1, max_length=128)
    tz_offset_minutes: int = Field(ge=-840, le=840, strict=True)
    note: str = Field(default='', max_length=500)


class BackupExtension(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: int = Field(strict=True, ge=1, le=1)
    items: list[BackupLink]


def export(db: Session, ledger: Ledger):
    return {'version': 1, 'items': [
        {'expense_id': r.expense_id, 'income_id': r.income_id,
         'tz_offset_minutes': r.tz_offset_minutes, 'note': r.note}
        for r in settlements.links(db, ledger.id)]}


def restore(db: Session, ledger: Ledger, payload: dict, actor: str, *, snapshot_currency: str):
    """由恢复事务在projection重建后调用；失败整批回滚，不默默解除已有关系。"""
    if KEY not in payload:
        return  # 旧备份无扩展：rebuild_from_snapshot已完整核验保留的关系。
    try:
        extension = BackupExtension.model_validate(payload[KEY])
    except ValidationError:
        settlements.conflict('备份中的关联回款扩展无效，未恢复数据')
    if extension.items and snapshot_currency.strip().upper() != ledger.currency.strip().upper():
        settlements.conflict('备份本位币与当前账本不同，不能恢复关联回款')
    desired = [row.model_dump() for row in extension.items]
    current = export(db, ledger)['items']
    sort = lambda rows: sorted(rows, key=lambda r: (r['income_id'], r['expense_id']))
    if current:
        if sort(current) != sort(desired):
            settlements.conflict('恢复会改变已有回款关系，请先显式解除关联再恢复备份')
        return
    seen = set()
    offsets = {}
    for row in extension.items:
        if row.income_id in seen or (row.expense_id in offsets and offsets[row.expense_id] != row.tz_offset_minutes):
            settlements.conflict('备份存在重复回款或同组时区冲突，未恢复数据')
        seen.add(row.income_id)
        offsets[row.expense_id] = row.tz_offset_minutes
        settlements.add(db, ledger, row.expense_id, row.income_id, row.tz_offset_minutes, row.note, actor)
