from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.security import SESSION_COOKIE_NAME, verify_password
from app.db.session import get_session_factory
from app.main import app
from app.models.audit import AuditLog
from app.models.configuration import AppSetting, Currency, UserCurrency
from app.models.institution import Institution
from app.models.user import User


def bootstrap_payload(**overrides):
    payload = {
        "bootstrapToken": "test-bootstrap-token",
        "email": "admin@example.com",
        "displayName": "Admin",
        "password": "a-strong-password-123",
    }
    payload.update(overrides)
    return payload


def test_bootstrap_initializes_admin_defaults_and_http_only_session() -> None:
    with TestClient(app) as client:
        assert client.get("/api/v1/setup/status").json() == {"requires_setup": True}

        weak_password = client.post(
            "/api/v1/setup/bootstrap",
            json=bootstrap_payload(password="short"),
        )
        assert weak_password.status_code == 422
        assert weak_password.json()["error"]["code"] == "VALIDATION_ERROR"

        invalid = client.post(
            "/api/v1/setup/bootstrap",
            json=bootstrap_payload(bootstrapToken="wrong-token"),
        )
        assert invalid.status_code == 403
        assert invalid.json()["error"]["code"] == "INVALID_BOOTSTRAP_TOKEN"

        response = client.post("/api/v1/setup/bootstrap", json=bootstrap_payload())
        assert response.status_code == 201
        assert response.json()["email"] == "admin@example.com"
        assert "HttpOnly" in response.headers["set-cookie"]
        assert SESSION_COOKIE_NAME in client.cookies
        assert client.get("/api/v1/auth/me").status_code == 200
        assert client.get("/api/v1/setup/status").json() == {"requires_setup": False}

        duplicate = client.post("/api/v1/setup/bootstrap", json=bootstrap_payload())
        assert duplicate.status_code == 409

    with get_session_factory()() as db:
        user = db.scalar(select(User).where(User.email == "admin@example.com"))
        assert user is not None
        assert user.password_hash != "a-strong-password-123"
        assert verify_password("a-strong-password-123", user.password_hash)
        assert db.scalar(select(func.count(Currency.code))) == 5
        assert db.scalar(select(func.count(UserCurrency.currency_code))) == 5
        assert db.scalar(select(func.count(AppSetting.id))) == 3
        cash = db.scalar(select(Institution).where(Institution.institution_type == "cash"))
        assert cash is not None and cash.name == "现金"
        assert db.scalar(select(func.count(AuditLog.id))) == 2


def test_login_logout_and_password_change_flow() -> None:
    with TestClient(app) as client:
        client.post("/api/v1/setup/bootstrap", json=bootstrap_payload())
        logout = client.post("/api/v1/auth/logout")
        assert logout.status_code == 204
        assert client.get("/api/v1/auth/me").status_code == 401

        wrong = client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "wrong-password"},
        )
        assert wrong.status_code == 401

        login = client.post(
            "/api/v1/auth/login",
            json={"email": "ADMIN@example.com", "password": "a-strong-password-123"},
        )
        assert login.status_code == 200
        assert "HttpOnly" in login.headers["set-cookie"]

        unchanged = client.post(
            "/api/v1/auth/change-password",
            json={
                "currentPassword": "a-strong-password-123",
                "newPassword": "a-strong-password-123",
            },
        )
        assert unchanged.status_code == 400

        changed = client.post(
            "/api/v1/auth/change-password",
            json={
                "currentPassword": "a-strong-password-123",
                "newPassword": "an-even-stronger-password-456",
            },
        )
        assert changed.status_code == 200
        assert client.get("/api/v1/auth/me").status_code == 200

        client.post("/api/v1/auth/logout")
        old_login = client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "a-strong-password-123"},
        )
        assert old_login.status_code == 401
        new_login = client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "an-even-stronger-password-456"},
        )
        assert new_login.status_code == 200
