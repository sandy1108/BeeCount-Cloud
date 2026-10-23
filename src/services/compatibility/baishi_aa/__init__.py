"""百事AA App 导出格式适配（基于17列FULL格式），与通用解析隔离。"""

from __future__ import annotations

import hashlib
import io
import posixpath
import zipfile
from decimal import Decimal, InvalidOperation
from xml.etree import ElementTree as ET

from ...import_data.schema import (
    ImportAttachment,
    ImportData,
    ImportError,
    ImportFieldMapping,
    ParsedRow,
    ParseWarning,
)

HEADERS = [
    "交易类型",
    "账本名称",
    "日期",
    "类别",
    "标签",
    "币种",
    "金额",
    "默认币种金额",
    "是否报销",
    "创建者",
    "付款人/收款人/交款人",
    "金额",
    "分账人/保管人",
    "金额",
    "账户",
    "参与统计标志",
    "描述",
]
# 重复的“金额”使用稳定的语义列名，不能转换成同名dict后再猜测。
COLUMNS = [
    "交易类型",
    "账本名称",
    "日期",
    "类别",
    "二级分类",
    "币种",
    "交易金额",
    "默认币种金额",
    "是否报销",
    "创建者",
    "付款人",
    "付款金额",
    "分账人",
    "分摊金额",
    "账户",
    "参与统计标志",
    "描述",
]


def header_index(rows: list[list[str]]) -> int | None:
    for i, row in enumerate(rows[:30]):
        if row[:17] == HEADERS:
            return i
    return None


def source_id(file_hash: str, row_number: int) -> str:
    """同文件同行拥有固定交易ID；同额同时间的不同原始行依然独立。"""
    return "tx_baa_" + hashlib.sha256(f"{file_hash}:{row_number}".encode()).hexdigest()[:32]


def parse(payload: bytes, rows: list[list[str]], sheet_count: int) -> ImportData | None:
    index = header_index(rows)
    if index is None:
        return None
    data = ImportData(
        source_format="baishi_aa",
        headers=COLUMNS,
        rows=[],
        suggested_mapping=ImportFieldMapping(
            tx_type="交易类型",
            amount="交易金额",
            happened_at="日期",
            category_name="类别",
            subcategory_name="二级分类",
            currency="币种",
            account_name="账户",
            note="描述",
            tz_offset_minutes=480,
        ),
        source_file_hash=hashlib.sha256(payload).hexdigest(),
    )

    def error(n: int, message: str):
        data.parse_errors.append(ImportError("BAISHI_UNSUPPORTED", n, message))

    if sheet_count != 1:
        error(0, "百事AA首期仅支持单工作表文件，请拆分后导入，避免遗漏其他账本。")
    names = set()
    for n, row in enumerate(rows[index + 1 :], index + 2):
        if not any(row):
            continue
        values = (row + [""] * 17)[:17]
        cells = dict(zip(COLUMNS, values, strict=True))
        data.source_records[n] = dict(cells)
        data.rows.append(ParsedRow(n, cells, ""))
        names.add(cells["账本名称"])
        try:
            amount = Decimal(cells["交易金额"])
            paid = Decimal(cells["付款金额"])
            split = Decimal(cells["分摊金额"])
            native = Decimal(cells["默认币种金额"])
            valid = all(x.is_finite() for x in (amount, paid, split, native))
            expected_paid = -amount if cells["交易类型"] == "支出" else amount
            if (
                not valid
                or amount < 0
                or native != amount
                or paid != expected_paid
                or split != amount
            ):
                error(n, "金额、付款或分摊关系不支持；退款、多币种折算和复杂分账需单独核对。")
        except InvalidOperation:
            error(n, "金额不是有效数字。")
        if cells["交易类型"] not in ("支出", "收入"):
            error(n, "首期仅支持普通收入和支出，不支持转账、结算或退款。")
        if cells["币种"] != "CNY":
            error(n, "首期仅支持人民币账本。")
        members = [cells[k] for k in ("创建者", "付款人", "分账人")]
        if (
            not members[0]
            or len(set(members)) != 1
            or any(s in members[0] for s in (",", "，", ";", "；", "\n"))
        ):
            error(n, "首期仅支持创建者、付款人和分摊人为同一人的账单。")
        if cells["是否报销"] or cells["参与统计标志"]:
            error(n, "报销状态或参与统计标志非空，需要先确认其含义，不能静默丢弃。")
        if any(row[17:]):
            error(n, "发现额外非空列，请核对是否包含未支持的分账信息。")
        # 原系统成员不是本系统用户，保留文字来源而不伪造用户ID。
        provenance = f"[百事AA来源：{cells['账本名称']}；创建/付款/分摊：{cells['创建者']}]"
        cells["描述"] = (cells["描述"] + "\n" + provenance).strip()
    # 通用写入按name+kind识别分类。源文件允许一级和二级同名，
    # 仅在冲突时给二级加父级限定，并在预览警告中明确展示转换。
    roots = {(r.cells["类别"], r.cells["交易类型"]) for r in data.rows}
    leaf_parents = {}
    for r in data.rows:
        c = r.cells
        leaf_parents.setdefault((c["二级分类"], c["交易类型"]), set()).add(c["类别"])
    for r in data.rows:
        c = r.cells
        key = (c["二级分类"], c["交易类型"])
        if c["二级分类"] and (key in roots or len(leaf_parents[key]) > 1):
            original = c["二级分类"]
            c["二级分类"] = f"{original}（{c['类别']}）"
            data.parse_warnings.append(
                ParseWarning(
                    "BAISHI_CATEGORY_QUALIFIED",
                    r.row_number,
                    f"二级分类“{original}”存在同名歧义，导入为“{c['二级分类']}”，父分类不变。",
                )
            )
    if len(names) != 1:
        error(0, "文件须只包含一个明确的源账本。")
    data.source_ledger_name = next(iter(names), "")
    try:
        data.attachments = _pictures(payload, {r.row_number for r in data.rows})
    except (ValueError, KeyError, ET.ParseError) as exc:
        error(0, f"图片无法可靠关联：{exc}")
    data.parse_warnings.append(
        ParseWarning(
            "BAISHI_SCOPE",
            0,
            "兼容单人CNY收支；同文件重复导入按原始行去重。重新导出的不同文件须人工核对重叠记录。",
        )
    )
    return data


