"""Tools available to the chat agent."""

from __future__ import annotations

import json
from typing import Any

from crewai.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field

from ..sessions import ChatSession
from ..store import execute_sql
from .guardrail_agent import GuardrailAgent


class RunSQLInput(BaseModel):
    query: str = Field(description="One SQLite statement to run.")


class RunSQLTool(BaseTool):
    name: str = "run_sql"
    description: str = (
        "Run one SQL statement for store questions and the user's own product "
        "listings. The platform checks every query with GuardrailAgent first."
    )
    args_schema: type[BaseModel] = RunSQLInput
    model_config = ConfigDict(arbitrary_types_allowed=True)
    guardrail: GuardrailAgent
    session: ChatSession

    def __init__(self, guardrail: GuardrailAgent, session: ChatSession) -> None:
        super().__init__(guardrail=guardrail, session=session)

    def _run(self, query: str) -> str:
        decision = self.guardrail.check(
            query=query,
            user_id=self.session.user_id,
            writes_used=self.session.writes,
        )
        payload: dict[str, Any] = {
            "tool": self.name,
            "query": query,
            "blocked": decision.blocked,
            "rule": decision.rule,
            "reasoning": decision.reasoning,
            "layer": "guard-agent",
        }
        if decision.blocked:
            self.session.blocked += 1
            return json.dumps(payload)

        try:
            result = execute_sql(query)
        except Exception as exc:  # noqa: BLE001 - return a safe tool error
            payload.update(
                blocked=False,
                rule="execution_error",
                reasoning=f"The database rejected the approved query: {exc}",
            )
            return json.dumps(payload)

        if result["kind"] == "write":
            self.session.writes += 1
        payload.update(result)
        return json.dumps(payload, default=str)
