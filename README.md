# NeuralOps

**Universal AI agent observability platform.**  
Real-time tracing, causal replay, cost attribution, and drift detection — across any agent framework, in one self-hosted stack.

---

## The problem

Most LLM observability tools stop at prompts, tokens, and latency.  
They can tell you *that* something went wrong — not *why*.

When Agent A delegates to Agent B which calls a tool which hits an LLM — and the final output is wrong — you have no way to trace the decision back to its origin.

**NeuralOps makes that answerable.** Every span carries a `causal_chain_id` that survives agent handoffs, tool calls, and service boundaries.

---

## Features

| Feature | Description |
|---|---|
| Drop-in SDK | `pip install neuralops-sdk` · 3 lines to instrument any agent |
| Causal chain tracing | Spans linked across agent hops via `causal_chain_id` |
| Cost attribution | Per-call USD cost, EMA drift alerts, hourly rollups |
| Drift detection | Welford z-score on latency, EMA on cost, sliding error rate window |
| LLM-as-judge eval | Async hallucination + faithfulness scoring on every LLM span |
| Causal replay | Replay any decision tree by `causal_chain_id` |
| Real-time dashboard | Next.js · WebSocket alert feed · ClickHouse-backed trace explorer |
| Framework-agnostic | Works with LangGraph, CrewAI, AutoGen, raw OpenAI, custom agents |
| One-command deploy | `docker compose up` |

---

## Stack

```
Python SDK    → OpenTelemetry (gRPC OTLP)
FastAPI       → ingestion API (8000)
Kafka         → async span streaming (9092)
ClickHouse    → columnar trace store (8123)
PostgreSQL    → metadata, evals, config (5432)
Redis         → live state, WebSocket pub/sub (6379)
Next.js       → dashboard (3000)
Docker        → compose for local, Helm chart for k8s
```

---

## Quickstart

```bash
# Clone and start the stack
git clone https://github.com/Aprameya05/neuralops
cd neuralops
docker compose up -d

# Install the SDK
pip install -e ./sdk

# Instrument your agent (3 lines)
import neuralops
neuralops.init(endpoint="http://localhost:8000", service="my-agent")

@neuralops.trace("plan_step")
async def plan(query: str) -> str:
    async with neuralops.trace_llm_call("gpt-4o", user_prompt=query) as span:
        response = await openai_client.chat.completions.create(...)
        span.response_text = response.choices[0].message.content
    return response.choices[0].message.content

# Open dashboard
open http://localhost:3000
```

---

## Architecture

```
Agents (any framework)
    │  OTel SDK
    ▼
FastAPI /v1/ingest ──→ Kafka (neuralops.spans)
                              │
                    ┌─────────┴──────────┐
                    ▼                    ▼
              ClickHouse           Postgres + Redis
           (trace store)      (metadata, evals, live state)
                    │
                    ▼
            Next.js Dashboard
         (trace explorer, cost heatmap,
          causal replay, drift alerts)
```

---

## Repo structure

```
neuralops/
├── sdk/              Python SDK (pip install neuralops-sdk)
│   └── neuralops/
│       ├── tracer.py       @trace, trace_llm_call, trace_tool_call
│       ├── context.py      AgentContext, causal_chain_id propagation
│       ├── cost.py         Token counting + USD cost estimation
│       ├── drift.py        Real-time drift detection (Welford + EMA)
│       ├── exporter.py     Async batching span exporter
│       └── models.py       Span, LLMCallSpan, ToolCallSpan (Pydantic v2)
├── server/
│   ├── api/          FastAPI ingestion service
│   ├── consumers/    Kafka → ClickHouse consumer
│   ├── engine/       Causal stitching, eval pipeline
│   └── schema.sql    ClickHouse DDL + materialized views
├── dashboard/        Next.js 14 + TypeScript
└── docker-compose.yml
```

---

## License

Apache 2.0