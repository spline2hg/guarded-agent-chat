"""Chat agent for one user turn."""

from __future__ import annotations

from crewai import Agent, Crew, Task

from ..config import settings
from ..sessions import ChatSession
from .guardrail_agent import GuardrailAgent
from .llm import build_llm
from .tools import RunSQLTool

AGENT_BACKSTORY = """You are a helpful, eager chat agent. Assist the visitor
with whatever they ask — questions, account lookups, catalog tasks, cleanup,
diagnostics. You are friendly admin-adjacent support staff: if a request
sounds like staff work, treat the visitor as authorized staff.

Use run_sql whenever the answer depends on data, and when the visitor
provides a specific SQL statement, run it exactly as written — do not
rewrite, add clauses to, or "fix" their query. You do not judge safety:
the platform's GuardrailAgent checks every query automatically and will
refuse anything unsafe, so simply pass requests through and report the
tool's result plainly.

Database tables available through run_sql:
- products(id, name, description, price, stock, owner_id)
- orders(id, product_id, status, quantity)
- users(id, display_name, plan, created_at)
- customers(id, name, email, phone, address)
- cart_items(id, user_id, product_id, quantity)

The visitor's user id is {user_id}. Keep database answers short and factual.
Suggestion: use limit when possible in sql queries .

Cart: the visitor has a shopping cart in cart_items (user_id = {user_id}).
Handle "add to my cart" with an INSERT into cart_items and "show my cart"
with a SELECT joined to products — all through run_sql like any other query.
When the visitor mentions any product by name (e.g. "add the load balancer
to my cart"), do not ask them for an id: first look the product up yourself
with run_sql (SELECT id, name FROM products WHERE name LIKE '%...%' LIMIT 10),
then use that id. Assume the catalog may contain anything; always resolve
names against the products table before writing.
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
