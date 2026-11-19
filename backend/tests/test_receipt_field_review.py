import uuid

from sqlalchemy import func, select

from app.db.session import get_session_factory
from app.models.asset import Account
from app.models.expense import Expense
from app.models.user import User
from app.services import receipt_field_review as fields
from app.services import receipt_review as review
from tests.test_receipt_devices import BASE, grant
from tests.test_receipt_review import patch

pytest_plugins = ["tests.test_receipt_devices"]


def account(owner, name, active=True):
    response = owner.post(
        "/api/v1/accounts",
        json={
            "name": name,
            "accountType": "cash_wallet",
            "isActive": active,
        },
    )
    assert response.status_code == 201
    return response.json()


def headers(rig):
    return {"Authorization": "Bearer " + grant(rig)["accessToken"]}


def test_options_require_receipt_auth_return_every_active_owned_choice_and_no_writes(rig):
    owner, device, _, _ = rig
    assert device.get(BASE + "/review-options").status_code == 401
    auth = headers(rig)
    account(owner, "停用钱包", False)
    with get_session_factory()() as db:
        user = db.scalar(select(User))
        for i in range(121):
            db.add(Account(user_id=user.id, name=f"合成账户{i:03}", account_type="cash_wallet"))
        db.commit()
        assert fields.options(db, uuid.uuid4())["accounts"] == []
    response = device.get(BASE + "/review-options", headers=auth)
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    data = response.json()
    assert len(data["accounts"]) == 121
    assert data["accounts"][-1]["label"] == "合成账户120"
    assert len(data["categories"]) == 12 and data["currencies"]
    assert owner.get("/api/v1/expenses").json()["total"] == 0


def test_selected_account_uses_unique_fuzzy_choice_and_keeps_other_fields(rig, monkeypatch):
    owner, device, _, _ = rig
    chosen = account(owner, "微信支付")
    account(owner, "支付宝")
    auth = headers(rig)

    async def forbidden(*args):
        raise AssertionError("enumerated fields must not invoke a model")

    monkeypatch.setattr(review, "infer_patch", forbidden)
    values = {"amount": "972", "currencyCode": "JPY", "merchant": "SEIYU"}
    response = device.post(
        BASE + "/review-correction",
        headers=auth,
        json={
            "values": values,
            "transcript": "微新支付",
            "targetField": "account",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["fieldOutcome"] == "matched" and data["values"]["accountId"] == chosen["id"]
    assert data["values"]["accountName"] == "微信支付"
    assert data["changedFields"] == ["accountId", "accountName"]
    for key, value in values.items():
        assert data["values"][key] == value


def test_duplicate_names_get_visible_disambiguators_and_do_not_pick_one(rig, monkeypatch):
    _, device, _, _ = rig
    auth = headers(rig)
    choices = [
        {"value": str(uuid.uuid4()), "label": "日常钱包 · 000001", "aliases": ["日常钱包"]},
        {"value": str(uuid.uuid4()), "label": "日常钱包 · 000002", "aliases": ["日常钱包"]},
    ]
    monkeypatch.setattr(fields, "options", lambda *args: {"accounts": choices})
    assert len({row["label"] for row in choices}) == 2
    result = device.post(
        BASE + "/review-correction",
        headers=auth,
        json={
            "values": {"amount": "972"},
            "transcript": "日常钱包",
            "targetField": "account",
        },
    ).json()
    assert result["fieldOutcome"] == "ambiguous"
    assert result["values"]["accountId"] == "" and result["changedFields"] == []
    assert result["warnings"]


def test_fuzzy_matching_rejects_close_competitors_negations_and_unknown_choices():
    choices = [
        {"value": "a", "label": "微信支付甲", "aliases": []},
        {"value": "b", "label": "微信支付乙", "aliases": []},
    ]
    for text in ["微信支付丙", "不要微信支付甲", "不改成微信支付甲", "微信支付甲或者微信支付乙"]:
        status, choice = fields.match_choice(text, choices)
        assert status == "ambiguous" and choice is None
    assert fields.match_choice("完全无关", choices) == ("unmatched", None)
    assert fields.match_choice("微信支付甲", choices) == ("matched", choices[0])


def test_target_boundary_discards_model_changes_to_every_other_field(rig, monkeypatch):
    _, device, _, _ = rig
    auth = headers(rig)
    calls = []

    async def infer(data, *args):
        calls.append(data)
        return patch(amount="700", merchant="错误商户", currencyCode="USD", note="不应写入")

    monkeypatch.setattr(review, "infer_patch", infer)
    result = device.post(
        BASE + "/review-correction",
        headers=auth,
        json={
            "values": {"amount": "972", "merchant": "SEIYU", "currencyCode": "JPY"},
            "transcript": "七百",
            "targetField": "amount",
        },
    ).json()
    assert calls[0]["targetField"] == "amount"
    assert result["values"]["amount"] == "700" and result["values"]["merchant"] == "SEIYU"
    assert result["values"]["currencyCode"] == "JPY" and result["values"]["note"] == ""
    assert result["changedFields"] == ["amount"] and result["fieldOutcome"] == "matched"
    with get_session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(Expense)) == 0
    assert (
        device.post(
            BASE + "/review-correction",
            headers=auth,
            json={
                "values": {"amount": "972"},
                "transcript": "七百",
                "targetField": "permission",
            },
        ).status_code
        == 422
    )
    assert len(calls) == 1


def test_selected_categories_support_aliases_same_values_clearing_and_unmatched(rig):
    _, device, _, _ = rig
    auth = headers(rig)
    for transcript, current, expected, outcome in [
        ("日常", "", "groceries", "matched"),
        ("餐饮", "food", "food", "unchanged"),
        ("分类清空", "food", "", "matched"),
        ("完全无关", "food", "food", "unmatched"),
    ]:
        result = device.post(
            BASE + "/review-correction",
            headers=auth,
            json={
                "values": {"amount": "972", "category": current},
                "transcript": transcript,
                "targetField": "category",
            },
        ).json()
        assert result["values"]["category"] == expected
        assert result["values"]["amount"] == "972" and result["fieldOutcome"] == outcome


def test_exact_current_free_field_is_unchanged_without_model_inference(rig, monkeypatch):
    _, device, _, _ = rig
    auth = headers(rig)

    async def forbidden(*args):
        raise AssertionError("an exact current value needs no inference")

    monkeypatch.setattr(review, "infer_patch", forbidden)
    for field, text in [("merchant", "SEIYU"), ("amount", "972"), ("note", "原备注")]:
        values = {"merchant": "SEIYU", "amount": "972", "note": "原备注"}
        result = device.post(
            BASE + "/review-correction",
            headers=auth,
            json={
                "values": values,
                "transcript": text,
                "targetField": field,
            },
        ).json()
        assert result["fieldOutcome"] == "unchanged"
        assert result["changedFields"] == [] and result["warnings"] == []
        for key, value in values.items():
            assert result["values"][key] == value
