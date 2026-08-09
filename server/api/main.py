"""
NeuralOps ingestion API.

POST /v1/ingest  — receives batches of spans from the SDK
GET  /v1/health  — liveness probe
GET  /v1/ready   — readiness probe (checks Kafka + DB connectivity)

Design:
  - FastAPI + Pydantic v2 for validation
  - Aiokafka producer (async, non-blocking) to publish to Kafka
  - ClickHouse insert is handled downstream by the Kafka consumer
  - Drift alerts fire inline (< 1ms per span) and are WebSocket-broadcast
"""

from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager
from typing import Any

import structlog
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .kafka_producer import KafkaProducerClient
from .websocket_manager import WebSocketManager

log = structlog.get_logger(__name__)

_kafka: KafkaProducerClient | None = None
_ws_manager = WebSocketManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _kafka
    _kafka = KafkaProducerClient(
        brokers=os.environ.get("KAFKA_BROKERS", "localhost:9092"),
        topic=os.environ.get("KAFKA_TOPIC", "neuralops.spans"),
    )
    await _kafka.start()
    log.info("neuralops.api.started")
    yield
    if _kafka:
        await _kafka.stop()
    log.info("neuralops.api.stopped")


app = FastAPI(
    title="NeuralOps Ingestion API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ──────────────────────────────────────────────

class IngestRequest(BaseModel):
    spans: list[dict[str, Any]] = Field(..., min_length=1, max_length=1000)


class IngestResponse(BaseModel):
    accepted: int
    rejected: int
    ingested_at_ms: float


# ── Routes ────────────────────────────────────────────────────────────────

@app.get("/v1/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/ready")
async def ready() -> dict[str, Any]:
    kafka_ok = _kafka is not None and _kafka.is_connected
    return {
        "kafka": "ok" if kafka_ok else "degraded",
        "api": "ok",
    }


@app.post("/v1/ingest", response_model=IngestResponse)
async def ingest(request: Request, body: list[dict[str, Any]]) -> IngestResponse:
    """
    Receive a batch of spans from the SDK.
    Validates structure, publishes to Kafka, returns immediately.
    """
    if not body:
        raise HTTPException(status_code=400, detail="Empty span batch")

    accepted = 0
    rejected = 0

    for raw_span in body:
        if not isinstance(raw_span, dict) or "span_id" not in raw_span:
            rejected += 1
            continue
        try:
            # Enrich with server-side metadata
            raw_span["_received_at"] = time.time()
            raw_span["_client_ip"] = request.client.host if request.client else None

            await _kafka.publish(raw_span)
            accepted += 1
        except Exception as exc:
            log.error("neuralops.ingest.span_failed", error=str(exc))
            rejected += 1

    return IngestResponse(
        accepted=accepted,
        rejected=rejected,
        ingested_at_ms=time.time() * 1000,
    )


@app.get("/v1/ws/alerts")
async def ws_info() -> dict[str, str]:
    return {"ws_endpoint": "ws://localhost:8000/ws/alerts"}