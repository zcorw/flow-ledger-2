"""Synthetic image + mocked HTTP contract tests; never contact the paid API."""

import base64
import io
import json

import httpx
import pytest
from PIL import Image
from pydantic import SecretStr

from app.core.config import get_settings
from app.services import receipt
from tests.test_expenses import bootstrap

URL = "/api/v1/expenses/receipt-recognition"
HEADERS = {"Content-Type": "image/png", "X-Receipt-Upload": "1"}
AsyncClient = httpx.AsyncClient


def synthetic_image(fmt="PNG", size=(40, 80), exif=None):
    out = io.BytesIO()
    image = Image.new("RGB", size, "white")
    image.save(out, format=fmt, **({"exif": exif} if exif else {}))
    return out.getvalue()


def extraction(**changes):
    return {
        "is_receipt": True,
        "amount": "1234",
        "expense_date": "2026-11-01",
        "currency_code": "JPY",
        "merchant": "合成スーパー",
        "warnings": [],
        **changes,
    }


def response_body(**changes):
    return {
        "status": "completed",
        "output": [
            {
                "type": "message",
                "content": [
                    {"type": "output_text", "text": json.dumps(extraction(**changes))},
                ],
            }
        ],
    }


@pytest.fixture
def provider(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "openai_api_key", SecretStr("synthetic-test-key"))
    receipt._requests.clear()
    state = {"calls": [], "status": 200, "body": response_body(), "error": None}

    def handle(request):
        state["calls"].append(request)
        if state["error"]:
            raise state["error"]
        return httpx.Response(state["status"], json=state["body"])

    monkeypatch.setattr(
        receipt.httpx,
        "AsyncClient",
        lambda **kwargs: AsyncClient(transport=httpx.MockTransport(handle), **kwargs),
    )
    yield state
    receipt._requests.clear()


def test_auth_header_and_configuration_block_upload_without_provider(client, provider, monkeypatch):
    assert client.post(URL, headers=HEADERS, content=synthetic_image()).status_code == 401
    bootstrap(client)
    assert client.post(URL, content=synthetic_image()).status_code == 400
    monkeypatch.setattr(get_settings(), "openai_api_key", SecretStr(""))
    assert client.get(URL).json() == {"configured": False, "model": "gpt-6-luna"}
    assert client.post(URL, headers=HEADERS, content=synthetic_image()).status_code == 503
    assert provider["calls"] == []


@pytest.mark.parametrize(
    ("changes", "model"),
    [
        ({}, "gpt-6-luna"),
        ({"amount": "12.50", "currency_code": "EUR", "merchant": "Synthetic Cafe"}, "gpt-6-sol"),
        ({"amount": "88.80", "currency_code": "CNY", "merchant": "合成商店"}, "gpt-6-luna"),
        ({"amount": "99999999999999.999999"}, "gpt-6-luna"),
    ],
)
def test_openai_contract_and_candidate_never_create_expenses(
    client, provider, monkeypatch, changes, model
):
    bootstrap(client)
    monkeypatch.setattr(get_settings(), "receipt_model", model)
    provider["body"] = response_body(**changes)
    assert client.get(URL).json() == {"configured": True, "model": model}
    assert provider["calls"] == []
    result = client.post(URL, headers=HEADERS, content=synthetic_image())
    assert result.status_code == 200
    assert result.json()["amount"] == changes.get("amount", "1234")
    request = provider["calls"][0]
    assert str(request.url) == receipt.OPENAI_URL
    assert request.headers["Authorization"] == "Bearer synthetic-test-key"
    payload = json.loads(request.content)
    assert payload["model"] == model
    assert payload["store"] is False
    assert payload["max_output_tokens"] == 2000 and payload["reasoning"] == {"effort": "low"}
    assert "tools" not in payload and "previous_response_id" not in payload
    schema = payload["text"]["format"]
    assert schema["strict"] and schema["schema"]["additionalProperties"] is False
    assert set(schema["schema"]["required"]) == set(extraction())
    image = payload["input"][0]["content"][1]
    assert image["detail"] == "high" and image["image_url"].startswith("data:image/jpeg;base64,")
    assert Image.open(io.BytesIO(base64.b64decode(image["image_url"].split(",")[1]))).size == (
        40,
        80,
    )
    assert client.get("/api/v1/expenses").json()["total"] == 0
    assert "synthetic-test-key" not in result.text


@pytest.mark.parametrize(
    ("raw", "headers", "status"),
    [
        (b"", HEADERS, 413),
        (b"not-a-png", HEADERS, 422),
        (b"x" * (receipt.MAX_IMAGE_BYTES + 1), HEADERS, 413),
        (synthetic_image("JPEG"), HEADERS, 422),
        (synthetic_image(size=(10001, 1)), HEADERS, 422),
        (synthetic_image(size=(5000, 4100)), HEADERS, 422),
        (b"synthetic", {**HEADERS, "Content-Type": "image/heic"}, 415),
    ],
    ids=["empty", "invalid", "oversize", "mime-mismatch", "too-wide", "too-many-pixels", "heic"],
)
def test_bad_images_rejected_before_paid_call(client, provider, raw, headers, status):
    bootstrap(client)
    assert client.post(URL, headers=headers, content=raw).status_code == status
    assert not provider["calls"]


