import io

import openpyxl
import xlwt

from rizpoint_scanner.workbooks import inspect_workbook, normalize_sheet


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
