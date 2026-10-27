"""仅交易详情使用的关联API；不向旧手机同步未知实体。"""
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..deps import get_current_user, require_any_scopes, require_scopes
from ..ledger_access import READABLE_ROLES, WRITABLE_ROLES, require_accessible_ledger_by_external_id
from ..models import AuditLog, User
from ..security import SCOPE_APP_WRITE, SCOPE_WEB_READ, SCOPE_WEB_WRITE
from ..services import settlements
from ..websocket_manager import broadcast_to_ledger

read_router = APIRouter()
write_router = APIRouter()
_ALLOW_APP = get_settings().allow_app_rw_scopes
_READ = require_any_scopes(SCOPE_WEB_READ, SCOPE_APP_WRITE) if _ALLOW_APP else require_scopes(SCOPE_WEB_READ)
_WRITE = require_any_scopes(SCOPE_WEB_WRITE, SCOPE_APP_WRITE) if _ALLOW_APP else require_scopes(SCOPE_WEB_WRITE)
_BASE = '/ledgers/{ledger_id}/transactions/{tx_id}'


def _ledger(db, user, external, *, write=False):
    from .read._shared import _is_ledger_deleted
    from fastapi import HTTPException
    ledger, role = require_accessible_ledger_by_external_id(db, user_id=user.id,
        ledger_external_id=external, roles=WRITABLE_ROLES if write else READABLE_ROLES)
    if _is_ledger_deleted(db, ledger_id=ledger.id):
        raise HTTPException(404, 'Ledger not found')
    return ledger, role


class RepaymentCreate(BaseModel):
    income_id: str = Field(min_length=1, max_length=128)
    tz_offset_minutes: int = Field(ge=-840, le=840, strict=True)  # 必传；不能替用户猜时区
    note: str = Field(default='', max_length=500)


@read_router.get(_BASE + '/settlement')
def read_settlement(ledger_id: str, tx_id: str, _s=Depends(_READ),
    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ledger, role = _ledger(db, user, ledger_id)
    return settlements.summary(db, ledger, tx_id, role in WRITABLE_ROLES)


@read_router.get(_BASE + '/repayment-candidates')
def read_candidates(ledger_id: str, tx_id: str, tz_offset_minutes: int = Query(ge=-840, le=840),
    limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0),
    q: str = Query(default='', max_length=200), _s=Depends(_READ),
    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ledger, _ = _ledger(db, user, ledger_id)
    return settlements.candidates(db, ledger, tx_id, tz_offset_minutes, limit, offset, q.strip())


async def _notify(request, db, ledger):
    # 独立事件没有sync cursor/未知sync实体；旧手机可忽略，Web详情重新读取。
    await broadcast_to_ledger(db=db, ws_manager=request.app.state.ws_manager,
        ledger_id=ledger.id, payload={'type': 'repayment_change', 'ledgerId': ledger.external_id})


@write_router.post(_BASE + '/repayments')
async def create_repayment(ledger_id: str, tx_id: str, req: RepaymentCreate, request: Request,
    _s=Depends(_WRITE), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ledger, _ = _ledger(db, user, ledger_id, write=True)
    changed = settlements.add(db, ledger, tx_id, req.income_id, req.tz_offset_minutes, req.note.strip(), user.id)
    if changed:
        db.add(AuditLog(user_id=user.id, ledger_id=ledger.id, action='repayment_link',
            metadata_json={'expenseId': tx_id, 'incomeId': req.income_id}))
    db.commit()
    result = settlements.summary(db, ledger, tx_id, True)
    if changed:
        await _notify(request, db, ledger)
    return result


@write_router.delete(_BASE + '/repayments/{income_id}')
async def delete_repayment(ledger_id: str, tx_id: str, income_id: str, request: Request,
    _s=Depends(_WRITE), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ledger, _ = _ledger(db, user, ledger_id, write=True)
    settlements.remove(db, ledger, tx_id, income_id)
    db.add(AuditLog(user_id=user.id, ledger_id=ledger.id, action='repayment_unlink',
        metadata_json={'expenseId': tx_id, 'incomeId': income_id}))
    db.commit()
    result = settlements.summary(db, ledger, tx_id, True)
    await _notify(request, db, ledger)
    return result
