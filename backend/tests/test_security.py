import pytest
from fastapi import Response
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select

from app.core.config import Settings
from app.core.security import SESSION_COOKIE_NAME, hash_session_token
from app.db.session import get_session_factory
from app.main import app
from app.models.audit import AuditLog
from app.models.auth import AuthSession
from app.services.auth import set_session_cookie

PASSWORD = "security-password-123"


def bootstrap(client: TestClient) -> None:
    response = client.post(
        "/api/v1/setup/bootstrap",
        json={
            "bootstrapToken": "test-bootstrap-token",
            "displayName": "Security Admin",
            "email": "security@example.com",
            "password": PASSWORD,
        },
    )
    assert response.status_code == 201


def test_business_endpoints_require_authentication(client: TestClient) -> None:
    endpoints = [
        ("GET", "/api/v1/institutions"),
        ("GET", "/api/v1/dashboard/summary?snapshotDate=2026-08-01"),
        ("GET", "/api/v1/debts?type=receivable"),
        ("GET", "/api/v1/imports/templates/monthly_snapshot"),
        ("GET", "/api/v1/audit-logs"),
        ("POST", "/api/v1/exports/master-data"),
        ("POST", "/api/v1/exports/monthly-snapshots"),
        ("POST", "/api/v1/exports/debt-events"),
        ("POST", "/api/v1/backups/export"),
    ]
    for method, path in endpoints:
        response = client.request(method, path)
        assert response.status_code == 401
        assert response.json() == {
            "error": {
                "code": "NOT_AUTHENTICATED",
                "message": "请先登录",
                "details": [],
            }
        }


def test_session_token_is_hashed_and_password_change_revokes_other_sessions() -> None:
    with TestClient(app) as primary:
        bootstrap(primary)
        raw_token = primary.cookies[SESSION_COOKIE_NAME]
        with get_session_factory()() as db:
            session = db.scalar(select(AuthSession))
            assert session is not None
            assert session.token_hash == hash_session_token(raw_token)
            assert session.token_hash != raw_token
            assert len(session.token_hash) == 64

        with TestClient(app) as secondary:
            login = secondary.post(
                "/api/v1/auth/login",
                json={"email": "security@example.com", "password": PASSWORD},
            )
            assert login.status_code == 200
            changed = primary.post(
                "/api/v1/auth/change-password",
                json={
                    "currentPassword": PASSWORD,
                    "newPassword": "security-new-password-456",
                },
            )
            assert changed.status_code == 200
            assert primary.get("/api/v1/auth/me").status_code == 200
            assert secondary.get("/api/v1/auth/me").status_code == 401


def test_cookie_flags_sensitive_responses_and_security_audit(client: TestClient) -> None:
    bootstrap(client)
    cookie = client.cookies[SESSION_COOKIE_NAME]
    response = Response()
    set_session_cookie(
        response,
        "production-token",
        Settings(
            app_env="production",
            secret_key="production-secret-key-that-is-long-enough",
            bootstrap_token="production-bootstrap-token-that-is-random",
        ),
    )
    production_cookie = response.headers["set-cookie"]
    assert "HttpOnly" in production_cookie
    assert "Secure" in production_cookie
    assert "SameSite=lax" in production_cookie

    secret = "must-never-be-reflected"
    with TestClient(app) as attacker:
        denied = attacker.post(
            "/api/v1/auth/login",
            json={"email": "security@example.com", "password": secret},
        )
    assert denied.status_code == 401
    assert secret not in denied.text

    exported = client.post("/api/v1/backups/export")
    assert exported.status_code == 200
    body = exported.text.casefold()
    assert "users" not in exported.json()["tables"]
    for sensitive in ("password", "password_hash", "token_hash", cookie.casefold()):
        assert sensitive not in body

    actions = {item["action"] for item in client.get("/api/v1/audit-logs").json()}
    assert {"auth.login_failed", "backup.export"} <= actions
    with get_session_factory()() as db:
        failed = db.scalar(select(AuditLog).where(AuditLog.action == "auth.login_failed"))
        assert failed is not None
        assert failed.after_data is None and failed.before_data is None


def test_production_rejects_default_or_short_secrets() -> None:
    with pytest.raises(ValidationError, match="production SECRET_KEY"):
        Settings(
            app_env="production",
            secret_key="development-secret-change-me-please",
            bootstrap_token="a-secure-random-production-bootstrap-token",
        )
    with pytest.raises(ValidationError, match="production BOOTSTRAP_TOKEN"):
        Settings(
            app_env="production",
            secret_key="a-secure-random-production-secret-key-value",
            bootstrap_token="too-short",
        )
