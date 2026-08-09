"""
NeuralOps Cloud API — uses Redis Streams instead of Kafka, Neon Postgres instead of ClickHouse.
Fully free, forever.
"""

from __future__ import annotations

import json
import os
import time
from contextlib import asynccontextmanager
from typing import Any

import asyncpg
import redis.asyncio as aioredis
import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

log = structlog.get_logger(__name__)

REDIS_URL    = os.environ.get("REDIS_URL", "")
POSTGRES_URL = os.environ.get("POSTGRES_URL", "")
STREAM_KEY   = "neuralops:spans"

_redis: aioredis.Redis | None = None
_pg: asyncpg.Pool | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _redis, _pg
    _redis = await aioredis.from_url(REDIS_URL, decode_responses=True)
    _pg = await asyncpg.create_pool(POSTGRES_URL, min_size=2, max_size=10)
    log.info("neuralops.cloud.started")
    yield
    if _redis:
        await _redis.close()
    if _pg:
        await _pg.close()
    log.info("neuralops.cloud.stopped")


app = FastAPI(title="NeuralOps Cloud API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Ingest ────────────────────────────────────────────────────────────────

@app.get("/v1/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/ingest")
async def ingest(request: Request, body: list[dict[str, Any]]) -> dict[str, Any]:
    if not body:
        raise HTTPException(status_code=400, detail="Empty batch")

    accepted = 0
    for span in body:
        if not isinstance(span, dict) or "span_id" not in span:
            continue
        span["_received_at"] = time.time()
        span["_client_ip"] = request.client.host if request.client else ""
        await _redis.xadd(STREAM_KEY, {"data": json.dumps(span, default=str)})
        accepted += 1

    return {"accepted": accepted, "rejected": len(body) - accepted}


# ── Query routes ──────────────────────────────────────────────────────────

@app.get("/v1/traces/")
async def list_traces(limit: int = 50, offset: int = 0) -> dict[str, Any]:
    rows = await _pg.fetch(
        """
        SELECT
            causal_chain_id,
            min(started_at)          AS started_at,
            count(*)                 AS span_count,
            sum(duration_ms)         AS total_duration_ms,
            sum(estimated_usd)       AS total_cost_usd,
            array_agg(DISTINCT agent_id) AS agent_ids,
            count(*) FILTER (WHERE status='error') AS error_count,
            max(hallucination_score) AS max_hallucination
        FROM spans
        GROUP BY causal_chain_id
        ORDER BY started_at DESC
        LIMIT $1 OFFSET $2
        """,
        limit, offset
    )
    return {"traces": [dict(r) for r in rows], "limit": limit, "offset": offset}


@app.get("/v1/traces/{causal_chain_id}/replay")
async def replay_trace(causal_chain_id: str) -> dict[str, Any]:
    rows = await _pg.fetch(
        """
        SELECT * FROM spans
        WHERE causal_chain_id = $1
        ORDER BY started_at ASC
        """,
        causal_chain_id
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Causal chain not found")

    spans = [dict(r) for r in rows]
    total_cost = sum(s.get("estimated_usd") or 0 for s in spans)
    agent_ids = list(set(s["agent_id"] for s in spans))
    has_errors = any(s["status"] == "error" for s in spans)

    return {
        "causal_chain_id": causal_chain_id,
        "spans": spans,
        "total_spans": len(spans),
        "total_cost_usd": total_cost,
        "agent_ids": agent_ids,
        "has_errors": has_errors,
    }


@app.get("/v1/traces/cost/summary")
async def cost_summary(hours: int = 24) -> list[dict[str, Any]]:
    rows = await _pg.fetch(
        """
        SELECT
            agent_id,
            model,
            date_trunc('hour', started_at) AS hour,
            count(*)                        AS calls,
            sum(total_tokens)               AS tokens,
            sum(estimated_usd)              AS cost_usd
        FROM spans
        WHERE started_at >= NOW() - INTERVAL '1 hour' * $1
          AND model != ''
        GROUP BY agent_id, model, hour
        ORDER BY hour DESC, cost_usd DESC
        """,
        hours
    )
    return [dict(r) for r in rows]


@app.get("/v1/traces/agents/summary")
async def agents_summary() -> list[dict[str, Any]]:
    rows = await _pg.fetch(
        """
        SELECT
            agent_id,
            agent_framework,
            service_name,
            count(*)                                    AS total_spans,
            count(*) FILTER (WHERE status='error')      AS error_spans,
            sum(estimated_usd)                          AS total_cost_usd,
            avg(duration_ms)                            AS avg_latency_ms,
            max(started_at)                             AS last_seen,
            count(DISTINCT causal_chain_id)             AS total_chains
        FROM spans
        GROUP BY agent_id, agent_framework, service_name
        ORDER BY last_seen DESC
        LIMIT 200
        """
    )
    return [dict(r) for r in rows]


@app.get("/v1/traces/drift/alerts")
async def drift_alerts(hours: int = 1) -> list[dict[str, Any]]:
    rows = await _pg.fetch(
        """
        SELECT
            operation_name,
            agent_id,
            count(*)                                AS total,
            count(*) FILTER (WHERE status='error')  AS errors,
            count(*) FILTER (WHERE status='error')::float / count(*) AS error_rate,
            avg(duration_ms)                        AS avg_latency_ms,
            max(duration_ms)                        AS p100_latency_ms
        FROM spans
        WHERE started_at >= NOW() - INTERVAL '1 hour' * $1
        GROUP BY operation_name, agent_id
        HAVING count(*) FILTER (WHERE status='error')::float / count(*) > 0.05
        ORDER BY error_rate DESC
        LIMIT 100
        """,
        hours
    )
    return [dict(r) for r in rows]


# ── Agent routes ──────────────────────────────────────────────────────────

@app.post("/v1/agents/run")
async def run_pipeline(body: dict[str, Any]) -> dict[str, Any]:
    task = body.get("task", "").strip()
    if not task:
        raise HTTPException(status_code=400, detail="Task cannot be empty")

    import sys
    sys.path.insert(0, ".")
    sys.path.insert(0, "./sdk")

    from dotenv import load_dotenv
    load_dotenv()

    from server.agents.pipeline import PlannerAgent, ResearcherAgent, CriticAgent
    import neuralops

    ctx = neuralops.init(
        endpoint=os.environ.get("NEURALOPS_ENDPOINT", "http://localhost:8000"),
        service="neuralops-agents",
        agent_id="orchestrator",
        framework="neuralops-native",
    )

    planner    = PlannerAgent(ctx)
    researcher = ResearcherAgent(ctx)
    critic     = CriticAgent(ctx)

    import time
    t0 = time.perf_counter()
    plan     = await planner.plan(task)
    research = await researcher.answer(task, context=plan)
    critique = await critic.evaluate(task, research)

    return {
        "causal_chain_id": ctx.causal_chain_id,
        "plan":     {"agent": "Planner",    "content": plan,             "latency_ms": 0},
        "research": {"agent": "Researcher", "content": research,         "latency_ms": 0},
        "critique": {"agent": "Critic",     "content": critique["raw"],  "latency_ms": 0},
        "total_latency_ms": (time.perf_counter() - t0) * 1000,
    }


@app.post("/v1/agents/benchmark")
async def run_benchmark(body: dict[str, Any]) -> dict[str, Any]:
    prompt = body.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    import sys
    sys.path.insert(0, ".")
    sys.path.insert(0, "./sdk")

    from dotenv import load_dotenv
    load_dotenv()

    from server.agents.benchmark import BenchmarkArena
    arena = BenchmarkArena()
    result = await arena.run(prompt)

    return {
        "prompt": result.prompt,
        "winner": str(result.winner),
        "total_duration_ms": result.total_duration_ms,
        "results": [
            {
                "provider":       str(r.provider),
                "model":          r.model,
                "content":        r.content,
                "latency_ms":     r.latency_ms,
                "quality_score":  r.quality_score,
                "error":          r.error,
            }
            for r in result.results
        ],
    }
