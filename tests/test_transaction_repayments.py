"""关联回款契约：现金流水不变；同本/同币/同季；旧端不能破坏关系。"""
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from src import projection
from src.main import app
from src.models import Ledger, ReadTxProjection
from src.services import settlements
from tests.test_tx_multi_currency import _make_client, _register_and_token, _push


@pytest.fixture
def env():
    client, TS = _make_client()
    token = _register_and_token(client, 'repayment@example.com', device_id='d-web', client_type='web')
    h = {'Authorization': f'Bearer {token}'}
    r = client.post('/api/v1/write/ledgers', headers=h, json={'ledger_name': '合成回款', 'currency': 'CNY'})
    assert r.status_code == 200, r.text
    ext = r.json()['entity_id']
    with TS() as db:
        ledger = db.scalar(select(Ledger).where(Ledger.external_id == ext))
        lid = ledger.id
        for sid, kind, amount in [('tx_e', 'expense', 3000), ('tx_i1', 'income', 750), ('tx_i2', 'income', 750), ('tx_i3', 'income', 750), ('tx_big', 'income', 2000)]:
            projection.upsert_tx(db, ledger_id=lid, user_id=ledger.user_id, source_change_id=0,
                payload={'syncId': sid, 'type': kind, 'amount': amount, 'happenedAt': '2026-10-20T12:00:00Z', 'note': sid})
        db.commit()
    yield client, TS, h, ext, lid
    app.dependency_overrides.clear()


def link(client, h, ext, income='tx_i1', **kw):
    return client.post(f'/api/v1/write/ledgers/{ext}/transactions/tx_e/repayments', headers=h,
        json={'income_id': income, 'tz_offset_minutes': 480, **kw})


