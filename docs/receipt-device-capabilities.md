# Isolated receipt device capabilities

## Delivery boundary

This increment supplies an **unmounted**, synthetic-account HTTP integration in
`backend/app/device`. It does not enable a production endpoint, issue live tokens,
change web sessions, migrate production data, or connect the glasses. It is not a
finished pairing/refresh protocol. No browser consent screen is provided yet.

The existing application continues to reject device bearer tokens at ordinary
account, asset, backup, expense-list/update/delete and administrative APIs.
The isolated test app exposes only POST confirmation, receipt recognition and
receipt expense creation. Tests exercise actual expense validation, SQL storage,
audit creation, duplicate checks and idempotent replay in an ephemeral database.
They use generated images and a fake recognition provider, never OpenAI or real
receipts. Receipt submission is a ledger-record creation, not a financial transfer.

## Trusted approval seam

`ReceiptGrants.approve(db, owner_id)` is an internal function for a future trusted
owner-consent flow, not a public API. Its caller must authenticate the owner,
protect against CSRF, show the exact receipt recognition/expense creation scope,
and use the authenticated owner ID rather than accepting a caller-selected ID.
The function does not itself prove consent. There is deliberately no issuance,
renewal, grant-listing or revocation HTTP route in this increment.

The returned random 256-bit token is stored only as a SHA-256 digest. Database
records bind it to one user and canonical HTTPS resource, and a fingerprint of the
current password hash. Password changes invalidate it; ordinary web logout does
not grant or revoke it. Owner-scoped revocation is available internally. Grant IDs
are not credentials. A token cannot choose its user, scope or target resource.

Tokens start pending: the client must durably save and read back the token before
calling confirmation. Confirmation is idempotent and must happen within five
minutes of issuance. The grant expires fifteen minutes from issuance, including
pending time; retries do not extend it. These short fixed deadlines are a safe
foundation, not a promise of the eventual device lifetime policy. There is no
refresh or unattended long-lived authorization. No client storage implementation
is approved by these tests.

## Request and privacy contract

- `POST /device/confirm`: Authorization bearer header, no body required.
- `POST /device/receipt-recognition`: bearer plus `X-Receipt-Upload: 1` and raw
  `image/png` or `image/jpeg`. Reuses the existing 8 MiB bounded streaming/image
  normalization/provider policy. No multipart spool or image persistence added.
- `POST /device/expenses`: bearer plus JSON, maximum 16 KiB. Uses existing
  `ExpenseCreate` fields, `source: receipt_ocr`, a stable `requestKey`, and explicit
  `allowDuplicate` only after a second user confirmation. It cannot verify a
  physical user's click itself; the trusted device UI must enforce confirmation.
- Cookies/query strings/passwords are not accepted as device credentials.
- Responses, including handled authentication/validation errors, are `no-store`.
  Validation messages do not echo input values or chain raw Pydantic errors.
- Authorization is rechecked after body/image processing before a write or provider
  invocation, so revocation during a slow upload is not ignored. A request already
  committed or sent to a provider cannot be retroactively undone by revocation.
- The expense implementation remains authoritative for enabled currencies,
  user-owned account references, duplicate warning, request conflict and replay.
  Cancel/retry semantics must preserve the original key and content after an
  unknown result, as implemented separately in ledger-rokid.

## Remaining integration and rollout gates

1. Reviewed browser session + CSRF owner-consent/pairing workflow, bounded attempts
   and issuance rate limiting, grant cleanup and appropriate durable migration.
2. Native device credential isolation/storage, confirmation-after-save, expiry UI,
   renewal policy and authenticated transport with TLS/redirect/response limits.
3. Wire the existing ledger-rokid receipt chain to approved scoped transport; retain
   unknown-result recovery and account-switch isolation. Do not embed web session
   cookies, passwords or provider keys in an AIUI project.
4. Production backup/restore semantics, deployment approval, TLS/proxy and privacy
   review, then explicit target-device testing with synthetic receipts first.

The model uses separate experimental metadata and is intentionally absent from `app.models` and no migration is added.
Tests import it and create/drop tables only in their isolated database. Do not
mount the router or create production tables until the above gates are addressed.

## Verification

Run from `backend`: `ruff check .` and
`pytest --cov=app --cov-report=term --cov-fail-under=85`.
The focused suite is `pytest tests/test_receipt_devices.py`.
GitHub Actions retains the existing frontend, backend, deployment-configuration
and Chromium E2E jobs. Passing them does not establish device/runtime acceptance.
