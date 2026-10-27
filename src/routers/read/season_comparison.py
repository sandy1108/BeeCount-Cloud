"""五月年度的两侧精确统计；范围由服务端统一生成，供分类/月/账单复用。"""
from calendar import monthrange
from datetime import date
from decimal import Decimal

from ._shared import *  # noqa: F401,F403
from .statistics_filter import statistics_filters


def comparison_ranges(season, compare_season, mode, cutoff, tz_offset_minutes, now=None):
    """同期按月日对齐而非减365天；五月首日昨日不属于本季时返回明确空范围。"""
    if season == compare_season or mode not in ('same', 'full'):
        raise HTTPException(status_code=400, detail='Choose distinct seasons and a valid comparison mode')
    offset = timedelta(minutes=tz_offset_minutes)
    today = (_to_utc(now or datetime.now(timezone.utc)) + offset).date()
    start, end = date(season, 5, 1), date(season + 1, 5, 1)
    cutoff_day = None
    if mode == 'same':
        if cutoff:
            try:
                cutoff_day = date.fromisoformat(cutoff)
            except ValueError:
                raise HTTPException(status_code=400, detail='Invalid cutoff date')
            if not start <= cutoff_day < end or cutoff_day > today:
                raise HTTPException(status_code=400, detail='Cutoff must be inside the selected season and not after today')
        else:
            cutoff_day = min(today - timedelta(days=1), end - timedelta(days=1))
            if cutoff_day < start:
                cutoff_day = None

    def side(year):
        first, limit = date(year, 5, 1), date(year + 1, 5, 1)
        last, leap = limit - timedelta(days=1), False
        if mode == 'same':
            if cutoff_day is None:
                last = None
            else:
                target_year = year if cutoff_day.month >= 5 else year + 1
                day = min(cutoff_day.day, monthrange(target_year, cutoff_day.month)[1])
                leap = day != cutoff_day.day
                last = date(target_year, cutoff_day.month, day)
        stop = first if last is None else last + timedelta(days=1)
        utc = lambda d: (datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc) - offset).isoformat()
        return dict(year=year, start_at=utc(first), end_at_exclusive=utc(stop),
                    start_date=first.isoformat(), end_date=last.isoformat() if last else None,
                    empty_period=last is None, leap_adjusted=leap, not_ended=today < limit,
                    includes_today=mode == 'same' and last == today)
    return side(season), side(compare_season)


def _summarize(db, ledger, scope, offset_minutes):
    """流式读取全部匹配记录；Decimal累加，分页和类别数量均不截断汇总。"""
    first = datetime.fromisoformat(scope['start_at'])
    stop = datetime.fromisoformat(scope['end_at_exclusive'])
    query = select(ReadTxProjection).where(
        ReadTxProjection.ledger_id == ledger.id,
        *statistics_filters(db, statistics_only=True, tx_type='cashflow', date_from=first, date_to=stop),
    )
    months, categories = {}, {'income': {}, 'expense': {}}
    totals = dict(income=Decimal(0), expense=Decimal(0), count=0)
    for row in db.scalars(query).yield_per(1000):
        value = Decimal(str(row.native_amount if row.native_amount is not None else row.amount))
        kind = row.tx_type
        totals[kind] += value
        totals['count'] += 1
        bucket = (_to_utc(row.happened_at) + timedelta(minutes=offset_minutes)).strftime('%Y-%m')
        slot = months.setdefault(bucket, dict(income=Decimal(0), expense=Decimal(0), count=0))
        slot[kind] += value
        slot['count'] += 1
        group = (row.category_name or '').strip() or 'Uncategorized'
        cat = categories[kind].setdefault(group, dict(amount=Decimal(0), count=0))
        cat['amount'] += value
        cat['count'] += 1
    monthly = []
    for index in range(12):
        year = scope['year'] + (index + 4) // 12
        month = (index + 4) % 12 + 1
        bucket = f'{year:04d}-{month:02d}'
        if scope['empty_period'] or bucket > scope['end_date'][:7]:
            continue
        row = months.get(bucket, dict(income=Decimal(0), expense=Decimal(0), count=0))
        partial = bucket == scope['end_date'][:7] and int(scope['end_date'][-2:]) < monthrange(year, month)[1]
        monthly.append(dict(bucket=bucket, income=float(row['income']), expense=float(row['expense']),
                            balance=float(row['income']-row['expense']), count=row['count'], partial=partial))

    def ranked(kind):
        return [dict(category_name=name, category_group=name, total=float(row['amount']), tx_count=row['count'])
                for name,row in sorted(categories[kind].items(),key=lambda item:(-item[1]['amount'],item[0]))]
    return dict(range=scope, summary=dict(income=float(totals['income']), expense=float(totals['expense']),
                balance=float(totals['income']-totals['expense']), count=totals['count']), monthly=monthly,
                expenseCategories=ranked('expense'), incomeCategories=ranked('income'))


@router.get('/workspace/season-comparison')
def season_comparison(
    ledger_id: str = Query(...),
    season: int = Query(..., ge=100, le=9998),
    compare_season: int = Query(..., ge=100, le=9998),
    mode: str = Query(default='same'),
    cutoff: str | None = Query(default=None),
    tz_offset_minutes: int = Query(default=0, ge=-720, le=840),
    _scopes: set[str] = Depends(_READ_SCOPE_DEP),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    # 与A/B一致：管理员身份不能绕过成员权限；只比同一雪季账本，避免混币。
    ledgers = _visible_workspace_ledgers(db, current_user=current_user, is_admin=False, ledger_id=ledger_id, user_id=None)
    if not ledgers:
        raise HTTPException(status_code=404, detail='Ledger not found')
    ledger = ledgers[0]
    if ledger.statistics_mode != 'ski_season':
        raise HTTPException(status_code=400, detail='Comparison requires a ski-season ledger')
    selected, comparison = comparison_ranges(season, compare_season, mode, cutoff, tz_offset_minutes)
    return dict(selected=_summarize(db,ledger,selected,tz_offset_minutes),
                comparison=_summarize(db,ledger,comparison,tz_offset_minutes))
