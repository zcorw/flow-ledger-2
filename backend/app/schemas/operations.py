import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ImportJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    import_type: str
    status: str
    file_name: str | None
    row_count: int
    error_report: list[dict[str, Any]] | None
    created_at: datetime
    finished_at: datetime | None


class ImportCommitRequest(BaseModel):
    job_id: uuid.UUID = Field(alias="jobId")


class BackupMetadata(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    file_name: str
    checksum: str
    purpose: str
    created_at: datetime


class RestoreRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)
    backup_file_id: uuid.UUID = Field(alias="backupFileId")


class RestoreResponse(BaseModel):
    restored_from_id: uuid.UUID
    pre_restore_backup_id: uuid.UUID
