import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .database import Base, engine
from .routers import (ai, analytics, attendance, auth, chat, departments, documents, employees, enterprise, leaves,
                      notifications, payroll)

log = logging.getLogger("workforce")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="HR Attrition Prediction & Workforce Intelligence Platform. "
                "Authenticate via **POST /api/auth/login**, then click *Authorize* and paste the access token.",
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=settings.CORS_ORIGINS, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Process-Time", "Content-Disposition"])


@app.middleware("http")
async def timing(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - start) * 1000
    response.headers["X-Process-Time"] = f"{ms:.1f}ms"
    if ms > 1000:
        log.warning("Slow request %s %s took %.0fms", request.method, request.url.path, ms)
    return response


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    log.exception("Unhandled error: %s", exc)
    return JSONResponse({"detail": "Internal server error"}, status_code=500)


for r in (auth.router, auth.users_router, employees.router, departments.router, departments.roles_router,
          attendance.router, attendance.shifts_router, leaves.router, payroll.router, notifications.router,
          notifications.alerts_router, chat.router, chat.ws_router, documents.router, ai.router, analytics.router,
          enterprise.router):
    app.include_router(r)


@app.get("/api/health", tags=["System"])
def health():
    from .database import SessionLocal
    from .services.ai import active_model
    with SessionLocal() as db:
        mv = active_model(db)
    return {"status": "ok", "database": engine.dialect.name, "model_version": mv.version if mv else None}
