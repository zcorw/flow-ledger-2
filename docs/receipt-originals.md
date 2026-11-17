# Original receipt storage

**English** | [简体中文](receipt-originals.zh-CN.md)

After migration `0013_receipt_originals` and deployment of both apps, new valid JPEG/PNG/WebP uploads are stored as private binary attachments in PostgreSQL. The existing VPS database volume preserves them across container replacement. No public image directory is created. Previous photos that were not saved cannot be recovered.

The original bytes, MIME type, size and SHA-256 are retained together. Originals can contain metadata such as EXIF; only the separate OCR copy is oriented, stripped of metadata and converted to JPEG. Uploads remain bounded to 8 MiB, 20 million pixels and 10000 pixels per side; animated images are rejected. Valid originals are committed before the provider call. Recognition failures retain the original and a sanitized failure code. Invalid images are not archived.

The receipt is an independent record with candidate fields; unknown fields stay empty. It does not create an expense. The unchanged recognition JSON is accompanied by an `X-Receipt-Id` response header. The website exposes **Daily Expenses → Recognized receipts**, with private original viewing and explicit expense entry. Expenses reference `receiptId`; duplicate linkage is rejected. Deleting an expense does not delete its original receipt. Leaving the glasses or cancelling a request does not delete an original already stored by the server.

`GET /api/v1/receipts`, `/{id}` and `/{id}/image` require the owner's web session. A receipt-recognition device bearer grant cannot browse the archive or create expenses. Image responses use private/no-store caching, MIME validation and nosniff. SQL error parameters are hidden and image bytes are not written to audit logs.

PostgreSQL scheduled and pre-deployment dumps include originals and associations automatically. Web JSON backups use version 3 when receipts exist, encoding originals as base64 and checking their hashes during restore; versions 1/2 remain readable. Web export/upload is limited to 64 MiB including images; use server full backups for larger archives. Restore creates a pre-restore backup and replaces related rows transactionally. Downgrading 0013 removes originals and associations: preserve a full backup before a rollback.

Acceptance must verify an unchanged original hash, owner isolation, partial/failed OCR, expense linkage, backup/restore, VPS container replacement and an updated glasses package. Automated tests use synthetic images and mocked OCR, not production photos or paid recognition.
