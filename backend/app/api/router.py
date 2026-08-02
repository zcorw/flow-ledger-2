from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.setup import router as setup_router
from app.api.system import router as system_router

api_router = APIRouter()
api_router.include_router(setup_router, prefix="/setup", tags=["setup"])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(system_router, prefix="/system", tags=["system"])
