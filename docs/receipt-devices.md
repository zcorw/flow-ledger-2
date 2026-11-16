# Receipt-only device authorization

**English** | [简体中文](receipt-devices.zh-CN.md)

Rokid uses a separate persistent, revocable bearer grant. The signed-in owner explicitly approves the matching code at `/receipt-devices`. This permits receipt recognition only; it cannot create expenses or modify assets. Recognition produces a candidate for review, not a saved expense.

## Deployment

Deploy backend and frontend from the same revision, following the backup/release procedure in [deploy/README.md](../deploy/README.md). Run `alembic upgrade head` against the configured deployment database before serving the new API, and rebuild the frontend. Migration `0011_receipt_devices` adds two tables. `0012_persistent_devices` makes device expiry nullable, preserving existing finite expiry dates and financial records. Downgrading 0012 expires permanent grants so the old server can safely handle them; downgrading 0011 removes the two tables.

Set backend `APP_BASE_URL=https://ledger.zcorw.xyz`. Configure the provider only on the server; see [receipt configuration](10-openai-receipts.md). HTTPS API requests must reach this origin without redirects. No CORS changes are needed for native fetch or the same-origin phone page. Do not log authorization headers, user/device codes, image bodies or provider keys.

After deployment, signed-out access to `/receipt-devices` should lead to login and return to this page. On the current glasses package, capture a receipt, enter the matching code on the phone, acknowledge and approve it. Recognition continues automatically. Check the returned amount, currency, date and merchant against the receipt. Test denial, expiry, revocation, retry and exit on hardware. Automated tests use fake OCR rather than production provider calls.

## Protocol

All paths are under `/api/v1/receipt-devices`; responses use `Cache-Control: no-store`.

| Method / path | Authorization and data |
| --- | --- |
| POST `/pairings` | Public JSON `{deviceName:"Rokid"}`; returns `deviceCode`, `userCode`, `verificationUri`, `expiresAt`, `interval`. |
| POST `/pairings/token` | JSON `{deviceCode}`; 202 `authorization_pending`, 429 slow down, or 200 `{accessToken,tokenType:"Bearer",scope:"receipt:recognize",deviceId,expiresAt}` after approval. |
| POST `/pairings/lookup` | Owner web session; returns name, status, expiry, scope. |
| POST `/pairings/approve` or `/pairings/deny` | Owner web session and `X-Device-Approval: 1`; same-origin intent check. |
| GET root | Owner web session; lists active grants. |
| DELETE `/{deviceId}` | Owner web session and `X-Device-Approval: 1`; revokes grant. |
| POST `/receipt-recognition` | `Authorization: Bearer …`, `X-Receipt-Upload: 1`, raw PNG/JPEG body (1 byte–8 MiB). |

Response: strings `amount`, `expenseDate`, `currencyCode`, `merchant`, and string array `warnings`, matching web OCR. Images are normalized in memory with the existing provider and rate limits. Authorization is checked before upload processing, before the provider call and before returning a result. Revocation cannot undo an already-started provider call, but prevents returning its result.

Pairings expire after 10 minutes and poll no faster than every 3 seconds. Approval exchanges once for a persistent token with `expiresAt: null`. Password changes and revocation invalidate access. Older finite grants still expire at their original time. The glasses save the credential in Agent-isolated native storage and restore it after exit or device restart. Clearing Agent data requires authorization again. Database records contain hashes, not recoverable codes/tokens. Pairing creation is bounded per requester and globally; JSON/image bodies are bounded. Phone consent is explicit, including a matching-code acknowledgement; URL parameters never authorize automatically.

The glasses convert original WebP using `Blob`, `createImageBitmap`, and offscreen `Canvas.convertToBlob`, with longest side at most 4096 pixels. The 400×180 display thumbnail is never uploaded. Hiding/exiting aborts polling/upload; photos and bill contents are not persisted locally; only the origin-bound receipt credential is saved. Storage errors are visible and network errors do not discard authorization. Agent isolation is documented by AIUI; hardware-backed encryption is not claimed. Provider privacy/retention rules still apply.

Owner lookup/decision requests send JSON `{userCode}` in the body, keeping codes out of API request URLs.