def summary(client, h, ext, sid='tx_e'):
    r = client.get(f'/api/v1/read/ledgers/{ext}/transactions/{sid}/settlement', headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_three_repayments_and_explicit_unlink_preserve_cashflow(env):
    c, TS, h, ext, lid = env
    before = c.get('/api/v1/read/ledgers', headers=h).json()
    for i in range(1, 4):
        r = link(c, h, ext, f'tx_i{i}', note='分摊回款')
        assert r.status_code == 200, r.text
    s = summary(c, h, ext)
    assert (s['original_amount'], s['repaid_amount'], s['own_amount']) == ('3000', '2250', '750')
    assert len(s['repayments']) == 3
    assert s['tz_offset_minutes'] == 480
    assert s['can_manage'] is True
    assert summary(c, h, ext, 'tx_i1')['expense']['sync_id'] == 'tx_e'
    after = c.get('/api/v1/read/ledgers', headers=h).json()
    for key in ['income_total', 'expense_total', 'transaction_count', 'balance']:
        assert before[0][key] == after[0][key]
    r = c.delete(f'/api/v1/write/ledgers/{ext}/transactions/tx_e/repayments/tx_i1', headers=h)
    assert r.status_code == 200, r.text
    assert summary(c, h, ext)['own_amount'] == '1500'
    assert summary(c, h, ext, 'tx_i1')['expense'] is None


def test_replay_overpayment_and_candidate_pagination(env):
    c, TS, h, ext, lid = env
    assert link(c, h, ext).status_code == 200
    assert link(c, h, ext).status_code == 200  # 相同关系幂等，不重复抵扣
    assert link(c, h, ext, note='另一个说明').status_code == 409
    assert link(c, h, ext, 'tx_big').status_code == 200
    assert link(c, h, ext, 'tx_i2').status_code == 409
    s = summary(c, h, ext)
    assert s['repaid_amount'] == '2750'
    r = c.get(f'/api/v1/read/ledgers/{ext}/transactions/tx_e/repayment-candidates?tz_offset_minutes=0&limit=1', headers=h)
    assert r.status_code == 200, r.text
    assert r.json()['tz_offset_minutes'] == 480  # 已建立的组不随另一设备变化
    assert r.json()['total'] == 0  # 剩余250，750的候选均不可选


@pytest.mark.parametrize('patch', [
    {'amount': 500}, {'type': 'transfer'}, {'happenedAt': '2027-05-01T01:00:00Z'}, {'currencyCode': 'USD'},
])
def test_projection_guards_legacy_changes(env, patch):
    c, TS, h, ext, lid = env
    assert link(c, h, ext).status_code == 200
    with TS() as db:
        lg = db.get(Ledger, lid)
        row = db.get(ReadTxProjection, (lid, 'tx_e'))
        payload = {'syncId': row.sync_id, 'type': row.tx_type, 'amount': row.amount, 'happenedAt': row.happened_at.isoformat(), **patch}
        with pytest.raises(HTTPException) as err:
            projection.upsert_tx(db, ledger_id=lid, user_id=lg.user_id, source_change_id=1, payload=payload)
        assert err.value.status_code == 409
        db.rollback()
    assert summary(c, h, ext)['repaid_amount'] == '750'


def test_web_batch_delete_and_snapshot_guard(env):
    c, TS, h, ext, lid = env
    assert link(c, h, ext).status_code == 200
    r = c.post(f'/api/v1/write/ledgers/{ext}/transactions/batch/delete', headers=h,
        json={'tx_ids': ['tx_e', 'tx_i1', 'tx_i2']})
    assert r.status_code == 200, r.text
    assert r.json()['deleted_tx_ids'] == ['tx_i2']
    assert len(r.json()['failed']) == 2
    with TS() as db:
        lg = db.get(Ledger, lid)
        with pytest.raises(HTTPException):
            projection.rebuild_from_snapshot(db, ledger_id=lid, user_id=lg.user_id, source_change_id=1, snapshot={'items': []})
        assert db.get(ReadTxProjection, (lid, 'tx_e')) is not None


def test_plain_note_edit_and_excluded_transactions_allowed(env):
    c, TS, h, ext, lid = env
    assert link(c, h, ext).status_code == 200
    r = c.patch(f'/api/v1/write/ledgers/{ext}/transactions/tx_e', headers=h,
        json={'base_change_id': 0, 'note': '只是备注', 'exclude_from_stats': True})
    assert r.status_code == 200, r.text
    s = summary(c, h, ext)
    assert s['expense']['exclude_from_stats'] is True
    assert s['own_amount'] == '2250'
    r = c.request('DELETE', f'/api/v1/write/ledgers/{ext}/transactions/tx_i1', headers=h, json={'base_change_id': 0})
    assert r.status_code == 409, r.text


@pytest.mark.parametrize('offset', [480, 0, -420])
def test_season_boundary_uses_saved_statistics_offset(env, offset):
    c, TS, h, ext, lid = env
    from datetime import timedelta
    boundary = datetime(2026, 5, 1, tzinfo=timezone(timedelta(minutes=offset))).astimezone(timezone.utc)
    with TS() as db:
        db.get(ReadTxProjection, (lid, 'tx_e')).happened_at = boundary
        db.get(ReadTxProjection, (lid, 'tx_i1')).happened_at = boundary - timedelta(seconds=1)
        db.commit()
    assert link(c, h, ext, tz_offset_minutes=offset).status_code == 409
    with TS() as db:
        db.get(ReadTxProjection, (lid, 'tx_i1')).happened_at = boundary
        db.commit()
    assert link(c, h, ext, tz_offset_minutes=offset).status_code == 200
    assert summary(c, h, ext)['season'] == '2026'


def test_permissions_viewer_revocation_and_cross_user(env):
    c, TS, h, ext, lid = env
    from src.models import LedgerMember, User
    other_token = _register_and_token(c, 'other-repayment@example.com', device_id='other-web', client_type='web')
    other = {'Authorization': f'Bearer {other_token}'}
    endpoint = f'/api/v1/read/ledgers/{ext}/transactions/tx_e/settlement'
    assert c.get(endpoint, headers=other).status_code == 404
    with TS() as db:
        uid = db.scalar(select(User.id).where(User.email == 'other-repayment@example.com'))
        db.add(LedgerMember(ledger_id=lid, user_id=uid, role='viewer'))
        db.commit()
    s = c.get(endpoint, headers=other)
    assert s.status_code == 200 and s.json()['can_manage'] is False
    assert link(c, other, ext).status_code == 404
    with TS() as db:
        member = db.scalar(select(LedgerMember).where(LedgerMember.ledger_id == lid, LedgerMember.user_id == uid))
        member.role = 'editor'
        db.commit()
    assert link(c, other, ext).status_code == 200
    with TS() as db:
        member = db.scalar(select(LedgerMember).where(LedgerMember.ledger_id == lid, LedgerMember.user_id == uid))
        db.delete(member); db.commit()
    assert c.get(endpoint, headers=other).status_code == 404
    assert link(c, other, ext, 'tx_i2').status_code == 404


def test_legacy_partial_sync_retains_links_and_rejects_dangerous_batch(env):
    c, TS, h, ext, lid = env
    token = _register_and_token(c, 'repayment@example.com', device_id='d-app', client_type='app')
    app_h = {'Authorization': f'Bearer {token}'}
    assert link(c, h, ext).status_code == 200
    _push(c, app_h, ext, 'transaction', 'tx_e', {'note': '来自旧手机的备注'})
    assert summary(c, h, ext)['expense']['note'] == '来自旧手机的备注'
    body = {'device_id': 'd-app', 'changes': [
        {'ledger_id': ext, 'entity_type': 'transaction', 'entity_sync_id': sid, 'action': 'upsert',
         'updated_at': '2027-10-20T12:00:00Z', 'payload': payload}
        for sid, payload in [('tx_i2', {'note': '这项也应回滚'}), ('tx_e', {'amount': 100})]
    ]}
    r = c.post('/api/v1/sync/push', headers=app_h, json=body)
    assert r.status_code == 409, r.text
    with TS() as db:
        assert db.get(ReadTxProjection, (lid, 'tx_i2')).note == 'tx_i2'
    assert summary(c, h, ext)['own_amount'] == '2250'


def test_snapshot_roundtrip_keeps_links_and_ledger_deletion_requires_unlink(env):
    c, TS, h, ext, lid = env
    from src import snapshot_builder
    assert link(c, h, ext).status_code == 200
    with TS() as db:
        ledger = db.get(Ledger, lid)
        snapshot = snapshot_builder.build(db, ledger)
        projection.rebuild_from_snapshot(db, ledger_id=lid, user_id=ledger.user_id, source_change_id=0, snapshot=snapshot)
        db.commit()
    assert summary(c, h, ext)['own_amount'] == '2250'
    r = c.request('DELETE', f'/api/v1/write/ledgers/{ext}', headers=h, json={'base_change_id': 0})
    assert r.status_code == 409, r.text
    assert summary(c, h, ext)['own_amount'] == '2250'


@pytest.mark.parametrize('kind,value', [('amount',0),('amount',-5),('amount',float('inf')),('currency_code','USD')])
def test_invalid_income_rejected_without_mutating_cashflow(env, kind, value):
    c, TS, h, ext, lid = env
    with TS() as db:
        setattr(db.get(ReadTxProjection, (lid, 'tx_i1')), kind, value)
        db.commit()
    assert link(c, h, ext).status_code == 409
    assert summary(c, h, ext)['repayments'] == []


def test_explicit_timezone_and_income_are_required(env):
    c, TS, h, ext, lid = env
    endpoint = f'/api/v1/write/ledgers/{ext}/transactions/tx_e/repayments'
    for body in [{'note':'孤立说明'}, {'income_id':'tx_i1'}, {'income_id':'tx_i1','tz_offset_minutes':841}]:
        assert c.post(endpoint, headers=h, json=body).status_code == 422


def test_single_income_cannot_pay_two_expenses(env):
    c, TS, h, ext, lid = env
    assert link(c, h, ext).status_code == 200
    with TS() as db:
        ledger = db.get(Ledger,lid)
        projection.upsert_tx(db, ledger_id=lid, user_id=ledger.user_id, source_change_id=0,
            payload={'syncId':'tx_e2','type':'expense','amount':3000,'happenedAt':'2026-10-01T00:00:00Z'})
        db.commit()
    r = c.post(f'/api/v1/write/ledgers/{ext}/transactions/tx_e2/repayments', headers=h,
        json={'income_id':'tx_i1','tz_offset_minutes':480})
    assert r.status_code == 409
    assert summary(c,h,ext,'tx_e2')['own_amount'] == '3000'


def test_server_logical_backup_carries_relationship_extension(env):
    c, TS, h, ext, lid = env
    from src.models import BackupSnapshot, TransactionRepayment
    assert link(c, h, ext, note='分摊回款').status_code == 200
    r = c.post('/api/v1/admin/backups/create', headers=h, json={'ledger_id':ext})
    assert r.status_code == 200, r.text
    import json
    with TS() as db:
        saved = db.get(BackupSnapshot, r.json()['snapshot_id'])
        payload = json.loads(saved.snapshot_json)
        assert payload['cloudRepayments']['version'] == 1
        assert payload['cloudRepayments']['items'][0]['income_id'] == 'tx_i1'
        # 模拟显式解除后恢复，关系从备份而不是旧端payload找回。
        settlements.remove(db, db.get(Ledger,lid), 'tx_e','tx_i1')
        db.commit()
    rr = c.post('/api/v1/admin/backups/restore', headers=h,
        json={'snapshot_id':r.json()['snapshot_id'],'device_id':'d-web'})
    assert rr.status_code == 200, rr.text
    assert summary(c,h,ext)['own_amount'] == '2250'
    assert summary(c,h,ext)['repayments'][0]['relation_note'] == '分摊回款'


def test_parallel_adds_never_overpay_file_sqlite(env, tmp_path):
    c, TS, h, ext, lid = env
    import sqlite3
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    file = tmp_path/'concurrent.db'
    raw = TS.kw['bind'].raw_connection()
    destination = sqlite3.connect(file)
    raw.driver_connection.backup(destination)
    destination.execute('PRAGMA journal_mode=WAL')
    destination.close(); raw.close()
    engine = create_engine(f'sqlite:///{file}', connect_args={'check_same_thread':False,'timeout':10})
    Session = sessionmaker(bind=engine, autoflush=False)
    with Session() as db:
        db.get(ReadTxProjection,(lid,'tx_i1')).amount=2000
        db.commit()
    barrier=Barrier(2)
    def worker(income):
        with Session() as db:
            ledger=db.get(Ledger,lid)
            barrier.wait()
            try:
                settlements.add(db,ledger,'tx_e',income,480,'',ledger.user_id)
                db.commit()
                return 200
            except HTTPException as exc:
                db.rollback()
                return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(worker,['tx_i1','tx_big']))
    assert sorted(results)==[200,409]
    with Session() as db:
        assert len(settlements.links(db,lid))==1
    engine.dispose()


