"""
NeuralOps built-in agents — real AI agents using free LLM APIs.

Three agents, each with a distinct role:
  - PlannerAgent   — breaks a task into steps
  - ResearcherAgent— answers questions with reasoning
  - CriticAgent    — evaluates and scores any response

All fully instrumented with NeuralOps SDK — every call appears in the dashboard.
All use the smart router — auto-fallback, zero billing risk.
"""

from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass
from typing import Any

# Load .env if python-dotenv is available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import structlog

import neuralops
from neuralops import router
from neuralops.router import Provider

log = structlog.get_logger(__name__)


# ── Planner Agent ─────────────────────────────────────────────────────────

class PlannerAgent:
    """
    Breaks any task into a numbered execution plan.
    Uses the fastest available free model.
    """

    SYSTEM = """You are an expert planning agent. 
Given a task, produce a clear numbered step-by-step execution plan.
Be specific and actionable. Maximum 6 steps. No fluff."""

    def __init__(self, ctx: neuralops.AgentContext) -> None:
        self.ctx = ctx

    @neuralops.trace("planner.plan")
    async def plan(self, task: str) -> str:
        async with neuralops.trace_llm_call(
            "llama-3.3-70b",
            system_prompt=self.SYSTEM,
            user_prompt=task,
        ) as span:
            response = await router.chat(
                messages=[{"role": "user", "content": task}],
                system=self.SYSTEM,
                max_tokens=512,
                preferred_provider=Provider.CEREBRAS,
            )
            span.response_text = response.content
            span.attributes["provider"] = response.provider
            span.attributes["fallback_count"] = response.fallback_count
            span.cost = neuralops.estimate_cost(
                response.model,
                prompt_tokens=response.prompt_tokens,
                completion_tokens=response.completion_tokens,
            )

        return response.content


# ── Researcher Agent ──────────────────────────────────────────────────────

class ResearcherAgent:
    """
    Answers questions with structured reasoning.
    Prefers Gemini for its frontier quality on the free tier.
    """

    SYSTEM = """You are a precise research agent.
Answer questions with structured reasoning. Show your thinking step by step.
Be factual. Acknowledge uncertainty when it exists. Be concise."""

    def __init__(self, ctx: neuralops.AgentContext) -> None:
        self.ctx = ctx

    @neuralops.trace("researcher.answer")
    async def answer(self, question: str, context: str = "") -> str:
        prompt = question
        if context:
            prompt = f"Context:\n{context}\n\nQuestion:\n{question}"

        async with neuralops.trace_llm_call(
            "gemini-2.0-flash",
            system_prompt=self.SYSTEM,
            user_prompt=prompt,
        ) as span:
            response = await router.chat(
                messages=[{"role": "user", "content": prompt}],
                system=self.SYSTEM,
                max_tokens=768,
                preferred_provider=Provider.GEMINI,
            )
            span.response_text = response.content
            span.attributes["provider"] = response.provider
            span.cost = neuralops.estimate_cost(
                response.model,
                prompt_tokens=response.prompt_tokens,
                completion_tokens=response.completion_tokens,
            )

        return response.content


# ── Critic Agent ──────────────────────────────────────────────────────────

class CriticAgent:
    """
    Evaluates any response on accuracy, clarity, and completeness.
    Returns a structured score + feedback.
    """

    SYSTEM = """You are a rigorous critic agent.
Evaluate the given response on three dimensions:
1. Accuracy (0-10): Is it factually correct?
2. Clarity (0-10): Is it easy to understand?
3. Completeness (0-10): Does it fully address the question?

Respond in this exact format:
ACCURACY: <score>/10 — <one line reason>
CLARITY: <score>/10 — <one line reason>
COMPLETENESS: <score>/10 — <one line reason>
OVERALL: <score>/10
VERDICT: <one sentence summary>"""

    def __init__(self, ctx: neuralops.AgentContext) -> None:
        self.ctx = ctx

    @neuralops.trace("critic.evaluate")
    async def evaluate(self, question: str, response: str) -> dict[str, Any]:
        prompt = f"Original question:\n{question}\n\nResponse to evaluate:\n{response}"

        async with neuralops.trace_llm_call(
            "mistral-small-latest",
            system_prompt=self.SYSTEM,
            user_prompt=prompt,
        ) as span:
            result = await router.chat(
                messages=[{"role": "user", "content": prompt}],
                system=self.SYSTEM,
                max_tokens=256,
                preferred_provider=Provider.MISTRAL,
            )
            span.response_text = result.content
            span.attributes["provider"] = result.provider
            span.cost = neuralops.estimate_cost(
                result.model,
                prompt_tokens=result.prompt_tokens,
                completion_tokens=result.completion_tokens,
            )

        return {
            "raw": result.content,
            "provider": result.provider,
            "latency_ms": result.latency_ms,
        }


# ── Orchestrator — runs all three agents in sequence ──────────────────────

@dataclass
class OrchestrationResult:
    task: str
    plan: str
    research: str
    critique: dict[str, Any]
    causal_chain_id: str
    total_cost_usd: float


async def run_full_pipeline(task: str) -> OrchestrationResult:
    """
    Full multi-agent pipeline:
      1. Planner breaks the task into steps
      2. Researcher answers the task
      3. Critic evaluates the researcher's answer

    Every span is traced and linked via causal_chain_id.
    """
    ctx = neuralops.init(
        endpoint=os.environ.get("NEURALOPS_ENDPOINT", "http://localhost:8000"),
        service="neuralops-agents",
        agent_id="orchestrator",
        framework="neuralops-native",
    )

    planner    = PlannerAgent(ctx)
    researcher = ResearcherAgent(ctx)
    critic     = CriticAgent(ctx)

    log.info("pipeline.start", task=task[:80], causal_chain_id=ctx.causal_chain_id)

    plan      = await planner.plan(task)
    research  = await researcher.answer(task, context=plan)
    critique  = await critic.evaluate(task, research)

    log.info("pipeline.complete", causal_chain_id=ctx.causal_chain_id)

    return OrchestrationResult(
        task=task,
        plan=plan,
        research=research,
        critique=critique,
        causal_chain_id=ctx.causal_chain_id,
        total_cost_usd=0.0,  # all free models
    )


# ── CLI entrypoint ────────────────────────────────────────────────────────

async def main() -> None:
    task = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else (
        "What are the most important engineering decisions when building "
        "a distributed AI agent observability platform?"
    )

    print(f"\nTask: {task}\n")
    print("Running multi-agent pipeline...\n")

    result = await run_full_pipeline(task)

    print("PLAN:")
    print(result.plan)
    print("\nRESEARCH:")
    print(result.research)
    print("\nCRITIQUE:")
    print(result.critique["raw"])
    print(f"\nCausal chain ID: {result.causal_chain_id}")
    print(f"Dashboard: http://localhost:3000/replay/{result.causal_chain_id}")


if __name__ == "__main__":
    asyncio.run(main())
