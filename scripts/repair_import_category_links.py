"""历史导入分类补链工具。默认只预览；实际执行前必须备份并暂停目标账本写入。"""

from __future__ import annotations

import argparse
import json

from sqlalchemy import select

from src.database import SessionLocal
from src.models import Ledger, User
from src.services.import_data.category_repair import apply_repair, preview_repair


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-email", required=True)
    parser.add_argument("--ledger-external-id", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-plan-hash")
    args = parser.parse_args()
    if args.apply and not args.expected_plan_hash:
        parser.error("--apply 必须同时提供预览所得 --expected-plan-hash")
    with SessionLocal() as db:
        try:
            # 在第一次读取之前拿写锁，防止 SQLite 预览与执行之间插入并发写入。
            if args.apply and db.bind.dialect.name == "sqlite":
                db.connection().exec_driver_sql("BEGIN IMMEDIATE")
            ledger = db.scalar(
                select(Ledger)
                .join(User, User.id == Ledger.user_id)
                .where(
                    User.email == args.user_email.strip().lower(),
                    Ledger.external_id == args.ledger_external_id,
                )
            )
            if ledger is None:
                raise ValueError("指定用户的账本不存在")
            report = (
                apply_repair(db, ledger, args.expected_plan_hash)
                if args.apply
                else preview_repair(db, ledger)
            )
            if args.apply:
                db.commit()
            print(
                json.dumps(
                    {k: v for k, v in report.items() if not k.startswith("_")}, ensure_ascii=False
                )
            )
        except Exception:
            db.rollback()
            raise
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
