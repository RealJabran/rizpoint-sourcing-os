"""Deterministic, non-executing spreadsheet inspection and normalization."""

from __future__ import annotations

import csv
import hashlib
import io
import re
import zipfile
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, cast

import openpyxl  # type: ignore[import-untyped]
import xlrd  # type: ignore[import-untyped]

MAX_SHEETS = 100
MAX_ROWS = 50_000
MAX_COLUMNS = 200
MAX_ZIP_EXPANDED_BYTES = 250 * 1024 * 1024
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
PREVIEW_ROWS = 50

NUMERIC_TARGETS = {
    "UNIT_COST",
    "QUANTITY",
    "CASE_COUNT",
    "PACK_COUNT",
    "WEIGHT",
    "LENGTH",
    "WIDTH",
    "HEIGHT",
}
KNOWN_HEADERS = {
    "asin",
    "upc",
    "ean",
    "gtin",
    "sku",
    "item",
    "item number",
    "item#",
    "description",
    "product",
    "brand",
    "cost",
    "unit cost",
    "price",
    "quantity",
    "qty",
    "case",
    "case count",
    "pack",
    "pack count",
    "weight",
    "length",
    "width",
    "height",
    "currency",
}


class WorkbookError(ValueError):
    """Safe parser error with a stable code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class SheetData:
    index: int
    name: str
    rows: list[list[str]]


def detect_format(data: bytes, filename: str) -> str:
    lowered = filename.lower()
    expected_format: str
    if lowered.endswith(".csv"):
        expected_format = "CSV"
    elif lowered.endswith(".xlsx"):
        expected_format = "XLSX"
    elif lowered.endswith(".xls"):
        expected_format = "XLS"
    else:
        raise WorkbookError("UNSUPPORTED_FILE_TYPE", "Only CSV, XLSX, and XLS files are supported.")

    if data.startswith(b"PK\x03\x04"):
        detected_format = "XLSX"
    elif data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        detected_format = "XLS"
    else:
        try:
            data.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise WorkbookError(
                "FILE_SIGNATURE_MISMATCH",
                "File content does not match its spreadsheet extension.",
            ) from error
        detected_format = "CSV"

    if detected_format != expected_format:
        raise WorkbookError(
            "FILE_SIGNATURE_MISMATCH",
            "File content does not match its spreadsheet extension.",
        )
    return detected_format


def _check_xlsx_zip(data: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            expanded = sum(info.file_size for info in archive.infolist())
            if expanded > MAX_ZIP_EXPANDED_BYTES:
                raise WorkbookError(
                    "ZIP_EXPANSION_LIMIT", "Workbook expansion exceeds the configured limit."
                )
    except zipfile.BadZipFile as error:
        raise WorkbookError("INVALID_XLSX", "Workbook ZIP structure is invalid.") from error


def _format_number(value: Any, number_format: str | None = None) -> str:
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        if number_format and re.fullmatch(r"0+", number_format):
            return str(value).zfill(len(number_format))
        return str(value)
    if isinstance(value, float):
        if value.is_integer():
            integer = int(value)
            if number_format and re.fullmatch(r"0+", number_format):
                return str(integer).zfill(len(number_format))
            return str(integer)
        return format(value, "f").rstrip("0").rstrip(".")
    return "" if value is None else str(value).strip()


def _read_csv(data: bytes) -> list[SheetData]:
    try:
        decoded = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise WorkbookError("CSV_ENCODING", "CSV must be UTF-8 encoded.") from error
    rows = [list(row) for row in csv.reader(io.StringIO(decoded))]
    return [SheetData(index=0, name="CSV", rows=_bounded_rows(rows))]


def _read_xlsx(data: bytes) -> list[SheetData]:
    _check_xlsx_zip(data)
    try:
        workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=False)
    except Exception as error:  # openpyxl has several parser-specific exceptions.
        raise WorkbookError("INVALID_XLSX", "Workbook could not be read safely.") from error
    if len(workbook.worksheets) > MAX_SHEETS:
        raise WorkbookError("SHEET_LIMIT", "Workbook contains too many sheets.")
    sheets: list[SheetData] = []
    for index, worksheet in enumerate(workbook.worksheets):
        if worksheet.max_row > MAX_ROWS:
            raise WorkbookError("ROW_LIMIT", "Workbook exceeds the configured row limit.")
        if worksheet.max_column > MAX_COLUMNS:
            raise WorkbookError("COLUMN_LIMIT", "Workbook exceeds the configured column limit.")
        rows = [
            [_format_number(cell.value, cell.number_format) for cell in row]
            for row in worksheet.iter_rows()
        ]
        sheets.append(SheetData(index=index, name=worksheet.title, rows=_bounded_rows(rows)))
    return sheets


def _xls_number_format(book: xlrd.book.Book, cell: xlrd.sheet.Cell) -> str | None:
    try:
        xf = book.xf_list[cell.xf_index]
        return cast(str, book.format_map[xf.format_key].format_str)
    except (AttributeError, IndexError, KeyError):
        return None


def _read_xls(data: bytes) -> list[SheetData]:
    try:
        book = xlrd.open_workbook(file_contents=data, formatting_info=True, on_demand=True)
    except Exception as error:
        raise WorkbookError("INVALID_XLS", "Legacy workbook could not be read safely.") from error
    if book.nsheets > MAX_SHEETS:
        raise WorkbookError("SHEET_LIMIT", "Workbook contains too many sheets.")
    sheets: list[SheetData] = []
    for index in range(book.nsheets):
        sheet = book.sheet_by_index(index)
        if sheet.nrows > MAX_ROWS:
            raise WorkbookError("ROW_LIMIT", "Workbook exceeds the configured row limit.")
        if sheet.ncols > MAX_COLUMNS:
            raise WorkbookError("COLUMN_LIMIT", "Workbook exceeds the configured column limit.")
        rows: list[list[str]] = []
        for row_index in range(sheet.nrows):
            row: list[str] = []
            for column_index in range(sheet.ncols):
                cell = sheet.cell(row_index, column_index)
                row.append(_format_number(cell.value, _xls_number_format(book, cell)))
            rows.append(row)
        sheets.append(SheetData(index=index, name=sheet.name, rows=_bounded_rows(rows)))
    return sheets


def _bounded_rows(rows: list[list[str]]) -> list[list[str]]:
    if len(rows) > MAX_ROWS:
        raise WorkbookError("ROW_LIMIT", "Workbook exceeds the configured row limit.")
    if any(len(row) > MAX_COLUMNS for row in rows):
        raise WorkbookError("COLUMN_LIMIT", "Workbook exceeds the configured column limit.")
    return rows


def read_workbook(data: bytes, filename: str) -> tuple[str, list[SheetData]]:
    if not data:
        raise WorkbookError("EMPTY_FILE", "Uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise WorkbookError("FILE_SIZE_LIMIT", "Uploaded file exceeds the configured limit.")
    file_format = detect_format(data, filename)
    if file_format == "CSV":
        return file_format, _read_csv(data)
    if file_format == "XLSX":
        return file_format, _read_xlsx(data)
    return file_format, _read_xls(data)


def header_candidates(rows: list[list[str]]) -> list[dict[str, int]]:
    candidates: list[dict[str, int]] = []
    for row_index, row in enumerate(rows[:25], start=1):
        values = [value.strip().lower() for value in row if value.strip()]
        if not values:
            continue
        known = sum(value in KNOWN_HEADERS for value in values)
        distinct = len(set(values))
        score = known * 10 + distinct
        candidates.append({"row": row_index, "score": score})
    return sorted(candidates, key=lambda candidate: (-candidate["score"], candidate["row"]))[:5]


def inspect_workbook(data: bytes, filename: str) -> dict[str, Any]:
    file_format, sheets = read_workbook(data, filename)
    return {
        "file_format": file_format,
        "sheets": [
            {
                "sheet_index": sheet.index,
                "name": sheet.name,
                "row_count": len(sheet.rows),
                "column_count": max((len(row) for row in sheet.rows), default=0),
                "header_candidates": header_candidates(sheet.rows),
                "columns": sheet.rows[0] if sheet.rows else [],
                "preview": sheet.rows[:PREVIEW_ROWS],
            }
            for sheet in sheets
        ],
    }


def _check_digit_is_valid(value: str) -> bool:
    if len(value) not in {8, 12, 13, 14} or not value.isdigit():
        return False
    total = 0
    for index, digit in enumerate(reversed(value[:-1])):
        total += int(digit) * (3 if index % 2 == 0 else 1)
    return (10 - total % 10) % 10 == int(value[-1])


def _decimal(value: str) -> str | None:
    value = value.replace(",", "").replace("$", "").strip()
    if value == "":
        return None
    try:
        return format(Decimal(value), "f")
    except InvalidOperation:
        return None


def _integer(value: str) -> int | None:
    decimal = _decimal(value)
    if decimal is None:
        return None
    parsed = Decimal(decimal)
    if parsed != parsed.to_integral_value() or parsed < 0:
        return None
    return int(parsed)


def _is_formula_like(value: str) -> bool:
    return value.lstrip().startswith(("=", "+", "-", "@"))


def normalize_sheet(
    data: bytes,
    filename: str,
    sheet_index: int,
    header_row: int,
    mappings: list[dict[str, Any]],
) -> dict[str, Any]:
    _, sheets = read_workbook(data, filename)
    sheet = next((candidate for candidate in sheets if candidate.index == sheet_index), None)
    if sheet is None:
        raise WorkbookError("SHEET_NOT_FOUND", "Selected sheet no longer exists.")
    if header_row < 1 or header_row > len(sheet.rows):
        raise WorkbookError("HEADER_ROW_INVALID", "Selected header row is outside the sheet.")
    if header_row >= len(sheet.rows):
        raise WorkbookError("NO_DATA_ROWS", "Selected header row has no data rows.")
    mapped_indices = {entry["target"]: int(entry["source_index"]) for entry in mappings}
    output_rows: list[dict[str, Any]] = []
    for source_row_number, row in enumerate(sheet.rows[header_row:], start=header_row + 1):
        raw = {str(index): value for index, value in enumerate(row)}
        offer: dict[str, Any] = {}
        warnings: list[dict[str, str]] = []
        for source_index, value in enumerate(row):
            if _is_formula_like(value):
                warnings.append(
                    {
                        "code": "FORMULA_LIKE_CELL",
                        "severity": "WARNING",
                        "field": f"column_{source_index}",
                    }
                )
        for target, source_index in mapped_indices.items():
            value = row[source_index].strip() if source_index < len(row) else ""
            if target in {"UPC", "EAN", "GTIN"}:
                offer[target.lower()] = value or None
                if value and not _check_digit_is_valid(value):
                    warnings.append(
                        {
                            "code": "INVALID_IDENTIFIER",
                            "severity": "WARNING",
                            "field": target.lower(),
                        }
                    )
            elif target == "ASIN":
                offer["asin"] = value or None
                if value and not re.fullmatch(r"B[A-Z0-9]{9}", value.upper()):
                    warnings.append(
                        {"code": "INVALID_ASIN", "severity": "WARNING", "field": "asin"}
                    )
            elif target in NUMERIC_TARGETS:
                key = {
                    "UNIT_COST": "unit_cost",
                    "QUANTITY": "quantity",
                    "CASE_COUNT": "case_count",
                    "PACK_COUNT": "pack_count",
                    "WEIGHT": "weight",
                    "LENGTH": "length",
                    "WIDTH": "width",
                    "HEIGHT": "height",
                }[target]
                numeric = (
                    _integer(value)
                    if target in {"QUANTITY", "CASE_COUNT", "PACK_COUNT"}
                    else _decimal(value)
                )
                offer[key] = numeric
                if value and numeric is None:
                    warnings.append(
                        {"code": "INVALID_NUMERIC", "severity": "WARNING", "field": key}
                    )
            else:
                key = {
                    "ITEM_NUMBER": "item_number",
                    "DESCRIPTION": "description",
                    "BRAND": "brand",
                    "CURRENCY": "currency",
                }.get(target, target.lower())
                offer[key] = value or None
        if not any(offer.get(field) for field in ("asin", "upc", "ean", "gtin", "item_number")):
            warnings.append(
                {"code": "MISSING_IDENTIFIER", "severity": "WARNING", "field": "identifier"}
            )
        checksum = hashlib.sha256(repr(sorted(raw.items())).encode()).hexdigest()
        output_rows.append(
            {
                "source_row_number": source_row_number,
                "raw_data": raw,
                "row_checksum": checksum,
                "offer": offer,
                "warnings": warnings,
            }
        )
    return {"rows": output_rows}
