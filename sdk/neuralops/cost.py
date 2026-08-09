"""
Token-level cost estimation for LLM calls.

Pricing is pulled from a local table (no external API call at runtime).
The table is intentionally kept simple — update MODEL_PRICING to add new models.

Design: We use tiktoken for token counting where the model is known.
For unknown models we fall back to character-based heuristics (3.5 chars/token).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

try:
    import tiktoken
    _TIKTOKEN_AVAILABLE = True
except ImportError:
    _TIKTOKEN_AVAILABLE = False

from neuralops.models import CostAttribution


@dataclass(frozen=True)
class ModelPricing:
    provider: str
    input_per_1m: float   # USD per 1M input tokens
    output_per_1m: float  # USD per 1M output tokens
    encoding: str = "cl100k_base"


# USD per 1M tokens — update as pricing changes
MODEL_PRICING: dict[str, ModelPricing] = {
    # OpenAI
    "gpt-4o":                  ModelPricing("openai", 5.00,  15.00),
    "gpt-4o-mini":             ModelPricing("openai", 0.15,   0.60),
    "gpt-4-turbo":             ModelPricing("openai", 10.00,  30.00),
    "gpt-4":                   ModelPricing("openai", 30.00,  60.00),
    "gpt-3.5-turbo":           ModelPricing("openai", 0.50,   1.50),

    # Anthropic
    "claude-opus-4-6":         ModelPricing("anthropic", 15.00, 75.00, "cl100k_base"),
    "claude-sonnet-4-6":       ModelPricing("anthropic", 3.00,  15.00, "cl100k_base"),
    "claude-haiku-4-5":        ModelPricing("anthropic", 0.25,   1.25, "cl100k_base"),

    # Google
    "gemini-1.5-pro":          ModelPricing("google", 3.50,  10.50),
    "gemini-1.5-flash":        ModelPricing("google", 0.075,  0.30),

    # Meta / open weights (self-hosted, near-zero compute cost — set to infra cost estimate)
    "llama-3-70b":             ModelPricing("meta", 0.90,   0.90),
    "llama-3-8b":              ModelPricing("meta", 0.20,   0.20),

    # Mistral
    "mistral-large":           ModelPricing("mistral", 4.00,  12.00),
    "mistral-small":           ModelPricing("mistral", 1.00,   3.00),
}

_FALLBACK_CHARS_PER_TOKEN = 3.5


def count_tokens(text: str, encoding: str = "cl100k_base") -> int:
    """Count tokens in text. Falls back to char heuristic if tiktoken unavailable."""
    if not text:
        return 0
    if _TIKTOKEN_AVAILABLE:
        try:
            enc = tiktoken.get_encoding(encoding)
            return len(enc.encode(text))
        except Exception:
            pass
    return max(1, int(len(text) / _FALLBACK_CHARS_PER_TOKEN))


def estimate_cost(
    model: str,
    prompt: str | None = None,
    completion: str | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    raw_response: dict[str, Any] | None = None,
) -> CostAttribution:
    """
    Compute cost for an LLM call.

    Priority for token counts:
      1. raw_response usage field (most accurate — comes from the API)
      2. explicit token counts passed by caller
      3. tiktoken count of prompt/completion strings
      4. character heuristic
    """
    pricing = MODEL_PRICING.get(model)
    provider = pricing.provider if pricing else "unknown"
    encoding = pricing.encoding if pricing else "cl100k_base"

    # Extract token counts from API response if available
    if raw_response:
        usage = raw_response.get("usage", {})
        prompt_tokens = prompt_tokens or usage.get("prompt_tokens") or usage.get("input_tokens", 0)
        completion_tokens = completion_tokens or usage.get("completion_tokens") or usage.get("output_tokens", 0)

    # Fall back to counting strings
    if prompt_tokens is None:
        prompt_tokens = count_tokens(prompt or "", encoding)
    if completion_tokens is None:
        completion_tokens = count_tokens(completion or "", encoding)

    total_tokens = prompt_tokens + completion_tokens

    if pricing:
        estimated_usd = (
            prompt_tokens * pricing.input_per_1m / 1_000_000
            + completion_tokens * pricing.output_per_1m / 1_000_000
        )
    else:
        # Unknown model: use gpt-4o pricing as conservative upper bound
        fallback = MODEL_PRICING["gpt-4o"]
        estimated_usd = (
            prompt_tokens * fallback.input_per_1m / 1_000_000
            + completion_tokens * fallback.output_per_1m / 1_000_000
        )

    return CostAttribution(
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        estimated_usd=round(estimated_usd, 8),
        provider=provider,
    )