def test_normalization_strips_metadata_and_orients_without_storing_files():
    exif = Image.Exif()
    exif[270] = "synthetic-private-metadata"
    exif[274] = 6
    result = receipt.normalize_image(synthetic_image("JPEG", exif=exif), "image/jpeg")
    assert b"synthetic-private-metadata" not in result
    with Image.open(io.BytesIO(result)) as image:
        assert image.size == (80, 40) and not image.getexif()
    result = receipt.normalize_image(synthetic_image(size=(1000, 8000)), "image/png")
    assert Image.open(io.BytesIO(result)).size == (512, 4096)


@pytest.mark.parametrize(
    "changes",
    [
        {"amount": None, "expense_date": None, "currency_code": None, "merchant": None},
        {"amount": "-12", "expense_date": "2026-02-29", "currency_code": "¥"},
        {"amount": "1,234", "expense_date": "20261101", "currency_code": "jpy"},
        {"amount": "NaN", "expense_date": "2026-11-01T00:00:00Z", "currency_code": ""},
        {"amount": "100000000000000", "expense_date": "", "currency_code": "JPY/CNY"},
    ],
)
def test_unknown_or_invalid_fields_stay_empty_with_review_warning(client, provider, changes):
    bootstrap(client)
    provider["body"] = response_body(**changes)
    result = client.post(URL, headers=HEADERS, content=synthetic_image())
    assert result.status_code == 200
    candidate = result.json()
    assert candidate["amount"] == candidate["expenseDate"] == candidate["currencyCode"] == ""
    assert len(candidate["warnings"]) >= 4


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "RECEIPT_PROVIDER_CONFIG"),
        (403, "RECEIPT_PROVIDER_CONFIG"),
        (404, "RECEIPT_PROVIDER_CONFIG"),
        (429, "RECEIPT_PROVIDER_LIMIT"),
        (500, "RECEIPT_PROVIDER_ERROR"),
        (400, "RECEIPT_PROVIDER_ERROR"),
    ],
)
def test_provider_errors_are_sanitized_and_never_retried(client, provider, status, code):
    bootstrap(client)
    provider["status"] = status
    provider["body"] = {"error": {"message": "synthetic-private-provider-body"}}
    result = client.post(URL, headers=HEADERS, content=synthetic_image())
    assert result.json()["error"]["code"] == code
    assert "synthetic-private-provider-body" not in result.text
    assert len(provider["calls"]) == 1


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"status": "incomplete", "output": []}, "RECEIPT_INCOMPLETE"),
        ({"status": "completed", "output": []}, "RECEIPT_INVALID_RESULT"),
        (
            {
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {"type": "refusal", "refusal": "synthetic-private-refusal"},
                        ],
                    }
                ],
            },
            "RECEIPT_REFUSED",
        ),
        (response_body(is_receipt=False), "RECEIPT_NOT_FOUND"),
        (response_body(amount=1234), "RECEIPT_INVALID_RESULT"),
        ([], "RECEIPT_INVALID_RESULT"),
    ],
)
def test_incomplete_refused_and_malformed_outputs(client, provider, body, code):
    bootstrap(client)
    provider["body"] = body
    result = client.post(URL, headers=HEADERS, content=synthetic_image())
    assert result.json()["error"]["code"] == code
    assert "synthetic-private-refusal" not in result.text


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (httpx.ReadTimeout("private detail"), "RECEIPT_TIMEOUT"),
        (httpx.ConnectError("private detail"), "RECEIPT_CONNECTION"),
    ],
)
def test_network_failure_does_not_retry_or_expose_details(client, provider, error, code):
    bootstrap(client)
    provider["error"] = error
    result = client.post(URL, headers=HEADERS, content=synthetic_image())
    assert result.json()["error"]["code"] == code
    assert "private detail" not in result.text
    assert len(provider["calls"]) == 1


def test_rate_and_concurrency_limits_prevent_paid_requests(client, provider, monkeypatch):
    bootstrap(client)
    monkeypatch.setattr(get_settings(), "receipt_requests_per_minute", 1)
    assert client.post(URL, headers=HEADERS, content=synthetic_image()).status_code == 200
    assert client.post(URL, headers=HEADERS, content=synthetic_image()).status_code == 429
    assert len(provider["calls"]) == 1
    receipt._slots.acquire()
    receipt._slots.acquire()
    try:
        result = client.post(URL, headers=HEADERS, content=synthetic_image())
        assert result.json()["error"]["code"] == "RECEIPT_BUSY"
        assert len(provider["calls"]) == 1
    finally:
        receipt._slots.release()
        receipt._slots.release()
