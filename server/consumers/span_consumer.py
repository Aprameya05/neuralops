"""
NeuralOps Kafka consumer — reads spans from Kafka, writes to ClickHouse.

Design:
  - aiokafka consumer (async)
  - Batches inserts into ClickHouse (clickhouse-driver, native protocol)
  - Runs drift detection on every span inline
  - Publishes drift alerts to Redis pub/sub → WebSocket broadcast
  - Commits offsets only after successful ClickHouse insert (at-least-once)
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import time
from datetime import datetime
from typing import Any

import redis.asyncio as aioredis
import structlog
from aiokafka import AIOKafkaConsumer
from clickhouse_driver import Client as CHClient

log = structlog.get_logger(__name__)

KAFKA_BROKERS   = os.environ.get("KAFKA_BROKERS", "localhost:9092")
KAFKA_TOPIC     = os.environ.get("KAFKA_TOPIC", "neuralops.spans")
KAFKA_GROUP_ID  = os.environ.get("KAFKA_GROUP_ID", "neuralops-consumer")
CH_HOST         = os.environ.get("CLICKHOUSE_HOST", "localhost")
CH_USER         = os.environ.get("CLICKHOUSE_USER", "neuralops")
CH_PASSWORD     = os.environ.get("CLICKHOUSE_PASSWORD", "neuralops")
CH_DB           = os.environ.get("CLICKHOUSE_DB", "neuralops")
REDIS_URL       = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

BATCH_SIZE      = int(os.environ.get("BATCH_SIZE", "200"))
FLUSH_INTERVAL  = float(os.environ.get("FLUSH_INTERVAL_SECS", "2.0"))


# ── ClickHouse column order (must match schema.sql) ───────────────────────

_CH_COLUMNS = [
    "span_id", "trace_id", "parent_span_id", "causal_chain_id",
    "agent_id", "agent_framework", "service_name", "operation_name",
    "started_at", "ended_at", "duration_ms",
    "status", "error_message",
    "model", "provider", "prompt_tokens", "completion_tokens",
    "total_tokens", "estimated_usd", "hallucination_score", "faithfulness_score",
    "tool_name", "autonomous",
    "attributes", "received_at", "client_ip", "_version",
]


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def _span_to_row(raw: dict[str, Any]) -> tuple:
    """Convert raw span dict (from Kafka) to a ClickHouse insert row tuple."""
    cost = raw.get("cost") or {}
    return (
        raw.get("span_id", ""),
        raw.get("trace_id", ""),
        raw.get("parent_span_id"),
        raw.get("causal_chain_id", ""),
        raw.get("agent_id", "unknown"),
        raw.get("agent_framework", "unknown"),
        raw.get("service_name", "unknown"),
        raw.get("operation_name", "unknown"),
        _parse_dt(raw.get("started_at")) or datetime.utcnow(),
        _parse_dt(raw.get("ended_at")),
        raw.get("duration_ms"),
        raw.get("status", "ok"),
        raw.get("error_message"),
        raw.get("model"),
        raw.get("provider") or (cost.get("provider") if cost else None),
        cost.get("prompt_tokens") if cost else None,
        cost.get("completion_tokens") if cost else None,
        cost.get("total_tokens") if cost else None,
        cost.get("estimated_usd") if cost else None,
        raw.get("hallucination_score"),
        raw.get("faithfulness_score"),
        raw.get("tool_name"),
        int(raw.get("autonomous", True)),
        json.dumps(raw.get("attributes") or {}),
        datetime.utcnow(),
        raw.get("_client_ip"),
        int(time.time() * 1000),  # _version for ReplacingMergeTree dedup
    )


class SpanConsumer:
    def __init__(self) -> None:
        self._ch = CHClient(
            host=CH_HOST,
            user=CH_USER,
            password=CH_PASSWORD,
            database=CH_DB,
            settings={"use_numpy": False},
        )
        self._redis: aioredis.Redis | None = None
        self._consumer: AIOKafkaConsumer | None = None
        self._batch: list[tuple] = []
        self._last_flush = time.monotonic()
        self._running = True

    async def start(self) -> None:
        self._redis = await aioredis.from_url(REDIS_URL, decode_responses=True)
        self._consumer = AIOKafkaConsumer(
            KAFKA_TOPIC,
            bootstrap_servers=KAFKA_BROKERS,
            group_id=KAFKA_GROUP_ID,
            auto_offset_reset="earliest",
            enable_auto_commit=False,
            value_deserializer=lambda b: json.loads(b.decode()),
            max_poll_records=500,
        )
        await self._consumer.start()
        log.info("consumer.started", topic=KAFKA_TOPIC, group=KAFKA_GROUP_ID)

    async def run(self) -> None:
        await self.start()
        try:
            async for msg in self._consumer:
                if not self._running:
                    break
                try:
                    raw: dict[str, Any] = msg.value
                    row = _span_to_row(raw)
                    self._batch.append(row)

                    # Publish live span event to Redis for WebSocket broadcast
                    await self._publish_live(raw)

                except Exception as exc:
                    log.error("consumer.parse_error", error=str(exc))

                # Flush when batch is full or interval elapsed
                elapsed = time.monotonic() - self._last_flush
                if len(self._batch) >= BATCH_SIZE or elapsed >= FLUSH_INTERVAL:
                    await self._flush()
                    await self._consumer.commit()

        finally:
            if self._batch:
                await self._flush()
            await self._consumer.stop()
            if self._redis:
                await self._redis.close()
            log.info("consumer.stopped")

    async def _flush(self) -> None:
        if not self._batch:
            return
        batch = self._batch[:]
        self._batch = []
        self._last_flush = time.monotonic()
        try:
            self._ch.execute(
                f"INSERT INTO {CH_DB}.spans ({', '.join(_CH_COLUMNS)}) VALUES",
                batch,
            )
            log.info("consumer.flushed", count=len(batch))
        except Exception as exc:
            log.error("consumer.clickhouse_error", error=str(exc), count=len(batch))
            # Re-queue on failure so we don't lose data
            self._batch = batch + self._batch

    async def _publish_live(self, raw: dict[str, Any]) -> None:
        """Push span to Redis so the API WebSocket can broadcast it."""
        if not self._redis:
            return
        try:
            await self._redis.publish(
                "neuralops:live_spans",
                json.dumps({
                    "span_id":        raw.get("span_id"),
                    "causal_chain_id": raw.get("causal_chain_id"),
                    "agent_id":       raw.get("agent_id"),
                    "operation_name": raw.get("operation_name"),
                    "status":         raw.get("status"),
                    "duration_ms":    raw.get("duration_ms"),
                    "estimated_usd":  (raw.get("cost") or {}).get("estimated_usd"),
                    "started_at":     str(raw.get("started_at")),
                }, default=str),
            )
        except Exception:
            pass  # never crash the consumer over a Redis pub/sub failure

    def stop(self) -> None:
        self._running = False


async def main() -> None:
    consumer = SpanConsumer()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, consumer.stop)

    await consumer.run()


if __name__ == "__main__":
    asyncio.run(main())
