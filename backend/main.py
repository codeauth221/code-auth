"""
CodeAuthentic - FastAPI Main Application Entry Point.
AI-Generated Source Code Detector for CCIS, Caraga State University.

Runs with:
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import os
import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from backend.database import create_tables, test_connection
from backend.routes import auth, dashboard, lobbies, submissions, worker
from backend.security import decode_token, get_current_instructor
from backend.ws import manager, set_event_loop
from ml.predictor import model_readiness


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.
    Initializes database tables, captures event loop for thread-safe broadcasts,
    and preloads ML models if available.
    """
    print("[STARTUP] Starting CodeAuthentic server...")

    # 1. Capture running event loop for thread-safe WebSocket broadcasts
    loop = asyncio.get_running_loop()
    set_event_loop(loop)
    print("[STARTUP] AsyncIO event loop registered for background broadcasts.")

    # 2. Initialize database tables in development
    create_tables()

    # Repair orphaned pending/analyzing rows after restarts. This worker only
    # updates old statuses; it NEVER runs CodeBERT or assigns AI scores.
    async def stale_analysis_recovery_loop():
        from backend.analysis import recover_stale_analyses
        while True:
            await asyncio.to_thread(recover_stale_analyses)
            await asyncio.sleep(60)

    recovery_task = asyncio.create_task(stale_analysis_recovery_loop())
    try:
        yield
    finally:
        recovery_task.cancel()
        try:
            await recovery_task
        except asyncio.CancelledError:
            pass
        print("[SHUTDOWN] Stopping CodeAuthentic server...")


# Initialize FastAPI application
app = FastAPI(
    title="CodeAuthentic API",
    description="AI-generated source code detector (C, Java, Python) for live computer-laboratory exams.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# The React frontend sends bearer tokens, not browser cookies.
# For production, set FRONTEND_ORIGINS to the permitted frontend origin(s).
_allowed_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("FRONTEND_ORIGINS", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Server-Timing", "X-Process-Time-Ms"],
)

# Register API routers
app.include_router(auth.router)
app.include_router(lobbies.router)
app.include_router(submissions.router)
app.include_router(dashboard.router)
app.include_router(worker.router)


# Measure server work; never log request bodies, credentials or query strings.
perf_logger = logging.getLogger("uvicorn.error")


@app.middleware("http")
async def request_duration_middleware(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000
    response.headers["Server-Timing"] = f"app;dur={elapsed_ms:.1f}"
    response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.1f}"
    if elapsed_ms >= 750 and request.url.path != "/health":
        route = request.scope.get("route")
        pattern = getattr(route, "path", "API request")
        perf_logger.warning(
            "[PERF] slow API %s %s status=%s server_ms=%.1f",
            request.method, pattern, response.status_code, elapsed_ms,
        )
    return response


# ==============================================================================
# Real-Time WebSocket Endpoint
# ==============================================================================

@app.websocket("/ws/lobbies/{lobby_id}")
async def lobby_websocket_endpoint(
    websocket: WebSocket,
    lobby_id: str,
    token: str | None = Query(default=None),
):
    """
    Real-time WebSocket connection for instructor dashboard.
    Only the owning instructor may connect.
    Broadcasts live updates whenever submissions are created, analyzed, or failed.
    """
    # Prefer WebSocket subprotocol authentication so access logs do not expose
    # JWTs as URL query strings. Accept the legacy query argument temporarily
    # for existing clients. Never echo or log either token.
    protocols = websocket.scope.get("subprotocols", [])
    supplied = next((p[5:] for p in protocols if p.startswith("auth.") and len(p) > 5), None)
    if supplied is None:
        supplied = token
    if not supplied:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    try:
        token_data = decode_token(supplied)
    except HTTPException:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # 2. Verify Lobby Ownership in DB
    from backend.database import SessionLocal
    from backend.models import Lobby

    db = SessionLocal()
    try:
        lobby_uuid = uuid.UUID(lobby_id)
        lobby = db.query(Lobby).filter(Lobby.id == lobby_uuid).first()
        if not lobby or lobby.instructor_id != token_data.instructor_id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    finally:
        db.close()

    # 3. Connect to manager
    await manager.connect(
        str(lobby_id), websocket,
        subprotocol="codeauthentic" if "codeauthentic" in protocols else None,
    )
    try:
        while True:
            # Keep socket open and listen for optional ping/pong messages
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(str(lobby_id), websocket)
    except Exception:
        manager.disconnect(str(lobby_id), websocket)


# ==============================================================================
# Health Check & Static Files
# ==============================================================================

@app.get("/health")
def health_check():
    """System health check endpoint."""
    db_ok = test_connection()
    return {
        "status": "ok",
        "app": "CodeAuthentic",
        "database_connected": db_ok,
        "api_release": "2026-11-16-latency",
        "dashboard_summary_endpoint": True,
        "ml_workflow": "evaluated-codebert-heads",
        "code_viewer_endpoint": True,
        "timestamps_utc": True,
    }


@app.get("/ml/status")
def ml_status(current_instructor=Depends(get_current_instructor)):
    """Instructor-only diagnostics; does not download pretrained models or change DB."""
    return model_readiness()


# Frontend directory path
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

if FRONTEND_DIR.exists():
    # Mount static assets if directories exist
    css_dir = FRONTEND_DIR / "css"
    js_dir = FRONTEND_DIR / "js"
    if css_dir.exists():
        app.mount("/css", StaticFiles(directory=str(css_dir)), name="css")
    if js_dir.exists():
        app.mount("/js", StaticFiles(directory=str(js_dir)), name="js")

    @app.get("/favicon.png")
    def serve_favicon():
        favicon = FRONTEND_DIR / "favicon.png"
        if favicon.exists():
            return FileResponse(str(favicon), media_type="image/png")
        raise HTTPException(status_code=404, detail="Favicon not found")

    @app.get("/", response_class=HTMLResponse)
    def serve_index():
        index_file = FRONTEND_DIR / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        return HTMLResponse("<h1>CodeAuthentic</h1><p>Visit <a href='/docs'>/docs</a> for the API.</p>")

    @app.get("/dashboard", response_class=HTMLResponse)
    def serve_dashboard():
        dash_file = FRONTEND_DIR / "dashboard.html"
        if dash_file.exists():
            return FileResponse(str(dash_file))
        return HTMLResponse("<h1>Instructor Dashboard</h1>")

    @app.get("/lobby/{lobby_id}", response_class=HTMLResponse)
    def serve_lobby(lobby_id: str):
        lobby_file = FRONTEND_DIR / "lobby.html"
        if lobby_file.exists():
            return FileResponse(str(lobby_file))
        return HTMLResponse(f"<h1>Exam Lobby: {lobby_id}</h1>")
