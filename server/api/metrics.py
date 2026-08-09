"""
NeuralOps Prometheus metrics endpoint.

Exposes standard Prometheus metrics at /metrics so any Grafana dashboard
can scrape NeuralOps span data without any additional configuration.

Metrics exposed:
    neuralops_spans_total              - total spans ingested (counter, by agent/status)
    neuralops_span_duration_ms         - span duration histogram (by operation)
    neuralops_llm_cost_usd_total       - total LLM cost in USD (counter, by model)
    neuralops_llm_tokens_total         - total tokens consumed (counter, by model)
    neuralops_error_rate               - error rate per operation (gauge)
    neuralops_active_agents            - number of active agents seen in last 5m (gauge)
    neuralops_hallucination_score_avg  - average hallucination score (gauge, by model)

Usage:
    Add to FastAPI app:
        from server.api.metrics import router as metrics_router
        app.include_router(metrics_router)

    Scrape with Prometheus:
        - job_name: neuralops
          static_configs:
            - targets: ['neuralops-api-cmgf.onrender.com']
          metrics_path: /metrics
"""

from __future__ import annotations

import os
import time
from typing import Any

import asyncpg
import structlog
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

log = structlog.get_logger(__name__)
router = APIRouter(tags=["metrics"])

POSTGRES_URL = os.environ.get("POSTGRES_URL", "")

_pg_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pg_pool
    if _pg_pool is None:
        _pg_pool = await asyncpg.create_pool(POSTGRES_URL, min_size=1, max_size=3)
    return _pg_pool


def _gauge(name: str, value: float, labels: dict[str, str] | None = None) -> str:
    label_str = ""
    if labels:
        pairs = ",".join(f'{k}="{v}"' for k, v in labels.items())
        label_str = f"{{{pairs}}}"
    return f"{name}{label_str} {value}"


def _counter(name: str, value: float, labels: dict[str, str] | None = None) -> str:
    return _gauge(name, value, labels)


@router.get("/metrics", response_class=PlainTextResponse)
async def prometheus_metrics() -> str:
    """
    Prometheus-compatible metrics endpoint.
    Scrape this with any Prometheus instance.
    """
    t0 = time.perf_counter()
    lines: list[str] = []
    pg = await get_pool()

    # ── spans total by agent and status ──────────────────────────────────
    lines.append("# HELP neuralops_spans_total Total spans ingested by agent and status")
    lines.append("# TYPE neuralops_spans_total counter")
    rows = await pg.fetch(
        """SELECT agent_id, status, count(*) AS cnt
           FROM spans GROUP BY agent_id, status"""
    )
    for row in rows:
        lines.append(_counter(
            "neuralops_spans_total", row["cnt"],
            {"agent_id": row["agent_id"], "status": row["status"]}
        ))

    # ── span duration histogram (simplified as summary) ───────────────────
    lines.append("# HELP neuralops_span_duration_ms_avg Average span duration in ms by operation")
    lines.append("# TYPE neuralops_span_duration_ms_avg gauge")
    rows = await pg.fetch(
        """SELECT operation_name, avg(duration_ms) AS avg_ms, max(duration_ms) AS max_ms
           FROM spans WHERE duration_ms IS NOT NULL
           GROUP BY operation_name"""
    )
    for row in rows:
        op = row["operation_name"]
        lines.append(_gauge(
            "neuralops_span_duration_ms_avg", round(row["avg_ms"] or 0, 2),
            {"operation": op}
        ))
        lines.append(_gauge(
            "neuralops_span_duration_ms_max", round(row["max_ms"] or 0, 2),
            {"operation": op}
        ))

    # ── LLM cost total ────────────────────────────────────────────────────
    lines.append("# HELP neuralops_llm_cost_usd_total Total LLM cost in USD by model")
    lines.append("# TYPE neuralops_llm_cost_usd_total counter")
    rows = await pg.fetch(
        """SELECT model, sum(estimated_usd) AS total_usd
           FROM spans WHERE model != '' AND estimated_usd IS NOT NULL
           GROUP BY model"""
    )
    for row in rows:
        lines.append(_counter(
            "neuralops_llm_cost_usd_total",
            round(row["total_usd"] or 0, 8),
            {"model": row["model"]}
        ))

    # ── LLM tokens total ─────────────────────────────────────────────────
    lines.append("# HELP neuralops_llm_tokens_total Total tokens consumed by model")
    lines.append("# TYPE neuralops_llm_tokens_total counter")
    rows = await pg.fetch(
        """SELECT model, sum(total_tokens) AS total
           FROM spans WHERE model != '' AND total_tokens IS NOT NULL
           GROUP BY model"""
    )
    for row in rows:
        lines.append(_counter(
            "neuralops_llm_tokens_total",
            int(row["total"] or 0),
            {"model": row["model"]}
        ))

    # ── error rate per operation ──────────────────────────────────────────
    lines.append("# HELP neuralops_error_rate Error rate per operation (0.0-1.0)")
    lines.append("# TYPE neuralops_error_rate gauge")
    rows = await pg.fetch(
        """SELECT operation_name,
           count(*) FILTER (WHERE status='error')::float / count(*) AS error_rate
           FROM spans GROUP BY operation_name"""
    )
    for row in rows:
        lines.append(_gauge(
            "neuralops_error_rate",
            round(row["error_rate"] or 0, 4),
            {"operation": row["operation_name"]}
        ))

    # ── active agents (seen in last 5 minutes) ────────────────────────────
    lines.append("# HELP neuralops_active_agents Number of agents active in last 5 minutes")
    lines.append("# TYPE neuralops_active_agents gauge")
    row = await pg.fetchrow(
        """SELECT count(DISTINCT agent_id) AS cnt
           FROM spans WHERE started_at >= NOW() - INTERVAL '5 minutes'"""
    )
    lines.append(_gauge("neuralops_active_agents", int(row["cnt"] or 0)))

    # ── hallucination score ───────────────────────────────────────────────
    lines.append("# HELP neuralops_hallucination_score_avg Avg hallucination score by model (0-1)")
    lines.append("# TYPE neuralops_hallucination_score_avg gauge")
    rows = await pg.fetch(
        """SELECT model, avg(hallucination_score) AS avg_score
           FROM spans WHERE model != '' AND hallucination_score IS NOT NULL
           GROUP BY model"""
    )
    for row in rows:
        lines.append(_gauge(
            "neuralops_hallucination_score_avg",
            round(row["avg_score"] or 0, 4),
            {"model": row["model"]}
        ))

    # ── scrape duration ───────────────────────────────────────────────────
    scrape_ms = (time.perf_counter() - t0) * 1000
    lines.append("# HELP neuralops_scrape_duration_ms Time to generate metrics in ms")
    lines.append("# TYPE neuralops_scrape_duration_ms gauge")
    lines.append(_gauge("neuralops_scrape_duration_ms", round(scrape_ms, 2)))

    return "\n".join(lines) + "\n"
