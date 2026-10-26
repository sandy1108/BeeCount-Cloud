"""月份统计复用A批精确范围：完整汇总、收支、分页及所有导出同条件。"""
import csv
import io
from urllib.parse import unquote
from datetime import datetime, timezone

from sqlalchemy import select
from test_statistics_drilldown import client, seed
from src.database import get_db
from src.main import app
from src.models import Ledger, ReadTxProjection


def month_params(ledger):
    return dict(ledger_id=ledger, tx_type='cashflow', date_from='2025-04-30T16:00:00Z',
                date_to='2025-05-31T16:00:00Z', tz_offset_minutes=480)


def test_month_summary_and_list_cover_all_cashflow_without_transfers(client):
    headers, ledger = seed(client)
    db = next(app.dependency_overrides[get_db]())
    try:
        led = db.scalar(select(Ledger).where(Ledger.external_id == ledger))
        db.add(ReadTxProjection(ledger_id=led.id, user_id=led.user_id, sync_id='transfer-month',
                               tx_type='transfer', amount=700, native_amount=700,
                               happened_at=datetime(2025, 5, 1, tzinfo=timezone.utc)))
        db.commit()
    finally:
        db.close()
    p = month_params(ledger)
    result = client.get('/api/v1/read/workspace/month-statistics', headers=headers, params=p)
    assert result.status_code == 200, result.text
    data = result.json()
    assert data['summary'] == dict(income=1.25, expense=1255, balance=-1253.75, count=1005)
    assert data['daily'] == [dict(bucket='2025-05-01', income=1.25, expense=1255, balance=-1253.75, count=1005)]
    lodging = next(row for row in data['expenseCategories'] if row['category_name'] == '住宿')
    assert lodging['total'] == 1252.5 and lodging['tx_count'] == 1002
    assert data['incomeCategories'][0]['total'] == 1.25
    filters = {**p, 'statistics_only': True}
    page = client.get('/api/v1/read/workspace/transactions', headers=headers, params={**filters, 'offset': 1000, 'limit': 20})
    assert page.json()['total'] == 1005 and len(page.json()['items']) == 5
    exported = client.get('/api/v1/read/workspace/transactions.csv', headers=headers, params=filters)
    assert len(list(csv.reader(io.StringIO(exported.content.decode('utf-8-sig'))))) == 1006
    assert '2025-05-01_2025-05-31.csv' in unquote(exported.headers['content-disposition'])
    gallery = client.get('/api/v1/read/workspace/attachments', headers=headers, params=filters)
    assert gallery.status_code == 200 and gallery.json()['transaction_total'] == 1005


def test_month_category_and_type_stay_exact_and_partial_empty_ranges_work(client):
    headers, ledger = seed(client)
    p = {**month_params(ledger), 'category_group': '住宿', 'tx_type': 'expense'}
    data = client.get('/api/v1/read/workspace/month-statistics', headers=headers, params=p).json()
    assert data['summary'] == dict(income=0, expense=1252.5, balance=-1252.5, count=1002)
    income = client.get('/api/v1/read/workspace/month-statistics', headers=headers, params={**p, 'tx_type': 'income'}).json()
    assert income['summary']['count'] == 1 and income['summary']['income'] == 1.25
    empty = client.get('/api/v1/read/workspace/month-statistics', headers=headers,
                       params={**p, 'date_from': '2025-05-01T16:00:00Z', 'date_to': '2025-05-15T16:00:00Z'}).json()
    assert empty['summary']['count'] == 0 and empty['daily'] == []


def test_month_range_validation_and_membership(client):
    from test_import_csv import _login
    headers, ledger = seed(client)
    p = month_params(ledger)
    outsider = {'Authorization': 'Bearer ' + _login(client, 'month-private@example.com')}
    result = client.get('/api/v1/read/workspace/month-statistics', headers=outsider, params=p)
    assert result.status_code == 404
    for bad in [dict(date_to=p['date_from']), dict(date_to='2025-06-01T16:00:00Z'), dict(tx_type='transfer')]:
        result = client.get('/api/v1/read/workspace/month-statistics', headers=headers, params={**p, **bad})
        assert result.status_code == 400, result.text


def test_leap_day_timezone_edges_native_precision_and_admin_membership(client):
    from test_import_csv import _login
    from src.models import User
    headers, ledger = seed(client)
    db = next(app.dependency_overrides[get_db]())
    try:
        led = db.scalar(select(Ledger).where(Ledger.external_id == ledger))
        # 本地2月29日两端与下一月起点，金额使用账本本位币，保留分币精度。
        for sid, moment, amount in [
            ('leap-start', datetime(2024, 2, 28, 16, tzinfo=timezone.utc), .1),
            ('leap-end', datetime(2024, 2, 29, 15, 59, 59, tzinfo=timezone.utc), .2),
            ('march-start', datetime(2024, 2, 29, 16, tzinfo=timezone.utc), 999),
        ]:
            db.add(ReadTxProjection(ledger_id=led.id, user_id=led.user_id, sync_id=sid,
                                   tx_type='expense', amount=999, native_amount=amount, category_name='闰日',
                                   happened_at=moment))
        db.commit()
    finally:
        db.close()
    p = dict(ledger_id=ledger, date_from='2024-02-28T16:00:00Z',
             date_to='2024-02-29T16:00:00Z', tz_offset_minutes=480)
    response = client.get('/api/v1/read/workspace/month-statistics', headers=headers, params=p)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['summary'] == dict(income=0, expense=.3, balance=-.3, count=2)
    assert data['daily'][0]['bucket'] == '2024-02-29'
    token = _login(client, 'month-admin@example.com')
    db = next(app.dependency_overrides[get_db]())
    try:
        admin = db.scalar(select(User).where(User.email == 'month-admin@example.com'))
        admin.is_admin = True
        db.commit()
    finally:
        db.close()
    assert client.get('/api/v1/read/workspace/month-statistics',
                      headers={'Authorization': 'Bearer ' + token}, params=p).status_code == 404
