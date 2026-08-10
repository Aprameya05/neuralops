"""
NeuralOps Cloud API -- FastAPI + Redis Streams consumer in one process.

Improvements over v1:
  - Shared asyncpg pool injected into vector_search (no per-call pool creation)
  - Inline embedding indexing after each consumer flush
  - WebSocket endpoint for live trace streaming
  - Prometheus metrics wired to real span data
  - gRPC ingestion server running alongside HTTP
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
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

log = structlog.get_logger(__name__)

REDIS_URL    = os.environ.get("REDIS_URL", "")
POSTGRES_URL = os.environ.get("POSTGRES_URL", "")
STREAM_KEY   = "neuralops:spans"
GROUP_NAME   = "neuralops-consumer"
CONSUMER     = "consumer-1"

_redis: aioredis.Redis | None = None
_pg: asyncpg.Pool | None = None

# WebSocket connection registry
_ws_clients: set[WebSocket] = set()


# ---------------------------------------------------------------------------
# WebSocket broadcast helper
# ---------------------------------------------------------------------------

async def _broadcast(payload: dict) -> None:
    """Broadcast a span event to all connected WebSocket clients."""
    if not _ws_clients:
        return
    msg = json.dumps(payload, default=str)
    dead: set[WebSocket] = set()
    for ws in _ws_clients:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.add(ws)
    _ws_clients.difference_update(dead)


# ---------------------------------------------------------------------------
# Consumer group setup
# ---------------------------------------------------------------------------

async def ensure_consumer_group() -> None:
    try:
        await _redis.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Background consumer loop
# ---------------------------------------------------------------------------

async def consumer_loop() -> None:
    """
    Reads from Redis Streams, writes to Postgres, indexes embeddings,
    and broadcasts to WebSocket clients.
    """
    await ensure_consumer_group()
    log.info("consumer.started")

    # Import here to avoid circular import at module level
    from engine.vector_search import index_span, set_pool as vs_set_pool
    vs_set_pool(_pg)  # inject shared pool
    from engine.causal_attribution import set_pool as attr_set_pool
    attr_set_pool(_pg)
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

                    # Index embeddings for the flushed batch (non-blocking)
                    asyncio.create_task(_index_batch(batch, index_span))

                    # Broadcast last span to WebSocket clients
                    if batch:
                        asyncio.create_task(_broadcast({
                            "event": "span",
                            "data": {
                                "span_id": batch[-1].get("span_id"),
                                "causal_chain_id": batch[-1].get("causal_chain_id"),
                                "agent_id": batch[-1].get("agent_id"),
                                "operation_name": batch[-1].get("operation_name"),
                                "status": batch[-1].get("status"),
                                "duration_ms": batch[-1].get("duration_ms"),
                            }
                        }))

                    # Update Prometheus counters
                    _update_metrics(batch)

                except Exception as exc:
                    log.error("consumer.flush_error", error=str(exc))

                batch = []
                ids = []
                last_flush = time.monotonic()

        except Exception as exc:
            log.error("consumer.loop_error", error=str(exc))
            await asyncio.sleep(1)


async def _index_batch(batch: list[dict], index_fn) -> None:
    """Fire-and-forget embedding indexing for a flushed batch."""
    for raw in batch:
        try:
            await index_fn(raw, _pg)
        except Exception as exc:
            log.warning("consumer.index_error", span_id=raw.get("span_id"), error=str(exc))


# ---------------------------------------------------------------------------
# Prometheus metrics
# ---------------------------------------------------------------------------

try:
    from prometheus_client import Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST
    _PROM_AVAILABLE = True
except ImportError:
    _PROM_AVAILABLE = False
    log.warning("prometheus_client not installed; /metrics will return empty")

if _PROM_AVAILABLE:
    _spans_ingested   = Counter("neuralops_spans_ingested_total", "Total spans ingested", ["agent_id", "status"])
    _spans_per_minute = Gauge("neuralops_spans_per_minute", "Spans ingested in the last minute")
    _cost_usd_total   = Counter("neuralops_cost_usd_total", "Total estimated USD cost", ["agent_id", "model"])
    _latency_ms       = Histogram("neuralops_span_latency_ms", "Span duration in ms",
                                  buckets=[10, 50, 100, 250, 500, 1000, 2000, 5000, 10000])
    _error_rate       = Gauge("neuralops_error_rate", "Current error rate (0-1)")
    _active_agents    = Gauge("neuralops_active_agents", "Number of distinct agents seen in last 5 minutes")

    _recent_span_times: list[float] = []  # timestamps for rolling SPM
    _recent_errors: list[bool] = []       # for rolling error rate

def _update_metrics(batch: list[dict]) -> None:
    if not _PROM_AVAILABLE:
        return
    now = time.monotonic()
    for raw in batch:
        agent  = raw.get("agent_id", "unknown")
        status = raw.get("status", "ok")
        model  = raw.get("model", "unknown")
        cost   = (raw.get("cost") or {}).get("estimated_usd") or 0.0
        dur    = raw.get("duration_ms") or 0.0

        _spans_ingested.labels(agent_id=agent, status=status).inc()
        if cost:
            _cost_usd_total.labels(agent_id=agent, model=model).inc(cost)
        if dur:
            _latency_ms.observe(dur)

        _recent_span_times.append(now)
        _recent_errors.append(status == "error")

    # Trim to last 60 seconds
    cutoff = now - 60.0
    while _recent_span_times and _recent_span_times[0] < cutoff:
        _recent_span_times.pop(0)
        _recent_errors.pop(0)

    _spans_per_minute.set(len(_recent_span_times))
    if _recent_errors:
        _error_rate.set(sum(_recent_errors) / len(_recent_errors))


# ---------------------------------------------------------------------------
# gRPC ingestion server
# ---------------------------------------------------------------------------

async def _start_grpc_server() -> None:
    """
    Start gRPC server on port 50051.
    Proto: neuralops.proto (IngestSpan, IngestBatch, IngestResponse)
    Falls back gracefully if grpcio or proto stubs not installed.
    """
    try:
        import grpc
        from grpc import aio as grpc_aio
        from api import neuralops_pb2, neuralops_pb2_grpc

        class NeuralOpsServicer(neuralops_pb2_grpc.NeuralOpsIngestServicer):
            async def IngestBatch(self, request, context):
                accepted = 0
                for span_proto in request.spans:
                    try:
                        raw = {
                            "span_id":        span_proto.span_id,
                            "trace_id":       span_proto.trace_id,
                            "causal_chain_id":span_proto.causal_chain_id,
                            "agent_id":       span_proto.agent_id,
                            "operation_name": span_proto.operation_name,
                            "status":         span_proto.status,
                            "duration_ms":    span_proto.duration_ms,
                            "model":          span_proto.model,
                            "error_message":  span_proto.error_message,
                            "_received_at":   time.time(),
                            "_transport":     "grpc",
                        }
                        await _redis.xadd(STREAM_KEY, {"data": json.dumps(raw, default=str)})
                        accepted += 1
                    except Exception:
                        pass
                return neuralops_pb2.IngestResponse(accepted=accepted, rejected=len(request.spans) - accepted)

        server = grpc_aio.server()
        neuralops_pb2_grpc.add_NeuralOpsIngestServicer_to_server(NeuralOpsServicer(), server)
        server.add_insecure_port("[::]:50051")
        await server.start()
        log.info("grpc.server.started", port=50051)
        await server.wait_for_termination()

    except ImportError:
        log.warning("grpc.unavailable", reason="grpcio or proto stubs not installed; HTTP ingestion still works")
    except Exception as exc:
        log.error("grpc.start_error", error=str(exc))


# ---------------------------------------------------------------------------
# App lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _redis, _pg
    _redis = await aioredis.from_url(REDIS_URL, decode_responses=True)
    _pg    = await asyncpg.create_pool(POSTGRES_URL, min_size=2, max_size=10)

    consumer_task = asyncio.create_task(consumer_loop())
    grpc_task     = asyncio.create_task(_start_grpc_server())

    log.info("neuralops.cloud.started")
    yield

    consumer_task.cancel()
    grpc_task.cancel()
    await _redis.close()
    await _pg.close()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="NeuralOps Cloud API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@app.get("/v1/health")
async def health() -> dict:
    return {"status": "ok", "version": "0.2.0"}


@app.post("/v1/ingest")
async def ingest(request: Request, body: list[dict[str, Any]]) -> dict:
    if not body:
        raise HTTPException(status_code=400, detail="Empty batch")
    accepted = 0
    for span in body:
        if not isinstance(span, dict) or "span_id" not in span:
            continue
        span["_received_at"] = time.time()
        span["_client_ip"]   = request.client.host if request.client else ""
        await _redis.xadd(STREAM_KEY, {"data": json.dumps(span, default=str)})
        accepted += 1
    return {"accepted": accepted, "rejected": len(body) - accepted}


@app.get("/v1/traces/")
async def list_traces(limit: int = 50, offset: int = 0) -> dict:
    rows = await _pg.fetch(
        """SELECT causal_chain_id,
                  min(started_at) AS started_at,
                  count(*) AS span_count,
                  sum(duration_ms) AS total_duration_ms,
                  sum(estimated_usd) AS total_cost_usd,
                  array_agg(DISTINCT agent_id) AS agent_ids,
                  count(*) FILTER (WHERE status='error') AS error_count,
                  max(status) AS status
           FROM spans
           GROUP BY causal_chain_id
           ORDER BY started_at DESC
           LIMIT $1 OFFSET $2""",
        limit, offset,
    )
    return {"traces": [dict(r) for r in rows], "limit": limit, "offset": offset}


@app.get("/v1/traces/{causal_chain_id}/replay")
async def replay_trace(causal_chain_id: str) -> dict:
    rows = await _pg.fetch(
        "SELECT * FROM spans WHERE causal_chain_id=$1 ORDER BY started_at ASC",
        causal_chain_id,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Not found")
    spans = [dict(r) for r in rows]
    return {
        "causal_chain_id": causal_chain_id,
        "spans": spans,
        "total_spans": len(spans),
        "total_cost_usd": sum(s.get("estimated_usd") or 0 for s in spans),
        "agent_ids": list({s["agent_id"] for s in spans}),
        "has_errors": any(s["status"] == "error" for s in spans),
    }


@app.get("/v1/traces/cost/summary")
async def cost_summary(hours: int = 24) -> list:
    rows = await _pg.fetch(
        """SELECT agent_id, model,
                  date_trunc('hour', started_at) AS hour,
                  count(*) AS calls,
                  sum(total_tokens) AS tokens,
                  sum(estimated_usd) AS cost_usd
           FROM spans
           WHERE started_at >= NOW() - INTERVAL '1 hour' * $1
             AND model != ''
           GROUP BY agent_id, model, hour
           ORDER BY hour DESC, cost_usd DESC""",
        hours,
    )
    return [dict(r) for r in rows]


@app.get("/v1/traces/agents/summary")
async def agents_summary() -> list:
    rows = await _pg.fetch(
        """SELECT agent_id, agent_framework, service_name,
                  count(*) AS total_spans,
                  count(*) FILTER (WHERE status='error') AS error_spans,
                  CASE WHEN count(*) > 0
                       THEN count(*) FILTER (WHERE status='error')::float / count(*)
                       ELSE 0 END AS error_rate,
                  sum(estimated_usd) AS total_cost_usd,
                  avg(duration_ms) AS avg_latency_ms,
                  max(started_at) AS last_seen,
                  count(DISTINCT causal_chain_id) AS total_chains
           FROM spans
           GROUP BY agent_id, agent_framework, service_name
           ORDER BY last_seen DESC
           LIMIT 200"""
    )
    return [dict(r) for r in rows]


@app.get("/v1/traces/drift/alerts")
async def drift_alerts(hours: int = 1) -> list:
    rows = await _pg.fetch(
        """SELECT operation_name, agent_id,
                  count(*) AS total,
                  count(*) FILTER (WHERE status='error') AS errors,
                  count(*) FILTER (WHERE status='error')::float / count(*) AS error_rate,
                  avg(duration_ms) AS avg_latency_ms,
                  max(duration_ms) AS p100_latency_ms
           FROM spans
           WHERE started_at >= NOW() - INTERVAL '1 hour' * $1
           GROUP BY operation_name, agent_id
           HAVING count(*) FILTER (WHERE status='error')::float / count(*) > 0.05
           ORDER BY error_rate DESC
           LIMIT 100""",
        hours,
    )
    return [dict(r) for r in rows]
# Add these endpoints to cloud_main.py
# Place after the drift_alerts endpoint and before the spans/timeseries endpoint

@app.get("/v1/traces/{causal_chain_id}/attribution")
async def causal_attribution(
    causal_chain_id: str,
    error_span_id: str | None = None,
) -> dict:
    """
    Root cause attribution for a causal chain.

    Scores every upstream span by its causal contribution to the failure
    using a composite of temporal proximity, error propagation, latency
    anomaly, and structural centrality signals.

    Returns ranked list of likely root causes with confidence score.

    Example:
        GET /v1/traces/csl_65a1b2/attribution
        GET /v1/traces/csl_65a1b2/attribution?error_span_id=spn_abc123
    """
    from engine.causal_attribution import CausalAttributionEngine
    engine = CausalAttributionEngine(_pg)
    report = await engine.attribute(causal_chain_id, error_span_id)
    return {
        "causal_chain_id":  report.causal_chain_id,
        "error_span_id":    report.error_span_id,
        "error_operation":  report.error_operation,
        "total_spans":      report.total_spans,
        "confidence":       report.confidence,
        "summary":          report.summary,
        "root_cause": {
            "span_id":           report.root_cause.span_id,
            "operation_name":    report.root_cause.operation_name,
            "agent_id":          report.root_cause.agent_id,
            "status":            report.root_cause.status,
            "duration_ms":       report.root_cause.duration_ms,
            "attribution_score": report.root_cause.attribution_score,
            "explanation":       report.root_cause.explanation,
        } if report.root_cause else None,
        "ranked_causes": [
            {
                "span_id":           r.span_id,
                "operation_name":    r.operation_name,
                "agent_id":          r.agent_id,
                "status":            r.status,
                "duration_ms":       r.duration_ms,
                "attribution_score": r.attribution_score,
                "temporal_score":    r.temporal_score,
                "error_score":       r.error_score,
                "latency_score":     r.latency_score,
                "centrality_score":  r.centrality_score,
                "descendant_count":  r.descendant_count,
                "explanation":       r.explanation,
            }
            for r in report.ranked_causes
        ],
    }


@app.get("/v1/traces/{causal_chain_id}/diff")
async def trace_diff(
    causal_chain_id: str,
    compare_to: str,
) -> dict:
    """
    Structural diff between two causal chains.

    Compares operation sequences, agent participation, latency profiles,
    and cost distribution between two chains. Highlights divergence points.

    Example:
        GET /v1/traces/csl_abc/diff?compare_to=csl_xyz
    """
    from engine.trace_diff import TraceDiffEngine
    engine = TraceDiffEngine(_pg)
    diff = await engine.diff(causal_chain_id, compare_to)
    return diff
@app.get("/v1/traces/spans/timeseries")
async def spans_timeseries(minutes: int = 30) -> list:
    rows = await _pg.fetch(
        """
        SELECT
            date_trunc('minute', started_at) AS bucket,
            count(*) AS spans,
            count(*) FILTER (WHERE status = 'error') AS errors
        FROM spans
        WHERE started_at >= NOW() - INTERVAL '1 minute' * $1
        GROUP BY bucket
        ORDER BY bucket ASC
        """,
        minutes,
    )
    return [
        {
            "time": r["bucket"].strftime("%H:%M"),
            "spans": r["spans"],
            "errors": r["errors"],
        }
        for r in rows
    ]
@app.get("/v1/agents/fingerprint")
async def agent_fingerprint(hours: int = 24) -> dict:
    """
    Behavioral fingerprinting and clustering of all agents.

    Extracts behavioral signatures from trace patterns and clusters
    agents by similarity. Identifies archetypes, redundancy, and
    anomalous agents.

    Example:
        GET /v1/agents/fingerprint?hours=24
    """
    from engine.agent_fingerprint import AgentFingerprintEngine
    engine = AgentFingerprintEngine(_pg)
    report = await engine.fingerprint(hours)
    return {
        "summary": report.summary,
        "fingerprints": [
            {
                "agent_id":          fp.agent_id,
                "agent_framework":   fp.agent_framework,
                "archetype":         fp.archetype,
                "total_spans":       fp.total_spans,
                "total_chains":      fp.total_chains,
                "avg_latency_ms":    fp.avg_latency_ms,
                "p95_latency_ms":    fp.p95_latency_ms,
                "error_rate":        fp.error_rate,
                "tool_affinity":     fp.tool_affinity,
                "avg_cost_per_span": fp.avg_cost_per_span,
                "spans_per_chain":   fp.spans_per_chain,
                "top_operations":    [{"op": op, "fraction": frac} for op, frac in fp.top_operations],
                "signature":         fp.signature,
            }
            for fp in report.fingerprints
        ],
        "similarities": [
            {
                "agent_a":    s.agent_a,
                "agent_b":    s.agent_b,
                "similarity": s.similarity,
                "shared_ops": s.shared_ops,
                "explanation":s.explanation,
            }
            for s in report.similarities
        ],
        "clusters": [
            {
                "cluster_id":  c.cluster_id,
                "archetype":   c.archetype,
                "agents":      c.agents,
                "cohesion":    c.cohesion,
                "description": c.description,
            }
            for c in report.clusters
        ],
    }
# ---------------------------------------------------------------------------
# Prometheus /metrics endpoint
# ---------------------------------------------------------------------------

@app.get("/metrics")
async def metrics():
    from fastapi.responses import Response
    if not _PROM_AVAILABLE:
        return Response("# prometheus_client not installed\n", media_type="text/plain")

    # Pull live stats from Postgres into gauges before scraping
    try:
        row = await _pg.fetchrow(
            """SELECT
                 count(DISTINCT agent_id) AS agent_count,
                 count(*) FILTER (WHERE started_at >= NOW() - INTERVAL '5 minutes') AS recent_spans,
                 count(*) FILTER (WHERE status='error' AND started_at >= NOW() - INTERVAL '5 minutes') AS recent_errors
               FROM spans"""
        )
        if row:
            _active_agents.set(row["agent_count"] or 0)
            recent = row["recent_spans"] or 0
            errors = row["recent_errors"] or 0
            if recent > 0:
                _error_rate.set(errors / recent)
    except Exception as exc:
        log.warning("metrics.db_error", error=str(exc))

    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ---------------------------------------------------------------------------
# WebSocket live trace stream
# ---------------------------------------------------------------------------

@app.websocket("/ws/traces")
async def ws_traces(websocket: WebSocket):
    """
    WebSocket endpoint for live span streaming.
    Connect and receive JSON events as spans are ingested.

    Event format:
        {"event": "span", "data": {span_id, causal_chain_id, agent_id, ...}}
    """
    await websocket.accept()
    _ws_clients.add(websocket)
    try:
        # Send current stats on connect
        try:
            row = await _pg.fetchrow("SELECT count(*) AS total FROM spans")
            await websocket.send_text(json.dumps({
                "event": "connected",
                "data": {"total_spans": row["total"] if row else 0}
            }))
        except Exception:
            pass

        # Keep connection alive until client disconnects
        while True:
            await asyncio.sleep(30)
            await websocket.send_text(json.dumps({"event": "ping"}))

    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(websocket)


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

from api.metrics import router as metrics_router
from api.search_routes import router as search_router

app.include_router(metrics_router)
app.include_router(search_router)
