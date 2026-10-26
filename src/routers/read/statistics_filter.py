"""统计下钻共用条件；分类按首页的名称分组，绝不退回备注模糊搜索。"""
from sqlalchemy import false, func

from ...models import ReadTxProjection


def statistics_filters(db, *, category_group=None, statistics_only=False, tx_type=None,
                       date_from=None, date_to=None, columns=ReadTxProjection):
    conditions = []
    if category_group is not None:
        # SQLite trim 与 PostgreSQL btrim 均显式去除 Python strip 常用空白。
        trim = func.btrim if db.get_bind().dialect.name == 'postgresql' else func.trim
        name = func.coalesce(func.nullif(trim(columns.category_name, ' \t\r\n\v\f\x1c\x1d\x1e\x1f\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000'), ''), 'Uncategorized')
        conditions.append(name == category_group)
    if statistics_only:
        conditions.append(columns.exclude_from_stats == false())
    if tx_type:
        # 整月收支与其分页/CSV/附件共用这个条件，避免汇总排除转账而明细混入。
        conditions.append(columns.tx_type.in_(("income", "expense")) if tx_type == "cashflow" else columns.tx_type == tx_type)
    if date_from is not None:
        conditions.append(columns.happened_at >= date_from)
    if date_to is not None:
        conditions.append(columns.happened_at < date_to)
    return conditions
