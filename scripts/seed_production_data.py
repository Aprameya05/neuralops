"""
NeuralOps Production Data Seeder.

Sends realistic multi-agent spans to the live Render API using real Groq LLM calls.
Run this once to populate the dashboard with real traces.

Usage:
    cd D:\\neuralops
    pip install httpx groq --break-system-packages
    python scripts/seed_production_data.py

Requirements:
    - NEURALOPS_ENDPOINT env var (defaults to live Render API)
    - GROQ_API_KEY env var
"""

from __future__ import annotations

import asyncio
import os
import random
import time
import uuid
from datetime import datetime, timezone

import httpx

ENDPOINT  = os.environ.get("NEURALOPS_ENDPOINT", "https://neuralops-api-cmgf.onrender.com")
GROQ_KEY  = os.environ.get("GROQ_API_KEY", "")
INGEST    = f"{ENDPOINT}/v1/ingest"
HEALTH    = f"{ENDPOINT}/v1/health"

GROQ_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768",
]

AGENT_CONFIGS = [
    {"agent_id": "planner-agent",    "framework": "custom",    "service": "planning-service"},
    {"agent_id": "researcher-agent", "framework": "langchain", "service": "research-service"},
    {"agent_id": "critic-agent",     "framework": "custom",    "service": "critic-service"},
    {"agent_id": "orchestrator",     "framework": "crewai",    "service": "orchestration-service"},
    {"agent_id": "writer-agent",     "framework": "langchain", "service": "writing-service"},
]

OPERATIONS = [
    "plan_decompose_query",
    "llm_generate_response",
    "vector_search_embeddings",
    "tool_call_web_search",
    "tool_call_read_url",
    "critic_evaluate_output",
    "orchestrate_pipeline",
    "execute_sql_query",
    "llm_generate_code",
    "synthesize_final_answer",
]

TASKS = [
    "What are the latest breakthroughs in quantum computing?",
    "Analyze the impact of transformer architecture on NLP.",
    "How does RLHF improve LLM alignment?",
    "Summarize recent advances in protein structure prediction.",
    "What is the current state of fusion energy research?",
]


# ---------------------------------------------------------------------------
# Groq LLM call (real tokens, real latency)
# ---------------------------------------------------------------------------

async def call_groq(prompt: str, model: str) -> dict:
    """Call Groq API and return {text, prompt_tokens, completion_tokens, latency_ms}."""
    if not GROQ_KEY:
        # Simulate if no API key
        await asyncio.sleep(random.uniform(0.1, 0.6))
        return {
            "text": f"Simulated response for: {prompt[:60]}",
            "prompt_tokens": random.randint(80, 400),
            "completion_tokens": random.randint(40, 200),
            "latency_ms": random.uniform(120, 800),
        }

    t0 = time.perf_counter()
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {GROQ_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt[:800]}],
                "max_tokens": 150,
                "temperature": 0.7,
            },
        )
        latency_ms = (time.perf_counter() - t0) * 1000

        if resp.status_code != 200:
            raise ValueError(f"Groq error {resp.status_code}: {resp.text[:100]}")

        data = resp.json()
        usage = data.get("usage", {})
        return {
            "text": data["choices"][0]["message"]["content"],
            "prompt_tokens":      usage.get("prompt_tokens", 0),
            "completion_tokens":  usage.get("completion_tokens", 0),
            "latency_ms":         latency_ms,
        }


# ---------------------------------------------------------------------------
# Span builders
# ---------------------------------------------------------------------------

MODEL_COSTS = {
    "llama-3.3-70b-versatile": {"prompt": 0.59, "completion": 0.79},
    "llama-3.1-8b-instant":    {"prompt": 0.05, "completion": 0.08},
    "mixtral-8x7b-32768":      {"prompt": 0.24, "completion": 0.24},
}

def estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    rates = MODEL_COSTS.get(model, {"prompt": 0.10, "completion": 0.10})
    return (prompt_tokens * rates["prompt"] + completion_tokens * rates["completion"]) / 1_000_000


def make_span(
    *,
    span_id: str,
    trace_id: str,
    causal_chain_id: str,
    parent_span_id: str | None,
    agent: dict,
    operation_name: str,
    duration_ms: float,
    status: str = "ok",
    error_message: str = "",
    model: str = "",
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    estimated_usd: float = 0.0,
    tool_name: str = "",
    attributes: dict | None = None,
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "span_id":           span_id,
        "trace_id":          trace_id,
        "parent_span_id":    parent_span_id or "",
        "causal_chain_id":   causal_chain_id,
        "agent_id":          agent["agent_id"],
        "agent_framework":   agent["framework"],
        "service_name":      agent["service"],
        "operation_name":    operation_name,
        "started_at":        now,
        "status":            status,
        "error_message":     error_message,
        "duration_ms":       round(duration_ms, 2),
        "model":             model,
        "provider":          "groq" if model else "",
        "prompt_tokens":     prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens":      prompt_tokens + completion_tokens,
        "cost": {
            "provider":        "groq" if model else "",
            "prompt_tokens":   prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens":    prompt_tokens + completion_tokens,
            "estimated_usd":   estimated_usd,
        },
        "estimated_usd":     estimated_usd,
        "tool_name":         tool_name,
        "autonomous":        True,
        "attributes":        attributes or {},
    }


