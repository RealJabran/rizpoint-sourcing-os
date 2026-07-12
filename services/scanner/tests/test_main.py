import asyncio

import httpx

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
