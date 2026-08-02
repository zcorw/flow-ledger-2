from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.fx import get_fx_provider
from app.core.errors import ApiError
from app.db.session import get_session_factory
from app.main import app
from app.models.configuration import AppSetting
from app.services.fx import resolve_rate


def bootstrap(client: TestClient) -> None:
    response = client.post(
        "/api/v1/setup/bootstrap",
        json={
            "bootstrapToken": "test-bootstrap-token",
            "email": "admin@example.com",
            "displayName": "Admin",
            "password": "a-strong-password-123",
        },
    )
    assert response.status_code == 201


class FakeFxProvider:
    source = "test-provider"

    def fetch_rates(self, currencies: list[str]):
        available = {
            "USD": Decimal("7.1234567890"),
            "JPY": Decimal("0.0485500000"),
            "HKD": Decimal("0.9193200000"),
            "EUR": Decimal("8.4200000000"),
        }
        return date(2026, 7, 31), {code: available[code] for code in currencies}


def test_enabled_currency_constraints() -> None:
    with TestClient(app) as client:
        bootstrap(client)
        currencies = client.get("/api/v1/currencies").json()
        assert len(currencies) == 5
        assert all(item["enabled"] for item in currencies)
        assert next(item for item in currencies if item["code"] == "CNY")["is_base"] is True

        without_base = client.put(
            "/api/v1/currencies/enabled",
            json={"enabledCurrencyCodes": ["USD", "JPY"]},
        )
        assert without_base.status_code == 400
        assert without_base.json()["error"]["code"] == "BASE_CURRENCY_REQUIRED"

        updated = client.put(
            "/api/v1/currencies/enabled",
            json={"enabledCurrencyCodes": ["CNY", "USD", "JPY"]},
        )
        assert updated.status_code == 200
        assert {item["code"] for item in updated.json() if item["enabled"]} == {"CNY", "USD", "JPY"}

        with get_session_factory()() as db:
            setting = db.scalar(select(AppSetting).where(AppSetting.key == "currency_limit"))
            assert setting is not None
            setting.value = {"value": 2}
            db.commit()
        over_limit = client.put(
            "/api/v1/currencies/enabled",
            json={"enabledCurrencyCodes": ["CNY", "USD", "JPY"]},
        )
        assert over_limit.status_code == 400
        assert over_limit.json()["error"]["code"] == "CURRENCY_LIMIT_EXCEEDED"


def test_sync_history_and_stale_fallback() -> None:
    app.dependency_overrides[get_fx_provider] = lambda: FakeFxProvider()
    try:
        with TestClient(app) as client:
            bootstrap(client)
            client.put(
                "/api/v1/currencies/enabled",
                json={"enabledCurrencyCodes": ["CNY", "USD", "JPY"]},
            )
            sync = client.post("/api/v1/fx-rates/sync")
            assert sync.status_code == 200
            assert sync.json()["status"] == "success"
            assert sync.json()["currencies"] == ["JPY", "USD"]

            latest = client.get("/api/v1/fx-rates/latest")
            assert latest.status_code == 200
            assert {item["quote_currency"] for item in latest.json()} == {"USD", "JPY"}

            history = client.get(
                "/api/v1/fx-rates/history",
                params={"currency": "USD", "from": "2026-07-01", "to": "2026-08-31"},
            )
            assert len(history.json()) == 1
            assert history.json()[0]["rate_to_base"] == "7.1234567890"
            assert len(client.get("/api/v1/fx-rates/sync-runs").json()) == 1

        with get_session_factory()() as db:
            exact = resolve_rate(db, "USD", date(2026, 7, 31))
            assert exact.is_stale is False
            assert exact.rate_to_cny == Decimal("7.1234567890")
            stale = resolve_rate(db, "USD", date(2026, 8, 3))
            assert stale.is_stale is True
            assert stale.rate_date == date(2026, 7, 31)
            with pytest.raises(ApiError) as missing:
                resolve_rate(db, "HKD", date(2026, 7, 1))
            assert missing.value.code == "FX_RATE_MISSING"
    finally:
        app.dependency_overrides.pop(get_fx_provider, None)
