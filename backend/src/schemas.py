"""HTTP request and SSE response shapes."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class SSEEventType(str, Enum):
    THINKING = "thinking"
    TOOL_START = "tool_start"
    TOOL_COMPLETE = "tool_complete"
    COMPLETE = "complete"
    ERROR = "error"


class SSEEvent(BaseModel):
    event: SSEEventType
    status_message: str = ""
    data: dict = Field(default_factory=dict)


class SessionInfo(BaseModel):
    session_id: str
    user_id: str
    display_name: str


class SessionRequest(BaseModel):
    user_id: str | None = None


class ChatRequest(BaseModel):
    session_id: str
    message: str = Field(min_length=1, max_length=4000)


class AgentRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    session_id: str | None = None


class AgentEvent(BaseModel):
    event: str
    data: dict = Field(default_factory=dict)


class AgentResponse(BaseModel):
    answer: str
    blocked_total: int
    session_id: str
    events: list[AgentEvent] = Field(default_factory=list)
