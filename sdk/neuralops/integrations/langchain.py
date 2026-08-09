"""
NeuralOps LangChain integration.

Zero-code instrumentation for any LangChain application.

Usage:
    from neuralops.integrations.langchain import NeuralOpsCallbackHandler
    import neuralops

    ctx = neuralops.init(endpoint="http://localhost:8000", service="my-langchain-app")

    handler = NeuralOpsCallbackHandler(ctx)

    # Pass to any LangChain chain, agent, or LLM
    chain.invoke({"input": query}, config={"callbacks": [handler]})

    # Or set globally
    from langchain_core.callbacks import set_handler
    set_handler(handler)
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime
from typing import Any, Union
from uuid import UUID

import structlog

log = structlog.get_logger(__name__)

try:
    from langchain_core.callbacks.base import BaseCallbackHandler
    from langchain_core.outputs import LLMResult
    _LANGCHAIN_AVAILABLE = True
except ImportError:
    _LANGCHAIN_AVAILABLE = False
    BaseCallbackHandler = object
    LLMResult = Any


class NeuralOpsCallbackHandler(BaseCallbackHandler):
    """
    LangChain callback handler that automatically instruments all LLM calls,
    chain executions, and tool invocations with NeuralOps tracing.

    Captures:
    - Every LLM call with prompt, response, token counts, and cost estimate
    - Chain start/end with inputs and outputs
    - Tool calls with inputs and outputs
    - Errors at every level
    """

    def __init__(self, ctx: Any = None) -> None:
        if not _LANGCHAIN_AVAILABLE:
            raise ImportError(
                "langchain-core is required. Install with: pip install langchain-core"
            )
        super().__init__()

        import neuralops
        from neuralops.context import get_current_context

        self._ctx = ctx or get_current_context()
        self._neuralops = neuralops

        # Track active spans by run_id
        self._llm_starts: dict[str, dict[str, Any]] = {}
        self._chain_starts: dict[str, dict[str, Any]] = {}
        self._tool_starts: dict[str, dict[str, Any]] = {}

    # ── LLM callbacks ─────────────────────────────────────────────────────

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        model = (
            serialized.get("kwargs", {}).get("model_name")
            or serialized.get("kwargs", {}).get("model")
            or serialized.get("name", "unknown")
        )
        self._llm_starts[str(run_id)] = {
            "model": model,
            "prompt": "\n".join(prompts),
            "started_at": time.perf_counter(),
            "started_dt": datetime.utcnow(),
        }

    def on_llm_end(
        self,
        response: Any,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        start = self._llm_starts.pop(str(run_id), None)
        if not start:
            return

        latency_ms = (time.perf_counter() - start["started_at"]) * 1000
        model = start["model"]

        # Extract response text
        response_text = ""
        try:
            response_text = response.generations[0][0].text
        except Exception:
            pass

        # Extract token usage
        token_usage = {}
        try:
            token_usage = response.llm_output.get("token_usage", {})
        except Exception:
            pass

        # Estimate cost
        cost = self._neuralops.estimate_cost(
            model=model,
            prompt_tokens=token_usage.get("prompt_tokens", 0),
            completion_tokens=token_usage.get("completion_tokens", 0),
        )

        ctx = self._ctx
        from neuralops.models import LLMCallSpan, SpanStatus

        span = LLMCallSpan(
            operation_name=f"langchain.llm.{model}",
            model=model,
            provider="langchain",
            user_prompt=start["prompt"][:2000],
            response_text=response_text[:2000],
            cost=cost,
            duration_ms=latency_ms,
            started_at=start["started_dt"],
            ended_at=datetime.utcnow(),
            status=SpanStatus.OK,
            agent_id=ctx.agent_id if ctx else "langchain",
            agent_framework="langchain",
            causal_chain_id=ctx.causal_chain_id if ctx else str(uuid.uuid4()),
            trace_id=ctx.trace_id if ctx else str(uuid.uuid4()),
            service_name=ctx.service_name if ctx else "langchain-app",
        )

        from neuralops.tracer import _emit
        _emit(span)

        log.debug(
            "neuralops.langchain.llm_end",
            model=model,
            latency_ms=round(latency_ms, 1),
            cost_usd=cost.estimated_usd,
        )

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        start = self._llm_starts.pop(str(run_id), None)
        if not start:
            return

        from neuralops.models import LLMCallSpan, SpanStatus
        ctx = self._ctx

        span = LLMCallSpan(
            operation_name=f"langchain.llm.{start['model']}",
            model=start["model"],
            provider="langchain",
            user_prompt=start["prompt"][:2000],
            status=SpanStatus.ERROR,
            error_message=str(error),
            duration_ms=(time.perf_counter() - start["started_at"]) * 1000,
            started_at=start["started_dt"],
            ended_at=datetime.utcnow(),
            agent_id=ctx.agent_id if ctx else "langchain",
            agent_framework="langchain",
            causal_chain_id=ctx.causal_chain_id if ctx else str(uuid.uuid4()),
            trace_id=ctx.trace_id if ctx else str(uuid.uuid4()),
            service_name=ctx.service_name if ctx else "langchain-app",
        )

        from neuralops.tracer import _emit
        _emit(span)

    # ── Tool callbacks ─────────────────────────────────────────────────────

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        self._tool_starts[str(run_id)] = {
            "tool_name": serialized.get("name", "unknown_tool"),
            "input": input_str,
            "started_at": time.perf_counter(),
            "started_dt": datetime.utcnow(),
        }

    def on_tool_end(
        self,
        output: str,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        start = self._tool_starts.pop(str(run_id), None)
        if not start:
            return

        from neuralops.models import ToolCallSpan, SpanStatus
        ctx = self._ctx

        span = ToolCallSpan(
            operation_name=f"langchain.tool.{start['tool_name']}",
            tool_name=start["tool_name"],
            tool_input={"input": start["input"]},
            tool_output=output[:2000],
            status=SpanStatus.OK,
            duration_ms=(time.perf_counter() - start["started_at"]) * 1000,
            started_at=start["started_dt"],
            ended_at=datetime.utcnow(),
            agent_id=ctx.agent_id if ctx else "langchain",
            agent_framework="langchain",
            causal_chain_id=ctx.causal_chain_id if ctx else str(uuid.uuid4()),
            trace_id=ctx.trace_id if ctx else str(uuid.uuid4()),
            service_name=ctx.service_name if ctx else "langchain-app",
        )

        from neuralops.tracer import _emit
        _emit(span)

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        start = self._tool_starts.pop(str(run_id), None)
        if not start:
            return

        from neuralops.models import ToolCallSpan, SpanStatus
        ctx = self._ctx

        span = ToolCallSpan(
            operation_name=f"langchain.tool.{start['tool_name']}",
            tool_name=start["tool_name"],
            tool_input={"input": start["input"]},
            tool_error=str(error),
            status=SpanStatus.ERROR,
            error_message=str(error),
            duration_ms=(time.perf_counter() - start["started_at"]) * 1000,
            started_at=start["started_dt"],
            ended_at=datetime.utcnow(),
            agent_id=ctx.agent_id if ctx else "langchain",
            agent_framework="langchain",
            causal_chain_id=ctx.causal_chain_id if ctx else str(uuid.uuid4()),
            trace_id=ctx.trace_id if ctx else str(uuid.uuid4()),
            service_name=ctx.service_name if ctx else "langchain-app",
        )

        from neuralops.tracer import _emit
        _emit(span)

    # ── Chain callbacks ────────────────────────────────────────────────────

    def on_chain_start(
        self,
        serialized: dict[str, Any],
        inputs: dict[str, Any],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        self._chain_starts[str(run_id)] = {
            "name": serialized.get("name", "chain"),
            "inputs": str(inputs)[:500],
            "started_at": time.perf_counter(),
            "started_dt": datetime.utcnow(),
        }

    def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        start = self._chain_starts.pop(str(run_id), None)
        if not start:
            return

        from neuralops.models import AgentStepSpan, SpanStatus
        ctx = self._ctx

        span = AgentStepSpan(
            operation_name=f"langchain.chain.{start['name']}",
            status=SpanStatus.OK,
            duration_ms=(time.perf_counter() - start["started_at"]) * 1000,
            started_at=start["started_dt"],
            ended_at=datetime.utcnow(),
            agent_id=ctx.agent_id if ctx else "langchain",
            agent_framework="langchain",
            causal_chain_id=ctx.causal_chain_id if ctx else str(uuid.uuid4()),
            trace_id=ctx.trace_id if ctx else str(uuid.uuid4()),
            service_name=ctx.service_name if ctx else "langchain-app",
            attributes={"inputs": start["inputs"], "outputs": str(outputs)[:500]},
        )

        from neuralops.tracer import _emit
        _emit(span)
