from fastapi import APIRouter

from app.api.assets import router as assets_router
from app.api.auth import router as auth_router
from app.api.currencies import router as currencies_router
from app.api.fx import router as fx_router
from app.api.setup import router as setup_router
from app.api.snapshots import router as snapshots_router
from app.api.system import router as system_router

api_router = APIRouter()
api_router.include_router(setup_router, prefix="/setup", tags=["setup"])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(assets_router, tags=["asset-hierarchy"])
api_router.include_router(currencies_router, prefix="/currencies", tags=["currencies"])
api_router.include_router(fx_router, prefix="/fx-rates", tags=["fx-rates"])
api_router.include_router(snapshots_router, prefix="/snapshots", tags=["snapshots"])
api_router.include_router(system_router, prefix="/system", tags=["system"])
