"""Environment-backed application settings."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    llm_base_url: str = os.getenv("LLM_BASE_URL", "")
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    agent_model: str = os.getenv("AGENT_MODEL", "")
    guard_model: str = os.getenv("GUARD_MODEL", "") or os.getenv("AGENT_MODEL", "")
    db_path: str = os.getenv("DB_PATH", "../data.db")
    max_rows: int = 100
    write_budget: int = 10
    agent_timeout_s: float = 90.0
    guard_timeout_s: float = 30.0


settings = Settings()
