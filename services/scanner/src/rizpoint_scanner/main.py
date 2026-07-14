from hashlib import sha256
from io import BytesIO
from typing import Any

import polars as pl
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from rizpoint_scanner.malware import malware_ready, scan_upload
from rizpoint_scanner.workbooks import WorkbookError, inspect_workbook, normalize_sheet

app = FastAPI(title="RizPoint Scanner", version="0.0.0")


class MockScanRequest(BaseModel):
    scan_job_id: str = Field(min_length=1)


class MockScanResponse(BaseModel):
    scanner: str
    row_count: int
    checksum: str


class WorkbookInspectRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(min_length=1)


class NormalizeRequest(WorkbookInspectRequest):
    sheet_index: int = Field(ge=0)
    header_row: int = Field(ge=1)
    mappings: list[dict[str, Any]]


class ExportSheet(BaseModel):
    sheet_name: str = Field(min_length=1, max_length=31)
    columns: list[str] = Field(min_length=1, max_length=80)
    rows: list[list[str | int | float]] = Field(max_length=50000)


class XlsxExportRequest(BaseModel):
    sheets: list[ExportSheet] = Field(min_length=1, max_length=4)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "scanner"}


@app.get("/ready")
def ready() -> dict[str, str]:
    if not malware_ready():
        raise HTTPException(status_code=503, detail={"code": "MALWARE_SCANNER_UNAVAILABLE"})
    return {"status": "ready", "service": "scanner"}


@app.post("/v1/mock-scans", response_model=MockScanResponse)
def process_mock_scan(request: MockScanRequest) -> MockScanResponse:
    """Deterministic stand-in for future Polars scan stages."""
    synthetic_rows = pl.DataFrame({"scan_job_id": [request.scan_job_id] * 3})
    checksum = sha256(f"phase-zero:{request.scan_job_id}".encode()).hexdigest()
    return MockScanResponse(scanner="mock", row_count=synthetic_rows.height, checksum=checksum)


@app.post("/v1/workbooks/inspect")
def inspect_upload(request: WorkbookInspectRequest) -> dict[str, Any]:
    import base64

    try:
        content = base64.b64decode(request.content_base64, validate=True)
        scan_upload(content)
        return inspect_workbook(content, request.filename)
    except (ValueError, WorkbookError) as error:
        code = error.code if isinstance(error, WorkbookError) else "INVALID_UPLOAD"
        raise HTTPException(status_code=400, detail={"code": code}) from error


@app.post("/v1/workbooks/normalize")
def normalize_upload(request: NormalizeRequest) -> dict[str, Any]:
    import base64

    try:
        content = base64.b64decode(request.content_base64, validate=True)
        scan_upload(content)
        return normalize_sheet(
            content,
            request.filename,
            request.sheet_index,
            request.header_row,
            request.mappings,
        )
    except (ValueError, WorkbookError) as error:
        code = error.code if isinstance(error, WorkbookError) else "INVALID_UPLOAD"
        raise HTTPException(status_code=400, detail={"code": code}) from error


@app.post("/v1/exports/xlsx")
def export_xlsx(request: XlsxExportRequest) -> dict[str, str]:
    """Create a formula-free workbook from already-sanitized, allowlisted cells."""
    import base64

    from openpyxl import Workbook  # type: ignore[import-untyped]

    workbook = Workbook(write_only=True)
    for sheet in request.sheets:
        worksheet = workbook.create_sheet(title=sheet.sheet_name)
        worksheet.append(sheet.columns)
        for row in sheet.rows:
            worksheet.append(row)
    # openpyxl creates a default sheet only in normal mode; write-only starts empty.
    output = BytesIO()
    workbook.save(output)
    return {"content_base64": base64.b64encode(output.getvalue()).decode("ascii")}
