"""Owned receipt choices and conservative text matching; no financial writes."""

import re
import unicodedata
import uuid
from collections import Counter
from difflib import SequenceMatcher
from typing import get_args

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.asset import Account
from app.schemas.expense import ExpenseCategory
from app.services.fx import enabled_currency_codes

CATEGORIES = {
    "uncategorized": ("未分类", []),
    "food": ("餐饮", ["吃饭", "餐费", "饮食"]),
    "groceries": ("日用", ["日常", "日用品", "日常用品"]),
    "transport": ("交通", ["交通费", "出行"]),
    "housing": ("住房", ["房租", "租房"]),
    "utilities": ("水电", ["水电费"]),
    "shopping": ("购物", ["买东西"]),
    "health": ("医疗", ["医药", "看病"]),
    "entertainment": ("娱乐", []),
    "education": ("教育", ["学费"]),
    "travel": ("旅行", ["旅游"]),
    "other": ("其他", []),
}
CURRENCIES = {
    "JPY": ("日元", ["日圆", "日币", "日幣", "円", "日圓"]),
    "CNY": ("人民币", ["人民幣", "人民币元"]),
    "USD": ("美元", ["美金"]),
    "EUR": ("欧元", ["歐元"]),
    "GBP": ("英镑", ["英鎊"]),
    "HKD": ("港币", ["港元", "港幣"]),
    "TWD": ("新台币", ["台币", "新臺幣"]),
    "KRW": ("韩元", ["韩币", "韓元"]),
    "SGD": ("新加坡元", ["新币"]),
    "AUD": ("澳元", ["澳币"]),
    "CAD": ("加元", ["加币"]),
}


def options(db: Session, user_id: uuid.UUID) -> dict:
    # Do not silently truncate accounts: every active owned choice is returned.
    accounts = db.scalars(
        select(Account)
        .where(Account.user_id == user_id, Account.is_active.is_(True))
        .order_by(Account.name, Account.id)
    ).all()
    counts = Counter(a.name for a in accounts)
    return {
        "version": 1,
        "categories": [
            {"value": key, "label": CATEGORIES[key][0], "aliases": CATEGORIES[key][1] + [key]}
            for key in get_args(ExpenseCategory)
        ],
        "currencies": [
            {
                "value": code,
                "label": code + (" " + CURRENCIES[code][0] if code in CURRENCIES else ""),
                "aliases": [code]
                + (list(CURRENCIES[code][1]) + [CURRENCIES[code][0]] if code in CURRENCIES else []),
            }
            for code in sorted(enabled_currency_codes(db, user_id))
        ],
        "accounts": [
            {
                "value": str(a.id),
                "label": a.name + (" · " + str(a.id)[-6:] if counts[a.name] > 1 else ""),
                "aliases": [a.name],
            }
            for a in accounts
        ],
    }


def normalized(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold() if c.isalnum())


def match_choice(transcript: str, choices: list[dict]) -> tuple[str, dict | None]:
    text = normalized(transcript)
    if re.fullmatch(r"(?:请)?(?:把)?(?:分类|币种|账户|支付方式)?(?:清空|删除|留空)", text):
        return "clear", None
    # Negations and multi-choice utterances must not become an arbitrary choice.
    if re.search(r"不(?:要|是|选|用|改|修改|设置)|别(?:用|选|改)|取消|或者|还是", text):
        return "ambiguous", None
    exact, contained, scores = [], [], []
    payload = re.sub(
        r"^(?:请)?(?:把|将)?(?:分类|类别|币种|账户|支付方式)?(?:修改为|设置为|改为|改成|设为|选|用|是|为)?",
        "",
        text,
    )
    for choice in choices:
        names = {normalized(name) for name in [choice["label"], *choice["aliases"]] if name}
        if text in names or payload in names:
            exact.append(choice)
        if any(len(name) >= 2 and name in payload for name in names):
            contained.append(choice)
        score = max(
            (SequenceMatcher(None, payload, name).ratio() for name in names if len(name) >= 3),
            default=0,
        )
        scores.append((score, choice))
    if len(exact) == 1:
        return "matched", exact[0]
    if len(exact) > 1 or len(contained) > 1:
        return "ambiguous", None
    if len(contained) == 1:
        return "matched", contained[0]
    scores.sort(key=lambda item: item[0], reverse=True)
    if len(payload) >= 3 and scores and scores[0][0] >= 0.72:
        if len(scores) > 1 and scores[0][0] - scores[1][0] < 0.15:
            return "ambiguous", None
        return "matched", scores[0][1]
    return "unmatched", None
