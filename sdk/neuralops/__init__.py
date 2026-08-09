"""
NeuralOps SDK — drop-in AI agent observability.

Usage:
    import neuralops
    neuralops.init(endpoint="http://localhost:4317", service="my-agent")

    @neuralops.trace("my_agent_step")
    async def my_step(input: str) -> str:
        ...
"""

from neuralops.tracer import init, trace, trace_tool_call, trace_llm_call
from neuralops.context import AgentContext, get_current_context
from neuralops.models import (
    Span,
    ToolCallSpan,
    LLMCallSpan,
    SpanStatus,
    CostAttribution,
)
from neuralops.cost import estimate_cost
from neuralops.drift import DriftDetector

__version__ = "0.1.0"

__all__ = [
    "init",
    "trace",
    "trace_tool_call",
    "trace_llm_call",
    "AgentContext",
    "get_current_context",
    "Span",
    "ToolCallSpan",
    "LLMCallSpan",
    "SpanStatus",
    "CostAttribution",
    "estimate_cost",
    "DriftDetector",
]