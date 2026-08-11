"""
NeuralOps AutoGen Auto-Instrumentation
----------------------------------------
Wraps AutoGen ConversableAgent to trace every message exchange
and tool invocation as a NeuralOps span.

Usage:
    from neuralops.integrations.autogen import instrument_agent

    assistant = AssistantAgent("assistant", llm_config={...})
    user_proxy = UserProxyAgent("user_proxy", ...)

    # Instrument both agents
    instrument_agent(assistant, agent_id="autogen-assistant")
    instrument_agent(user_proxy, agent_id="autogen-user-proxy")

    # Initiate chat — every message turn becomes a span
    user_proxy.initiate_chat(assistant, message="Analyze this dataset")
"""
from __future__ import annotations

import uuid
import time
import functools
from typing import Any, Callable, Optional


def instrument_agent(agent: Any, agent_id: str | None = None, service_name: str = "autogen") -> Any:
    """
    Monkey-patch a ConversableAgent to auto-trace message generation.

    Parameters
    ----------
    agent       : AutoGen ConversableAgent instance
    agent_id    : override name (defaults to agent.name)
    service_name: service name for grouping
    """
    try:
        from neuralops.tracer import trace_llm_call
        from neuralops.context import AgentContext
    except ImportError as e:
        raise ImportError(f"neuralops SDK not installed: {e}") from e

    _agent_id = agent_id or getattr(agent, "name", "autogen-agent")

    # Patch generate_reply
    original_generate_reply = agent.generate_reply

    @functools.wraps(original_generate_reply)
    def patched_generate_reply(messages=None, sender=None, **kwargs):
        chain_id = getattr(agent, "_neuralops_chain_id", f"csl_{uuid.uuid4().hex[:8]}")
        agent._neuralops_chain_id = chain_id

        t0 = time.time()
        try:
            result = original_generate_reply(messages=messages, sender=sender, **kwargs)
            duration_ms = (time.time() - t0) * 1000

            # Extract content for token estimation
            content = result if isinstance(result, str) else str(result)
            estimated_tokens = len(content.split()) * 1.3

            with trace_llm_call(
                operation_name="autogen.generate_reply",
                agent_id=_agent_id,
                service_name=service_name,
                causal_chain_id=chain_id,
                model=_get_model(agent),
                prompt_tokens=sum(len(str(m.get("content", "")).split()) for m in (messages or [])),
                completion_tokens=int(estimated_tokens),
                duration_ms=duration_ms,
                response_text=content[:500],
                attributes={
                    "framework": "autogen",
                    "sender": getattr(sender, "name", str(sender)) if sender else None,
                    "message_count": len(messages or []),
                },
            ):
                pass  # span already recorded above

            return result

        except Exception as exc:
            duration_ms = (time.time() - t0) * 1000
            raise

    agent.generate_reply = patched_generate_reply
    return agent


def _get_model(agent: Any) -> str:
    """Extract model name from AutoGen agent config."""
    try:
        llm_config = getattr(agent, "llm_config", {}) or {}
        config_list = llm_config.get("config_list", [{}])
        return config_list[0].get("model", "unknown") if config_list else "unknown"
    except Exception:
        return "unknown"


def instrument_group_chat(group_chat_manager: Any, service_name: str = "autogen") -> Any:
    """
    Instrument an AutoGen GroupChatManager to trace multi-agent conversations
    as a single causal chain with per-agent spans.
    """
    chain_id = f"csl_{uuid.uuid4().hex[:8]}"

    # Attach chain_id to all agents in the group
    if hasattr(group_chat_manager, "groupchat"):
        for agent in group_chat_manager.groupchat.agents:
            agent._neuralops_chain_id = chain_id
            instrument_agent(agent, service_name=service_name)

    return group_chat_manager
