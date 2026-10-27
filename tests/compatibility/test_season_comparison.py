"""C批跨季对比：五月年度、相同月日、零基数之外的原始金额与下钻一致。"""
from datetime import datetime, timezone
from sqlalchemy import select
from test_statistics_drilldown import client, seed
from src.database import get_db
from src.main import app
from src.models import Ledger, ReadTxProjection, User

URL = '/api/v1/read/workspace/season-comparison'


def test_full_comparison_keeps_all_rows_union_income_and_drilldown(client):
    h, ledger = seed(client)
    db = next(app.dependency_overrides[get_db]())
    try:
        led = db.scalar(select(Ledger).where(Ledger.external_id == ledger))
        for sid, kind, category, amount, at in [
            ('historical-only', 'expense', '仅上季', .3, datetime(2024, 6, 1, tzinfo=timezone.utc)),
            ('historical-income', 'income', '奖金', 20, datetime(2024, 6, 1, tzinfo=timezone.utc)),
            ('current-transfer', 'transfer', '转账', 999, datetime(2025, 6, 1, tzinfo=timezone.utc)),
        ]:
            db.add(ReadTxProjection(ledger_id=led.id, user_id=led.user_id, sync_id=sid, tx_type=kind,
                                   category_name=category, amount=9999, native_amount=amount, happened_at=at))
        db.commit()
    finally:
        db.close()
    result = client.get(URL, headers=h, params=dict(ledger_id=ledger, season=2025, compare_season=2024, mode='full', tz_offset_minutes=480))
    assert result.status_code == 200, result.text
    a, b = result.json()['selected'], result.json()['comparison']
    assert a['summary'] == dict(income=1.25, expense=1255, balance=-1253.75, count=1005)
    assert b['summary']['income'] == 20 and b['summary']['expense'] == 1.55
    assert len(a['monthly']) == len(b['monthly']) == 12
    assert a['monthly'][0]['bucket'] == '2025-05'
    assert a['monthly'][-1]['bucket'] == '2026-04'
    assert sum(m['expense'] for m in a['monthly']) == a['summary']['expense']
    assert next(c for c in b['expenseCategories'] if c['category_name'] == '仅上季')['total'] == .3
    p = dict(ledger_id=ledger, date_from=a['range']['start_at'], date_to=a['range']['end_at_exclusive'],
             statistics_only=True, tx_type='cashflow')
    page = client.get('/api/v1/read/workspace/transactions', headers=h, params=p).json()
    assert page['total'] == a['summary']['count']
    for side in (a, b):
        for row in side['expenseCategories']:
            p.update(date_from=side['range']['start_at'], date_to=side['range']['end_at_exclusive'],
                     tx_type='expense', category_group=row['category_group'])
            detail = client.get('/api/v1/read/workspace/category-statistics', headers=h, params={**p, 'tz_offset_minutes':480}).json()
            assert detail['total'] == row['total'] and detail['count'] == row['tx_count']


def test_same_period_excludes_later_records_and_keeps_partial_month(client):
    h, ledger = seed(client)
    r = client.get(URL, headers=h, params=dict(ledger_id=ledger, season=2025, compare_season=2024, mode='same', cutoff='2025-05-15', tz_offset_minutes=480))
    assert r.status_code == 200, r.text
    d = r.json()
    for side, year in ((d['selected'],2025),(d['comparison'],2024)):
        assert side['range']['end_at_exclusive'] == f'{year}-05-15T16:00:00+00:00'
        assert side['range']['end_date'] == f'{year}-05-15'
        assert len(side['monthly']) == 1 and side['monthly'][0]['partial']
    assert d['selected']['summary']['count'] == 1005


def test_comparison_requires_distinct_seasons_and_member_even_for_admin(client):
    from test_import_csv import _login
    h, ledger = seed(client)
    p = dict(ledger_id=ledger, season=2025, compare_season=2024, mode='full')
    for patch in [dict(compare_season=2025),dict(mode='bad'),dict(mode='same',cutoff='2025-04-30'),dict(mode='same',cutoff='2026-05-01')]:
        assert client.get(URL,headers=h,params={**p,**patch}).status_code == 400
    token = _login(client,'comparison-outsider@example.com')
    db=next(app.dependency_overrides[get_db]())
    try:
        u=db.scalar(select(User).where(User.email=='comparison-outsider@example.com'));u.is_admin=True;db.commit()
    finally:db.close()
    assert client.get(URL,headers={'Authorization':'Bearer '+token},params=p).status_code == 404


def test_range_defaults_may_first_leap_and_timezone():
    from src.routers.read.season_comparison import comparison_ranges
    now = datetime(2026,4,30,16,1,tzinfo=timezone.utc)  # 本地五月首日
    a,b = comparison_ranges(2026,2025,'same',None,480,now)
    assert a['empty_period'] and b['empty_period'] and a['end_date'] is None
    a,b = comparison_ranges(2026,2025,'same','2026-05-01',480,now)
    assert a['end_date']=='2026-05-01' and a['includes_today']
    a,b = comparison_ranges(2023,2022,'same','2024-02-29',480,now)
    assert b['end_date']=='2023-02-28' and b['leap_adjusted']
    a,b = comparison_ranges(2025,2024,'same',None,480,datetime(2025,12,31,16,10,tzinfo=timezone.utc))
    assert a['end_date']=='2025-12-31' and b['end_date']=='2024-12-31'
    a,b = comparison_ranges(2024,2023,'full',None,480,now)
    assert a['start_at']=='2024-04-30T16:00:00+00:00' and a['end_at_exclusive']=='2025-04-30T16:00:00+00:00'


def test_partial_cutoff_excludes_later_income_and_expense_and_empty_season(client):
    h, ledger = seed(client)
    db=next(app.dependency_overrides[get_db]())
    try:
        led=db.scalar(select(Ledger).where(Ledger.external_id==ledger))
        for kind in ('income','expense'):
            db.add(ReadTxProjection(ledger_id=led.id,user_id=led.user_id,sync_id='later-'+kind,
                tx_type=kind,category_name='后半月',amount=100,native_amount=.25,
                happened_at=datetime(2025,5,20,tzinfo=timezone.utc)))
        db.commit()
    finally:db.close()
    p=dict(ledger_id=ledger,season=2025,compare_season=2024,mode='same',cutoff='2025-05-15',tz_offset_minutes=480)
    data=client.get(URL,headers=h,params=p).json()['selected']
    assert data['summary']['count']==1005
    assert not any(r['category_name']=='后半月' for r in data['expenseCategories']+data['incomeCategories'])
    data=client.get(URL,headers=h,params={**p,'cutoff':'2025-05-31'}).json()['selected']
    assert data['summary']['count']==1007 and data['summary']['expense']==1255.25
    assert data['monthly'][0]['partial'] is False
    empty=client.get(URL,headers=h,params={**p,'season':2022,'compare_season':2021,'mode':'full'}).json()
    assert empty['selected']['summary']==dict(income=0,expense=0,balance=0,count=0)
    assert len(empty['selected']['monthly'])==12
