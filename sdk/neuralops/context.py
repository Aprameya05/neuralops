"""
Agent context — propagates causal_chain_id, trace_id, and agent metadata
across async boundaries and across agent-to-agent handoffs.

Design decision: We use Python contextvars (not threading.local) so context
propagates correctly through asyncio tasks without leaking across requests.
"""

from __future__ import annotations

import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentContext:
    """
    Immutable(ish) context object attached to the current async execution.

    Pass this between agents to preserve the causal chain — when Agent B is
    spawned by Agent A, it should receive A's context so every span they emit
    shares the same causal_chain_id, making the full decision tree queryable.
    """
    causal_chain_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    trace_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    parent_span_id: str | None = None
    agent_id: str = "unknown"
    agent_framework: str = "unknown"
    service_name: str = "unknown"
    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def child(self, agent_id: str, framework: str = "unknown") -> "AgentContext":
        """Create a child context for a sub-agent, preserving the causal chain."""
        return AgentContext(
            causal_chain_id=self.causal_chain_id,  # same chain!
            trace_id=str(uuid.uuid4()),             # new trace per agent
            parent_span_id=None,
            agent_id=agent_id,
            agent_framework=framework,
            service_name=self.service_name,
            session_id=self.session_id,
            user_id=self.user_id,
            metadata={**self.metadata},
        )

    def to_headers(self) -> dict[str, str]:
        """Serialize context to HTTP headers for cross-process propagation."""
        return {
            "x-neuralops-causal-chain-id": self.causal_chain_id,
            "x-neuralops-trace-id": self.trace_id,
            "x-neuralops-session-id": self.session_id,
            "x-neuralops-agent-id": self.agent_id,
        }

    @classmethod
    def from_headers(cls, headers: dict[str, str]) -> "AgentContext":
        """Deserialize context from incoming HTTP headers (agent receives call)."""
        return cls(
            causal_chain_id=headers.get(
                "x-neuralops-causal-chain-id", str(uuid.uuid4())
            ),
            trace_id=str(uuid.uuid4()),
            session_id=headers.get("x-neuralops-session-id", str(uuid.uuid4())),
            agent_id=headers.get("x-neuralops-agent-id", "unknown"),
        )


# Module-level context var — safe for asyncio concurrency
_current_context: ContextVar[AgentContext | None] = ContextVar(
    "neuralops_context", default=None
)


def get_current_context() -> AgentContext | None:
    return _current_context.get()


def set_current_context(ctx: AgentContext) -> None:
    _current_context.set(ctx)