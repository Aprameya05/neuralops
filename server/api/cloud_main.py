"""
NeuralOps Cloud API — FastAPI + Redis Streams consumer in one process.
Uses Redis Streams instead of Kafka, Neon Postgres instead of ClickHouse.
Fully free forever on Render free tier.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import asyncpg
import redis.asyncio as aioredis
import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

log = structlog.get_logger(__name__)

REDIS_URL    = os.environ.get("REDIS_URL", "")
POSTGRES_URL = os.environ.get("POSTGRES_URL", "")
STREAM_KEY   = "neuralops:spans"
GROUP_NAME   = "neuralops-consumer"
CONSUMER     = "consumer-1"

_redis: aioredis.Redis | None = None
_pg: asyncpg.Pool | None = None


async def ensure_consumer_group() -> None:
    try:
        await _redis.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
    except Exception:
        pass


async def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


async def consumer_loop() -> None:
    """Background consumer — reads from Redis Streams, writes to Postgres."""
    await ensure_consumer_group()
    log.info("consumer.started")
    batch: list[dict] = []
    ids: list[str] = []
    last_flush = time.monotonic()

    while True:
        try:
            messages = await _redis.xreadgroup(
                GROUP_NAME, CONSUMER,
                {STREAM_KEY: ">"},
                count=100, block=2000,
            )
            if messages:
                for _, entries in messages:
                    for msg_id, fields in entries:
                        try:
                            batch.append(json.loads(fields["data"]))
                            ids.append(msg_id)
                        except Exception:
                            pass

            elapsed = time.monotonic() - last_flush
            if batch and (len(batch) >= 100 or elapsed >= 2.0):
                rows = []
                for raw in batch:
                    cost = raw.get("cost") or {}
                    rows.append((
                        raw.get("span_id") or "",
                        raw.get("trace_id") or "",
                        raw.get("parent_span_id") or "",
                        raw.get("causal_chain_id") or "",
                        raw.get("agent_id") or "unknown",
                        raw.get("agent_framework") or "unknown",
                        raw.get("service_name") or "unknown",
                        raw.get("operation_name") or "unknown",
                        datetime.now(timezone.utc),
                        None,
                        raw.get("duration_ms"),
                        raw.get("status") or "ok",
                        raw.get("error_message") or "",
                        raw.get("model") or "",
                        cost.get("provider") or "",
                        cost.get("prompt_tokens"),
                        cost.get("completion_tokens"),
                        cost.get("total_tokens"),
                        cost.get("estimated_usd"),
                        raw.get("hallucination_score"),
                        raw.get("faithfulness_score"),
                        raw.get("tool_name") or "",
                        int(raw.get("autonomous", True)),
                        json.dumps(raw.get("attributes") or {}),
                        datetime.now(timezone.utc),
                        raw.get("_client_ip") or "",
                    ))
                try:
                    await _pg.executemany(
                        """INSERT INTO spans (
                            span_id,trace_id,parent_span_id,causal_chain_id,
                            agent_id,agent_framework,service_name,operation_name,
                            started_at,ended_at,duration_ms,status,error_message,
                            model,provider,prompt_tokens,completion_tokens,
                            total_tokens,estimated_usd,hallucination_score,
                            faithfulness_score,tool_name,autonomous,attributes,
                            received_at,client_ip
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                                  $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
                        ON CONFLICT (span_id) DO NOTHING""",
                        rows,
                    )
                    if ids:
                        await _redis.xack(STREAM_KEY, GROUP_NAME, *ids)
                    log.info("consumer.flushed", count=len(rows))
                except Exception as exc:
                    log.error("consumer.flush_error", error=str(exc))
                batch = []
                ids = []
                last_flush = time.monotonic()

        except Exception as exc:
            log.error("consumer.loop_error", error=str(exc))
            await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _redis, _pg
    _redis = await aioredis.from_url(REDIS_URL, decode_responses=True)
    _pg = await asyncpg.create_pool(POSTGRES_URL, min_size=2, max_size=10)
    # Start consumer in background
    task = asyncio.create_task(consumer_loop())
    log.info("neuralops.cloud.started")
    yield
    task.cancel()
    await _redis.close()
    await _pg.close()


app = FastAPI(title="NeuralOps Cloud API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/v1/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/v1/ingest")
async def ingest(request: Request, body: list[dict[str, Any]]) -> dict:
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


@app.get("/v1/traces/")
async def list_traces(limit: int = 50, offset: int = 0) -> dict:
    rows = await _pg.fetch(
        """SELECT causal_chain_id, min(started_at) AS started_at,
           count(*) AS span_count, sum(duration_ms) AS total_duration_ms,
           sum(estimated_usd) AS total_cost_usd,
           array_agg(DISTINCT agent_id) AS agent_ids,
           count(*) FILTER (WHERE status='error') AS error_count
           FROM spans GROUP BY causal_chain_id
           ORDER BY started_at DESC LIMIT $1 OFFSET $2""",
        limit, offset
    )
    return {"traces": [dict(r) for r in rows], "limit": limit, "offset": offset}


@app.get("/v1/traces/{causal_chain_id}/replay")
async def replay_trace(causal_chain_id: str) -> dict:
    rows = await _pg.fetch(
        "SELECT * FROM spans WHERE causal_chain_id=$1 ORDER BY started_at ASC",
        causal_chain_id
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Not found")
    spans = [dict(r) for r in rows]
    return {
        "causal_chain_id": causal_chain_id,
        "spans": spans,
        "total_spans": len(spans),
        "total_cost_usd": sum(s.get("estimated_usd") or 0 for s in spans),
        "agent_ids": list(set(s["agent_id"] for s in spans)),
        "has_errors": any(s["status"] == "error" for s in spans),
    }


@app.get("/v1/traces/cost/summary")
async def cost_summary(hours: int = 24) -> list:
    rows = await _pg.fetch(
        """SELECT agent_id, model, date_trunc('hour', started_at) AS hour,
           count(*) AS calls, sum(total_tokens) AS tokens, sum(estimated_usd) AS cost_usd
           FROM spans WHERE started_at >= NOW() - INTERVAL '1 hour' * $1 AND model != ''
           GROUP BY agent_id, model, hour ORDER BY hour DESC, cost_usd DESC""",
        hours
    )
    return [dict(r) for r in rows]


@app.get("/v1/traces/agents/summary")
async def agents_summary() -> list:
    rows = await _pg.fetch(
        """SELECT agent_id, agent_framework, service_name, count(*) AS total_spans,
           count(*) FILTER (WHERE status='error') AS error_spans,
           sum(estimated_usd) AS total_cost_usd, avg(duration_ms) AS avg_latency_ms,
           max(started_at) AS last_seen, count(DISTINCT causal_chain_id) AS total_chains
           FROM spans GROUP BY agent_id, agent_framework, service_name
           ORDER BY last_seen DESC LIMIT 200"""
    )
    return [dict(r) for r in rows]


@app.get("/v1/traces/drift/alerts")
async def drift_alerts(hours: int = 1) -> list:
    rows = await _pg.fetch(
        """SELECT operation_name, agent_id, count(*) AS total,
           count(*) FILTER (WHERE status='error') AS errors,
           count(*) FILTER (WHERE status='error')::float / count(*) AS error_rate,
           avg(duration_ms) AS avg_latency_ms, max(duration_ms) AS p100_latency_ms
           FROM spans WHERE started_at >= NOW() - INTERVAL '1 hour' * $1
           GROUP BY operation_name, agent_id
           HAVING count(*) FILTER (WHERE status='error')::float / count(*) > 0.05
           ORDER BY error_rate DESC LIMIT 100""",
        hours
    )
    return [dict(r) for r in rows]
