import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentAuthDependency
from app.core.errors import ApiError
from app.db.session import get_db
from app.models.asset import Account, Project
from app.models.audit import AuditLog
from app.models.institution import Institution
from app.schemas.asset import (
    AccountPayload,
    AccountResponse,
    InstitutionPayload,
    InstitutionResponse,
    ProjectPayload,
    ProjectResponse,
)
from app.services.fx import enabled_currency_codes

router = APIRouter()
DbDependency = Annotated[Session, Depends(get_db)]


def _institution(db: Session, user_id: uuid.UUID, entity_id: uuid.UUID) -> Institution:
    entity = db.scalar(
        select(Institution).where(Institution.id == entity_id, Institution.user_id == user_id)
    )
    if not entity:
        raise ApiError(404, "INSTITUTION_NOT_FOUND", "机构不存在")
    return entity


def _account(db: Session, user_id: uuid.UUID, entity_id: uuid.UUID) -> Account:
    entity = db.scalar(select(Account).where(Account.id == entity_id, Account.user_id == user_id))
    if not entity:
        raise ApiError(404, "ACCOUNT_NOT_FOUND", "账户不存在")
    return entity


def _project(db: Session, user_id: uuid.UUID, entity_id: uuid.UUID) -> Project:
    entity = db.scalar(select(Project).where(Project.id == entity_id, Project.user_id == user_id))
    if not entity:
        raise ApiError(404, "PROJECT_NOT_FOUND", "项目不存在")
    return entity


def _commit(
    db: Session,
    *,
    user_id: uuid.UUID,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID,
    before: dict[str, Any] | None,
    after: dict[str, Any],
    conflict_code: str,
    conflict_message: str,
) -> None:
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(409, conflict_code, conflict_message) from exc
    db.add(
        AuditLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            before_data=before,
            after_data=after,
        )
    )
    db.commit()


@router.get("/institutions", response_model=list[InstitutionResponse])
def list_institutions(auth: CurrentAuthDependency, db: DbDependency) -> list[InstitutionResponse]:
    account_count = (
        select(func.count(Account.id))
        .where(Account.institution_id == Institution.id)
        .correlate(Institution)
        .scalar_subquery()
    )
    project_count = (
        select(func.count(Project.id))
        .join(Account, Project.account_id == Account.id)
        .where(Account.institution_id == Institution.id)
        .correlate(Institution)
        .scalar_subquery()
    )
    rows = db.execute(
        select(Institution, account_count, project_count)
        .where(Institution.user_id == auth.user.id)
        .order_by(Institution.name)
    )
    return [
        InstitutionResponse(
            id=item.id,
            name=item.name,
            institution_type=item.institution_type,
            display_color=item.display_color,
            is_active=item.is_active,
            account_count=accounts,
            project_count=projects,
        )
        for item, accounts, projects in rows
    ]


