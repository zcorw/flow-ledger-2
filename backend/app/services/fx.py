import logging
import uuid
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models.common import utc_now
from app.models.configuration import UserCurrency
from app.models.fx import FxRate, FxSyncRun

logger = logging.getLogger(__name__)
RATE_QUANTIZER = Decimal("0.0000000001")


class FrankfurterFxProvider:
    source = "frankfurter.dev"

    def fetch_rates(self, currencies: list[str]) -> tuple[date, dict[str, Decimal]]:
        if not currencies:
            return date.today(), {}
        response = httpx.get(
            "https://api.frankfurter.dev/v1/latest",
            params={"from": "CNY", "to": ",".join(currencies)},
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
        rate_date = date.fromisoformat(payload["date"])
        rates_from_cny = {code: Decimal(str(value)) for code, value in payload["rates"].items()}
        rates_to_cny = {
            code: (Decimal("1") / value).quantize(RATE_QUANTIZER, rounding=ROUND_HALF_UP)
            for code, value in rates_from_cny.items()
            if value > 0
        }
        return rate_date, rates_to_cny


def get_fx_provider() -> FrankfurterFxProvider:
    return FrankfurterFxProvider()


def enabled_currency_codes(db: Session, user_id: uuid.UUID) -> list[str]:
    return list(
        db.scalars(
            select(UserCurrency.currency_code)
            .where(UserCurrency.user_id == user_id)
            .order_by(UserCurrency.currency_code)
        )
    )


def sync_enabled_rates(
    db: Session,
    user_id: uuid.UUID,
    provider: FrankfurterFxProvider,
    *,
    triggered_by_user_id: uuid.UUID | None = None,
) -> FxSyncRun:
    settings = get_settings()
    foreign_codes = [
        code for code in enabled_currency_codes(db, user_id) if code != settings.base_currency
    ]
    sync_run = FxSyncRun(
        status="running",
        currencies=foreign_codes,
        triggered_by_user_id=triggered_by_user_id,
    )
    db.add(sync_run)
    db.flush()
    try:
        rate_date, rates = provider.fetch_rates(foreign_codes)
        missing = sorted(set(foreign_codes) - set(rates))
        if missing:
            raise ValueError(f"Missing rates for: {', '.join(missing)}")
        for code, rate in rates.items():
            existing = db.scalar(
                select(FxRate).where(
                    FxRate.base_currency == settings.base_currency,
                    FxRate.quote_currency == code,
                    FxRate.rate_date == rate_date,
                    FxRate.source == provider.source,
                )
            )
            if existing:
                existing.rate_to_base = rate
                existing.fetched_at = utc_now()
            else:
                db.add(
                    FxRate(
                        base_currency=settings.base_currency,
                        quote_currency=code,
                        rate_date=rate_date,
                        rate_to_base=rate,
                        source=provider.source,
                    )
                )
        sync_run.status = "success"
        sync_run.message = f"Synced {len(rates)} currencies for {rate_date.isoformat()}"
    except Exception as exc:
        logger.exception("FX synchronization failed")
        sync_run.status = "failed"
        sync_run.message = str(exc)[:1000]
    sync_run.finished_at = utc_now()
    db.commit()
    db.refresh(sync_run)
    return sync_run


@dataclass(frozen=True)
class RateResolution:
    fx_rate_id: uuid.UUID | None
    currency_code: str
    rate_date: date
    rate_to_cny: Decimal
    source: str
    is_stale: bool


def resolve_rate(db: Session, currency_code: str, target_date: date) -> RateResolution:
    settings = get_settings()
    if currency_code == settings.base_currency:
        return RateResolution(
            fx_rate_id=None,
            currency_code=currency_code,
            rate_date=target_date,
            rate_to_cny=Decimal("1"),
            source="base-currency",
            is_stale=False,
        )
    rate = db.scalar(
        select(FxRate)
        .where(
            FxRate.base_currency == settings.base_currency,
            FxRate.quote_currency == currency_code,
            FxRate.rate_date <= target_date,
        )
        .order_by(FxRate.rate_date.desc(), FxRate.fetched_at.desc())
        .limit(1)
    )
    if rate is None:
        raise ApiError(
            409,
            "FX_RATE_MISSING",
            f"{currency_code} 在 {target_date.isoformat()} 之前没有可用汇率",
        )
    return RateResolution(
        fx_rate_id=rate.id,
        currency_code=currency_code,
        rate_date=rate.rate_date,
        rate_to_cny=rate.rate_to_base,
        source=rate.source,
        is_stale=rate.rate_date < target_date,
    )
