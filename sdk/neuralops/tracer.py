"""
NeuralOps tracer — the main instrumentation surface.

Provides:
  - init()           — configure the SDK once at startup
  - @trace()         — decorator for any agent function
  - trace_llm_call() — context manager for LLM calls (captures cost, tokens)
  - trace_tool_call()— context manager for tool invocations

All spans are:
  1. Emitted to the NeuralOps collector via OTLP gRPC
  2. Also exported in OpenTelemetry format for compatibility with Datadog, Grafana, etc.
"""

from __future__ import annotations

import asyncio
import functools
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime
from typing import Any, Callable, TypeVar

import structlog

from neuralops.context import AgentContext, get_current_context, set_current_context
from neuralops.cost import estimate_cost
from neuralops.models import (
    AgentStepSpan,
    LLMCallSpan,
    SpanStatus,
    ToolCallSpan,
)
from neuralops.exporter import SpanExporter

log = structlog.get_logger(__name__)

F = TypeVar("F", bound=Callable[..., Any])

_exporter: SpanExporter | None = None
_default_service: str = "unknown"


def init(
    endpoint: str = "http://localhost:4317",
    service: str = "agent",
    agent_id: str | None = None,
    framework: str = "unknown",
    api_key: str | None = None,
    batch_size: int = 100,
    flush_interval_ms: int = 2000,
) -> AgentContext:
    """
    Initialize the NeuralOps SDK. Call once at application startup.

    Returns an AgentContext that should be stored and passed to child agents.
    """
    global _exporter, _default_service
    _default_service = service

    _exporter = SpanExporter(
        endpoint=endpoint,
        api_key=api_key,
        batch_size=batch_size,
        flush_interval_ms=flush_interval_ms,
    )

    ctx = AgentContext(
        agent_id=agent_id or str(uuid.uuid4()),
        agent_framework=framework,
        service_name=service,
    )
    set_current_context(ctx)

    log.info(
        "neuralops.init",
        endpoint=endpoint,
        service=service,
        agent_id=ctx.agent_id,
    )
    return ctx


def trace(
    operation: str | None = None,
    *,
    capture_args: bool = False,
    capture_output: bool = False,
) -> Callable[[F], F]:
    """
    Decorator for any agent function (sync or async).

    @neuralops.trace("plan_step")
    async def plan(query: str) -> str:
        ...
    """
    def decorator(fn: F) -> F:
        op_name = operation or fn.__qualname__

        @functools.wraps(fn)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            ctx = get_current_context()
            span = AgentStepSpan(
                operation_name=op_name,
                agent_id=ctx.agent_id if ctx else "unknown",
                agent_framework=ctx.agent_framework if ctx else "unknown",
                causal_chain_id=ctx.causal_chain_id if ctx else str(uuid.uuid4()),
                trace_id=ctx.trace_id if ctx else str(uuid.uuid4()),
                service_name=ctx.service_name if ctx else _default_service,
                attributes={"args": str(args)[:500] if capture_args else None},
            )
            t0 = time.perf_counter()
            try:
                result = await fn(*args, **kwargs)
                span.status = SpanStatus.OK
                if capture_output:
                    span.attributes["output"] = str(result)[:500]
                return result
            except Exception as exc:
                span.status = SpanStatus.ERROR
                span.error_message = str(exc)
                raise
            finally:
                span.ended_at = datetime.utcnow()
                span.duration_ms = (time.perf_counter() - t0) * 1000
                _emit(span)

        @functools.wraps(fn)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            ctx = get_current_context()
            span = AgentStepSpan(
                operation_name=op_name,
                agent_id=ctx.agent_id if ctx else "unknown",
                agent_framework=ctx.agent_framework if ctx else "unknown",
                causal_chain_id=ctx.causal_chain_id if ctx else str(uuid.uuid4()),
                trace_id=ctx.trace_id if ctx else str(uuid.uuid4()),
                service_name=ctx.service_name if ctx else _default_service,
            )
            t0 = time.perf_counter()
            try:
                result = fn(*args, **kwargs)
                span.status = SpanStatus.OK
                return result
            except Exception as exc:
                span.status = SpanStatus.ERROR
                span.error_message = str(exc)
                raise
            finally:
                span.ended_at = datetime.utcnow()
                span.duration_ms = (time.perf_counter() - t0) * 1000
                _emit(span)

        if asyncio.iscoroutinefunction(fn):
            return async_wrapper  # type: ignore[return-value]
        return sync_wrapper  # type: ignore[return-value]

    return decorator


@asynccontextmanager
async def trace_llm_call(
    model: str,
    system_prompt: str | None = None,
    user_prompt: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
):
    """
    Async context manager for LLM calls.

    Usage:
        async with neuralops.trace_llm_call("gpt-4o", user_prompt=query) as span:
            response = await openai_client.chat.completions.create(...)
            span.response_text = response.choices[0].message.content
            span.cost = neuralops.estimate_cost("gpt-4o", raw_response=response.model_dump())
    """
    ctx = get_current_context()
    span = LLMCallSpan(
        operation_name=f"llm.{model}",
        model=model,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=temperature,
        max_tokens=max_tokens,
        agent_id=ctx.agent_id if ctx else "unknown",
        agent_framework=ctx.agent_framework if ctx else "unknown",
        causal_chain_id=ctx.causal_chain_id if ctx else str(uuid.uuid4()),
        trace_id=ctx.trace_id if ctx else str(uuid.uuid4()),
        service_name=ctx.service_name if ctx else _default_service,
    )
    t0 = time.perf_counter()
    try:
        yield span
        span.status = SpanStatus.OK
        if span.cost is None and (user_prompt or system_prompt):
            span.cost = estimate_cost(
                model=model,
                prompt=f"{system_prompt or ''}\n{user_prompt or ''}",
                completion=span.response_text or "",
            )
    except Exception as exc:
        span.status = SpanStatus.ERROR
        span.error_message = str(exc)
        raise
    finally:
        span.ended_at = datetime.utcnow()
        span.duration_ms = (time.perf_counter() - t0) * 1000
        _emit(span)


@asynccontextmanager
async def trace_tool_call(
    tool_name: str,
    tool_input: dict[str, Any] | None = None,
    autonomous: bool = True,
):
    """
    Async context manager for tool calls.

    Usage:
        async with neuralops.trace_tool_call("web_search", {"query": q}) as span:
            result = await search(q)
            span.tool_output = result
    """
    ctx = get_current_context()
    span = ToolCallSpan(
        operation_name=f"tool.{tool_name}",
        tool_name=tool_name,
        tool_input=tool_input or {},
        autonomous=autonomous,
        agent_id=ctx.agent_id if ctx else "unknown",
        agent_framework=ctx.agent_framework if ctx else "unknown",
        causal_chain_id=ctx.causal_chain_id if ctx else str(uuid.uuid4()),
        trace_id=ctx.trace_id if ctx else str(uuid.uuid4()),
        service_name=ctx.service_name if ctx else _default_service,
    )
    t0 = time.perf_counter()
    try:
        yield span
        span.status = SpanStatus.OK
    except Exception as exc:
        span.status = SpanStatus.ERROR
        span.tool_error = str(exc)
        span.error_message = str(exc)
        raise
    finally:
        span.ended_at = datetime.utcnow()
        span.duration_ms = (time.perf_counter() - t0) * 1000
        _emit(span)


def _emit(span: Any) -> None:
    """Fire-and-forget span emission. Never blocks the agent."""
    if _exporter is None:
        return
    try:
        _exporter.enqueue(span)
    except Exception:
        pass  # observability must never crash the observed system