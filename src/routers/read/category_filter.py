"""分类读取口径：转账为虚拟分类，普通收支仍精确匹配分类ID。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import ReadTxProjection, UserCategoryProjection


def category_filter(db: Session, category_id: str, user_id: str, columns=ReadTxProjection):
    """只识别目标用户自己的转账分类，交易的账本权限由调用者继续限定。"""
    kind = db.scalar(select(UserCategoryProjection.kind).where(
        UserCategoryProjection.user_id == user_id,
        UserCategoryProjection.sync_id == category_id,
    ))
    if kind == "transfer":
        # 手机、旧导入或Web创建的转账都可能不带categoryId，不补写历史数据。
        return columns.tx_type == "transfer"
    return columns.category_sync_id == category_id
