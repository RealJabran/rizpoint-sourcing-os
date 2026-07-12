import asyncio

import httpx
import pytest

from rizpoint_scanner.main import app


def test_mock_scan_is_deterministic() -> None:
    async def process_twice() -> tuple[httpx.Response, httpx.Response]:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            first = await client.post("/v1/mock-scans", json={"scan_job_id": "scan_123"})
            second = await client.post("/v1/mock-scans", json={"scan_job_id": "scan_123"})
            return first, second

    first, second = asyncio.run(process_twice())

    assert first.status_code == 200
    assert first.json() == second.json()
    assert first.json()["row_count"] == 3


def test_inspection_requires_malware_scanner_when_not_in_local_mock_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MALWARE_SCAN_MODE", "invalid")

    async def inspect() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post(
                "/v1/workbooks/inspect",
                json={
                    "filename": "catalog.csv",
                    "content_base64": "VVBDLERlc2NyaXB0aW9uCjAxMjM0NTY3ODkwNSxXaWRnZXQK",
                },
            )

    response = asyncio.run(inspect())

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "MALWARE_SCAN_CONFIGURATION"
