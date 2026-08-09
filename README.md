<div align="center">

<img src="https://img.shields.io/badge/NeuralOps-v0.1.0-6366f1?style=for-the-badge&labelColor=0a0a0a" alt="version"/>
<img src="https://img.shields.io/github/actions/workflow/status/Aprameya05/neuralops/benchmark.yml?style=for-the-badge&label=Benchmark+CI&labelColor=0a0a0a&color=10b981" alt="CI"/>
<img src="https://img.shields.io/badge/License-Apache_2.0-6366f1?style=for-the-badge&labelColor=0a0a0a" alt="license"/>
<img src="https://img.shields.io/badge/Python-3.10+-6366f1?style=for-the-badge&labelColor=0a0a0a" alt="python"/>
<img src="https://img.shields.io/badge/Free_LLMs-Groq_Mistral_OpenRouter-10b981?style=for-the-badge&labelColor=0a0a0a" alt="llms"/>

<br/><br/>

```
 ███╗   ██╗███████╗██╗   ██╗██████╗  █████╗ ██╗      ██████╗ ██████╗ ███████╗
 ████╗  ██║██╔════╝██║   ██║██╔══██╗██╔══██╗██║     ██╔═══██╗██╔══██╗██╔════╝
 ██╔██╗ ██║█████╗  ██║   ██║██████╔╝███████║██║     ██║   ██║██████╔╝███████╗
 ██║╚██╗██║██╔══╝  ██║   ██║██╔══██╗██╔══██║██║     ██║   ██║██╔═══╝ ╚════██║
 ██║ ╚████║███████╗╚██████╔╝██║  ██║██║  ██║███████╗╚██████╔╝██║     ███████║
 ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚══════╝
```

### AI Agent Observability Platform

**The missing infrastructure layer between your AI agents and production.**
Real-time tracing. Causal decision replay. Cost attribution. Multi-LLM benchmarking.
Self-hosted. Open source. Zero vendor lock-in.

<br/>

