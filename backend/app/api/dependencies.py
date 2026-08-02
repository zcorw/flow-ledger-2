from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.auth import CurrentAuth, authenticate_request


def get_current_auth(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> CurrentAuth:
    return authenticate_request(request, db)


CurrentAuthDependency = Annotated[CurrentAuth, Depends(get_current_auth)]
