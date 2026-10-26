"""雪季统计：边界、账本隔离和旧手机元信息同步兼容。"""

from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from test_baishi_aa import client as _client
from test_category_type_coverage import write
from test_import_csv import _login, _make_ledger

from src.database import get_db
from src.main import app
from src.models import Ledger, SyncChange
from src.routers.read._shared import _analytics_range, _bucket_key
from src.sync_applier import apply_change_to_projection

client = _client


def test_season_range_and_calendar_buckets():
    start, end, label = _analytics_range(
        scope="ski_season", period="2025", tz_offset_minutes=480, month_start_day=20
    )
    assert start == datetime(2025, 4, 30, 16, tzinfo=timezone.utc)
    assert end == datetime(2026, 4, 30, 16, tzinfo=timezone.utc)
    assert label == "2025"
    assert (
        _bucket_key("ski_season", datetime(2026, 1, 1, tzinfo=timezone.utc), 480, 20) == "2026-01"
    )


@pytest.mark.parametrize("period", ["abc", "25~26", "0", "10000"])
def test_invalid_season_period(period):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        _analytics_range(scope="ski_season", period=period)
    assert exc.value.status_code == 400


def test_mode_and_season_statistics_are_isolated(client):
    token = _login(client)
    h = {"Authorization": f"Bearer {token}"}
    response = client.post(
        "/api/v1/write/ledgers",
        headers=h,
        json={"ledger_name": "合成雪季", "statistics_mode": "ski_season", "month_start_day": 20},
    )
    assert response.status_code == 200, response.text
    ledger = response.json()["entity_id"]
    ordinary = _make_ledger(client, token)
    rows = client.get("/api/v1/read/ledgers", headers=h).json()
    assert next(r for r in rows if r["ledger_id"] == ledger)["statistics_mode"] == "ski_season"
    assert next(r for r in rows if r["ledger_id"] == ordinary)["statistics_mode"] == "standard"
    for time, amount in [
        ("2025-04-30T15:59:59Z", 1),
        ("2025-04-30T16:00:00Z", 10),
        ("2026-01-01T00:00:00Z", 20),
        ("2026-04-30T15:59:59Z", 30),
        ("2026-04-30T16:00:00Z", 100),
    ]:
        write(client, h, ledger, "transactions", tx_type="expense", amount=amount, happened_at=time)
    write(
        client,
        h,
        ledger,
        "transactions",
        tx_type="income",
        amount=80,
        happened_at="2026-02-01T00:00:00Z",
    )
    write(
        client,
        h,
        ordinary,
        "transactions",
        tx_type="expense",
        amount=999,
        happened_at="2026-02-01T00:00:00Z",
    )
    params = {
        "ledger_id": ledger,
        "scope": "ski_season",
        "period": "2025",
        "tz_offset_minutes": 480,
    }
    res = client.get("/api/v1/read/workspace/analytics", headers=h, params=params)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["summary"]["expense_total"] == 60
    assert body["summary"]["income_total"] == 80
    assert body["summary"]["transaction_count"] == 4
    assert [s["bucket"] for s in body["series"]] == ["2025-05", "2026-01", "2026-02", "2026-04"]
    assert sum(r["total"] for r in body["category_ranks"]) == 60
    for target in [None, ordinary]:
        bad = dict(params)
        bad["ledger_id"] = target
        if target is None:
            bad.pop("ledger_id")
        assert (
            client.get("/api/v1/read/workspace/analytics", headers=h, params=bad).status_code == 400
        )
    other = _login(client, "season-other@example.com")
    assert client.get(
        "/api/v1/read/workspace/analytics",
        headers={"Authorization": f"Bearer {other}"},
        params=params,
    ).status_code in (400, 404)


def test_legacy_sync_missing_mode_does_not_reset_it(client):
    token = _login(client)
    ledger = _make_ledger(client, token)
    db = next(app.dependency_overrides[get_db]())
    try:
        row = db.scalar(select(Ledger).where(Ledger.external_id == ledger))
        row.statistics_mode = "ski_season"
        db.commit()
        change = SyncChange(
            user_id=row.user_id,
            ledger_id=row.id,
            entity_type="ledger",
            entity_sync_id=ledger,
            action="upsert",
            payload_json={"ledgerName": "旧手机修改名字", "currency": "CNY", "monthStartDay": 2},
            updated_by_device_id="synthetic-legacy-phone",
        )
        apply_change_to_projection(db, ledger_id=row.id, ledger_owner_id=row.user_id, change=change)
        db.commit()
        db.refresh(row)
        assert row.statistics_mode == "ski_season"
        assert row.name == "旧手机修改名字"
    finally:
        db.close()


