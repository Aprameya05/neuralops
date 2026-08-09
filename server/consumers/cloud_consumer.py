"""
NeuralOps Cloud Consumer — reads spans from Redis Streams, writes to Neon Postgres.
Replaces Kafka + ClickHouse with Redis Streams + Postgres. Fully free forever.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from typing import Any

import asyncpg
import redis.asyncio as aioredis
import structlog
from dotenv import load_dotenv

load_dotenv()

log = structlog.get_logger(__name__)

REDIS_URL    = os.environ.get("REDIS_URL", "")
POSTGRES_URL = os.environ.get("POSTGRES_URL", "")
STREAM_KEY   = "neuralops:spans"
GROUP_NAME   = "neuralops-consumer"
CONSUMER     = "consumer-1"
BATCH_SIZE   = 100
FLUSH_INTERVAL = 2.0


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


async def ensure_consumer_group(redis: aioredis.Redis) -> None:
    try:
        await redis.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
    except Exception:
        pass  # group already exists


async def write_spans_to_postgres(pg: asyncpg.Pool, spans: list[dict[str, Any]]) -> None:
    if not spans:
        return

    rows = []
    for raw in spans:
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
            _parse_dt(raw.get("started_at")) or datetime.now(timezone.utc),
            _parse_dt(raw.get("ended_at")),
            raw.get("duration_ms"),
            raw.get("status") or "ok",
            raw.get("error_message") or "",
            raw.get("model") or "",
            raw.get("provider") or (cost.get("provider") if cost else "") or "",
            cost.get("prompt_tokens") if cost else None,
            cost.get("completion_tokens") if cost else None,
            cost.get("total_tokens") if cost else None,
            cost.get("estimated_usd") if cost else None,
            raw.get("hallucination_score"),
            raw.get("faithfulness_score"),
            raw.get("tool_name") or "",
            int(raw.get("autonomous", True)),
            json.dumps(raw.get("attributes") or {}),
            datetime.now(timezone.utc),
            raw.get("_client_ip") or "",
        ))

    await pg.executemany(
        """
        INSERT INTO spans (
            span_id, trace_id, parent_span_id, causal_chain_id,
            agent_id, agent_framework, service_name, operation_name,
            started_at, ended_at, duration_ms,
            status, error_message,
            model, provider, prompt_tokens, completion_tokens, total_tokens, estimated_usd,
            hallucination_score, faithfulness_score,
            tool_name, autonomous, attributes, received_at, client_ip
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26
        )
        ON CONFLICT (span_id) DO NOTHING
        """,
        rows,
    )
    log.info("consumer.flushed", count=len(rows))


async def run() -> None:
    redis = await aioredis.from_url(REDIS_URL, decode_responses=True)
    pg    = await asyncpg.create_pool(POSTGRES_URL, min_size=2, max_size=5)

    await ensure_consumer_group(redis)
    log.info("consumer.started", stream=STREAM_KEY, group=GROUP_NAME)

    batch: list[dict[str, Any]] = []
    message_ids: list[str] = []
    last_flush = time.monotonic()

    while True:
        try:
            messages = await redis.xreadgroup(
                GROUP_NAME, CONSUMER,
                {STREAM_KEY: ">"},
                count=BATCH_SIZE,
                block=2000,
            )

            if messages:
                for stream_name, entries in messages:
                    for msg_id, fields in entries:
                        try:
                            span = json.loads(fields["data"])
                            batch.append(span)
                            message_ids.append(msg_id)
                        except Exception as exc:
                            log.error("consumer.parse_error", error=str(exc))

            elapsed = time.monotonic() - last_flush
            if len(batch) >= BATCH_SIZE or (elapsed >= FLUSH_INTERVAL and batch):
                try:
                    await write_spans_to_postgres(pg, batch)
                    # Acknowledge messages
                    if message_ids:
                        await redis.xack(STREAM_KEY, GROUP_NAME, *message_ids)
                    batch = []
                    message_ids = []
                    last_flush = time.monotonic()
                except Exception as exc:
                    log.error("consumer.flush_error", error=str(exc))

        except Exception as exc:
            log.error("consumer.loop_error", error=str(exc))
            await asyncio.sleep(1)


if __name__ == "__main__":
    asyncio.run(run())
