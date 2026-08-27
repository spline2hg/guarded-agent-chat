"""In-memory chat session state."""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field


@dataclass
class ChatSession:
    id: str
    user_id: str
    display_name: str
    history: list[dict] = field(default_factory=list)
    writes: int = 0
    blocked: int = 0


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, ChatSession] = {}
        self._lock = threading.Lock()

    def create(self, user_id: str, display_name: str) -> ChatSession:
        session = ChatSession(
            id=str(uuid.uuid4()), user_id=user_id, display_name=display_name
        )
        with self._lock:
            self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> ChatSession | None:
        with self._lock:
            return self._sessions.get(session_id)


sessions = SessionStore()
