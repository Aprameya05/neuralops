"""
NeuralOps CrewAI Auto-Instrumentation
---------------------------------------
Wraps CrewAI Task execution and Crew kickoff with NeuralOps tracing.
Each task becomes a span; the full crew run becomes a causal chain.

Usage:
    from neuralops.integrations.crewai import instrument_crew

    crew = Crew(
        agents=[researcher, writer],
        tasks=[research_task, write_task],
        process=Process.sequential,
    )

    # Instrument the crew before kickoff
    instrument_crew(crew, crew_name="content-generation-crew")

    # Now every kickoff() auto-traces each task
    result = crew.kickoff(inputs={"topic": "AI observability"})
"""
from __future__ import annotations

import uuid
import time
import functools
from typing import Any, Callable, Optional


def instrument_crew(crew: Any, crew_name: str = "crewai-crew", service_name: str = "crewai") -> Any:
    """
    Instrument a CrewAI Crew instance.

    Parameters
    ----------
    crew        : CrewAI Crew instance
    crew_name   : name for the orchestrator span
    service_name: service name for grouping
    """
    try:
        from neuralops.tracer import trace_tool_call, trace_llm_call
    except ImportError as e:
        raise ImportError(f"neuralops SDK not installed: {e}") from e

    original_kickoff = crew.kickoff
    original_kickoff_async = getattr(crew, "kickoff_async", None)

    @functools.wraps(original_kickoff)
    def patched_kickoff(inputs: dict | None = None, **kwargs):
        chain_id = f"csl_{uuid.uuid4().hex[:8]}"
        crew._neuralops_chain_id = chain_id

        # Instrument each task
        _instrument_tasks(crew, chain_id, service_name)

        t0 = time.time()
        with trace_tool_call(
            tool_name=f"{crew_name}.kickoff",
            agent_id=crew_name,
            service_name=service_name,
            causal_chain_id=chain_id,
            attributes={
                "framework": "crewai",
                "task_count": len(getattr(crew, "tasks", [])),
                "agent_count": len(getattr(crew, "agents", [])),
                "process": str(getattr(crew, "process", "sequential")),
                "inputs": str(inputs or {})[:200],
            },
        ):
            result = original_kickoff(inputs=inputs, **kwargs)
        return result

    crew.kickoff = patched_kickoff

    if original_kickoff_async:
        @functools.wraps(original_kickoff_async)
        async def patched_kickoff_async(inputs: dict | None = None, **kwargs):
            chain_id = f"csl_{uuid.uuid4().hex[:8]}"
            crew._neuralops_chain_id = chain_id
            _instrument_tasks(crew, chain_id, service_name)

            with trace_tool_call(
                tool_name=f"{crew_name}.kickoff_async",
                agent_id=crew_name,
                service_name=service_name,
                causal_chain_id=chain_id,
                attributes={"framework": "crewai", "async": True},
            ):
                result = await original_kickoff_async(inputs=inputs, **kwargs)
            return result

        crew.kickoff_async = patched_kickoff_async

    return crew


def _instrument_tasks(crew: Any, chain_id: str, service_name: str) -> None:
    """Patch each task's execute method to emit a span."""
    try:
        from neuralops.tracer import trace_tool_call
    except ImportError:
        return

    tasks = getattr(crew, "tasks", [])
    for task in tasks:
        if getattr(task, "_neuralops_instrumented", False):
            continue

        original_execute = getattr(task, "execute_sync", None) or getattr(task, "_execute", None)
        if not original_execute:
            continue

        method_name = "execute_sync" if hasattr(task, "execute_sync") else "_execute"
        agent = getattr(task, "agent", None)
        agent_name = getattr(agent, "role", "crewai-agent") if agent else "crewai-agent"
        task_desc = str(getattr(task, "description", "task"))[:80]

        def make_patched(orig, _agent_name, _task_desc, _chain_id, _service_name):
            @functools.wraps(orig)
            def patched(*args, **kwargs):
                with trace_tool_call(
                    tool_name=f"crewai.task",
                    agent_id=_agent_name,
                    service_name=_service_name,
                    causal_chain_id=_chain_id,
                    attributes={
                        "framework": "crewai",
                        "task_description": _task_desc,
                    },
                ):
                    return orig(*args, **kwargs)
            return patched

        setattr(task, method_name, make_patched(original_execute, agent_name, task_desc, chain_id, service_name))
        task._neuralops_instrumented = True


def instrument_agent(agent: Any, service_name: str = "crewai") -> Any:
    """
    Instrument a single CrewAI Agent to trace its LLM calls.
    """
    try:
        from neuralops.tracer import trace_llm_call
    except ImportError:
        return agent

    role = getattr(agent, "role", "crewai-agent")

    original_execute_task = getattr(agent, "execute_task", None)
    if original_execute_task:
        @functools.wraps(original_execute_task)
        def patched_execute_task(task, context=None, tools=None):
            chain_id = getattr(agent, "_neuralops_chain_id", f"csl_{uuid.uuid4().hex[:8]}")
            with trace_tool_call(
                tool_name="crewai.agent.execute",
                agent_id=role,
                service_name=service_name,
                causal_chain_id=chain_id,
                attributes={"framework": "crewai", "role": role},
            ):
                return original_execute_task(task, context=context, tools=tools)
        agent.execute_task = patched_execute_task

    return agent
