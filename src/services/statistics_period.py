"""雪季统计窗口：按本地5月1日到次年5月1日的半开区间查询。"""

import re
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException


def ski_season_range(
    *, period: str | None, tz_offset_minutes: int = 0, now: datetime | None = None
) -> tuple[datetime, datetime, str]:
    """period为起始四位年份；5月起切换到当年雪季，不受月起始日影响。"""
    tz = timezone(timedelta(minutes=tz_offset_minutes))
    local_now = (now or datetime.now(timezone.utc)).astimezone(tz)
    if period is None or not period.strip():
        year = local_now.year if local_now.month >= 5 else local_now.year - 1
    else:
        target = period.strip()
        if not re.fullmatch(r"[0-9]{4}", target) or not 1 <= int(target) <= 9998:
            raise HTTPException(status_code=400, detail="Invalid analytics period")
        year = int(target)
    start = datetime(year, 5, 1, tzinfo=tz).astimezone(timezone.utc)
    end = datetime(year + 1, 5, 1, tzinfo=tz).astimezone(timezone.utc)
    return start, end, str(year)
