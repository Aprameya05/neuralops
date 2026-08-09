"""
Async Kafka producer — wraps aiokafka with connection management and backpressure.
"""

from __future__ import annotations

import json
from typing import Any

import structlog
from aiokafka import AIOKafkaProducer

log = structlog.get_logger(__name__)


class KafkaProducerClient:
    def __init__(self, brokers: str, topic: str) -> None:
        self._brokers = brokers
        self._topic = topic
        self._producer: AIOKafkaProducer | None = None

    @property
    def is_connected(self) -> bool:
        return self._producer is not None

    async def start(self) -> None:
        self._producer = AIOKafkaProducer(
            bootstrap_servers=self._brokers,
            value_serializer=lambda v: json.dumps(v, default=str).encode(),
            compression_type="lz4",
            linger_ms=10,        # small batching window — reduces overhead
            max_batch_size=16384,
            request_timeout_ms=10_000,
        )
        await self._producer.start()
        log.info("kafka.producer.started", brokers=self._brokers, topic=self._topic)

    async def stop(self) -> None:
        if self._producer:
            await self._producer.stop()
            self._producer = None

    async def publish(self, span: dict[str, Any], key: str | None = None) -> None:
        if not self._producer:
            raise RuntimeError("Kafka producer not started")
        key_bytes = key.encode() if key else span.get("causal_chain_id", "").encode()
        await self._producer.send_and_wait(
            self._topic,
            value=span,
            key=key_bytes or None,
        )