@router.post(
    "/institutions",
    response_model=InstitutionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_institution(
    payload: InstitutionPayload, auth: CurrentAuthDependency, db: DbDependency
) -> InstitutionResponse:
    entity = Institution(id=uuid.uuid4(), user_id=auth.user.id, **payload.model_dump())
    db.add(entity)
    after = payload.model_dump(mode="json")
    _commit(
        db,
        user_id=auth.user.id,
        action="institution.create",
        entity_type="institution",
        entity_id=entity.id,
        before=None,
        after=after,
        conflict_code="INSTITUTION_NAME_EXISTS",
        conflict_message="同名机构已存在",
    )
    db.refresh(entity)
    return InstitutionResponse.model_validate(entity)


@router.put("/institutions/{entity_id}", response_model=InstitutionResponse)
def update_institution(
    entity_id: uuid.UUID,
    payload: InstitutionPayload,
    auth: CurrentAuthDependency,
    db: DbDependency,
) -> InstitutionResponse:
    entity = _institution(db, auth.user.id, entity_id)
    before = InstitutionResponse.model_validate(entity).model_dump(mode="json")
    for key, value in payload.model_dump().items():
        setattr(entity, key, value)
    _commit(
        db,
        user_id=auth.user.id,
        action="institution.update",
        entity_type="institution",
        entity_id=entity.id,
        before=before,
        after=payload.model_dump(mode="json"),
        conflict_code="INSTITUTION_NAME_EXISTS",
        conflict_message="同名机构已存在",
    )
    db.refresh(entity)
    return InstitutionResponse.model_validate(entity)


@router.get("/institutions/{institution_id}/accounts", response_model=list[AccountResponse])
def list_accounts(
    institution_id: uuid.UUID, auth: CurrentAuthDependency, db: DbDependency
) -> list[AccountResponse]:
    _institution(db, auth.user.id, institution_id)
    project_count = (
        select(func.count(Project.id))
        .where(Project.account_id == Account.id)
        .correlate(Account)
        .scalar_subquery()
    )
    rows = db.execute(
        select(Account, project_count)
        .where(Account.institution_id == institution_id, Account.user_id == auth.user.id)
        .order_by(Account.name)
    )
    return [
        AccountResponse(
            id=item.id,
            institution_id=item.institution_id,
            name=item.name,
            account_type=item.account_type,
            masked_identifier=item.masked_identifier,
            display_color=item.display_color,
            is_active=item.is_active,
            project_count=count,
        )
        for item, count in rows
    ]


@router.post("/accounts", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(
    payload: AccountPayload, auth: CurrentAuthDependency, db: DbDependency
) -> AccountResponse:
    _institution(db, auth.user.id, payload.institution_id)
    entity = Account(id=uuid.uuid4(), user_id=auth.user.id, **payload.model_dump())
    db.add(entity)
    _commit(
        db,
        user_id=auth.user.id,
        action="account.create",
        entity_type="account",
        entity_id=entity.id,
        before=None,
        after=payload.model_dump(mode="json"),
        conflict_code="ACCOUNT_NAME_EXISTS",
        conflict_message="该机构下同名账户已存在",
    )
    db.refresh(entity)
    return AccountResponse.model_validate(entity)


@router.put("/accounts/{entity_id}", response_model=AccountResponse)
def update_account(
    entity_id: uuid.UUID,
    payload: AccountPayload,
    auth: CurrentAuthDependency,
    db: DbDependency,
) -> AccountResponse:
    entity = _account(db, auth.user.id, entity_id)
    _institution(db, auth.user.id, payload.institution_id)
    before = AccountResponse.model_validate(entity).model_dump(mode="json")
    for key, value in payload.model_dump().items():
        setattr(entity, key, value)
    _commit(
        db,
        user_id=auth.user.id,
        action="account.update",
        entity_type="account",
        entity_id=entity.id,
        before=before,
        after=payload.model_dump(mode="json"),
        conflict_code="ACCOUNT_NAME_EXISTS",
        conflict_message="该机构下同名账户已存在",
    )
    db.refresh(entity)
    return AccountResponse.model_validate(entity)


@router.get("/accounts/{account_id}/projects", response_model=list[ProjectResponse])
def list_projects(
    account_id: uuid.UUID, auth: CurrentAuthDependency, db: DbDependency
) -> list[Project]:
    _account(db, auth.user.id, account_id)
    return list(
        db.scalars(
            select(Project)
            .where(Project.account_id == account_id, Project.user_id == auth.user.id)
            .order_by(Project.name)
        )
    )


def _validate_project_parent_and_currency(
    db: Session, user_id: uuid.UUID, payload: ProjectPayload
) -> None:
    _account(db, user_id, payload.account_id)
    if payload.currency_code not in enabled_currency_codes(db, user_id):
        raise ApiError(400, "CURRENCY_NOT_ENABLED", "项目币种尚未启用")


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectPayload, auth: CurrentAuthDependency, db: DbDependency
) -> ProjectResponse:
    _validate_project_parent_and_currency(db, auth.user.id, payload)
    entity = Project(id=uuid.uuid4(), user_id=auth.user.id, **payload.model_dump())
    db.add(entity)
    _commit(
        db,
        user_id=auth.user.id,
        action="project.create",
        entity_type="project",
        entity_id=entity.id,
        before=None,
        after=payload.model_dump(mode="json"),
        conflict_code="PROJECT_NAME_EXISTS",
        conflict_message="该账户下同名项目已存在",
    )
    db.refresh(entity)
    return ProjectResponse.model_validate(entity)


@router.put("/projects/{entity_id}", response_model=ProjectResponse)
def update_project(
    entity_id: uuid.UUID,
    payload: ProjectPayload,
    auth: CurrentAuthDependency,
    db: DbDependency,
) -> ProjectResponse:
    entity = _project(db, auth.user.id, entity_id)
    _validate_project_parent_and_currency(db, auth.user.id, payload)
    before = ProjectResponse.model_validate(entity).model_dump(mode="json")
    for key, value in payload.model_dump().items():
        setattr(entity, key, value)
    _commit(
        db,
        user_id=auth.user.id,
        action="project.update",
        entity_type="project",
        entity_id=entity.id,
        before=before,
        after=payload.model_dump(mode="json"),
        conflict_code="PROJECT_NAME_EXISTS",
        conflict_message="该账户下同名项目已存在",
    )
    db.refresh(entity)
    return ProjectResponse.model_validate(entity)


@router.post("/projects/{entity_id}/deactivate", response_model=ProjectResponse)
def deactivate_project(
    entity_id: uuid.UUID, auth: CurrentAuthDependency, db: DbDependency
) -> ProjectResponse:
    entity = _project(db, auth.user.id, entity_id)
    before = ProjectResponse.model_validate(entity).model_dump(mode="json")
    entity.is_active = False
    _commit(
        db,
        user_id=auth.user.id,
        action="project.deactivate",
        entity_type="project",
        entity_id=entity.id,
        before=before,
        after={**before, "is_active": False},
        conflict_code="PROJECT_UPDATE_CONFLICT",
        conflict_message="项目状态更新冲突",
    )
    db.refresh(entity)
    return ProjectResponse.model_validate(entity)
