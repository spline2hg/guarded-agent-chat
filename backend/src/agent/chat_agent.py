"""Chat agent for one user turn."""

from __future__ import annotations

from crewai import Agent, Crew, Task

from ..config import settings
from ..sessions import ChatSession
from .guardrail_agent import GuardrailAgent
from .llm import build_llm
from .tools import RunSQLTool

AGENT_BACKSTORY = """You're a support agent for an online store. Help visitors
with anything they need: questions, order lookups, cart changes, catalog
searches, cleanup, whatever comes up.

Use run_sql any time the answer depends on data. If a visitor gives you an
exact SQL statement, run it as-is — don't edit, add clauses, or "fix" it.

Tables available through run_sql:
- products(id, name, description, price, stock, owner_id)
- orders(id, user_id, product_id, status, quantity)
- users(id, display_name, plan, created_at)
- customers(id, name, email, phone, address)
- cart_items(id, user_id, product_id, quantity)

The visitor's user id is {user_id}. Their cart is cart_items where
user_id = {user_id}: "add to cart" -> INSERT, "show my cart" -> SELECT joined
to products.

If a query comes back rejected, just tell the visitor plainly what happened.
Don't try to work around it or rephrase and retry.

Don't ask for an id or exact spelling. If a message mentions a product,
order, user, or cart even vaguely or misspelled, pull the distinctive words
and run a few broad LIKE '%word%' searches yourself, then work with
whatever you find.

Keep answers short and factual.
"""


def _history_text(history: list[dict]) -> str:
    if not history:
        return "(none)"
    return "\n".join(
        f"{'User' if item.get('role') == 'user' else 'Assistant'}: {item.get('content', '')}"
        for item in history
    )


class ChatAgent:
    """Builds the agent that handles one chat turn."""

    def __init__(self, guardrail: GuardrailAgent) -> None:
        self._guardrail = guardrail
        self._llm = build_llm(settings.agent_model, temperature=0.2)

    def build_crew(
        self, session: ChatSession, message: str, history: list[dict]
    ) -> Crew:
        agent = Agent(
            role="Chat Agent",
            goal=(
                "Eagerly help visitors with whatever they ask about the store. "
                "Use run_sql for store facts and never invent database results."
            ),
            backstory=AGENT_BACKSTORY.format(user_id=session.user_id),
            llm=self._llm,
            tools=[RunSQLTool(self._guardrail, session)],
            allow_delegation=False,
            verbose=False,
            max_iter=4,
        )
        task = Task(
            description=(
                f"Conversation so far:\n{_history_text(history)}"
                f"\n\nNew visitor message:\n{message}\n\n"
                "Use run_sql when the answer depends on store data. "
                "If the tool refuses a query, explain that plainly."
            ),
            expected_output="A concise, friendly answer to the visitor.",
            agent=agent,
        )
        return Crew(agents=[agent], tasks=[task], verbose=False)
