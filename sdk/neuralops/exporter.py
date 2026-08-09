"""
Async batching exporter — buffers spans and flushes in background.

Design goals:
  - Never block the calling thread/coroutine (queue-based)
  - Retry with exponential backoff on transient failures
  - Graceful drain on shutdown (atexit hook)
  - Zero data loss on normal shutdown (flush waits for queue drain)
"""

from __future__ import annotations

import atexit
import asyncio
import threading
from queue import Empty, Queue
from typing import Any

import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

log = structlog.get_logger(__name__)

_SENTINEL = object()


class SpanExporter:
    def __init__(
        self,
        endpoint: str,
        api_key: str | None = None,
        batch_size: int = 100,
        flush_interval_ms: int = 2000,
    ) -> None:
        self._endpoint = endpoint.rstrip("/") + "/v1/ingest"
        self._api_key = api_key
        self._batch_size = batch_size
        self._flush_interval = flush_interval_ms / 1000.0
        self._queue: Queue[Any] = Queue(maxsize=50_000)

        self._thread = threading.Thread(
            target=self._run_loop,
            name="neuralops-exporter",
            daemon=True,
        )
        self._thread.start()
        atexit.register(self._shutdown)

    def enqueue(self, span: Any) -> None:
        """Non-blocking enqueue. Drops span if queue is full (backpressure)."""
        try:
            self._queue.put_nowait(span)
        except Exception:
            log.warning("neuralops.exporter.queue_full", dropped=True)

    def _run_loop(self) -> None:
        """Background thread that batches and flushes spans."""
        batch: list[Any] = []
        while True:
            try:
                item = self._queue.get(timeout=self._flush_interval)
                if item is _SENTINEL:
                    self._flush(batch)
                    break
                batch.append(item)
                if len(batch) >= self._batch_size:
                    self._flush(batch)
                    batch = []
            except Empty:
                if batch:
                    self._flush(batch)
                    batch = []

    def _flush(self, batch: list[Any]) -> None:
        if not batch:
            return
        try:
            self._send(batch)
        except Exception as exc:
            log.error("neuralops.exporter.flush_failed", error=str(exc), count=len(batch))

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
        reraise=True,
    )
    def _send(self, batch: list[Any]) -> None:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        payload = [
            span.model_dump(mode="json", exclude_none=True)
            for span in batch
        ]

        with httpx.Client(timeout=10.0) as client:
            resp = client.post(self._endpoint, json=payload, headers=headers)
            resp.raise_for_status()

        log.debug("neuralops.exporter.flushed", count=len(batch))

    def _shutdown(self) -> None:
        self._queue.put(_SENTINEL)
        self._thread.join(timeout=5.0)