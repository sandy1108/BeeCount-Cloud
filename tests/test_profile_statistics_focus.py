"""统计视角只属于当前用户；旧客户端部分更新不能重置该偏好。"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.database import Base, get_db
from src.main import app


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine)

    def database():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = database
    test_client = TestClient(app)
    try:
        yield test_client
    finally:
        test_client.close()
        app.dependency_overrides.clear()
        engine.dispose()


def login(client, email, client_type="web"):
    response = client.post("/api/v1/auth/register", json={
        "email": email, "password": "Synthetic-password1!", "client_type": client_type,
    })
    assert response.status_code == 200, response.text
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def test_default_roundtrip_and_switch_back(client):
    headers = login(client, "focus@example.com")
    assert client.get("/api/v1/profile/me", headers=headers).json()["statistics_focus"] == "balance"
    for focus in ("expense", "balance"):
        response = client.patch("/api/v1/profile/me", headers=headers, json={"statistics_focus": focus})
        assert response.status_code == 200, response.text
        assert response.json()["statistics_focus"] == focus
        assert client.get("/api/v1/profile/me", headers=headers).json()["statistics_focus"] == focus


@pytest.mark.parametrize("patch", [
    {"appearance": {"compact_amount": True}},
    {"appearance": {}},
    {"display_name": "旧手机"},
    {"statistics_focus": None},
])
def test_old_client_partial_update_preserves_focus(client, patch):
    headers = login(client, "legacy@example.com", client_type="app")
    client.patch("/api/v1/profile/me", headers=headers, json={"statistics_focus": "expense"})
    response = client.patch("/api/v1/profile/me", headers=headers, json=patch)
    assert response.status_code == 200, response.text
    assert response.json()["statistics_focus"] == "expense"


def test_focus_is_user_scoped_and_does_not_change_analytics(client):
    first = login(client, "first@example.com")
    second = login(client, "second@example.com")
    ledger_response = client.post("/api/v1/write/ledgers", headers=first, json={"ledger_name": "合成测试"})
    assert ledger_response.status_code == 200, ledger_response.text
    ledger = ledger_response.json()["entity_id"]
    for kind, amount in (("income", 100), ("expense", 65)):
        response = client.post(f"/api/v1/write/ledgers/{ledger}/transactions", headers=first, json={
            "base_change_id": 0, "tx_type": kind, "amount": amount,
            "happened_at": "2026-01-10T03:00:00Z",
        })
        assert response.status_code == 200, response.text
    params = {"ledger_id": ledger, "scope": "all"}
    before = client.get("/api/v1/read/workspace/analytics", headers=first, params=params).json()
    client.patch("/api/v1/profile/me", headers=first, json={"statistics_focus": "expense"})
    after = client.get("/api/v1/read/workspace/analytics", headers=first, params=params).json()
    assert before == after
    assert after["summary"]["income_total"] == 100
    assert after["summary"]["expense_total"] == 65
    assert after["summary"]["balance"] == 35
    assert client.get("/api/v1/profile/me", headers=second).json()["statistics_focus"] == "balance"


def test_focus_change_notifies_only_current_user(client, monkeypatch):
    events = []

    async def broadcast(user_id, message):
        events.append((user_id, message))

    monkeypatch.setattr(app.state.ws_manager, "broadcast_to_user", broadcast)
    headers = login(client, "notify@example.com")
    response = client.patch("/api/v1/profile/me", headers=headers, json={"statistics_focus": "expense"})
    assert response.status_code == 200, response.text
    assert events[-1][0] == response.json()["user_id"]
    assert events[-1][1]["type"] == "profile_change"
    assert events[-1][1]["statistics_focus"] == "expense"


@pytest.mark.parametrize("invalid", ["", "income", "EXPENSE", 1])
def test_invalid_focus_is_rejected_without_mutation(client, invalid):
    headers = login(client, "invalid@example.com")
    client.patch("/api/v1/profile/me", headers=headers, json={"statistics_focus": "expense"})
    response = client.patch("/api/v1/profile/me", headers=headers, json={"statistics_focus": invalid})
    assert response.status_code == 422, response.text
    assert client.get("/api/v1/profile/me", headers=headers).json()["statistics_focus"] == "expense"
