"""
LLM-as-judge eval pipeline.

Scores every LLM span on two dimensions:
  - hallucination_score  (0.0 = grounded, 1.0 = hallucinated)
  - faithfulness_score   (0.0 = unfaithful, 1.0 = fully faithful)

Design:
  - Async, non-blocking — runs after span is stored, never on the hot path
  - Uses a cheap fast model (claude-haiku / gpt-4o-mini) as the judge
  - Results written back to ClickHouse via ALTER TABLE UPDATE
  - Structured JSON output from the judge — no regex parsing
  - Rate-limited to avoid burning cost on the eval itself
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx
import structlog
from clickhouse_driver import Client as CHClient

log = structlog.get_logger(__name__)

CH_HOST      = os.environ.get("CLICKHOUSE_HOST", "localhost")
CH_USER      = os.environ.get("CLICKHOUSE_USER", "neuralops")
CH_PASSWORD  = os.environ.get("CLICKHOUSE_PASSWORD", "neuralops")
CH_DB        = os.environ.get("CLICKHOUSE_DB", "neuralops")

# Judge model — intentionally cheap. Haiku costs ~$0.0003 per eval.
JUDGE_MODEL  = os.environ.get("JUDGE_MODEL", "claude-haiku-4-5")
JUDGE_APIKEY = os.environ.get("ANTHROPIC_API_KEY", "")
JUDGE_RPS    = float(os.environ.get("JUDGE_RPS", "5"))  # max evals per second

_JUDGE_SYSTEM = """You are an expert evaluator of AI agent outputs.
You will be given a prompt and a response from an AI agent.
Score the response on two dimensions:

1. hallucination_score: float 0.0-1.0
   0.0 = fully grounded, every claim is supported or reasonable
   1.0 = severely hallucinated, contains fabricated facts or impossible claims

2. faithfulness_score: float 0.0-1.0
   0.0 = response does not address the prompt at all
   1.0 = response fully and accurately addresses the prompt

Return ONLY a JSON object with exactly these two keys. No explanation, no markdown.
Example: {"hallucination_score": 0.1, "faithfulness_score": 0.9}"""


@dataclass
class EvalResult:
    span_id: str
    hallucination_score: float
    faithfulness_score: float
    judge_model: str
    eval_latency_ms: float


class EvalPipeline:
    """
    Async eval pipeline. Feed it span dicts; it scores and writes back.

    Usage:
        pipeline = EvalPipeline()
        await pipeline.start()
        await pipeline.submit(span_dict)  # non-blocking
    """

    def __init__(self, concurrency: int = 5) -> None:
        self._ch = CHClient(
            host=CH_HOST, user=CH_USER, password=CH_PASSWORD, database=CH_DB
        )
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
        self._concurrency = concurrency
        self._semaphore = asyncio.Semaphore(concurrency)
        self._rate_limiter = _TokenBucket(rate=JUDGE_RPS, capacity=JUDGE_RPS * 2)
        self._http = httpx.AsyncClient(timeout=30.0)

    async def start(self) -> None:
        for _ in range(self._concurrency):
            asyncio.create_task(self._worker())
        log.info("eval_pipeline.started", concurrency=self._concurrency)

    async def submit(self, span: dict[str, Any]) -> None:
        """Non-blocking submit. Drops if queue full (eval is best-effort)."""
        # Only evaluate LLM spans that have both prompt and response
        if not span.get("user_prompt") and not span.get("system_prompt"):
            return
        if not span.get("response_text"):
            return
        try:
            self._queue.put_nowait(span)
        except asyncio.QueueFull:
            log.warning("eval_pipeline.queue_full", span_id=span.get("span_id"))

    async def _worker(self) -> None:
        while True:
            span = await self._queue.get()
            try:
                async with self._semaphore:
                    await self._rate_limiter.acquire()
                    result = await self._evaluate(span)
                    if result:
                        self._write_back(result)
            except Exception as exc:
                log.error("eval_pipeline.worker_error", error=str(exc))
            finally:
                self._queue.task_done()

    async def _evaluate(self, span: dict[str, Any]) -> EvalResult | None:
        span_id = span.get("span_id", "unknown")
        prompt  = f"{span.get('system_prompt', '')}\n{span.get('user_prompt', '')}".strip()
        response = span.get("response_text", "")

        if not prompt or not response:
            return None

        user_message = (
            f"PROMPT:\n{prompt[:2000]}\n\n"
            f"RESPONSE:\n{response[:2000]}"
        )

        t0 = time.perf_counter()
        try:
            resp = await self._http.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": JUDGE_APIKEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": JUDGE_MODEL,
                    "max_tokens": 64,
                    "system": _JUDGE_SYSTEM,
                    "messages": [{"role": "user", "content": user_message}],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            text = data["content"][0]["text"].strip()
            scores = json.loads(text)

            return EvalResult(
                span_id=span_id,
                hallucination_score=float(scores["hallucination_score"]),
                faithfulness_score=float(scores["faithfulness_score"]),
                judge_model=JUDGE_MODEL,
                eval_latency_ms=(time.perf_counter() - t0) * 1000,
            )
        except Exception as exc:
            log.error("eval_pipeline.judge_failed", span_id=span_id, error=str(exc))
            return None

    def _write_back(self, result: EvalResult) -> None:
        """Write scores back to ClickHouse span row."""
        try:
            self._ch.execute(
                """
                ALTER TABLE neuralops.spans
                UPDATE
                    hallucination_score = %(hs)s,
                    faithfulness_score  = %(fs)s,
                    judge_model         = %(jm)s
                WHERE span_id = %(sid)s
                """,
                {
                    "hs":  result.hallucination_score,
                    "fs":  result.faithfulness_score,
                    "jm":  result.judge_model,
                    "sid": result.span_id,
                },
            )
            log.debug(
                "eval_pipeline.scored",
                span_id=result.span_id,
                hallucination=result.hallucination_score,
                faithfulness=result.faithfulness_score,
                latency_ms=round(result.eval_latency_ms, 1),
            )
        except Exception as exc:
            log.error("eval_pipeline.writeback_failed", error=str(exc))


class _TokenBucket:
    """Simple async token bucket for rate limiting."""
    def __init__(self, rate: float, capacity: float) -> None:
        self._rate = rate
        self._capacity = capacity
        self._tokens = capacity
        self._last = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            self._tokens = min(
                self._capacity,
                self._tokens + (now - self._last) * self._rate,
            )
            self._last = now
            if self._tokens < 1:
                wait = (1 - self._tokens) / self._rate
                await asyncio.sleep(wait)
                self._tokens = 0
            else:
                self._tokens -= 1
