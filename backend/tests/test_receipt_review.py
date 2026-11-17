import json

import httpx
from pydantic import SecretStr
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.errors import ApiError
from app.db.session import get_session_factory
from app.models.asset import Account
from app.models.expense import Expense
from app.schemas.receipt_review import ReviewFields, VoicePatch
from app.services import receipt_review as review
from tests.test_receipt_devices import BASE, grant

pytest_plugins = ["tests.test_receipt_devices"]


def patch(**values):
    return VoicePatch.model_validate(
        {
            **dict.fromkeys(
                [
                    "amount",
                    "expenseDate",
                    "currencyCode",
                    "merchant",
                    "category",
                    "accountName",
                    "note",
                ]
            ),
            "warnings": [],
            **values,
        }
    )


def test_correction_requires_grant_and_does_not_write_expenses(rig, monkeypatch):
    owner, device, _, _ = rig
    token = grant(rig)["accessToken"]
    payload = {
        "transcript": "金额改为 700 日元",
        "values": {"amount": "614", "currencyCode": "JPY"},
    }
    assert device.post(BASE + "/review-correction", json=payload).status_code == 401
    calls = []

    async def infer(data, settings, user_id):
        calls.append(data)
        return patch(amount="700", currencyCode="JPY", merchant=None)

    monkeypatch.setattr(review, "infer_patch", infer)
    result = device.post(
        BASE + "/review-correction", json=payload, headers={"Authorization": "Bearer " + token}
    )
    assert result.status_code == 200
    assert result.json()["values"]["amount"] == "700"
    assert result.json()["values"]["merchant"] == ""
    assert result.json()["changedFields"] == ["amount"]
    assert len(calls) == 1
    assert owner.get("/api/v1/expenses").json()["total"] == 0
    assert result.headers["cache-control"] == "no-store"
    bad = device.post(
        BASE + "/review-correction",
        json={**payload, "save": True},
        headers={"Authorization": "Bearer " + token},
    )
    assert bad.status_code == 422 and len(calls) == 1
    assert "金额改为" not in bad.text


def test_invalid_and_ambiguous_corrections_preserve_unspecified_values(rig):
    owner = rig[0]
    assert (
        owner.post(
            "/api/v1/accounts",
            json={
                "name": "合成现金",
                "accountType": "cash_wallet",
            },
        ).status_code
        == 201
    )
    with get_session_factory()() as db:
        account = db.scalar(select(Account))
        current = ReviewFields(amount="614", currencyCode="JPY", merchant="原商户")
        result = review.apply_patch(
            db,
            account.user_id,
            current,
            patch(
                amount="-1",
                currencyCode="ZZZ",
                expenseDate="2026-02-29",
                category="invented",
                accountName="未知账户",
            ),
        )
        assert result["values"]["amount"] == "614"
        assert result["values"]["merchant"] == "原商户"
        assert result["values"]["currencyCode"] == "JPY"
        assert result["changedFields"] == [] and result["warnings"]
        good = review.apply_patch(
            db, account.user_id, current, patch(accountName=account.name, category="food")
        )
        assert good["values"]["accountId"] == str(account.id)
        assert good["values"]["category"] == "food"
        assert db.scalar(select(func.count()).select_from(Expense)) == 0


def test_provider_uses_structured_text_only_and_never_retries(rig, monkeypatch):
    import asyncio

    settings = get_settings()
    monkeypatch.setattr(settings, "openai_api_key", SecretStr("synthetic-key"))
    calls = []

    def handle(request):
        calls.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {"type": "output_text", "text": patch(amount="42").model_dump_json()}
                        ],
                    }
                ],
            },
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        review.httpx,
        "AsyncClient",
        lambda **kw: original(transport=httpx.MockTransport(handle), **kw),
    )
    assert asyncio.run(review.infer_patch({"transcript": "42"}, settings, "test")).amount == "42"
    assert len(calls) == 1 and calls[0]["store"] is False
    assert calls[0]["text"]["format"]["strict"] is True
    assert "input_image" not in json.dumps(calls)


def test_correction_failure_preserves_candidate_and_sanitizes_response(rig, monkeypatch):
    _, device, _, _ = rig
    token = grant(rig)["accessToken"]

    async def infer(*args):
        raise ApiError(504, "RECEIPT_TIMEOUT", "语音修正超时，原账单未改变")

    monkeypatch.setattr(review, "infer_patch", infer)
    response = device.post(
        BASE + "/review-correction",
        json={"transcript": "私人指令", "values": {"amount": "614"}},
        headers={"Authorization": "Bearer " + token},
    )
    assert response.status_code == 504 and "私人指令" not in response.text
