import json
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentAuthDependency
from app.core.errors import ApiError
from app.core.security import verify_password
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.common import utc_now
from app.models.operations import BackupExport, ImportJob
from app.schemas.operations import (
    BackupMetadata,
    ImportCommitRequest,
    ImportJobResponse,
    RestoreRequest,
    RestoreResponse,
)
from app.services.backup import (
    backup_checksum,
    create_backup,
    restore_backup_payload,
    validate_backup_payload,
)
from app.services.imports import (
    IMPORT_TYPES,
    commit_rows,
    parse_csv,
    template_csv,
    validate_rows,
)

router = APIRouter()
DbDependency = Annotated[Session, Depends(get_db)]


def _import_type(value: str) -> str:
    if value not in IMPORT_TYPES:
        raise ApiError(404, "IMPORT_TYPE_NOT_FOUND", "导入类型不存在")
    return value


@router.get("/imports/templates/{import_type}")
def download_template(import_type: str, _auth: CurrentAuthDependency) -> Response:
    value = _import_type(import_type)
    return Response(
        content=template_csv(value).encode(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{value}.csv"'},
    )


@router.post("/imports/{import_type}/validate", response_model=ImportJobResponse)
async def validate_import(
    import_type: str,
    auth: CurrentAuthDependency,
    db: DbDependency,
    file: Annotated[UploadFile, File()],
) -> ImportJob:
    value = _import_type(import_type)
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise ApiError(413, "IMPORT_FILE_TOO_LARGE", "导入文件不能超过 2 MB")
    rows, errors = parse_csv(value, content)
    if not errors:
        errors = validate_rows(db, auth.user.id, value, rows)
    item = ImportJob(
        id=uuid.uuid4(),
        user_id=auth.user.id,
        import_type=value,
        status="invalid" if errors else "validated",
        file_name=file.filename,
        row_count=len(rows),
        error_report=errors or None,
        validated_payload=rows if not errors else None,
        finished_at=utc_now(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.post("/imports/{import_type}/commit", response_model=ImportJobResponse)
def commit_import(
    import_type: str,
    payload: ImportCommitRequest,
    auth: CurrentAuthDependency,
    db: DbDependency,
) -> ImportJob:
    value = _import_type(import_type)
    item = db.scalar(
        select(ImportJob).where(
            ImportJob.id == payload.job_id,
            ImportJob.user_id == auth.user.id,
            ImportJob.import_type == value,
        )
    )
    if item is None:
        raise ApiError(404, "IMPORT_JOB_NOT_FOUND", "导入校验任务不存在")
    if item.status != "validated" or item.validated_payload is None:
        raise ApiError(409, "IMPORT_NOT_VALIDATED", "只有校验通过的任务可以提交")
    current_errors = validate_rows(db, auth.user.id, value, item.validated_payload)
    if current_errors:
        item.status = "rejected"
        item.error_report = current_errors
        item.finished_at = utc_now()
        db.commit()
        raise ApiError(
            409,
            "IMPORT_CONFLICT",
            "数据在校验后发生变化，整批导入已拒绝",
            current_errors,
        )
    try:
        commit_rows(db, auth.user.id, value, item.validated_payload)
        db.add(
            AuditLog(
                user_id=auth.user.id,
                action="import.commit",
                entity_type="import_job",
                entity_id=item.id,
                after_data={"type": value, "rowCount": item.row_count},
            )
        )
        item.status = "committed"
        item.finished_at = utc_now()
        db.commit()
    except Exception as exc:
        db.rollback()
        failed = db.get(ImportJob, payload.job_id)
        if failed:
            failed.status = "rejected"
            failed.error_report = [{"row": 0, "field": "commit", "reason": str(exc)}]
            failed.finished_at = utc_now()
            db.commit()
        raise ApiError(409, "IMPORT_CONFLICT", f"整批导入已拒绝：{exc}") from exc
    db.refresh(item)
    return item


@router.post("/backups/export")
def export_backup(auth: CurrentAuthDependency, db: DbDependency) -> Response:
    item = create_backup(db, auth.user.id)
    db.add(
        AuditLog(
            user_id=auth.user.id,
            action="backup.export",
            entity_type="backup_export",
            entity_id=item.id,
            after_data={"checksum": item.checksum},
        )
    )
    db.commit()
    content = json.dumps(item.payload, ensure_ascii=False, indent=2).encode()
    return Response(
        content=content,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{item.file_name}"',
            "X-Backup-Id": str(item.id),
            "X-Backup-Checksum": item.checksum,
        },
    )


@router.post("/backups/upload", response_model=BackupMetadata)
async def upload_backup(
    auth: CurrentAuthDependency,
    db: DbDependency,
    file: Annotated[UploadFile, File()],
) -> BackupExport:
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise ApiError(413, "BACKUP_FILE_TOO_LARGE", "备份文件不能超过 10 MB")
    try:
        payload: dict[str, Any] = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ApiError(400, "INVALID_BACKUP_FILE", "备份文件不是有效 JSON") from exc
    try:
        validate_backup_payload(payload)
    except ValueError as exc:
        raise ApiError(400, "INVALID_BACKUP_VERSION", str(exc)) from exc
    item = BackupExport(
        id=uuid.uuid4(),
        user_id=auth.user.id,
        file_name=file.filename or "uploaded-backup.json",
        checksum=backup_checksum(payload),
        payload=payload,
        purpose="uploaded",
    )
    db.add(item)
    db.add(
        AuditLog(
            user_id=auth.user.id,
            action="backup.upload",
            entity_type="backup_export",
            entity_id=item.id,
            after_data={"checksum": item.checksum},
        )
    )
    db.commit()
    db.refresh(item)
    return item


@router.post("/backups/restore", response_model=RestoreResponse)
def restore_backup(
    payload: RestoreRequest, auth: CurrentAuthDependency, db: DbDependency
) -> RestoreResponse:
    if not verify_password(payload.password, auth.user.password_hash):
        raise ApiError(403, "INVALID_PASSWORD", "当前密码错误")
    source = db.scalar(
        select(BackupExport).where(
            BackupExport.id == payload.backup_file_id,
            BackupExport.user_id == auth.user.id,
        )
    )
    if source is None:
        raise ApiError(404, "BACKUP_NOT_FOUND", "备份文件不存在")
    if backup_checksum(source.payload) != source.checksum:
        raise ApiError(409, "BACKUP_CHECKSUM_MISMATCH", "备份校验和不匹配")
    try:
        pre_restore = create_backup(db, auth.user.id, purpose="pre-restore")
        restore_backup_payload(db, auth.user.id, source.payload)
        db.add(
            AuditLog(
                user_id=auth.user.id,
                action="backup.restore",
                entity_type="backup_export",
                entity_id=source.id,
                after_data={"preRestoreBackupId": str(pre_restore.id)},
            )
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise ApiError(
            409,
            "BACKUP_RESTORE_FAILED",
            "备份内容无法恢复，当前数据未发生变化",
        ) from exc
    return RestoreResponse(
        restored_from_id=source.id,
        pre_restore_backup_id=pre_restore.id,
    )


@router.get("/audit-logs")
def audit_logs(auth: CurrentAuthDependency, db: DbDependency) -> list[dict[str, Any]]:
    items = db.scalars(
        select(AuditLog)
        .where(AuditLog.user_id == auth.user.id)
        .order_by(AuditLog.created_at.desc())
        .limit(100)
    )
    return [
        {
            "id": str(item.id),
            "action": item.action,
            "entity_type": item.entity_type,
            "entity_id": str(item.entity_id) if item.entity_id else None,
            "created_at": item.created_at,
        }
        for item in items
    ]