def test_old_sync_ledger_tombstone_cannot_bypass_unlink(env):
    c, TS, h, ext, lid = env
    token = _register_and_token(c, 'repayment@example.com', device_id='d-app', client_type='app')
    assert link(c,h,ext).status_code==200
    r=c.post('/api/v1/sync/push',headers={'Authorization':f'Bearer {token}'},json={
        'device_id':'d-app','changes':[{'ledger_id':ext,'entity_type':'ledger_snapshot',
        'entity_sync_id':'legacy-delete','action':'delete','updated_at':'2027-01-01T00:00:00Z','payload':{}}]})
    assert r.status_code==409,r.text
    assert summary(c,h,ext)['own_amount']=='2250'


def test_web_base_currency_recalculation_keeps_related_original_currency(env, monkeypatch):
    c, TS, h, ext, lid = env
    from src.routers.write import ledgers
    async def no_rates(*args):
        return None, False
    monkeypatch.setattr(ledgers._rate_fetcher, 'get_rates', no_rates)
    with TS() as db:
        db.get(ReadTxProjection,(lid,'tx_i1')).currency_code='CNY'
        db.commit()
    assert link(c,h,ext).status_code==200
    r=c.patch(f'/api/v1/write/ledgers/{ext}/meta',headers=h,json={'base_change_id':0,'currency':'USD'})
    assert r.status_code==200,r.text
    s=summary(c,h,ext)
    assert s['currency']=='CNY' and s['own_amount']=='2250'


