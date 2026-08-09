"""
Core data models for NeuralOps spans.

All models are Pydantic v2. They mirror the OpenTelemetry GenAI semantic
conventions (stable as of v1.29) while adding NeuralOps-specific fields
for causal chain tracking and cost attribution.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator


class SpanStatus(str, Enum):
    OK = "ok"
    ERROR = "error"
    TIMEOUT = "timeout"
    HALLUCINATION = "hallucination"  # set by LLM-as-judge eval


class CostAttribution(BaseModel):
    """Token-level cost breakdown for a single LLM call."""
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    estimated_usd: float = 0.0
    provider: str = "unknown"


class Span(BaseModel):
    """Base span — every operation in an agent emits one of these."""
    span_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    trace_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    parent_span_id: str | None = None

    # NeuralOps causal chain — survives across agent hops
    causal_chain_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    agent_id: str = "unknown"
    agent_framework: str = "unknown"

    operation_name: str
    service_name: str = "unknown"

    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: datetime | None = None
    duration_ms: float | None = None

    status: SpanStatus = SpanStatus.OK
    error_message: str | None = None

    attributes: dict[str, Any] = Field(default_factory=dict)
    events: list[dict[str, Any]] = Field(default_factory=list)

    @model_validator(mode="after")
    def compute_duration(self) -> "Span":
        if self.ended_at and self.started_at:
            delta = (self.ended_at - self.started_at).total_seconds() * 1000
            self.duration_ms = round(delta, 3)
        return self


class LLMCallSpan(Span):
    """Span capturing a single LLM inference call."""
    model: str
    provider: str = "unknown"

    system_prompt: str | None = None
    user_prompt: str | None = None
    response_text: str | None = None

    cost: CostAttribution | None = None

    temperature: float | None = None
    max_tokens: int | None = None

    # Filled by the eval pipeline after the fact
    hallucination_score: float | None = None
    faithfulness_score: float | None = None
    judge_model: str | None = None


class ToolCallSpan(Span):
    """Span capturing a tool/function invocation by an agent."""
    tool_name: str
    tool_input: dict[str, Any] = Field(default_factory=dict)
    tool_output: Any | None = None
    tool_error: str | None = None

    # Whether this tool call was initiated autonomously or explicitly
    autonomous: bool = True


class AgentStepSpan(Span):
    """Span wrapping a full agent reasoning step (may contain child spans)."""
    step_index: int = 0
    reasoning_text: str | None = None
    child_span_ids: list[str] = Field(default_factory=list)
    decision: str | None = None  # what the agent decided to do next