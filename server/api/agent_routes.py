"""
Agent API routes — called by the dashboard playground and arena pages.

POST /v1/agents/run       — runs the full 3-agent pipeline
POST /v1/agents/benchmark — runs benchmark arena across all providers
GET  /v1/agents/status    — health check for agent system
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Make sdk importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../sdk"))

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/v1/agents", tags=["agents"])


# ── Request / Response models ─────────────────────────────────────────────

class RunRequest(BaseModel):
    task: str
    preferred_provider: str | None = None


class BenchmarkRequest(BaseModel):
    prompt: str
    system: str = "You are a helpful, concise assistant."
    max_tokens: int = 512


class AgentStepResult(BaseModel):
    agent: str
    model: str
    provider: str
    content: str
    latency_ms: float


class RunResponse(BaseModel):
    causal_chain_id: str
    plan: AgentStepResult
    research: AgentStepResult
    critique: AgentStepResult
    total_latency_ms: float


class ProviderBenchmarkResult(BaseModel):
    provider: str
    model: str
    content: str
    latency_ms: float
    prompt_tokens: int
    completion_tokens: int
    quality_score: float | None
    accuracy: float | None
    clarity: float | None
    completeness: float | None
    error: str | None


class BenchmarkResponse(BaseModel):
    prompt: str
    winner: str | None
    total_duration_ms: float
    results: list[ProviderBenchmarkResult]


# ── Routes ────────────────────────────────────────────────────────────────

@router.get("/status")
async def agent_status() -> dict[str, Any]:
    """Check which providers are configured and available."""
    import neuralops.router as nr
    available = []
    for config in nr.PROVIDERS:
        key = os.environ.get(config.api_key_env, "")
        available.append({
            "provider": config.name,
            "model": config.model,
            "configured": bool(key),
            "available": nr._rate_tracker.is_available(config.name),
        })
    return {"providers": available, "total": len(available)}


@router.post("/run", response_model=RunResponse)
async def run_pipeline(req: RunRequest) -> RunResponse:
    """
    Run the full 3-agent pipeline (Planner → Researcher → Critic).
    Called by the dashboard playground page.
    """
    if not req.task or not req.task.strip():
        raise HTTPException(status_code=400, detail="Task cannot be empty")

    if len(req.task) > 2000:
        raise HTTPException(status_code=400, detail="Task too long (max 2000 chars)")

    t0 = time.perf_counter()

    try:
        from server.agents.pipeline import (
            PlannerAgent,
            ResearcherAgent,
            CriticAgent,
            run_full_pipeline,
        )
        import neuralops
        from neuralops import router as nr

        ctx = neuralops.init(
            endpoint=os.environ.get("NEURALOPS_ENDPOINT", "http://localhost:8000"),
            service="neuralops-agents",
            agent_id="orchestrator",
            framework="neuralops-native",
        )

        planner    = PlannerAgent(ctx)
        researcher = ResearcherAgent(ctx)
        critic     = CriticAgent(ctx)

        # Run sequentially — each agent builds on the previous
        t_plan = time.perf_counter()
        plan_text = await planner.plan(req.task)
        plan_ms = (time.perf_counter() - t_plan) * 1000

        t_res = time.perf_counter()
        research_text = await researcher.answer(req.task, context=plan_text)
        res_ms = (time.perf_counter() - t_res) * 1000

        t_crit = time.perf_counter()
        critique_data = await critic.evaluate(req.task, research_text)
        crit_ms = (time.perf_counter() - t_crit) * 1000

        total_ms = (time.perf_counter() - t0) * 1000

        return RunResponse(
            causal_chain_id=ctx.causal_chain_id,
            plan=AgentStepResult(
                agent="Planner",
                model="llama-3.3-70b-versatile",
                provider="groq",
                content=plan_text,
                latency_ms=round(plan_ms, 1),
            ),
            research=AgentStepResult(
                agent="Researcher",
                model="gemini-2.0-flash",
                provider=str(critique_data.get("provider", "groq")),
                content=research_text,
                latency_ms=round(res_ms, 1),
            ),
            critique=AgentStepResult(
                agent="Critic",
                model="mistral-small-latest",
                provider=str(critique_data.get("provider", "mistral")),
                content=critique_data["raw"],
                latency_ms=round(crit_ms, 1),
            ),
            total_latency_ms=round(total_ms, 1),
        )

    except Exception as exc:
        log.error("agents.run_failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/benchmark", response_model=BenchmarkResponse)
async def run_benchmark(req: BenchmarkRequest) -> BenchmarkResponse:
    """
    Run benchmark arena — same prompt across all providers simultaneously.
    Called by the dashboard arena page.
    """
    if not req.prompt or not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    if len(req.prompt) > 1000:
        raise HTTPException(status_code=400, detail="Prompt too long (max 1000 chars)")

    try:
        from server.agents.benchmark import BenchmarkArena

        arena = BenchmarkArena()
        result = await arena.run(
            prompt=req.prompt,
            system=req.system,
            max_tokens=req.max_tokens,
        )

        return BenchmarkResponse(
            prompt=result.prompt,
            winner=result.winner,
            total_duration_ms=round(result.total_duration_ms, 1),
            results=[
                ProviderBenchmarkResult(
                    provider=r.provider,
                    model=r.model,
                    content=r.content,
                    latency_ms=round(r.latency_ms, 1),
                    prompt_tokens=r.prompt_tokens,
                    completion_tokens=r.completion_tokens,
                    quality_score=r.quality_score,
                    accuracy=r.accuracy,
                    clarity=r.clarity,
                    completeness=r.completeness,
                    error=r.error,
                )
                for r in result.results
            ],
        )

    except Exception as exc:
        log.error("agents.benchmark_failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
