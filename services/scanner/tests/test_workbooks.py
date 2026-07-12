import io

import openpyxl
import pytest
import xlwt

from rizpoint_scanner import workbooks
from rizpoint_scanner.workbooks import WorkbookError, inspect_workbook, normalize_sheet


def test_csv_inspection_and_normalization_preserve_leading_zero_identifier() -> None:
    content = (
        b"Supplier catalogue\nUPC,Description,Unit Cost\n012345678905,Widget,12.50\n"
        b"012345678906,Bad Widget,not-a-number\n"
    )

    inspection = inspect_workbook(content, "catalog.csv")
    normalized = normalize_sheet(
        content,
        "catalog.csv",
        sheet_index=0,
        header_row=2,
        mappings=[
            {"source_index": 0, "target": "UPC"},
            {"source_index": 1, "target": "DESCRIPTION"},
            {"source_index": 2, "target": "UNIT_COST"},
        ],
    )

    assert inspection["file_format"] == "CSV"
    assert inspection["sheets"][0]["header_candidates"][0]["row"] == 2
    assert normalized["rows"][0]["offer"]["upc"] == "012345678905"
    assert normalized["rows"][0]["offer"]["unit_cost"] == "12.50"
    assert {warning["code"] for warning in normalized["rows"][1]["warnings"]} == {
        "INVALID_IDENTIFIER",
        "INVALID_NUMERIC",
    }


def test_xlsx_inspection_preserves_zero_padded_numeric_upc() -> None:
    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.title = "Products"
    worksheet.append(["UPC", "Description"])
    worksheet.append([12345678905, "Widget"])
    worksheet["A2"].number_format = "000000000000"
    buffer = io.BytesIO()
    workbook.save(buffer)

    inspection = inspect_workbook(buffer.getvalue(), "catalog.xlsx")

    assert inspection["file_format"] == "XLSX"
    assert inspection["sheets"][0]["preview"][1][0] == "012345678905"


def test_xls_inspection_preserves_zero_padded_numeric_ean() -> None:
    workbook = xlwt.Workbook()
    worksheet = workbook.add_sheet("Products")
    worksheet.write(0, 0, "EAN")
    worksheet.write(1, 0, 123456789012, xlwt.easyxf(num_format_str="0000000000000"))
    buffer = io.BytesIO()
    workbook.save(buffer)

    inspection = inspect_workbook(buffer.getvalue(), "catalog.xls")

    assert inspection["file_format"] == "XLS"
    assert inspection["sheets"][0]["preview"][1][0] == "0123456789012"


def test_rejects_content_that_does_not_match_its_extension() -> None:
    workbook = openpyxl.Workbook()
    workbook.active.append(["UPC"])
    buffer = io.BytesIO()
    workbook.save(buffer)

    with pytest.raises(WorkbookError, match="File content does not match"):
        inspect_workbook(buffer.getvalue(), "catalog.csv")


@pytest.mark.parametrize("file_format", ["XLSX", "XLS"])
def test_rejects_row_and_column_limits_without_truncating(
    monkeypatch: pytest.MonkeyPatch,
    file_format: str,
) -> None:
    monkeypatch.setattr(workbooks, "MAX_ROWS", 2)
    monkeypatch.setattr(workbooks, "MAX_COLUMNS", 2)
    buffer = io.BytesIO()
    if file_format == "XLSX":
        workbook = openpyxl.Workbook()
        worksheet = workbook.active
        worksheet.append(["A", "B", "C"])
        worksheet.append(["1", "2", "3"])
        worksheet.append(["4", "5", "6"])
        workbook.save(buffer)
        filename = "catalog.xlsx"
    else:
        workbook = xlwt.Workbook()
        worksheet = workbook.add_sheet("Products")
        for row_index in range(3):
            for column_index in range(3):
                worksheet.write(row_index, column_index, f"{row_index}-{column_index}")
        workbook.save(buffer)
        filename = "catalog.xls"

    with pytest.raises(WorkbookError) as error:
        inspect_workbook(buffer.getvalue(), filename)

    assert error.value.code in {"ROW_LIMIT", "COLUMN_LIMIT"}


def test_formula_like_cells_are_warned_and_header_only_sheets_are_rejected() -> None:
    content = b'UPC,Description\n012345678905,=HYPERLINK("https://example.invalid","x")\n'
    normalized = normalize_sheet(
        content,
        "catalog.csv",
        sheet_index=0,
        header_row=1,
        mappings=[
            {"source_index": 0, "target": "UPC"},
            {"source_index": 1, "target": "DESCRIPTION"},
        ],
    )

    assert "FORMULA_LIKE_CELL" in {warning["code"] for warning in normalized["rows"][0]["warnings"]}
    with pytest.raises(WorkbookError, match="no data rows"):
        normalize_sheet(
            b"UPC,Description\n",
            "header-only.csv",
            sheet_index=0,
            header_row=1,
            mappings=[{"source_index": 0, "target": "UPC"}],
        )
