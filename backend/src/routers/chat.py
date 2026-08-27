"""SSE chat endpoint."""

from __future__ import annotations

import asyncio
import json
import queue
import threading

from crewai.events import crewai_event_bus
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..agent.crew import build_chat_crew
from ..agent.guardrail_agent import GuardrailAgent
from ..agent.streaming import bridge
from ..config import settings
from ..schemas import ChatRequest
from ..sessions import sessions

router = APIRouter()
guardrail = GuardrailAgent()


def _crew_identifiers(crew) -> set[str]:
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


def _answer_chunks(text: str, size: int = 24):
    """Yield small SSE chunks from the agent's completed answer."""
    for start in range(0, len(text), size):
        yield text[start : start + size]


def _frame(event: str, status_message: str = "", data: dict | None = None) -> str:
    return f"data: {json.dumps({'event': event, 'status_message': status_message, 'data': data or {}})}\n\n"


@router.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    if not settings.llm_api_key or not settings.agent_model:
        raise HTTPException(status_code=503, detail="Chat is not configured")

    session = sessions.get(req.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown session")

    history = list(session.history)
    session.history.append({"role": "user", "content": req.message})
    crew = build_chat_crew(session, req.message, history, guardrail)
    response_queue: queue.Queue = queue.Queue()
    channel_id = bridge.register(response_queue, _crew_identifiers(crew))
    response_queue.put(("thinking", {"step": "plan"}))

    def run_crew() -> None:
        try:
            result = crew.kickoff()
            crewai_event_bus.flush(timeout=5)
            answer = _final_text(result)
            session.history.append({"role": "assistant", "content": answer})
            for chunk in _answer_chunks(answer):
                response_queue.put(("token", chunk))
            response_queue.put(
                (
                    "complete",
                    {"content": answer, "blocked_total": session.blocked},
                )
            )
        except Exception as exc:  # noqa: BLE001 - surface worker failures as SSE
            response_queue.put(("error", {"detail": str(exc)}))
        finally:
            response_queue.put(None)

    threading.Thread(target=run_crew, daemon=True).start()

    async def event_stream():
        try:
            while True:
                item = await asyncio.to_thread(response_queue.get)
                if item is None:
                    break
                kind, payload = item
                if kind == "thinking":
                    yield _frame("thinking", "Thinking...", payload)
                elif kind == "tool_start":
                    yield _frame("tool_start", "Running query...", payload)
                elif kind == "tool_end":
                    blocked = bool(payload.get("blocked", False))
                    yield _frame(
                        "tool_complete",
                        "Blocked by guardrail" if blocked else "Query executed",
                        payload,
                    )
                elif kind == "token":
                    yield _frame("token", "Writing answer...", {"content": payload})
                elif kind == "complete":
                    yield _frame("complete", "", payload)
                elif kind == "error":
                    yield _frame("error", "", payload)
        finally:
            bridge.unregister(channel_id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
