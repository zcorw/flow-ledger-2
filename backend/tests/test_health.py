from fastapi.testclient import TestClient

from app.main import app


def test_health_check_reports_api_and_database() -> None:
    response = TestClient(app).get("/api/v1/system/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "api": "ok",
        "database": "ok",
        "scheduler": "configured",
        "environment": "test",
    }
