"""历史导入分类补链：默认预览，执行时复核计划并生成正常同步变更。"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ... import snapshot_builder
from ...concurrency import lock_ledger_for_materialize
from ...models import AuditLog, Ledger, ReadTxProjection, SyncChange, User
from ...routers.read._shared import _is_ledger_deleted
from ...routers.write._shared import _emit_entity_diffs
from .category_links import resolve_category_id


def preview_repair(db: Session, ledger: Ledger) -> dict:
    """只预览当前仍来自 web-import、缺少分类 ID 且唯一匹配的交易。"""
    if _is_ledger_deleted(db, ledger_id=ledger.id):
        raise ValueError("账本已删除，禁止修复")
    snapshot = snapshot_builder.build(db, ledger)
    categories = snapshot.get("categories") or []
    skipped = Counter()
    changes = []
    rows = db.execute(
        select(ReadTxProjection, SyncChange)
        .outerjoin(
            SyncChange,
            SyncChange.change_id == ReadTxProjection.source_change_id,
        )
        .where(ReadTxProjection.ledger_id == ledger.id)
    ).all()
    for tx, source in rows:
        if tx.category_sync_id:
            skipped["already_linked"] += 1
            continue
        if not source or source.updated_by_device_id != "web-import":
            skipped["not_current_import"] += 1
            continue
        payload = source.payload_json
        # 不修复删账、其它实体或投影和原始变更不一致的异常记录。
        if (
            source.action != "upsert"
            or source.entity_type != "transaction"
            or source.ledger_id != ledger.id
            or source.entity_sync_id != tx.sync_id
            or not isinstance(payload, dict)
            or payload.get("syncId") != tx.sync_id
            or payload.get("categoryId")
            or payload.get("categoryName") != tx.category_name
            or payload.get("type") != tx.tx_type
        ):
            skipped["inconsistent_source"] += 1
            continue
        if not tx.category_name or tx.tx_type not in {"income", "expense"}:
            skipped["no_category"] += 1
            continue
        try:
            category_id = resolve_category_id(
                categories, tx.category_name, tx.category_kind or tx.tx_type, legacy=True
            )
        except ValueError:
            skipped["missing_or_ambiguous_category"] += 1
            continue
        changes.append(
            {
                "sync_id": tx.sync_id,
                "category_id": category_id,
                "source_change_id": source.change_id,
                "payload": deepcopy(payload),
            }
        )
    revision = snapshot_builder.latest_change_id(db, ledger.id)
    material = {
        "ledger_id": ledger.id,
        "revision": revision,
        "categories": categories,
        "changes": changes,
    }
    fingerprint = hashlib.sha256(
        json.dumps(material, sort_keys=True, default=str).encode()
    ).hexdigest()
    return {
        "ledger_id": ledger.external_id,
        "base_change_id": revision,
        "plan_hash": fingerprint,
        "repair_count": len(changes),
        "skipped": dict(skipped),
        "_changes": changes,
    }


def apply_repair(db: Session, ledger: Ledger, expected_plan_hash: str) -> dict:
    """事务由调用者提交；CLI 在 SQLite 使用 BEGIN IMMEDIATE，失败整体回滚。"""
    lock_ledger_for_materialize(db, ledger.id)
    plan = preview_repair(db, ledger)
    if plan["plan_hash"] != expected_plan_hash:
        raise ValueError("修复计划已变化，请重新预览并确认")
    if not plan["repair_count"]:
        return {k: v for k, v in plan.items() if not k.startswith("_")}
    owner = db.get(User, ledger.user_id)
    before = [item["payload"] for item in plan["_changes"]]
    after = [dict(item["payload"], categoryId=item["category_id"]) for item in plan["_changes"]]
    # 保留原始 payload 的金额、备注、附件等全部字段，只补 categoryId。
    emitted = _emit_entity_diffs(
        db,
        ledger=ledger,
        current_user=owner,
        device_id="import-category-repair",
        prev={"items": before},
        next_snapshot={"items": after},
        now=datetime.now(timezone.utc),
    )
    report = {k: v for k, v in plan.items() if not k.startswith("_")}
    report["new_change_id"] = max(emitted)
    db.add(
        AuditLog(
            user_id=owner.id,
            ledger_id=ledger.id,
            action="import_category_repair",
            metadata_json=report,
        )
    )
    return report