@pytest.mark.parametrize(
    "date,year",
    [
        ("2026-01-01", "2025"),
        ("2026-05-01", "2026"),
        ("2026-09-30", "2026"),
        ("2026-10-01", "2026"),
    ],
)
def test_default_season_during_off_season(date, year):
    from src.services.statistics_period import ski_season_range

    assert (
        ski_season_range(
            period=None, now=datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
        )[2]
        == year
    )


def test_meta_mode_change_and_legacy_app_push(client):
    token = _login(client)
    h = {"Authorization": f"Bearer {token}"}
    ledger = _make_ledger(client, token)
    r = client.patch(
        f"/api/v1/write/ledgers/{ledger}/meta",
        headers=h,
        json={"base_change_id": 0, "statistics_mode": "ski_season"},
    )
    assert r.status_code == 200, r.text
    detail = client.get(f"/api/v1/read/ledgers/{ledger}", headers=h).json()
    assert detail["statistics_mode"] == "ski_season"
    # 真实同步入口：旧手机只传原来知道的元信息字段。
    login = client.post(
        "/api/v1/auth/login",
        json={
            "email": "imp@test.com",
            "password": "Pa$$word1!",
            "client_type": "app",
            "device_name": "legacy",
            "platform": "android",
        },
    )
    assert login.status_code == 200, login.text
    auth = login.json()
    push = client.post(
        "/api/v1/sync/push",
        headers={"Authorization": f"Bearer {auth['access_token']}"},
        json={
            "device_id": auth["device_id"],
            "changes": [
                {
                    "ledger_id": ledger,
                    "entity_type": "ledger",
                    "entity_sync_id": ledger,
                    "action": "upsert",
                    "updated_at": "2030-01-01T00:00:00Z",
                    "payload": {
                        "ledgerName": "旧手机新名字",
                        "currency": "CNY",
                        "monthStartDay": 2,
                    },
                }
            ],
        },
    )
    assert push.status_code == 200, push.text
    assert push.json()["accepted"] == 1
    detail = client.get(f"/api/v1/read/ledgers/{ledger}", headers=h).json()
    assert detail["statistics_mode"] == "ski_season"
    assert detail["ledger_name"] == "旧手机新名字"
    # Web旧表单也不得重置模式。
    assert (
        client.patch(
            f"/api/v1/write/ledgers/{ledger}/meta",
            headers=h,
            json={"base_change_id": 0, "ledger_name": "旧Web新名字"},
        ).status_code
        == 200
    )
    assert (
        client.get(f"/api/v1/read/ledgers/{ledger}", headers=h).json()["statistics_mode"]
        == "ski_season"
    )
    bad = client.patch(
        f"/api/v1/write/ledgers/{ledger}/meta",
        headers=h,
        json={"base_change_id": 0, "statistics_mode": "unknown"},
    )
    assert bad.status_code == 422
    # 恢复普通模式，不会改动交易。
    assert (
        client.patch(
            f"/api/v1/write/ledgers/{ledger}/meta",
            headers=h,
            json={"base_change_id": 0, "statistics_mode": "standard"},
        ).status_code
        == 200
    )
    assert (
        client.get(f"/api/v1/read/ledgers/{ledger}", headers=h).json()["statistics_mode"]
        == "standard"
    )


def test_sqlite_migration_preserves_existing_ledger_and_is_repeatable(tmp_path):
    """使用真实Alembic链条，不以create_all替代旧数据库升级。"""
    import os
    import sqlite3
    import subprocess
    import sys

    dbpath = tmp_path / "migration.db"
    env = dict(os.environ, DATABASE_URL="sqlite:///" + str(dbpath))
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "0021_import_source_records"],
        env=env,
        check=True,
        capture_output=True,
    )
    db = sqlite3.connect(dbpath)
    db.execute(
        "INSERT INTO ledgers(id,user_id,external_id,name,currency,month_start_day,created_at) VALUES('synthetic','synthetic-user','synthetic-external','旧合成账本','CNY',20,'2025-01-01')"
    )
    db.commit()
    before = db.execute("select * from ledgers").fetchall()
    db.close()
    for _ in range(2):
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            env=env,
            check=True,
            capture_output=True,
        )
    db = sqlite3.connect(dbpath)
    rows = db.execute("select * from ledgers").fetchall()
    assert [r[:-1] for r in rows] == before
    assert rows[0][-1] == "standard"
    assert db.execute("pragma integrity_check").fetchone()[0] == "ok"
    db.close()
