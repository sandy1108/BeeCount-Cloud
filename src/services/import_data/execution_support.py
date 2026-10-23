"""导入执行期辅助：新账本和附件不自行commit，由调用者统一提交/回滚。"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select

from ...config import get_settings
from ...models import AttachmentFile, Ledger, LedgerMember, SyncChange


def stage_ledger(db, user_id: str, name: str, currency: str = "CNY") -> Ledger:
    """只暂存账本及同步事件，避免调用会提前commit的HTTP建账本路由。"""
    external_id = "ledger_" + uuid4().hex[:12]
    ledger = Ledger(user_id=user_id, external_id=external_id, name=name, currency=currency)
    db.add(ledger)
    db.flush()
    now = datetime.now(timezone.utc)
    db.add(LedgerMember(ledger_id=ledger.id, user_id=user_id, role="owner", joined_at=now))
    db.add(
        SyncChange(
            user_id=user_id,
            ledger_id=ledger.id,
            entity_type="ledger",
            entity_sync_id=external_id,
            action="upsert",
            payload_json={"ledgerName": name, "currency": currency, "monthStartDay": 1},
            updated_at=now,
            updated_by_device_id="web-import",
            updated_by_user_id=user_id,
        )
    )
    db.flush()
    return ledger


def stage_attachments(db, ledger, user_id, attachments, created_paths: list[Path]) -> list[dict]:
    """写入前记录新文件路径，数据库失败或取消时由调用者清理；不删除复用文件。"""
    result = []
    settings = get_settings()
    for attachment in attachments:
        blob = attachment.data
        if len(blob) > settings.attachment_max_upload_bytes:
            raise ValueError("附件超过服务器配置的上传限制")
        digest = hashlib.sha256(blob).hexdigest()
        row = db.scalar(
            select(AttachmentFile).where(
                AttachmentFile.ledger_id == ledger.id, AttachmentFile.sha256 == digest
            )
        )
        if row is None:
            directory = (
                Path(settings.attachment_storage_dir).expanduser()
                / ledger.user_id
                / ledger.external_id
                / digest[:2]
            )
            directory.mkdir(parents=True, exist_ok=True)
            name = Path(attachment.file_name).name
            path = directory / (uuid4().hex + "_" + name)
            created_paths.append(path)
            path.write_bytes(blob)
            row = AttachmentFile(
                ledger_id=ledger.id,
                user_id=user_id,
                sha256=digest,
                size_bytes=len(blob),
                mime_type=attachment.mime_type,
                file_name=name,
                storage_path=str(path),
            )
            db.add(row)
            db.flush()
        result.append(
            {
                "cloudFileId": row.id,
                "originalName": row.file_name,
                "fileName": row.file_name,
                "mimeType": row.mime_type,
                "size": row.size_bytes,
                "sha256": row.sha256,
            }
        )
    return result
