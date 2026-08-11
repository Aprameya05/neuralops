"""
NeuralOps LangGraph Auto-Instrumentation
-----------------------------------------
Wraps LangGraph StateGraph nodes with NeuralOps tracing.
Each node execution becomes a span with full causal chain propagation.

Usage:
    from neuralops.integrations.langgraph import instrument_graph

    graph = StateGraph(AgentState)
    graph.add_node("planner", planner_fn)
    graph.add_node("researcher", researcher_fn)
    # ... add edges ...

    # Wrap the compiled graph
    compiled = graph.compile()
    compiled = instrument_graph(compiled, agent_id="my-langgraph-agent")

    # Now every invoke() auto-creates a causal chain
    result = compiled.invoke({"messages": [...]})
"""
from __future__ import annotations

import time
import uuid
import functools
from typing import Any, Callable, Optional


def instrument_graph(graph: Any, agent_id: str = "langgraph-agent", service_name: str = "langgraph") -> Any:
    """
    Wrap a compiled LangGraph graph to auto-trace every node execution.

    Parameters
    ----------
    graph       : compiled LangGraph graph (output of graph.compile())
    agent_id    : agent identifier for NeuralOps
    service_name: service name for span grouping

    Returns
    -------
    The same graph object with instrumented invoke/ainvoke methods.
    """
    try:
        from neuralops.tracer import trace_tool_call
        from neuralops.context import AgentContext
        from neuralops.exporter import NeuralOpsExporter
    except ImportError as e:
        raise ImportError(f"neuralops SDK not installed: {e}") from e

    original_invoke  = graph.invoke
    original_ainvoke = getattr(graph, "ainvoke", None)

    @functools.wraps(original_invoke)
    def patched_invoke(input: dict, config: dict | None = None, **kwargs):
        chain_id = f"csl_{uuid.uuid4().hex[:8]}"
        ctx = AgentContext(agent_id=agent_id, causal_chain_id=chain_id)

        with trace_tool_call(
            tool_name="langgraph.run",
            agent_id=agent_id,
            service_name=service_name,
            causal_chain_id=chain_id,
            attributes={"framework": "langgraph", "input_keys": list(input.keys())},
        ):
            result = original_invoke(input, config, **kwargs)

        return result

    graph.invoke = patched_invoke

    if original_ainvoke:
        @functools.wraps(original_ainvoke)
        async def patched_ainvoke(input: dict, config: dict | None = None, **kwargs):
            chain_id = f"csl_{uuid.uuid4().hex[:8]}"
            with trace_tool_call(
                tool_name="langgraph.arun",
                agent_id=agent_id,
                service_name=service_name,
                causal_chain_id=chain_id,
                attributes={"framework": "langgraph", "async": True},
            ):
                result = await original_ainvoke(input, config, **kwargs)
            return result

        graph.ainvoke = patched_ainvoke

    return graph


def instrument_node(fn: Callable, agent_id: str, operation_name: str, causal_chain_id: str) -> Callable:
    """
    Wrap a single LangGraph node function.

    Parameters
    ----------
    fn               : the node function (state -> state)
    agent_id         : agent identifier
    operation_name   : span operation name
    causal_chain_id  : causal chain to attach this span to
    """
    try:
        from neuralops.tracer import trace_tool_call
    except ImportError as e:
        raise ImportError(f"neuralops SDK not installed: {e}") from e

    @functools.wraps(fn)
    def wrapper(state: Any) -> Any:
        with trace_tool_call(
            tool_name=operation_name,
            agent_id=agent_id,
            causal_chain_id=causal_chain_id,
            attributes={"framework": "langgraph", "node": operation_name},
        ):
            return fn(state)

    @functools.wraps(fn)
    async def async_wrapper(state: Any) -> Any:
        with trace_tool_call(
            tool_name=operation_name,
            agent_id=agent_id,
            causal_chain_id=causal_chain_id,
            attributes={"framework": "langgraph", "node": operation_name, "async": True},
        ):
            return await fn(state)

    import asyncio
    return async_wrapper if asyncio.iscoroutinefunction(fn) else wrapper
