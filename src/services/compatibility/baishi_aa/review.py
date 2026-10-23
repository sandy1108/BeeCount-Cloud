"""百事AA跨文件核对：纯匹配与来源暂存，不自动覆盖账单。"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict, deque
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select

from ....models import ImportSourceRecord
from . import source_id


def digest(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()
    ).hexdigest()


def instant(value) -> str:
    dt = (
        value
        if isinstance(value, datetime)
        else datetime.fromisoformat(value.replace("Z", "+00:00"))
    )
    return (
        dt.replace(tzinfo=timezone.utc).isoformat()
        if dt.tzinfo is None
        else dt.astimezone(timezone.utc).isoformat()
    )


def source_payload(data, tx) -> dict:
    """依据原始字段与图片内容，不使用文件名、行号或可编辑的目标账单内容。"""
    cells = dict(data.source_records[tx.source_row_number])
    for name in ("交易金额", "默认币种金额", "付款金额", "分摊金额"):
        cells[name] = str(Decimal(cells[name]).normalize())
    cells["日期"] = instant(tx.happened_at)
    return {
        "version": 1,
        "cells": cells,
        "images": sorted(
            hashlib.sha256(a.data).hexdigest()
            for a in data.attachments
            if a.row_number == tx.source_row_number
        ),
    }


def candidate(item) -> dict:
    return {
        "sync_id": item["syncId"],
        "tx_type": item.get("type"),
        "amount": str(item.get("amount")),
        "currency_code": item.get("currencyCode"),
        "happened_at": item.get("happenedAt"),
        "note": item.get("note"),
        "category_name": item.get("categoryName"),
        "account_name": item.get("accountName"),
    }


def build_review(db, entry, txs, ledger, snapshot, decisions=None) -> dict:
    """一对一分配目标记录，避免一条旧记录吞掉多条真实同额同时间消费。"""
    live = {item["syncId"]: item for item in snapshot.get("items", [])}
    records = (
        list(
            db.scalars(
                select(ImportSourceRecord)
                .where(ImportSourceRecord.ledger_id == ledger.id)
                .order_by(ImportSourceRecord.id)
            )
        )
        if ledger
        else []
    )
    exact = defaultdict(set)
    by_time = defaultdict(set)
    by_amount = defaultdict(set)
    base_currency = ledger.currency if ledger else entry.data.source_currency

    def currency(item):
        return item.get("currencyCode") or base_currency

    def amount_key(kind, code, amount):
        return (kind, code, Decimal(str(amount)).normalize())

    for item_id, item in live.items():
        by_time[(item.get("type"), currency(item), instant(item["happenedAt"]))].add(item_id)
        by_amount[amount_key(item.get("type"), currency(item), item["amount"])].add(item_id)
    for record in records:
        if record.transaction_sync_id in live:
            exact[record.fingerprint].add(record.transaction_sync_id)
            original = record.source_payload["cells"]
            kind = {"支出": "expense", "收入": "income"}[original["交易类型"]]
            by_time[(kind, original.get("币种") or base_currency, original["日期"])].add(
                record.transaction_sync_id
            )
            by_amount[
                amount_key(kind, original.get("币种") or base_currency, original["交易金额"])
            ].add(record.transaction_sync_id)
    revision = digest(
        {
            "file": entry.data.source_file_hash,
            "target": entry.target_ledger_id,
            "new_name": entry.new_ledger_name,
            "mapping": asdict(entry.mapping),
            "strategy": entry.dedup_strategy,
            "tags": entry.auto_tag_names,
            "items": sorted(live.items()),
            "sources": [(r.id, r.fingerprint, r.transaction_sync_id) for r in records],
        }
    )
    exact = {key: deque(sorted(ids)) for key, ids in exact.items()}
    used = set()
    rows = []
    # 优先为整份文件预留精确匹配，再处理疑似项，避免修改行抢走后续精确行。
    for tx in txs:
        payload = source_payload(entry.data, tx)
        fp = digest(payload)
        old_id = source_id(entry.data.source_file_hash, tx.source_row_number)
        matches = exact.get(fp, deque())
        while matches and matches[0] in used:
            matches.popleft()
        reason = "content"
        if old_id in live and old_id not in used:
            match_id, reason = old_id, "same_file"
        else:
            match_id = matches.popleft() if matches else None
        if match_id:
            used.add(match_id)
        rows.append(
            {
                "row_number": tx.source_row_number,
                "kind": "matched" if match_id else "new",
                "reason": reason if match_id else "new",
                "match_id": match_id,
                "incoming": {
                    "tx_type": tx.tx_type,
                    "amount": str(tx.amount),
                    "currency_code": tx.currency_code,
                    "happened_at": tx.happened_at.isoformat(),
                    "note": tx.note,
                    "category_name": tx.category_name,
                    "account_name": tx.account_name,
                },
                "fingerprint": fp,
                "source_payload": payload,
                "candidates": [],
            }
        )
    available = {key: sorted(ids - used) for key, ids in by_time.items()}
    choices = entry.review_decisions if decisions is None else decisions
    claimed = set()
    for tx, row in zip(txs, rows, strict=True):
        if row["match_id"]:
            ids = [row["match_id"]]
        else:
            ids = available.get((tx.tx_type, tx.currency_code, instant(tx.happened_at)), [])
            # 改过时间的来源无法精确识别；仅给出前后7天同币种同金额候选，绝不自动跳过。
            near = by_amount.get(amount_key(tx.tx_type, tx.currency_code, tx.amount), set()) - used
            nearby = [
                i
                for i in near
                if abs(
                    datetime.fromisoformat(instant(live[i]["happenedAt"]))
                    - datetime.fromisoformat(instant(tx.happened_at))
                )
                <= timedelta(days=7)
            ]
            if nearby:
                if not ids:
                    row["reason"] = "near_time"
                ids = sorted(set(ids) | set(nearby))
            if ids:
                row["kind"] = "review"
                if row["reason"] != "near_time":
                    row["reason"] = "similar"
        # 限制候选展示数量；明确显示总数，不自动选择未展示的记录。
        row["candidate_count"] = len(ids)
        row["candidates"] = [
            {**candidate(live[i]), "currency_code": currency(live[i])} for i in ids[:20]
        ]
        choice = choices.get(str(row["row_number"]))
        if choice:
            if choice["action"] == "skip":
                selected = choice.get("match_id") or row["match_id"]
                if selected not in ids:
                    raise ValueError("跳过时必须选择当前候选中的一条已有记录。")
                row["action"], row["match_id"] = "skip", selected
            else:
                row["action"], row["match_id"] = "insert", None
        elif entry.dedup_strategy == "insert_all":
            row["action"], row["match_id"] = "insert", None
        else:
            row["action"] = {"matched": "skip", "new": "insert", "review": None}[row["kind"]]
        # 整批核对必须一对一；人工选择也不能让同一旧记录吞掉多笔消费。
        if row["action"] == "skip":
            if row["match_id"] in claimed:
                raise ValueError(
                    "同一条已有记录不能关联本批次的多条来源记录，请为其他行选择新增或不同候选。"
                )
            claimed.add(row["match_id"])
    counts = {
        kind: sum(row["kind"] == kind for row in rows) for kind in ("new", "matched", "review")
    }
    counts.update(
        {
            kind: sum(row["action"] == action for row in rows)
            for kind, action in [("insert", "insert"), ("skip", "skip"), ("unresolved", None)]
        }
    )
    return {"revision": revision, "counts": counts, "items": rows, "total": len(rows)}


def public_review(plan, offset=0, limit=25):
    """原始来源只存服务端，页面只返回核对需要的字段。"""
    return {
        **plan,
        "offset": offset,
        "limit": limit,
        "items": [
            {k: v for k, v in row.items() if k not in ("source_payload", "fingerprint")}
            for row in plan["items"][offset : offset + limit]
        ],
    }


def stage_source(db, ledger, data, row, transaction_id):
    """与账单在同一事务中记录来源，重复关联不累加计数。"""
    exists = db.scalar(
        select(ImportSourceRecord).where(
            ImportSourceRecord.ledger_id == ledger.id,
            ImportSourceRecord.file_hash == data.source_file_hash,
            ImportSourceRecord.row_number == row["row_number"],
            ImportSourceRecord.transaction_sync_id == transaction_id,
        )
    )
    if exists is None:
        db.add(
            ImportSourceRecord(
                ledger_id=ledger.id,
                source_format="baishi_aa",
                file_hash=data.source_file_hash,
                row_number=row["row_number"],
                fingerprint=row["fingerprint"],
                source_payload=row["source_payload"],
                transaction_sync_id=transaction_id,
            )
        )
        db.flush()
