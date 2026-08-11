"""
NeuralOps Load Test — 1000 spans/sec throughput benchmark
-----------------------------------------------------------
Fires concurrent span ingestion batches to the NeuralOps API
and reports detailed performance metrics.

Usage:
    python scripts/load_test.py
    python scripts/load_test.py --url https://neuralops-api-cmgf.onrender.com --rps 500 --duration 30
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import statistics
import time
import uuid
from datetime import datetime, timezone
from typing import NamedTuple

try:
    import httpx
except ImportError:
    raise SystemExit("Run: pip install httpx")

try:
    from dotenv import load_dotenv
    load_dotenv(override=True)
except ImportError:
    pass


# ── Span generator ────────────────────────────────────────────────────────────

AGENTS      = ["orchestrator", "planner-agent", "researcher-agent", "critic-agent", "executor-agent"]
OPERATIONS  = ["llm_call", "tool_call", "plan_step", "validate_output", "web_search", "embed_text", "synthesize"]
MODELS      = ["llama3-70b-8192", "mixtral-8x7b-32768", "gemma2-9b-it", "llama3-8b-8192"]
FRAMEWORKS  = ["langchain", "crewai", "autogen", "langgraph", "custom"]
STATUSES    = ["ok"] * 18 + ["error"] * 1 + ["hallucination"] * 1  # ~5% error rate

def make_span(chain_id: str) -> dict:
    agent    = random.choice(AGENTS)
    status   = random.choice(STATUSES)
    dur      = random.lognormvariate(5.5, 0.8)  # log-normal latency ~400ms median
    p_tokens = random.randint(50, 2000)
    c_tokens = random.randint(20, 800)
    cost     = (p_tokens * 0.00000027 + c_tokens * 0.00000027)

    return {
        "span_id":         f"spn_{uuid.uuid4().hex[:12]}",
        "trace_id":        f"trc_{uuid.uuid4().hex[:16]}",
        "causal_chain_id": chain_id,
        "agent_id":        agent,
        "agent_framework": random.choice(FRAMEWORKS),
        "service_name":    "load-test",
        "operation_name":  random.choice(OPERATIONS),
        "started_at":      datetime.now(timezone.utc).isoformat(),
        "duration_ms":     round(dur, 2),
        "status":          status,
        "error_message":   "Simulated error" if status == "error" else None,
        "model":           random.choice(MODELS),
        "cost": {
            "provider":        "groq",
            "prompt_tokens":   p_tokens,
            "completion_tokens": c_tokens,
            "total_tokens":    p_tokens + c_tokens,
            "estimated_usd":   round(cost, 8),
        },
        "hallucination_score": round(random.uniform(0.0, 0.15), 3),
        "faithfulness_score":  round(random.uniform(0.85, 1.0), 3),
        "attributes": {
            "load_test": True,
            "batch_id":  uuid.uuid4().hex[:8],
        },
    }


# ── Result bucket ─────────────────────────────────────────────────────────────

class BatchResult(NamedTuple):
    latency_ms: float
    accepted:   int
    rejected:   int
    error:      str | None


# ── Worker ────────────────────────────────────────────────────────────────────

async def send_batch(client: httpx.AsyncClient, url: str, batch: list[dict]) -> BatchResult:
    t0 = time.perf_counter()
    try:
        resp = await client.post(
            f"{url}/v1/ingest",
            json=batch,
            timeout=10.0,
        )
        latency_ms = (time.perf_counter() - t0) * 1000
        if resp.status_code == 200:
            data = resp.json()
            return BatchResult(latency_ms, data.get("accepted", len(batch)), data.get("rejected", 0), None)
        else:
            return BatchResult(latency_ms, 0, len(batch), f"HTTP {resp.status_code}")
    except Exception as exc:
        latency_ms = (time.perf_counter() - t0) * 1000
        return BatchResult(latency_ms, 0, len(batch), str(exc))


# ── Main load generator ───────────────────────────────────────────────────────

async def run_load_test(
    url: str,
    target_rps: int,
    duration_s: int,
    batch_size: int,
    concurrency: int,
) -> None:
    """
    Fire batches at target_rps for duration_s seconds.
    Reports p50/p95/p99 latency and throughput.
    """
    results: list[BatchResult] = []
    total_sent    = 0
    total_accepted = 0
    total_rejected = 0
    total_errors   = 0

    # Compute inter-batch delay
    batches_per_sec = target_rps / batch_size
    interval_s      = 1.0 / max(batches_per_sec, 0.1)

    print(f"\n{'─'*60}")
    print(f"  NeuralOps Load Test")
    print(f"  Target:      {target_rps} spans/sec")
    print(f"  Duration:    {duration_s}s")
    print(f"  Batch size:  {batch_size}")
    print(f"  Concurrency: {concurrency}")
    print(f"  API:         {url}")
    print(f"{'─'*60}\n")

    sem = asyncio.Semaphore(concurrency)

    async def bounded_batch(client, batch):
        async with sem:
            return await send_batch(client, url, batch)

    start_wall = time.perf_counter()
    chain_id   = f"csl_loadtest_{uuid.uuid4().hex[:8]}"

    limits = httpx.Limits(max_connections=concurrency + 10, max_keepalive_connections=concurrency)
    async with httpx.AsyncClient(limits=limits) as client:
        tasks = []
        last_report = time.perf_counter()

        while (time.perf_counter() - start_wall) < duration_s:
            batch = [make_span(chain_id) for _ in range(batch_size)]
            tasks.append(asyncio.create_task(bounded_batch(client, batch)))
            total_sent += batch_size

            # Periodic progress report every 5 seconds
            now = time.perf_counter()
            if now - last_report >= 5.0 and results:
                elapsed = now - start_wall
                rate = total_sent / elapsed
                print(f"  ⏱  {elapsed:.0f}s | sent={total_sent:,} | rate={rate:.0f}/s | errors={total_errors}")
                last_report = now

            await asyncio.sleep(interval_s)

        # Collect remaining results
        done = await asyncio.gather(*tasks, return_exceptions=True)
        for r in done:
            if isinstance(r, BatchResult):
                results.append(r)
                total_accepted += r.accepted
                total_rejected += r.rejected
                if r.error:
                    total_errors += 1

    # ── Report ────────────────────────────────────────────────────────────────
    elapsed = time.perf_counter() - start_wall
    latencies = sorted(r.latency_ms for r in results if r.error is None)

    if not latencies:
        print("❌  No successful requests — check API URL and connectivity\n")
        return

    def pct(lst, p): return lst[int(len(lst) * p / 100)] if lst else 0

    print(f"\n{'═'*60}")
    print(f"  RESULTS")
    print(f"{'═'*60}")
    print(f"  Duration          : {elapsed:.1f}s")
    print(f"  Spans sent        : {total_sent:,}")
    print(f"  Spans accepted    : {total_accepted:,}")
    print(f"  Spans rejected    : {total_rejected:,}")
    print(f"  Batches succeeded : {len(latencies):,}")
    print(f"  Batches errored   : {total_errors:,}")
    print(f"  Throughput        : {total_accepted / elapsed:.0f} spans/sec")
    print(f"  Error rate        : {total_errors / max(len(results), 1) * 100:.1f}%")
    print(f"{'─'*60}")
    print(f"  Ingestion Latency (per-batch HTTP round-trip)")
    print(f"    p50  : {pct(latencies, 50):.1f}ms")
    print(f"    p75  : {pct(latencies, 75):.1f}ms")
    print(f"    p95  : {pct(latencies, 95):.1f}ms")
    print(f"    p99  : {pct(latencies, 99):.1f}ms")
    print(f"    max  : {max(latencies):.1f}ms")
    print(f"    mean : {statistics.mean(latencies):.1f}ms")
    print(f"    stdev: {statistics.stdev(latencies) if len(latencies) > 1 else 0:.1f}ms")
    print(f"{'═'*60}\n")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NeuralOps load test")
    parser.add_argument("--url",        default=os.environ.get("NEURALOPS_API_URL", "http://localhost:8000"))
    parser.add_argument("--rps",        type=int, default=1000,  help="Target spans per second")
    parser.add_argument("--duration",   type=int, default=30,    help="Test duration in seconds")
    parser.add_argument("--batch",      type=int, default=50,    help="Spans per HTTP batch")
    parser.add_argument("--concurrency",type=int, default=20,    help="Max concurrent requests")
    args = parser.parse_args()

    asyncio.run(run_load_test(
        url=args.url,
        target_rps=args.rps,
        duration_s=args.duration,
        batch_size=args.batch,
        concurrency=args.concurrency,
    ))
