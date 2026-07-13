from fastapi.testclient import TestClient

from rizpoint_scanner.main import app


def test_xlsx_export_is_available() -> None:
    response = TestClient(app).post(
        "/v1/exports/xlsx",
        json={"sheets": [{"sheet_name": "Purchase Order", "columns": ["UPC"], "rows": [["0123"]]}]},
    )
    assert response.status_code == 200
    assert len(response.json()["content_base64"]) > 100
