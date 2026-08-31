"""FastAPI application entry point."""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db
from .routers import chat, shop
from .schemas import SessionInfo, SessionRequest
from .sessions import sessions
from .store import ensure_user

init_db()

# Seed the demo catalog on every boot — Render's disk is ephemeral, so the
# products must be re-created from code (seed.py is idempotent).
try:
    from seed import seed as _seed

    _seed()
except Exception as _exc:  # noqa: BLE001 — never block startup on seeding
    print(f"Seeding skipped: {_exc}")

app = FastAPI(title="Guarded Agent Chat")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "").split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.post("/api/session", response_model=SessionInfo)
def create_session(req: SessionRequest) -> SessionInfo:
    user = ensure_user(req.user_id)
    session = sessions.create(user["id"], user["display_name"])
    return SessionInfo(
        session_id=session.id,
        user_id=user["id"],
        display_name=user["display_name"],
    )


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok"
    }


app.include_router(chat.router, prefix="/api")
app.include_router(shop.router, prefix="/api")
