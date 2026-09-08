from __future__ import annotations

import asyncio
import time

import httpx
from fastapi import APIRouter, HTTPException

from ..agent.crew import build_chat_crew
from ..agent.guardrail_agent import GuardrailAgent
from ..agent.streaming import bridge
from ..config import settings
from ..schemas import AgentRequest, AgentResponse
from ..sessions import sessions
from ..store import AGENT_GUEST_ID, ensure_agent_guest

router = APIRouter()
guardrail = GuardrailAgent()

# Keep references to in-flight log uploads so they are not garbage-collected.
_log_tasks: set[asyncio.Task] = set()


def _crew_identifiers(crew) -> set[str]:
    """Collect event-bus identifiers owned by this crew."""
    identifiers: set[str] = set()
    fingerprint = getattr(crew, "fingerprint", None)
    if fingerprint:
        identifiers.add(str(getattr(fingerprint, "uuid_str", fingerprint)))
    for item in [*getattr(crew, "tasks", []), *getattr(crew, "agents", [])]:
        if item_id := getattr(item, "id", None):
            identifiers.add(str(item_id))
    return identifiers


def _final_text(result) -> str:
    raw = getattr(result, "raw", None)
    return str(raw if raw is not None else result)


class _EventCollector:
    """Queue-compatible sink that records the bridge's tool events."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    def put(self, item: tuple[str, dict] | None) -> None:
        if item is None:
            return
        kind, payload = item
        self.events.append({"event": kind, "data": payload})


def _schedule_log_upload(payload: dict) -> None:
    """Upload the interaction record without blocking the response."""

    if not settings.log_api_url or not settings.log_api_key:
        return

    async def _send() -> None:
        url = f"{settings.log_api_url.rstrip('/')}/api/interactions"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {settings.log_api_key}"},
                )
                response.raise_for_status()
        except Exception as exc:  # noqa: BLE001 - logging must never break chat
            print(f"Interaction log upload failed: {exc}")

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(_send())
    _log_tasks.add(task)
    task.add_done_callback(_log_tasks.discard)


@router.post("/agent", response_model=AgentResponse)
async def agent(req: AgentRequest) -> AgentResponse:
    if not settings.llm_api_key or not settings.agent_model:
        raise HTTPException(status_code=503, detail="Chat is not configured")

    if req.session_id:
        session = sessions.get(req.session_id)
        # Only continue this endpoint's own guest sessions; never adopt a
        # session that belongs to another user.
        if session is None or session.user_id != AGENT_GUEST_ID:
            raise HTTPException(status_code=404, detail="Unknown session")
    else:
        user = ensure_agent_guest()
        session = sessions.create(user["id"], user["display_name"])

    history = list(session.history)
    session.history.append({"role": "user", "content": req.message})
    crew = build_chat_crew(session, req.message, history, guardrail)
    collector = _EventCollector()
    channel_id = bridge.register(collector, _crew_identifiers(crew))

    started = time.monotonic()
    error: str | None = None
    answer = ""

    def run_crew() -> None:
        nonlocal answer, error
        try:
            result = crew.kickoff()
            from crewai.events import crewai_event_bus

            crewai_event_bus.flush(timeout=5)
            answer = _final_text(result)
        except Exception as exc:  # noqa: BLE001 - surface failures as JSON
            error = str(exc)

    await asyncio.to_thread(run_crew)
    bridge.unregister(channel_id)
    duration_ms = int((time.monotonic() - started) * 1000)

    _schedule_log_upload(
        {
            "source": "api",
            "session_id": session.id,
            "input_message": req.message,
            "answer": answer,
            "blocked_total": session.blocked,
            "events": collector.events,
            "duration_ms": duration_ms,
            "error": error,
        }
    )

    if error is not None:
        raise HTTPException(status_code=502, detail=f"Agent run failed: {error}")

    return AgentResponse(
        answer=answer,
        blocked_total=session.blocked,
        session_id=session.id,
        events=collector.events,
    )
