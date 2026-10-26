"""首页统计下钻：合成数据验证完整汇总、精确组、权限和各出口一致。"""
import csv
import io
import json
from datetime import datetime, timezone

from sqlalchemy import select
from test_baishi_aa import client as _client
from test_import_csv import _login, _make_ledger
from src.database import get_db
from src.main import app
from src.models import Ledger, ReadTxProjection

client = _client


def seed(client):
    token = _login(client)
    h = {'Authorization': f'Bearer {token}'}
    ledger = _make_ledger(client, token)
    other = _make_ledger(client, token)
    db = next(app.dependency_overrides[get_db]())
    try:
        led = db.scalar(select(Ledger).where(Ledger.external_id == ledger))
        led.statistics_mode = 'ski_season'
        second = db.scalar(select(Ledger).where(Ledger.external_id == other))
        def add(sid, **overrides):
            data = dict(ledger_id=led.id, user_id=led.user_id, sync_id=sid,
                        tx_type='expense', amount=99, native_amount=1.25,
                        category_name=' 住宿 ', category_sync_id='old-id',
                        happened_at=datetime(2025, 5, 1, tzinfo=timezone.utc),
                        attachments_json=json.dumps([{'fileName': 'shared.jpg', 'cloudFileId': 'shared'}]))
            data.update(overrides)
            db.add(ReadTxProjection(**data))
        for i in range(1002):
            add(f'valid-{i}', category_sync_id='new-id' if i % 2 else 'old-id')
        add('other-type', tx_type='income')
        add('excluded', exclude_from_stats=True)
        add('substring', category_name='住宿押金')
        add('before', happened_at=datetime(2025, 4, 30, 15, 59, 59, tzinfo=timezone.utc))
        add('after', happened_at=datetime(2026, 4, 30, 16, tzinfo=timezone.utc))
        add('other-ledger', ledger_id=second.id)
        add('unnamed', category_name=None)
        db.commit()
    finally:
        db.close()
    return h, ledger


def params(ledger):
    return dict(ledger_id=ledger, category_group='住宿', tx_type='expense', statistics_only=True,
                date_from='2025-04-30T16:00:00Z', date_to='2026-04-30T16:00:00Z')


def test_group_list_csv_gallery_and_full_statistics_agree(client):
    h, ledger = seed(client)
    p = params(ledger)
    page = client.get('/api/v1/read/workspace/transactions', headers=h, params={**p, 'limit': 2, 'offset': 1000})
    assert page.status_code == 200, page.text
    assert page.json()['total'] == 1002
    assert len(page.json()['items']) == 2
    result = client.get('/api/v1/read/workspace/category-statistics', headers=h,
                        params={**p, 'tz_offset_minutes': 480})
    assert result.status_code == 200, result.text
    stats = result.json()
    assert stats['count'] == 1002
    assert stats['total'] == 1252.5  # 折本位币，全部1002笔；不是原币99，也不是前1000笔
    assert stats['avg'] == 1.25
    assert stats['max']['amount'] == 1.25
    assert stats['monthly'] == [{'bucket': '2025-05', 'amount': 1252.5, 'count': 1002}]
    result = client.get('/api/v1/read/workspace/transactions.csv', headers=h, params=p)
    assert result.status_code == 200, result.text
    assert len(list(csv.reader(io.StringIO(result.content.decode('utf-8-sig'))))) == 1003
    result = client.get('/api/v1/read/workspace/attachments', headers=h, params=p)
    assert result.status_code == 200, result.text
    assert result.json()['transaction_total'] == 1002
    linked = result.json()['items'][0]['transactions']
    assert len(linked) == 1002
    assert all(t['id'].startswith('valid-') for t in linked)
    analytics = client.get('/api/v1/read/workspace/analytics', headers=h, params=dict(
        ledger_id=ledger, scope='ski_season', period='2025', tz_offset_minutes=480)).json()
    rank = next(r for r in analytics['category_ranks'] if r['category_name'] == '住宿')
    assert rank['tx_count'] == 1002
    assert rank['category_group'] == '住宿'
    assert analytics['range']['end_at_exclusive'] == '2026-04-30T16:00:00Z'


def test_group_scope_permissions_and_no_implicit_fuzzy_match(client):
    h, ledger = seed(client)
    other = _login(client, 'private-other@example.com')
    headers = {'Authorization': f'Bearer {other}'}
    p = params(ledger)
    for path in ['transactions', 'category-statistics', 'attachments']:
        result = client.get('/api/v1/read/workspace/' + path, headers=headers, params=p)
        assert result.status_code in (200, 404), result.text
        if result.status_code == 200:
            assert result.json().get('total', result.json().get('count')) == 0
    result = client.get('/api/v1/read/workspace/transactions', headers=h,
                        params={**p, 'category_group': 'Uncategorized'})
    assert result.json()['total'] == 1
    # 未启用统计筛选的旧列表仍能查看被排除的交易。
    assert client.get('/api/v1/read/workspace/transactions', headers=h,
                      params={'ledger_id': ledger}).json()['total'] == 1008


def test_income_and_empty_groups_use_same_basis(client):
    h, ledger = seed(client)
    p = {**params(ledger), 'tx_type': 'income'}
    stats = client.get('/api/v1/read/workspace/category-statistics', headers=h, params=p)
    assert stats.status_code == 200, stats.text
    assert stats.json()['count'] == 1 and stats.json()['total'] == 1.25
    ranks = client.get('/api/v1/read/workspace/analytics', headers=h, params=dict(
        ledger_id=ledger, scope='ski_season', period='2025', metric='income', tz_offset_minutes=480)).json()['category_ranks']
    assert next(r for r in ranks if r['category_name'] == '住宿')['tx_count'] == 1
    empty = client.get('/api/v1/read/workspace/category-statistics', headers=h,
                       params={**p, 'category_group': '没有此分类'}).json()
    assert empty['count'] == 0 and empty['total'] == 0 and empty['monthly'] == []
    assert client.get('/api/v1/read/workspace/category-statistics', headers=h,
                      params={'ledger_id': ledger}).status_code == 400


def test_admin_role_cannot_bypass_member_scope_for_statistics(client):
    _, ledger = seed(client)
    token = _login(client, 'statistics-admin@example.com')
    db = next(app.dependency_overrides[get_db]())
    try:
        from src.models import User
        admin = db.scalar(select(User).where(User.email == 'statistics-admin@example.com'))
        admin.is_admin = True
        db.commit()
    finally:
        db.close()
    headers = {'Authorization': f'Bearer {token}'}
    p = params(ledger)
    page = client.get('/api/v1/read/workspace/transactions', headers=headers, params=p)
    stats = client.get('/api/v1/read/workspace/category-statistics', headers=headers, params=p)
    assert page.status_code == stats.status_code == 200
    assert stats.json()['count'] == page.json()['total'] == 0
    assert stats.json()['total'] == 0
    assert client.get('/api/v1/read/workspace/attachments', headers=headers, params=p).status_code == 404
