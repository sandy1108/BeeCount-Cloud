"""分类关联回归：只使用合成账单。"""

from sqlalchemy import select
from test_baishi_aa import client as _client
from test_baishi_aa import upload, workbook
from test_baishi_review import confirm_execute
from test_import_csv import _login, _make_ledger

from src.database import get_db
from src.main import app
from src.models import ReadTxProjection, SyncChange, UserCategoryProjection

client = _client


def test_import_links_leaf_and_category_filter(client):
    token = _login(client)
    ledger = _make_ledger(client, token)
    confirm_execute(client, token, upload(client, token, workbook(), ledger))
    db = next(app.dependency_overrides[get_db]())
    try:
        tx = db.scalar(select(ReadTxProjection))
        leaf = db.scalar(
            select(UserCategoryProjection).where(UserCategoryProjection.name == "公交")
        )
        assert tx.category_sync_id == leaf.sync_id
        assert db.get(SyncChange, tx.source_change_id).payload_json["categoryId"] == leaf.sync_id
        headers = {"Authorization": f"Bearer {token}"}
        cats = client.get("/api/v1/read/workspace/categories", headers=headers).json()
        assert next(c for c in cats if c["id"] == leaf.sync_id)["tx_count"] == 1
        rows = client.get(
            "/api/v1/read/workspace/transactions",
            headers=headers,
            params={"category_sync_id": leaf.sync_id},
        ).json()
        assert len(rows["items"]) == 1
    finally:
        db.close()


def legacy_import(client, monkeypatch):
    from src.routers.import_data import endpoints

    token = _login(client)
    ledger = _make_ledger(client, token)
    # 模拟历史版本漏传 category_id，不直接修改待修复业务库。
    with monkeypatch.context() as patch:
        patch.setattr(endpoints, "resolve_category_id", lambda *a, **k: None)
        confirm_execute(client, token, upload(client, token, workbook(images=True), ledger))
    return token, ledger


def test_repair_sync_payload_filter_and_idempotence(client, monkeypatch):
    from src.models import Ledger
    from src.services.import_data.category_repair import apply_repair, preview_repair

    token, external = legacy_import(client, monkeypatch)
    db = next(app.dependency_overrides[get_db]())
    try:
        ledger = db.scalar(select(Ledger).where(Ledger.external_id == external))
        tx = db.scalar(select(ReadTxProjection))
        original = dict(db.get(SyncChange, tx.source_change_id).payload_json)
        assert tx.category_sync_id is None
        count_before = len(db.scalars(select(SyncChange)).all())
        plan = preview_repair(db, ledger)
        assert plan["repair_count"] == 1
        assert len(db.scalars(select(SyncChange)).all()) == count_before
        report = apply_repair(db, ledger, plan["plan_hash"])
        db.commit()
        db.expire_all()
        tx = db.scalar(select(ReadTxProjection))
        source = db.get(SyncChange, tx.source_change_id)
        assert source.change_id > plan["base_change_id"]
        assert source.payload_json == dict(original, categoryId=tx.category_sync_id)
        assert tx.attachments_json and tx.category_sync_id
        assert source.updated_by_device_id == "import-category-repair"
        assert report["repair_count"] == 1
        again = preview_repair(db, ledger)
        assert again["repair_count"] == 0
        apply_repair(db, ledger, again["plan_hash"])
        db.commit()
        assert len(db.scalars(select(SyncChange)).all()) == count_before + 1
        headers = {"Authorization": f"Bearer {token}"}
        cats = client.get("/api/v1/read/workspace/categories", headers=headers).json()
        assert next(c for c in cats if c["id"] == tx.category_sync_id)["tx_count"] == 1
        full = client.get("/api/v1/sync/full", headers=headers, params={"ledger_id": external})
        assert full.status_code == 200
        assert tx.category_sync_id in full.text
        pull = client.get(
            "/api/v1/sync/pull", headers=headers, params={"since": plan["base_change_id"]}
        )
        assert pull.status_code == 200 and tx.category_sync_id in pull.text
    finally:
        db.close()


