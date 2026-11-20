# Institution payment eligibility

Institutions expose `can_be_payment_account` in API responses and accept
`canBePaymentAccount` when created or updated. The toggle is independent of
`isActive`. New institutions default to true; migration `0016_institution_payment`
sets existing institutions to true without changing expense history, asset
balances, or institution/account active state. Omitted fields on old-client
institution updates preserve the saved eligibility.

The setting controls associated asset accounts, not a new institution-as-account
model. Standalone accounts and manual expenses without an account remain usable.
`GET /expenses/accounts` retains all names and adds eligibility metadata so
historical labels remain available. New expenses cannot select an ineligible
account. Editing an expense may retain its existing account, but cannot change
to another ineligible account. Successful idempotent expense replays are unchanged.

Receipt review options and voice matching exclude ineligible accounts. A saved
draft may retain its original account while other fields are edited, but a new
expense confirmation must select an eligible account or no account. Already
recorded confirmations still replay normally.

JSON backups retain the flag and old backups without it restore as true. Master
data CSV exports include it. Hierarchy CSV imports accept an optional
`can_be_payment_account` column (`true`/`false`, blank defaults to true); old
CSV templates continue to work.

Deploy the backend migration and corresponding frontend together. Local tests
use synthetic databases; they do not constitute production deployment or Rokid
hardware acceptance.
