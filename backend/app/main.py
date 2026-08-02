import logging
import time

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.errors import ApiError, api_error_handler, validation_error_handler
from app.core.logging import configure_logging

settings = get_settings()
configure_logging("backend", settings.log_dir)
logger = logging.getLogger("app.requests")

app = FastAPI(
    title="Flow Ledger API",
    version="0.1.0",
    docs_url="/api/docs" if settings.app_env != "production" else None,
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_base_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(  # type: ignore[arg-type]
    RequestValidationError,
    validation_error_handler,
)


@app.middleware("http")
async def log_request(request, call_next):  # type: ignore[no-untyped-def]
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "request.failed",
            extra={"method": request.method, "path": request.url.path},
        )
        raise
    logger.info(
        "request.completed",
        extra={
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        },
    )
    return response


app.include_router(api_router, prefix="/api/v1")