def _pictures(payload: bytes, valid_rows: set[int]) -> list[ImportAttachment]:
    """读取OOXML图片锚点，按工作表实际行关联，不依赖openpyxl私有图片API。"""
    ns = {
        "d": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    }
    out = []
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        media = {n for n in z.namelist() if n.startswith("xl/media/")}
        used = set()
        for name in z.namelist():
            if not name.startswith("xl/drawings/drawing") or not name.endswith(".xml"):
                continue
            rel_name = posixpath.join(
                posixpath.dirname(name), "_rels", posixpath.basename(name) + ".rels"
            )
            rels = {r.attrib["Id"]: r for r in ET.fromstring(z.read(rel_name))}
            for anchor in ET.fromstring(z.read(name)):
                blip = anchor.find(".//a:blip", ns)
                if blip is None:
                    continue
                row = anchor.find("d:from/d:row", ns)
                if row is None or int(row.text or "-1") + 1 not in valid_rows:
                    raise ValueError("图片没有明确的账单行锚点")
                rel = rels[blip.attrib["{" + ns["r"] + "}embed"]]
                if rel.attrib.get("TargetMode") == "External":
                    raise ValueError("不支持外部图片链接")
                target = rel.attrib["Target"]
                path = (
                    target.lstrip("/")
                    if target.startswith("/")
                    else posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
                )
                if path not in media:
                    raise ValueError("图片关系超出工作簿媒体目录")
                blob = z.read(path)
                if len(blob) > 10 * 1024 * 1024:
                    raise ValueError("单张图片超过10MB")
                suffix = posixpath.splitext(path)[1].lower()
                mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}.get(
                    suffix
                )
                if mime is None:
                    raise ValueError("首期仅支持PNG/JPEG图片")
                out.append(
                    ImportAttachment(int(row.text) + 1, posixpath.basename(path), mime, blob)
                )
                used.add(path)
        if media != used:
            raise ValueError("存在未关联的嵌入图片")
    return out


def validate_target(txs, snapshot: dict, currency: str) -> list[ImportError]:
    """通用写入按名称匹配分类，因此同名却不同层级/父类时阻断而非错配。"""
    errors = []
    if currency != "CNY":
        errors.append(ImportError("BAISHI_UNSUPPORTED", 0, "首期仅支持导入人民币目标账本。"))
    parents = {}
    for category in snapshot.get("categories", []):
        parents[(category.get("name"), category.get("kind"))] = category.get("parentName") or None
    for tx in txs:
        for name, parent in (
            (tx.parent_category_name, None),
            (tx.category_name, tx.parent_category_name),
        ):
            if not name:
                continue
            key = (name, tx.tx_type)
            if key in parents and parents[key] != parent:
                errors.append(
                    ImportError(
                        "BAISHI_CATEGORY_CONFLICT",
                        tx.source_row_number,
                        "分类同名但层级或父分类不同，请先核对分类映射。",
                    )
                )
            parents[key] = parent
    return errors
