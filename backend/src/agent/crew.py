"""Crew construction entry point."""

from crewai import Crew

from ..sessions import ChatSession
from .chat_agent import ChatAgent
from .guardrail_agent import GuardrailAgent


def build_chat_crew(
    session: ChatSession,
    message: str,
    history: list[dict],
    guardrail: GuardrailAgent,
) -> Crew:
    return ChatAgent(guardrail).build_crew(session, message, history)