@pytest.mark.parametrize('extension',[[], {'version':2,'items':[]}, {'version':1,'items':[{'income_id':'tx_i1'}]}])
def test_malformed_restore_extension_rolls_back_all_changes(env, extension):
    c, TS, h, ext, lid = env
    from src import snapshot_builder
    from src.models import BackupSnapshot
    import json
    with TS() as db:
        snapshot=snapshot_builder.build(db,db.get(Ledger,lid))
        snapshot['items'][0]['note']='必须回滚'
        backup=BackupSnapshot(user_id=db.get(Ledger,lid).user_id,ledger_id=lid,
            snapshot_json=json.dumps({'content':json.dumps(snapshot),'cloudRepayments':extension}))
        db.add(backup);db.commit();bid=backup.id
    r=c.post('/api/v1/admin/backups/restore',headers=h,json={'snapshot_id':bid,'device_id':'d-web'})
    assert r.status_code==409,r.text
    with TS() as db:
        assert all(row.note!='必须回滚' for row in db.scalars(select(ReadTxProjection)))


def test_candidate_search_pagination_no_duplicate_or_wrong_currency(env):
    c, TS, h, ext, lid = env
    endpoint=f'/api/v1/read/ledgers/{ext}/transactions/tx_e/repayment-candidates'
    r=c.get(endpoint,headers=h,params={'tz_offset_minutes':480,'limit':1,'offset':0,'q':'tx_i'})
    assert r.status_code==200 and r.json()['total']==3
    first=r.json()['items'][0]['sync_id']
    r=c.get(endpoint,headers=h,params={'tz_offset_minutes':480,'limit':1,'offset':1,'q':'tx_i'})
    assert r.json()['items'][0]['sync_id']!=first
    assert link(c,h,ext,first).status_code==200
    r=c.get(endpoint,headers=h,params={'tz_offset_minutes':0,'q':'tx_i'})
    assert r.json()['total']==2
    assert first not in [row['sync_id'] for row in r.json()['items']]


def test_same_sync_batch_cannot_overpay_using_stale_projection_rows(env):
    c, TS, h, ext, lid = env
    with TS() as db:
        db.get(ReadTxProjection,(lid,'tx_e')).amount=1000
        for sid in ('tx_i1','tx_i2'):
            db.get(ReadTxProjection,(lid,sid)).amount=300
        db.commit()
    assert link(c,h,ext,'tx_i1').status_code==200
    assert link(c,h,ext,'tx_i2').status_code==200
    token = _register_and_token(c,'repayment@example.com',device_id='d-app',client_type='app')
    r=c.post('/api/v1/sync/push',headers={'Authorization':f'Bearer {token}'},json={
        'device_id':'d-app','changes':[{'ledger_id':ext,'entity_type':'transaction','entity_sync_id':sid,
        'action':'upsert','updated_at':'2027-01-01T00:00:00Z','payload':{'amount':600}} for sid in ['tx_i1','tx_i2']]})
    assert r.status_code==409,r.text
    assert summary(c,h,ext)['repaid_amount']=='600'
