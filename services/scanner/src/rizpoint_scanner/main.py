from hashlib import sha256

import polars as pl
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="RizPoint Scanner", version="0.0.0")


class MockScanRequest(BaseModel):
    scan_job_id: str = Field(min_length=1)


class MockScanResponse(BaseModel):
    scanner: str
    row_count: int
    checksum: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "scanner"}


@app.get("/ready")
def ready() -> dict[str, str]:
    return {"status": "ready", "service": "scanner"}


@app.post("/v1/mock-scans", response_model=MockScanResponse)
def process_mock_scan(request: MockScanRequest) -> MockScanResponse:
    """Deterministic stand-in for future Polars scan stages."""
    synthetic_rows = pl.DataFrame({"scan_job_id": [request.scan_job_id] * 3})
    checksum = sha256(f"phase-zero:{request.scan_job_id}".encode()).hexdigest()
    return MockScanResponse(scanner="mock", row_count=synthetic_rows.height, checksum=checksum)
