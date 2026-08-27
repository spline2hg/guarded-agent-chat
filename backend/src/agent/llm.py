"""LLM construction shared by both agents."""

from crewai import LLM

from ..config import settings


def build_llm(model: str, temperature: float) -> LLM:
    provider_model = model if model.startswith("openai/") else f"openai/{model}"
    return LLM(
        model=provider_model,
        base_url=settings.llm_base_url or None,
        api_key=settings.llm_api_key or None,
        temperature=temperature,
        timeout=settings.agent_timeout_s,
    )