def test_repair_stale_plan_ambiguity_and_rollback(client, monkeypatch):
    import pytest

    from src.models import Ledger
    from src.services.import_data import category_repair

    _, external = legacy_import(client, monkeypatch)
    db = next(app.dependency_overrides[get_db]())
    try:
        ledger = db.scalar(select(Ledger).where(Ledger.external_id == external))
        plan = category_repair.preview_repair(db, ledger)
        leaf = db.scalar(
            select(UserCategoryProjection).where(UserCategoryProjection.name == "公交")
        )
        db.add(
            UserCategoryProjection(
                user_id=leaf.user_id,
                sync_id="cat_ambiguous",
                name=leaf.name,
                kind=leaf.kind,
                level=1,
            )
        )
        db.commit()
        with pytest.raises(ValueError, match="计划已变化"):
            category_repair.apply_repair(db, ledger, plan["plan_hash"])
        assert category_repair.preview_repair(db, ledger)["repair_count"] == 0
        db.delete(db.get(UserCategoryProjection, (leaf.user_id, "cat_ambiguous")))
        db.commit()
        plan = category_repair.preview_repair(db, ledger)
        real = category_repair._emit_entity_diffs

        def fail_after_write(*a, **kw):
            real(*a, **kw)
            raise RuntimeError("synthetic rollback")

        with monkeypatch.context() as patch:
            patch.setattr(category_repair, "_emit_entity_diffs", fail_after_write)
            with pytest.raises(RuntimeError):
                category_repair.apply_repair(db, ledger, plan["plan_hash"])
            db.rollback()
        assert db.scalar(select(ReadTxProjection)).category_sync_id is None
        assert category_repair.preview_repair(db, ledger)["plan_hash"] == plan["plan_hash"]
    finally:
        db.close()


def test_resolver_disambiguates_parent_and_kind():
    import pytest

    from src.services.import_data.category_links import resolve_category_id

    categories = [
        dict(syncId="p1", name="交通", kind="expense", level=1),
        dict(syncId="p2", name="旅行", kind="expense", level=1),
        dict(syncId="a", name="公交", kind="expense", level=2, parentSyncId="p1"),
        dict(syncId="b", name="公交", kind="expense", level=2, parentSyncId="p2"),
        dict(syncId="i", name="公交", kind="income", level=1),
    ]
    assert resolve_category_id(categories, "公交", "expense", "交通") == "a"
    assert resolve_category_id(categories, "公交", "income") == "i"
    with pytest.raises(ValueError):
        resolve_category_id(categories, "公交", "expense", legacy=True)
    with pytest.raises(ValueError):
        resolve_category_id(categories, "缺失", "expense")


def test_native_csv_also_writes_category_ids(client):
    from test_import_csv import _beecount_csv, _iter_sse

    token = _login(client)
    ledger = _make_ledger(client, token)
    headers = {"Authorization": f"Bearer {token}"}
    result = client.post(
        "/api/v1/import/upload",
        headers=headers,
        files={"file": ("synthetic.csv", _beecount_csv().encode(), "text/csv")},
        data={"target_ledger_id": ledger},
    ).json()
    response = client.post(f"/api/v1/import/{result['import_token']}/execute", headers=headers)
    assert any(e["event"] == "complete" for e in _iter_sse(response))
    db = next(app.dependency_overrides[get_db]())
    try:
        rows = db.scalars(
            select(ReadTxProjection).where(ReadTxProjection.tx_type != "transfer")
        ).all()
        assert rows and all(tx.category_sync_id for tx in rows if tx.category_name)
    finally:
        db.close()


def test_repair_skips_non_import_and_other_ledger(client, monkeypatch):
    from src.models import Ledger
    from src.services.import_data.category_repair import preview_repair

    token, external = legacy_import(client, monkeypatch)
    other = _make_ledger(client, token)
    db = next(app.dependency_overrides[get_db]())
    try:
        ledger = db.scalar(select(Ledger).where(Ledger.external_id == external))
        other_ledger = db.scalar(select(Ledger).where(Ledger.external_id == other))
        assert preview_repair(db, other_ledger)["repair_count"] == 0
        tx = db.scalar(select(ReadTxProjection))
        db.get(SyncChange, tx.source_change_id).updated_by_device_id = "mobile-device"
        db.commit()
        plan = preview_repair(db, ledger)
        assert plan["repair_count"] == 0 and plan["skipped"]["not_current_import"] == 1
    finally:
        db.close()
