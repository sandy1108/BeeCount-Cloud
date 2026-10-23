"""单币种与人工核对安全回归；仅使用合成账单。"""

import io

import pytest
from openpyxl import load_workbook
from sqlalchemy import select
from test_baishi_aa import client as _client
from test_baishi_aa import upload, workbook
from test_baishi_review import changed, confirm_execute, review
from test_import_csv import _login, _make_ledger

client = _client


def currency_file(code, *, mixed=False, converted=False):
    w = load_workbook(io.BytesIO(workbook()))
    w.active.cell(3, 6, code)
    if converted:
        w.active.cell(3, 8, "99.00")
    if mixed:
        w.active.append([c.value for c in w.active[3]])
        w.active.cell(4, 6, "CNY")
    out = io.BytesIO()
    w.save(out)
    return out.getvalue()


@pytest.mark.parametrize("currency", ["CNY", "USD", "JPY", "HKD", "MOP"])
def test_new_single_currency_ledger_and_sync(client, currency):
    from src.database import get_db
    from src.main import app
    from src.models import Ledger, ReadTxProjection, SyncChange

    token = _login(client)
    summary = upload(client, token, currency_file(currency))
    assert summary["stats"]["parse_errors_total"] == 0
    assert summary["source_currency"] == currency
    key = summary["import_token"]
    headers = {"Authorization": f"Bearer {token}"}
    r = client.post(
        f"/api/v1/import/{key}/preview", json={"new_ledger_name": "合成外币账本"}, headers=headers
    )
    assert r.status_code == 200 and r.json()["stats"]["parse_errors_total"] == 0
    result = confirm_execute(client, token, r.json())
    assert result["created_tx_count"] == 1
    with next(app.dependency_overrides[get_db]()) as db:
        ledger = db.scalar(select(Ledger).where(Ledger.external_id == result["ledger_id"]))
        assert ledger.currency == currency
        tx = db.scalar(select(ReadTxProjection).where(ReadTxProjection.ledger_id == ledger.id))
        assert tx.currency_code == currency and float(tx.amount) == 12.30
        change = db.scalar(
            select(SyncChange).where(
                SyncChange.ledger_id == ledger.id, SyncChange.entity_type == "ledger"
            )
        )
        assert change.payload_json["currency"] == currency
    # 新账本再次导入同文件，验证同币种目标及来源去重。
    again = upload(client, token, currency_file(currency), result["ledger_id"])
    assert again["stats"]["parse_errors_total"] == 0
    assert confirm_execute(client, token, again)["created_tx_count"] == 0


@pytest.mark.parametrize("code", ["USD", "JPY", "HKD", "MOP"])
def test_currency_mismatch_blocks_review_and_execute(client, code):
    token = _login(client)
    summary = upload(client, token, currency_file(code), _make_ledger(client, token))
    assert summary["stats"]["parse_errors_total"] > 0
    assert review(client, token, summary["import_token"]).status_code == 400


@pytest.mark.parametrize(
    "code,mixed,converted",
    [("USD", True, False), ("MOP", False, True), ("AUD", False, False), ("澳币", False, False)],
)
def test_unsupported_currency_semantics_block(client, code, mixed, converted):
    token = _login(client)
    summary = upload(client, token, currency_file(code, mixed=mixed, converted=converted))
    assert summary["stats"]["parse_errors_total"] > 0


def test_two_rows_cannot_claim_same_existing_record(client):
    token = _login(client)
    ledger = _make_ledger(client, token)
    payload = workbook()
    confirm_execute(client, token, upload(client, token, payload, ledger))
    summary = upload(client, token, changed(payload, note="修订", extra=True), ledger)
    key = summary["import_token"]
    plan = review(client, token, key).json()
    decisions = {
        str(r["row_number"]): {"action": "skip", "match_id": r["candidates"][0]["sync_id"]}
        for r in plan["items"]
    }
    r = review(client, token, key, revision=plan["revision"], decisions=decisions, confirm=True)
    assert r.status_code == 400
    # 拒绝冲突后仍可一条关联、一条新增，不能丢失消费笔数。
    rows = plan["items"]
    decisions[str(rows[1]["row_number"])] = {"action": "insert"}
    assert confirm_execute(client, token, summary, decisions)["created_tx_count"] == 1


def test_changed_time_is_manual_review_not_automatic_skip(client):
    token = _login(client)
    ledger = _make_ledger(client, token)
    payload = workbook()
    confirm_execute(client, token, upload(client, token, payload, ledger))
    w = load_workbook(io.BytesIO(changed(payload)))
    w.active.cell(4, 3, "2026-01-03 11:00")
    out = io.BytesIO()
    w.save(out)
    summary = upload(client, token, out.getvalue(), ledger)
    plan = review(client, token, summary["import_token"]).json()
    assert plan["counts"]["review"] == 1 and plan["counts"]["unresolved"] == 1
    assert plan["items"][0]["reason"] == "near_time"
    assert (
        review(
            client, token, summary["import_token"], revision=plan["revision"], confirm=True
        ).status_code
        == 409
    )


def test_far_time_edit_remains_new_and_wrong_currency_not_candidate(client):
    token = _login(client)
    ledger = _make_ledger(client, token)
    payload = workbook()
    confirm_execute(client, token, upload(client, token, payload, ledger))
    w = load_workbook(io.BytesIO(changed(payload)))
    w.active.cell(4, 3, "2026-02-03 11:00")
    out = io.BytesIO()
    w.save(out)
    summary = upload(client, token, out.getvalue(), ledger)
    plan = review(client, token, summary["import_token"]).json()
    assert plan["counts"]["new"] == 1


def test_mapping_cannot_disguise_source_currency(client):
    token = _login(client)
    ledger = _make_ledger(client, token)
    summary = upload(client, token, currency_file("USD"), ledger)
    key = summary["import_token"]
    mapping = dict(summary["current_mapping"])
    mapping["currency"] = None
    response = client.post(
        f"/api/v1/import/{key}/preview",
        json={"mapping": mapping},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200 and response.json()["stats"]["parse_errors_total"] > 0
    assert review(client, token, key).status_code == 400
