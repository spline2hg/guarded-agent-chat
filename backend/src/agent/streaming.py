"""Route agent tool events to the HTTP request that owns them."""

from __future__ import annotations

import json
import queue
import threading
import uuid
from dataclasses import dataclass
from typing import Any

from crewai.events import (
    BaseEventListener,
    ToolUsageFinishedEvent,
    ToolUsageStartedEvent,
)


@dataclass(frozen=True)
class StreamChannel:
    response_queue: queue.Queue
    identifiers: frozenset[str]


class SSEEventBridge(BaseEventListener):
    """Keep the global agent event bus isolated per chat request."""

    def __init__(self) -> None:
        super().__init__()
        self._channels: dict[str, StreamChannel] = {}
        self._lock = threading.Lock()

    def register(self, response_queue: queue.Queue, identifiers: set[str]) -> str:
        if not identifiers:
            raise ValueError("Crew has no event identifiers")
        channel_id = str(uuid.uuid4())
        with self._lock:
            self._channels[channel_id] = StreamChannel(
                response_queue, frozenset(identifiers)
            )
        return channel_id

    def unregister(self, channel_id: str) -> None:
        with self._lock:
            self._channels.pop(channel_id, None)

    @staticmethod
    def _identifiers(event: Any) -> set[str]:
        return {
            str(value)
            for name in ("source_fingerprint", "task_id", "agent_id")
            if (value := getattr(event, name, None))
        }

    def _emit(self, kind: str, payload: Any, event: Any) -> None:
        event_ids = self._identifiers(event)
        if not event_ids:
            return
        with self._lock:
            channels = list(self._channels.values())
        for channel in channels:
            if channel.identifiers.intersection(event_ids):
                channel.response_queue.put((kind, payload))

    def setup_listeners(self, bus) -> None:
        @bus.on(ToolUsageStartedEvent)
        def _tool_start(_sender, event) -> None:
            args = _event_value(event, "tool_input", "tool_args", "arguments", "input", default={})
            if not isinstance(args, dict):
                args = {"value": str(args)}
            self._emit(
                "tool_start",
                {
                    "tool": str(_event_value(event, "tool_name", "name", default="tool")),
                    "query": args.get("query", ""),
                    "arguments": args,
                },
                event,
            )

        @bus.on(ToolUsageFinishedEvent)
        def _tool_end(_sender, event) -> None:
            output = _event_value(event, "output", "result", "tool_output")
            payload = _decode_output(output)
            if not isinstance(payload, dict):
                payload = {"reasoning": str(payload)}
            self._emit("tool_end", payload, event)


def _event_value(event: Any, *names: str, default: Any = None) -> Any:
    for name in names:
        value = getattr(event, name, None)
        if value is not None:
            return value
    return default


def _decode_output(value: Any) -> Any:
    if hasattr(value, "raw"):
        value = value.raw
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    try:
        return json.loads(json.dumps(value, default=str))
    except (TypeError, ValueError):
        return str(value)


bridge = SSEEventBridge()
