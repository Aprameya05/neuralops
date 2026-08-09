"""
Query routes — the dashboard calls these to fetch traces, spans, and cost data.

All queries hit ClickHouse directly via HTTP interface for read performance.
Writes always go through Kafka → consumer.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from engine.causal_stitcher import CausalStitcher

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/v1/traces", tags=["traces"])

CH_HTTP = os.environ.get("CLICKHOUSE_HTTP_URL", "http://localhost:8123")
CH_USER = os.environ.get("CLICKHOUSE_USER", "neuralops")
CH_PASS = os.environ.get("CLICKHOUSE_PASSWORD", "neuralops")

_stitcher = CausalStitcher()


async def _ch_query(sql: str) -> list[dict[str, Any]]:
    """Execute a ClickHouse query over HTTP and return rows as dicts."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            CH_HTTP,
            content=sql + " FORMAT JSONEachRow",
            auth=(CH_USER, CH_PASS),
            headers={"Content-Type": "text/plain"},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"ClickHouse error: {resp.text[:200]}")
        rows = []
        for line in resp.text.strip().splitlines():
            if line.strip():
                import json
                rows.append(json.loads(line))
        return rows


# ── Routes ────────────────────────────────────────────────────────────────

@router.get("/")
async def list_traces(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    agent_id: str | None = None,
    status: str | None = None,
    service: str | None = None,
) -> dict[str, Any]:
    """List recent causal chains with summary stats."""
    where_clauses = ["1=1"]
    if agent_id:
        where_clauses.append(f"agent_id = '{agent_id}'")
    if status:
        where_clauses.append(f"status = '{status}'")
    if service:
        where_clauses.append(f"service_name = '{service}'")
    where = " AND ".join(where_clauses)

    sql = f"""
        SELECT
            causal_chain_id,
            min(started_at)          AS started_at,
            max(ended_at)            AS ended_at,
            count()                  AS span_count,
            sum(duration_ms)         AS total_duration_ms,
            sum(estimated_usd)       AS total_cost_usd,
            groupUniqArray(agent_id) AS agent_ids,
            countIf(status='error')  AS error_count,
            max(hallucination_score) AS max_hallucination
        FROM neuralops.spans
        WHERE {where}
        GROUP BY causal_chain_id
        ORDER BY started_at DESC
        LIMIT {limit} OFFSET {offset}
    """
    rows = await _ch_query(sql)
    return {"traces": rows, "limit": limit, "offset": offset}


@router.get("/{causal_chain_id}/replay")
async def replay_trace(causal_chain_id: str) -> dict[str, Any]:
    """
    Return the full causal graph for a chain — the core 'why did it do that' view.
    """
    graph = _stitcher.build(causal_chain_id)
    if graph.total_spans == 0:
        raise HTTPException(status_code=404, detail="Causal chain not found")
    return graph.to_dict()


@router.get("/cost/summary")
async def cost_summary(
    hours: int = Query(24, ge=1, le=168),
) -> list[dict[str, Any]]:
    """Hourly cost breakdown by agent and model."""
    sql = f"""
        SELECT
            agent_id,
            model,
            toStartOfHour(started_at) AS hour,
            count()                   AS calls,
            sum(total_tokens)         AS tokens,
            sum(estimated_usd)        AS cost_usd
        FROM neuralops.spans
        WHERE started_at >= now() - INTERVAL {hours} HOUR
          AND model IS NOT NULL
        GROUP BY agent_id, model, hour
        ORDER BY hour DESC, cost_usd DESC
    """
    return await _ch_query(sql)


@router.get("/drift/alerts")
async def drift_alerts(
    hours: int = Query(1, ge=1, le=24),
) -> list[dict[str, Any]]:
    """Operations with error rate above threshold in the last N hours."""
    sql = f"""
        SELECT
            operation_name,
            agent_id,
            count()                  AS total,
            countIf(status='error')  AS errors,
            countIf(status='error') / count() AS error_rate,
            avg(duration_ms)         AS avg_latency_ms,
            max(duration_ms)         AS p100_latency_ms
        FROM neuralops.spans
        WHERE started_at >= now() - INTERVAL {hours} HOUR
        GROUP BY operation_name, agent_id
        HAVING error_rate > 0.05 OR p100_latency_ms > avg_latency_ms * 5
        ORDER BY error_rate DESC
        LIMIT 100
    """
    return await _ch_query(sql)


@router.get("/agents/summary")
async def agents_summary() -> list[dict[str, Any]]:
    """Per-agent summary: span count, cost, error rate, last seen."""
    sql = """
        SELECT
            agent_id,
            agent_framework,
            service_name,
            count()                                AS total_spans,
            countIf(status='error')                AS error_spans,
            sum(estimated_usd)                     AS total_cost_usd,
            avg(duration_ms)                       AS avg_latency_ms,
            max(started_at)                        AS last_seen,
            count(DISTINCT causal_chain_id)        AS total_chains
        FROM neuralops.spans
        GROUP BY agent_id, agent_framework, service_name
        ORDER BY last_seen DESC
        LIMIT 200
    """
    return await _ch_query(sql)
