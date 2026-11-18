# Receipt review, drafts and confirmation

**English** | [简体中文](receipt-review-workflow.zh-CN.md)

This source increment requires the matching Rokid package and both migrations `0014_receipt_drafts` and `0015_device_expense_grants`. It does not deploy itself or upgrade existing device permissions.

## User flow

The glasses show merchant, amount, date, account and category with fixed labels. Unknown values stay empty; confirmed ISO currency codes accompany their symbols. Direction keys select Voice edit, Draft or Confirm.

- Voice edit starts a `SpeechRecognition` session only after activation. The transcript, current fields, enabled currencies and account names are processed by the configured server-side model with `store: false` and a strict JSON schema. Invalid changes are rejected, unspecified fields stay unchanged, and ambiguous accounts/currencies require clarification. No audio, raw provider reply or expense is stored by this action. A runtime without speech support can use the website to edit.
- Draft updates one versioned candidate on the same receipt. It preserves the original bytes and does not create an expense. Website users can filter unposted drafts, search merchants, edit fields and explicitly record an expense. JSON v4 backups include drafts and continue to support older backups.
- Confirm requires valid amount, calendar date, enabled ISO currency, category and owned active account. The owner first enables accounting for that exact device on the phone, with a separate acknowledgement. The glasses save the reviewed snapshot, then explicitly confirm that revision. A possible duplicate requires another explicit activation. Success links one expense to the original receipt; it does not deduct account/asset balances.

## API additions

All device routes below use the existing bearer token under `/api/v1/receipt-devices`; normal web-session APIs remain unavailable to device tokens.

| Method and path | Contract |
| --- | --- |
| POST `/review-correction` | `{transcript, values}` → `{values, changedFields, warnings}`; bounded body and model request rate/concurrency limits |
| POST `/receipt-drafts` | `{receiptId, requestKey, expectedRevision, values}` → saved revision; same-key replay, different-content conflict and optimistic stale-edit protection |
| GET `/receipt-drafts/{id}` | Fields/revision of a known owned receipt; never image bytes or an archive listing |
| GET `/capabilities` | Device ID, accounting permission and canonical phone authorization URL; a read does not grant permission |
| POST `/{id}/expense-permission` | **Web owner session only**, `X-Device-Approval: 1`, same-origin intent and `{enabled: boolean}`; no grant from a device token or URL parameter |
| POST `/receipt-confirmations` | `{receiptId, revision, requestKey, confirmed: true, allowDuplicate?: boolean}`; guarded snapshot and device-permission checks; reuses the existing expense writer, validation, audit and uniqueness constraints |
| GET `/receipt-confirmations/{key}?receiptId={id}` | Read-only outcome: `not_found`, `recorded` with the record, or `deleted`; requires ownership and still works after accounting permission alone is disabled |

Web owners save drafts through `POST /api/v1/receipts/drafts` with the same draft payload. `GET /api/v1/receipts?drafts=true&q=merchant` filters unposted drafts and searches original/corrected merchant names. Foreign receipts/accounts are rejected. Deleting an expense retains its idempotency tombstone and original receipt, and cannot recreate that expense by replay.

## Recovery and deployment

The glasses persist only a resource-bound journal containing a receipt ID, revision and request key before sending the financial request. They never journal image bytes, voice text, tokens in the payload journal or receipt field values. After interruption/restart, query the result first. If no record exists, recover the server draft and wait for an explicit activation before retrying the same key. A changed server draft must be reviewed again. A known committed record is shown without another accounting POST. Failed journal writes prevent financial requests.

Deploy the backend and website with a full backup and `alembic upgrade head`, then install the newly built glasses package. Older grants remain receipt-only unless the owner explicitly enables accounting. Downgrading 0015 removes that permission; upgrading again leaves it disabled. Downgrading 0014 discards draft fields, so preserve a full backup first. The unmounted short-lived authorization experiment is not used.

Automated checks use isolated synthetic data and mocked model replies. New-package speech support, native focus/scroll behavior, phone consent, exit/restart recovery and end-to-end original/expense viewing still require target-device acceptance. The previous package's acceptance does not validate this increment.

Speech contract: [Rokid SpeechRecognition](https://open.rokid.com/aiui/api/ai/speech-recognition?lang=en-US&version=0.19.0).
