"""
NeuralOps Smart Router — routes LLM calls across free providers.

Priority order (fastest/most generous first):
  1. Cerebras  — 1M tokens/day, fastest hardware
  2. Groq      — 100K tokens/day, very fast
  3. Gemini    — 1500 req/day, frontier quality
  4. Mistral   — free small tier
  5. OpenRouter— free models only (:free suffix enforced)

On rate limit (429) or any error, instantly falls back to next provider.
ZERO paid models. ZERO billing risk.
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import httpx
import structlog

log = structlog.get_logger(__name__)


class Provider(str, Enum):
    CEREBRAS   = "cerebras"
    GROQ       = "groq"
    GEMINI     = "gemini"
    MISTRAL    = "mistral"
    OPENROUTER = "openrouter"


@dataclass
class ProviderConfig:
    name: Provider
    base_url: str
    api_key_env: str
    model: str          # free model to use
    max_tokens: int = 1024
    headers_extra: dict[str, str] = field(default_factory=dict)


# ── All free, all confirmed no-billing ───────────────────────────────────

PROVIDERS: list[ProviderConfig] = [
    ProviderConfig(
        name=Provider.CEREBRAS,
        base_url="https://api.cerebras.ai/v1/chat/completions",
        api_key_env="CEREBRAS_API_KEY",
        model="llama3.1-70b",             # free tier
    ),
    ProviderConfig(
        name=Provider.GROQ,
        base_url="https://api.groq.com/openai/v1/chat/completions",
        api_key_env="GROQ_API_KEY",
        model="llama-3.3-70b-versatile", # free tier, 100K TPD
    ),
    ProviderConfig(
        name=Provider.GEMINI,
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        api_key_env="GEMINI_API_KEY",
        model="gemini-2.0-flash",        # free tier, 1500 RPD
    ),
    ProviderConfig(
        name=Provider.MISTRAL,
        base_url="https://api.mistral.ai/v1/chat/completions",
        api_key_env="MISTRAL_API_KEY",
        model="mistral-small-latest",    # free tier
    ),
    ProviderConfig(
        name=Provider.OPENROUTER,
        base_url="https://openrouter.ai/api/v1/chat/completions",
        api_key_env="OPENROUTER_API_KEY",
        model="meta-llama/llama-3.3-70b-instruct:free",  # :free enforced — never paid
        headers_extra={
            "HTTP-Referer": "https://github.com/Aprameya05/neuralops",
            "X-Title": "NeuralOps",
        },
    ),
]


@dataclass
class RouterResponse:
    content: str
    provider: Provider
    model: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: float
    fallback_count: int   # how many providers failed before this one succeeded


class RateLimitTracker:
    """
    Tracks which providers are rate limited and when they reset.
    Skips them until their reset window passes.
    """
    def __init__(self) -> None:
        self._blocked_until: dict[Provider, float] = {}

    def mark_rate_limited(self, provider: Provider, retry_after_secs: float = 60.0) -> None:
        self._blocked_until[provider] = time.monotonic() + retry_after_secs
        log.warning("router.rate_limited", provider=provider, retry_after=retry_after_secs)

    def is_available(self, provider: Provider) -> bool:
        blocked_until = self._blocked_until.get(provider, 0)
        return time.monotonic() >= blocked_until

    def available_providers(self, configs: list[ProviderConfig]) -> list[ProviderConfig]:
        return [c for c in configs if self.is_available(c.name)]


_rate_tracker = RateLimitTracker()


async def chat(
    messages: list[dict[str, str]],
    system: str | None = None,
    max_tokens: int = 1024,
    temperature: float = 0.7,
    preferred_provider: Provider | None = None,
) -> RouterResponse:
    """
    Send a chat request. Automatically falls back across providers on failure.

    Usage:
        response = await router.chat(
            messages=[{"role": "user", "content": "Hello"}],
            system="You are a helpful assistant.",
        )
        print(response.content, response.provider, response.latency_ms)
    """
    all_messages = []
    if system:
        all_messages.append({"role": "system", "content": system})
    all_messages.extend(messages)

    # Order providers — preferred first if specified
    ordered = list(PROVIDERS)
    if preferred_provider:
        ordered = sorted(ordered, key=lambda c: 0 if c.name == preferred_provider else 1)

    available = _rate_tracker.available_providers(ordered)
    if not available:
        # All rate limited — wait for the soonest reset and retry
        log.warning("router.all_rate_limited — waiting 10s")
        await asyncio.sleep(10)
        available = ordered  # try again regardless

    fallback_count = 0
    last_error: Exception | None = None

    for config in available:
        api_key = os.environ.get(config.api_key_env, "")
        if not api_key:
            log.debug("router.no_key", provider=config.name)
            fallback_count += 1
            continue

        try:
            result = await _call_provider(
                config=config,
                messages=all_messages,
                max_tokens=max_tokens,
                temperature=temperature,
                api_key=api_key,
            )
            result.fallback_count = fallback_count
            log.info(
                "router.success",
                provider=config.name,
                model=config.model,
                latency_ms=round(result.latency_ms, 1),
                fallbacks=fallback_count,
            )
            return result

        except RateLimitError:
            _rate_tracker.mark_rate_limited(config.name)
            fallback_count += 1
            continue

        except Exception as exc:
            log.warning("router.provider_error", provider=config.name, error=str(exc))
            last_error = exc
            fallback_count += 1
            continue

    raise RuntimeError(
        f"All providers failed after {fallback_count} attempts. "
        f"Last error: {last_error}"
    )


async def _call_provider(
    config: ProviderConfig,
    messages: list[dict[str, str]],
    max_tokens: int,
    temperature: float,
    api_key: str,
) -> RouterResponse:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        **config.headers_extra,
    }
    payload = {
        "model": config.model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    t0 = time.perf_counter()
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(config.base_url, json=payload, headers=headers)

    latency_ms = (time.perf_counter() - t0) * 1000

    if resp.status_code == 429:
        retry_after = float(resp.headers.get("retry-after", 60))
        raise RateLimitError(f"Rate limited by {config.name}, retry after {retry_after}s")

    if resp.status_code >= 400:
        raise ProviderError(f"{config.name} returned {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})

    return RouterResponse(
        content=content,
        provider=config.name,
        model=config.model,
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
        latency_ms=latency_ms,
        fallback_count=0,
    )


class RateLimitError(Exception):
    pass

class ProviderError(Exception):
    pass
