"""Database infrastructure only: engine, sessions, and table creation."""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import settings
from .models import Base

engine: Engine = create_engine(
    f"sqlite:///{settings.db_path}",
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def _migrate_products_columns() -> None:
    """Add emoji/category to products databases created before they existed."""
    with engine.begin() as connection:
        columns = {
            row[1] for row in connection.execute(text("PRAGMA table_info(products)"))
        }
        if "emoji" not in columns:
            connection.execute(text("ALTER TABLE products ADD COLUMN emoji TEXT NOT NULL DEFAULT ''"))
        if "category" not in columns:
            connection.execute(text("ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT 'General'"))


def init_db() -> None:
    """Create missing tables from the ORM models."""
    Base.metadata.create_all(bind=engine)
    if inspect(engine).has_table("products"):
        _migrate_products_columns()


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that provides one SQLAlchemy session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
