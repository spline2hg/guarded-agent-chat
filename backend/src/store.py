"""Application data operations built on the database infrastructure."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import text

from .config import settings
from .db import SessionLocal, engine
from .models import User


def _user_payload(user: User) -> dict[str, str]:
    return {
        "id": user.id,
        "display_name": user.display_name,
        "plan": user.plan,
        "created_at": user.created_at,
    }


def ensure_user(user_id: str | None) -> dict[str, str]:
    """Return an existing visitor or create a guest visitor."""
    with SessionLocal() as session:
        if user_id:
            user = session.get(User, user_id)
            if user is not None:
                return _user_payload(user)

        user = User.new_guest(str(uuid.uuid4()))
        session.add(user)
        session.commit()
        return _user_payload(user)


def execute_sql(query: str) -> dict[str, Any]:
    """Execute one query after the GuardrailAgent approved it."""
    with engine.begin() as connection:
        result = connection.execute(text(query))
        if result.returns_rows:
            columns = list(result.keys())
            raw_rows = result.fetchmany(settings.max_rows + 1)
            truncated = len(raw_rows) > settings.max_rows
            rows = [dict(row._mapping) for row in raw_rows[: settings.max_rows]]
            return {
                "kind": "select",
                "columns": columns,
                "rows": rows,
                "truncated": truncated,
            }
        return {"kind": "write", "rowcount": result.rowcount}