# ---------------------------------------------------------------------------
# Span ingestion
# ---------------------------------------------------------------------------

async def ingest_batch(spans: list[dict], client: httpx.AsyncClient) -> bool:
    try:
        resp = await client.post(INGEST, json=spans, timeout=15.0)
        if resp.status_code == 200:
            data = resp.json()
            print(f"  Ingested {data['accepted']} spans")
            return True
        else:
            print(f"  Ingest error {resp.status_code}: {resp.text[:100]}")
            return False
    except Exception as exc:
        print(f"  Ingest failed: {exc}")
        return False


# ---------------------------------------------------------------------------
# Causal chain simulation
# ---------------------------------------------------------------------------

async def run_causal_chain(task: str, client: httpx.AsyncClient) -> str:
    """
    Simulate a full 3-agent causal chain:
    orchestrator -> planner -> researcher -> critic
    Each makes real Groq LLM calls where possible.
    """
    chain_id  = f"csl_{uuid.uuid4().hex[:8]}"
    trace_id  = str(uuid.uuid4())
    spans: list[dict] = []

    print(f"\n  Chain: {chain_id}")
    print(f"  Task:  {task[:60]}")

    # --- Orchestrator span ---
    orch        = AGENT_CONFIGS[3]  # orchestrator
    orch_span_id = str(uuid.uuid4())
    t0 = time.perf_counter()

    try:
        llm_result = await call_groq(
            f"Break this task into 3 sub-steps for a multi-agent pipeline: {task}",
            "llama-3.1-8b-instant",
        )
        orch_dur = (time.perf_counter() - t0) * 1000
        spans.append(make_span(
            span_id=orch_span_id,
            trace_id=trace_id,
            causal_chain_id=chain_id,
            parent_span_id=None,
            agent=orch,
            operation_name="orchestrate_pipeline",
            duration_ms=orch_dur,
            status="ok",
            model="llama-3.1-8b-instant",
            prompt_tokens=llm_result["prompt_tokens"],
            completion_tokens=llm_result["completion_tokens"],
            estimated_usd=estimate_cost("llama-3.1-8b-instant", llm_result["prompt_tokens"], llm_result["completion_tokens"]),
            attributes={"task": task[:200], "plan": llm_result["text"][:300]},
        ))
    except Exception as exc:
        orch_dur = (time.perf_counter() - t0) * 1000
        spans.append(make_span(
            span_id=orch_span_id,
            trace_id=trace_id,
            causal_chain_id=chain_id,
            parent_span_id=None,
            agent=orch,
            operation_name="orchestrate_pipeline",
            duration_ms=orch_dur,
            status="error",
            error_message=str(exc)[:200],
        ))

    # --- Planner span ---
    planner      = AGENT_CONFIGS[0]
    planner_span = str(uuid.uuid4())
    t0 = time.perf_counter()
    model = random.choice(GROQ_MODELS)

    try:
        llm_result = await call_groq(
            f"Create a detailed plan for: {task}",
            model,
        )
        dur = (time.perf_counter() - t0) * 1000
        spans.append(make_span(
            span_id=planner_span,
            trace_id=trace_id,
            causal_chain_id=chain_id,
            parent_span_id=orch_span_id,
            agent=planner,
            operation_name="plan_decompose_query",
            duration_ms=dur,
            status="ok",
            model=model,
            prompt_tokens=llm_result["prompt_tokens"],
            completion_tokens=llm_result["completion_tokens"],
            estimated_usd=estimate_cost(model, llm_result["prompt_tokens"], llm_result["completion_tokens"]),
            attributes={"query": task[:200]},
        ))
    except Exception as exc:
        dur = (time.perf_counter() - t0) * 1000
        spans.append(make_span(
            span_id=planner_span,
            trace_id=trace_id,
            causal_chain_id=chain_id,
            parent_span_id=orch_span_id,
            agent=planner,
            operation_name="plan_decompose_query",
            duration_ms=dur,
            status="error",
            error_message=str(exc)[:200],
        ))

    # --- Tool call span (web search simulation) ---
    tool_span = str(uuid.uuid4())
    await asyncio.sleep(random.uniform(0.05, 0.15))
    tool_dur = random.uniform(80, 400)
    # Inject occasional errors for drift detection realism
    tool_status = "error" if random.random() < 0.12 else "ok"
    spans.append(make_span(
        span_id=tool_span,
        trace_id=trace_id,
        causal_chain_id=chain_id,
        parent_span_id=planner_span,
        agent=AGENT_CONFIGS[1],  # researcher
        operation_name="tool_call_web_search",
        duration_ms=tool_dur,
        status=tool_status,
        error_message="connection timeout after 3 retries" if tool_status == "error" else "",
        tool_name="web_search",
        attributes={"query": task[:100]},
    ))

    # --- Researcher LLM span ---
    researcher      = AGENT_CONFIGS[1]
    researcher_span = str(uuid.uuid4())
    t0 = time.perf_counter()
    model2 = random.choice(GROQ_MODELS)

    try:
        llm_result2 = await call_groq(
            f"Research and summarize key information about: {task}",
            model2,
        )
        dur2 = (time.perf_counter() - t0) * 1000
        halscore = round(random.uniform(0.01, 0.15), 3)
        spans.append(make_span(
            span_id=researcher_span,
            trace_id=trace_id,
            causal_chain_id=chain_id,
            parent_span_id=tool_span,
            agent=researcher,
            operation_name="llm_generate_response",
            duration_ms=dur2,
            status="ok",
            model=model2,
            prompt_tokens=llm_result2["prompt_tokens"],
            completion_tokens=llm_result2["completion_tokens"],
            estimated_usd=estimate_cost(model2, llm_result2["prompt_tokens"], llm_result2["completion_tokens"]),
            attributes={
                "response_preview": llm_result2["text"][:200],
                "hallucination_score": halscore,
            },
        ))
    except Exception as exc:
        dur2 = (time.perf_counter() - t0) * 1000
        spans.append(make_span(
            span_id=researcher_span,
            trace_id=trace_id,
            causal_chain_id=chain_id,
            parent_span_id=tool_span,
            agent=researcher,
            operation_name="llm_generate_response",
            duration_ms=dur2,
            status="error",
            error_message=str(exc)[:200],
        ))

    # --- Critic span ---
    critic      = AGENT_CONFIGS[2]
    critic_span = str(uuid.uuid4())
    t0 = time.perf_counter()

    try:
        llm_result3 = await call_groq(
            f"Evaluate the quality and accuracy of research on: {task}. Reply with a score 1-10 and brief justification.",
            "llama-3.1-8b-instant",
        )
        dur3 = (time.perf_counter() - t0) * 1000
        spans.append(make_span(
            span_id=critic_span,
            trace_id=trace_id,
            causal_chain_id=chain_id,
            parent_span_id=researcher_span,
            agent=critic,
            operation_name="critic_evaluate_output",
            duration_ms=dur3,
            status="ok",
            model="llama-3.1-8b-instant",
            prompt_tokens=llm_result3["prompt_tokens"],
            completion_tokens=llm_result3["completion_tokens"],
            estimated_usd=estimate_cost("llama-3.1-8b-instant", llm_result3["prompt_tokens"], llm_result3["completion_tokens"]),
            attributes={"evaluation": llm_result3["text"][:200]},
        ))
    except Exception as exc:
        dur3 = (time.perf_counter() - t0) * 1000
        spans.append(make_span(
            span_id=critic_span,
            trace_id=trace_id,
            causal_chain_id=chain_id,
            parent_span_id=researcher_span,
            agent=critic,
            operation_name="critic_evaluate_output",
            duration_ms=dur3,
            status="error",
            error_message=str(exc)[:200],
        ))

    # Ingest all spans for this chain
    await ingest_batch(spans, client)
    return chain_id


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    print("NeuralOps Production Data Seeder")
    print(f"Target: {ENDPOINT}")
    print(f"Groq API: {'configured' if GROQ_KEY else 'not set (using simulation)'}\n")

    # Health check
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(HEALTH)
            print(f"API health: {resp.json()}\n")
        except Exception as exc:
            print(f"API unreachable: {exc}")
            print("Check that the Render service is awake (UptimeRobot should keep it alive).")
            return

        # Run causal chains
        chain_ids = []
        for i, task in enumerate(TASKS):
            print(f"[{i+1}/{len(TASKS)}] Running chain...")
            try:
                chain_id = await run_causal_chain(task, client)
                chain_ids.append(chain_id)
            except Exception as exc:
                print(f"  Chain failed: {exc}")

            # Respect Groq rate limits
            await asyncio.sleep(1.5)

    print(f"\nSeeding complete. {len(chain_ids)} chains ingested.")
    print(f"\nView your live dashboard:")
    print(f"  {ENDPOINT.replace('neuralops-api-cmgf.onrender.com', 'neuralops.pages.dev')}")
    print(f"\nReplay a chain:")
    for cid in chain_ids[:3]:
        print(f"  https://neuralops.pages.dev/replay/{cid}")

    print("\nNote: spans appear after the 2-second consumer flush window.")
    print("Refresh the dashboard in ~5 seconds to see real data.")


if __name__ == "__main__":
    asyncio.run(main())