[**Quickstart**](#quickstart) &nbsp;|&nbsp; [**Architecture**](#architecture) &nbsp;|&nbsp; [**SDK**](#sdk) &nbsp;|&nbsp; [**Dashboard**](#dashboard) &nbsp;|&nbsp; [**Benchmark Arena**](#benchmark-arena)

</div>

---

## The problem

You deploy an AI agent to production. It starts returning wrong answers. You open your logs and see:

```
INFO  agent_step completed in 2.3s
INFO  agent_step completed in 8.1s
ERROR agent_step failed: timeout
```

That is all you get. No prompt. No model response. No tool call sequence. No cost breakdown. No way to know which step in a 12-hop reasoning chain went wrong or why.

Every existing observability tool stops at tokens and latency. They tell you something failed. They cannot tell you why the agent made that decision.

NeuralOps closes that gap.

---

## What NeuralOps does differently

| Capability | Datadog | Langfuse | NeuralOps |
|---|---|---|---|
| Span tracing | Yes | Yes | Yes |
| Token cost | Yes | Yes | Yes |
| Causal chain across agent hops | No | No | **Yes** |
| Decision replay | No | Partial | **Yes** |
| Real-time drift detection | Yes | No | **Yes** |
| LLM-as-judge eval | No | Yes | **Yes** |
| Multi-LLM benchmark arena | No | No | **Yes** |
| Self-hosted, open source | No | Yes | **Yes** |
| Built-in free LLM router | No | No | **Yes** |

The key innovation is the `causal_chain_id` — a UUID that travels across every agent hop, tool call, and service boundary. When Agent A delegates to Agent B which calls a tool which hits an LLM, every span shares one chain ID. The full decision tree is queryable in a single ClickHouse scan.

---

## Architecture

```
Agents (LangGraph / CrewAI / AutoGen / custom)
         |
         | OpenTelemetry SDK (3 lines to instrument)
         v
 +------------------+
 |  FastAPI /ingest |  <-- receives span batches
 +------------------+
         |
         v
 +---------------+
 |     Kafka     |  <-- async span streaming, lz4 compressed
 +---------------+
         |
    +----+----+
    v         v
+----------+  +------------------+
|ClickHouse|  | Postgres + Redis |
|(traces)  |  | (metadata, live) |
+----------+  +------------------+
    |
    v
+------------------+
| Next.js Dashboard|
| Trace explorer   |
| Causal replay    |
| Cost heatmap     |
| Benchmark arena  |
| Drift alerts     |
+------------------+
```

**Stack:**

```
Python SDK      OpenTelemetry instrumentation, async batching exporter
FastAPI         Ingestion API, agent routes, WebSocket alerts
Kafka (KRaft)   Span streaming, lz4 compression, at-least-once delivery
ClickHouse      Columnar trace store, materialized views, fast scans
PostgreSQL      Eval results, agent metadata, configuration
Redis           Live state, WebSocket pub/sub, rate tracking
Next.js 14      Dashboard, App Router, TypeScript, Framer Motion
Docker Compose  One-command local deployment
GitHub Actions  Benchmark CI on every push
```

---

## Quickstart

**Prerequisites:** Docker, Python 3.10+, Node.js 18+

```bash
# 1. Clone
git clone https://github.com/Aprameya05/neuralops
cd neuralops

# 2. Start the full stack
docker compose up -d

# 3. Install SDK
pip install -e ./sdk

# 4. Instrument your agent
import neuralops
neuralops.init(endpoint="http://localhost:8000", service="my-agent")

@neuralops.trace("plan_step")
async def plan(query: str) -> str:
    async with neuralops.trace_llm_call("gpt-4o", user_prompt=query) as span:
        response = await your_llm_client(query)
        span.response_text = response
    return response

# 5. Open dashboard
open http://localhost:3000
```

Every call is traced. Every LLM call has cost attribution. Every error is replayable.

---

## SDK

The SDK is a single pip install. It wraps any agent framework with zero changes to your business logic.

### Initialize

```python
import neuralops

ctx = neuralops.init(
    endpoint="http://localhost:8000",
    service="planner-service",
    agent_id="planner-v2",
    framework="langgraph",
)
```

### Trace any function

```python
@neuralops.trace("retrieve_context")
async def retrieve(query: str) -> list[str]:
    # your code unchanged
    return results
```

### Trace LLM calls with cost

```python
async with neuralops.trace_llm_call(
    "gpt-4o",
    system_prompt=system,
    user_prompt=query,
) as span:
    response = await openai_client.chat.completions.create(...)
    span.response_text = response.choices[0].message.content
    span.cost = neuralops.estimate_cost("gpt-4o", raw_response=response.model_dump())
```

### Trace tool calls

```python
async with neuralops.trace_tool_call("web_search", {"query": q}) as span:
    result = await search(q)
    span.tool_output = result
```

### Propagate causal context across service boundaries

```python
# Agent A spawns Agent B
child_ctx = ctx.child(agent_id="sub-agent-01", framework="crewai")
headers = child_ctx.to_headers()

# Agent B receives the context
ctx = AgentContext.from_headers(request.headers)
```

All spans from both agents share the same `causal_chain_id`. The full multi-hop decision tree is queryable in one scan.

### Cost estimation

Supports 15 models. No external API call at runtime.

```python
cost = neuralops.estimate_cost(
    model="claude-sonnet-4-6",
    prompt_tokens=1200,
    completion_tokens=340,
)
# CostAttribution(model='claude-sonnet-4-6', estimated_usd=0.0000087)
```

Supported: GPT-4o, GPT-4o-mini, Claude Opus/Sonnet/Haiku, Gemini 1.5 Pro/Flash, Llama 3 70B/8B, Mistral Large/Small.

### Drift detection

Real-time statistical anomaly detection using Welford's online algorithm. No training data required.

```python
detector = neuralops.DriftDetector(agent_id="planner")

alerts = detector.observe(span)

for alert in alerts:
    print(alert.drift_type)   # LATENCY / COST / ERROR_RATE
    print(alert.severity)     # warning / critical
    print(alert.z_score)      # 4.2
    print(alert.message)      # "plan_step latency 8100ms is 4.2s from baseline 1200ms"
```

---

## Dashboard

Seven pages, all dark theme, all real-time.

**Overview** — stat cards, spans-per-minute area chart, cost-by-agent bar chart, recent traces table with live WebSocket feed.

**Trace Explorer** — search and filter by agent, status, time range. Click any row to replay.

**Causal Replay** — the core page. Left panel: visual tree of every span colored by type (LLM=indigo, tool=violet, error=red). Right panel: full telemetry for the selected node including prompt, response, hallucination score, tool I/O.

**Cost Analysis** — hourly USD spend per agent and model. Sortable attribution table.

**Agent Registry** — one card per agent with framework badge, error rate bar, last seen timestamp.

**Benchmark Arena** — run any prompt across all providers. Ranked leaderboard with quality scores and actual responses side by side.

**Playground** — type a task, run the 3-agent pipeline, watch spans appear live as each agent completes.

---

## Benchmark Arena

Run the same prompt across providers simultaneously. Each response is scored by an LLM judge on accuracy, clarity, and completeness.

```python
from server.agents.benchmark import BenchmarkArena

arena = BenchmarkArena()
result = await arena.run("Explain the CAP theorem in one sentence.")
print(result.summary())
```

```
Benchmark: Explain the CAP theorem in one sentence.
Provider       Model                        Quality    Latency    Cost
----------------------------------------------------------------------
MISTRAL        mistral-small-latest          10.0/10    1758ms    FREE
GROQ           llama-3.3-70b-versatile       10.0/10    1811ms    FREE
OPENROUTER     openai/gpt-oss-20b:free       10.0/10   14744ms    FREE

Winner: MISTRAL
```

Benchmark CI runs on every push and posts results to the GitHub Actions job summary.

---

## Multi-Agent Pipeline

Three real agents, each using a different free LLM provider.

```python
from server.agents.pipeline import run_full_pipeline

result = await run_full_pipeline(
    "What makes a great distributed systems engineer?"
)

print(result.plan)              # Planner output (Groq, llama-3.3-70b)
print(result.research)          # Researcher output (Mistral)
print(result.critique)          # Critic score and feedback
print(result.causal_chain_id)   # replay at /replay/<id>
```

---

## Free LLM Router

Selects the best available free provider and falls back on rate limits automatically.

```python
from neuralops import router

response = await router.chat(
    messages=[{"role": "user", "content": "Hello"}],
    system="You are a concise assistant.",
)

print(response.provider)        # Provider.GROQ
print(response.latency_ms)      # 476
print(response.fallback_count)  # 0
```

Provider priority: Groq (100K tokens/day) → Mistral (free tier) → OpenRouter (:free models).
All OpenRouter calls use the `:free` suffix. It is not possible to incur charges.

---

## Repo Structure

```
neuralops/
|
+-- sdk/                           Python SDK
|   +-- neuralops/
|       +-- tracer.py              @trace, trace_llm_call, trace_tool_call
|       +-- context.py             AgentContext, causal_chain_id propagation
|       +-- cost.py                Token counting, USD cost (15 models)
|       +-- drift.py               Welford z-score, EMA, sliding window
|       +-- exporter.py            Async batching, retry, backpressure
|       +-- router.py              Multi-LLM router, auto-fallback
|       +-- models.py              Span, LLMCallSpan, ToolCallSpan
|
+-- server/
|   +-- api/
|       +-- main.py                FastAPI app
|       +-- agent_routes.py        POST /v1/agents/run and /benchmark
|       +-- routes.py              GET /v1/traces, /cost, /drift, /agents
|       +-- kafka_producer.py      Async aiokafka producer
|       +-- websocket_manager.py   WebSocket fan-out
|   +-- agents/
|       +-- pipeline.py            PlannerAgent, ResearcherAgent, CriticAgent
|       +-- benchmark.py           BenchmarkArena, parallel provider calls
|   +-- consumers/
|       +-- span_consumer.py       Kafka to ClickHouse, Redis pub/sub
|   +-- engine/
|       +-- causal_stitcher.py     Causal graph from spans
|       +-- eval_pipeline.py       LLM-as-judge, async scoring
|   +-- schema.sql                 ClickHouse DDL, materialized views
|
+-- dashboard/                     Next.js 14, TypeScript, Framer Motion
+-- .github/workflows/
|   +-- benchmark.yml              Benchmark CI, PR comments, artifacts
|   +-- ci.yml                     Lint and import checks
+-- docker-compose.yml             Full stack one-command deploy
```

---

## CI

Every push to `main` runs two workflows.

**Benchmark CI** runs the arena across 3 prompts and all providers. Results post to the GitHub Actions job summary. Fails if fewer than 30% of providers succeed.

**Lint CI** checks imports and code style across the SDK and server.

Both complete in under 2 minutes.

---

## Signals detected

**Latency drift** — Welford online algorithm tracks running mean and variance per operation. Fires at 2.5 standard deviations (warning) and 4.0 (critical). Works from the 10th observation onward.

**Cost spikes** — EMA on USD per call. Fires when a call exceeds 3x the moving average. Catches prompt injection attacks that inflate token counts.

**Error rate drift** — 50-span sliding window. Fires when error rate exceeds 15%.

**Hallucination** — LLM-as-judge scores every LLM span asynchronously. Scores written back to ClickHouse and visible in the dashboard.

---

## Local development

```bash
# Infrastructure only
docker compose up kafka clickhouse postgres redis -d

# API server
cd server && pip install -r requirements.txt
uvicorn api.main:app --reload --port 8000

# Kafka consumer
python -m consumers.span_consumer

# Dashboard
cd dashboard && npm install && npm run dev

# Example agent
cd sdk && pip install -r requirements.txt
python ../examples/example_agent.py
```

---

## Environment variables

```bash
GROQ_API_KEY=gsk_...
MISTRAL_API_KEY=...
OPENROUTER_API_KEY=sk-or-v1-...

KAFKA_BROKERS=localhost:9092
CLICKHOUSE_HOST=localhost
POSTGRES_URL=postgresql://neuralops:neuralops@localhost:5432/neuralops
REDIS_URL=redis://localhost:6379/0
NEURALOPS_ENDPOINT=http://localhost:8000
```

---

## Roadmap

- [x] Python SDK with OpenTelemetry instrumentation
- [x] Causal chain propagation across agent hops
- [x] FastAPI ingestion server with Kafka
- [x] ClickHouse trace store with materialized views
- [x] Kafka to ClickHouse consumer
- [x] Causal stitching engine
- [x] LLM-as-judge eval pipeline
- [x] Welford drift detection
- [x] Multi-LLM router with auto-fallback
- [x] 3-agent pipeline (Planner, Researcher, Critic)
- [x] Benchmark arena with LLM scoring
- [x] Next.js dashboard (7 pages)
- [x] GitHub Actions CI
- [ ] Colab A100 notebook (vLLM self-hosted inference)
- [ ] LoRA fine-tuning on agent trace data
- [ ] fly.io one-command cloud deploy
- [ ] Helm chart for Kubernetes
- [ ] JavaScript SDK

---

## Author

Built by **Aprameya** — researcher at CSIR with background in protein synergy docking and computational biology, now building production AI infrastructure.

[GitHub](https://github.com/Aprameya05) &nbsp;|&nbsp; [neuralops](https://github.com/Aprameya05/neuralops)

---

<div align="center">
Apache 2.0 &nbsp;|&nbsp; Built in public &nbsp;|&nbsp; PRs welcome
</div>
