"""导入分类引用解析；名称不唯一时拒绝猜测。"""

from __future__ import annotations


def resolve_category_id(
    categories: list[dict],
    name: str,
    kind: str,
    parent_name: str | None = None,
    *,
    legacy: bool = False,
) -> str:
    """新导入核对父子层级；历史记录缺少父信息时只允许名称和类型唯一匹配。"""
    matches = [
        c for c in categories if c.get("name") == name and c.get("kind") == kind and c.get("syncId")
    ]
    if not legacy:
        parents = {
            c["syncId"]
            for c in categories
            if c.get("name") == parent_name and c.get("kind") == kind and (c.get("level") or 1) == 1
        }
        if parent_name:
            matches = [
                c
                for c in matches
                if (c.get("level") or 1) == 2 and c.get("parentSyncId") in parents
            ]
        else:
            matches = [
                c
                for c in matches
                if (c.get("level") or 1) == 1
                and not c.get("parentSyncId")
                and not c.get("parentName")
            ]
    if len(matches) != 1:
        raise ValueError("分类无法唯一匹配，请核对分类名称、收支类型和父分类")
    return matches[0]["syncId"]
