<div align="center">

<a href="https://neuralops.pages.dev">
<img src="https://img.shields.io/badge/Live_Demo-neuralops.pages.dev-6366f1?style=for-the-badge&labelColor=0a0a0a" alt="live demo"/>
</a>
&nbsp;
<img src="https://img.shields.io/github/actions/workflow/status/Aprameya05/neuralops/benchmark.yml?style=for-the-badge&label=Benchmark+CI&labelColor=0a0a0a&color=10b981" alt="CI"/>
&nbsp;
<img src="https://img.shields.io/badge/NeuralOps-v0.1.0-6366f1?style=for-the-badge&labelColor=0a0a0a" alt="version"/>
&nbsp;
<img src="https://img.shields.io/badge/License-Apache_2.0-6366f1?style=for-the-badge&labelColor=0a0a0a" alt="license"/>
&nbsp;
<img src="https://img.shields.io/badge/Python-3.10+-6366f1?style=for-the-badge&labelColor=0a0a0a" alt="python"/>

<br/><br/>

```
 ███╗   ██╗███████╗██╗   ██╗██████╗  █████╗ ██╗      ██████╗ ██████╗ ███████╗
 ████╗  ██║██╔════╝██║   ██║██╔══██╗██╔══██╗██║     ██╔═══██╗██╔══██╗██╔════╝
 ██╔██╗ ██║█████╗  ██║   ██║██████╔╝███████║██║     ██║   ██║██████╔╝███████╗
 ██║╚██╗██║██╔══╝  ██║   ██║██╔══██╗██╔══██║██║     ██║   ██║██╔═══╝ ╚════██║
 ██║ ╚████║███████╗╚██████╔╝██║  ██║██║  ██║███████╗╚██████╔╝██║     ███████║
 ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚══════╝
```

**AI Agent Observability Platform**

Real-time tracing. Causal decision replay. Cost attribution. Multi-LLM benchmarking.
Self-hosted. Open source. Zero vendor lock-in.

<br/>

[**Live Demo**](https://neuralops.pages.dev) &nbsp;|&nbsp; [**Quickstart**](#quickstart) &nbsp;|&nbsp; [**Architecture**](#architecture) &nbsp;|&nbsp; [**SDK**](#sdk) &nbsp;|&nbsp; [**Benchmark Arena**](#benchmark-arena) &nbsp;|&nbsp; [**Dashboard**](#dashboard);| &nbsp;
<img src="https://img.shields.io/pypi/v/neuralops-observability?style=for-the-badge&label=PyPI&labelColor=0a0a0a&color=6366f1" alt="pypi"/>

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
| Token cost attribution | Yes | Yes | Yes |
| Causal chain across agent hops | No | No | **Yes** |
| Decision replay | No | Partial | **Yes** |
| Real-time drift detection | Yes | No | **Yes** |
| LLM-as-judge eval | No | Yes | **Yes** |
| Multi-LLM benchmark arena | No | No | **Yes** |
| Built-in real AI agents | No | No | **Yes** |
| Self-hosted, open source | No | Yes | **Yes** |
| Built-in free LLM router | No | No | **Yes** |

The core innovation is the `causal_chain_id` — a UUID that travels across every agent hop, tool call, and service boundary. When Agent A delegates to Agent B which calls a tool which hits an LLM, every span shares one chain ID. The full decision tree is queryable in a single ClickHouse scan.

---

## Architecture

```
Agents (LangGraph / CrewAI / AutoGen / custom)
         |
         | NeuralOps SDK (3 lines to instrument)
         v
 +------------------+
 |  FastAPI /ingest |  receives span batches, validates, enriches
 +------------------+
         |
         v
 +---------------+
 |     Kafka     |  async span streaming, gzip compressed, at-least-once
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
+----------------------+
|   Next.js Dashboard  |
|   neuralops.pages.dev|
|                      |
|  Overview            |
|  Trace Explorer      |
|  Causal Replay       |
|  Cost Analysis       |
|  Agent Registry      |
|  Benchmark Arena     |
|  Agent Playground    |
+----------------------+
```

**Stack:**

```
Python SDK      OpenTelemetry instrumentation, async batching exporter, Welford drift
FastAPI         Ingestion API, agent routes, WebSocket alerts
Kafka (KRaft)   Span streaming, gzip compression, at-least-once delivery
ClickHouse      Columnar trace store, materialized views, sub-second scans
PostgreSQL      Eval results, agent metadata, configuration
Redis           Live state, WebSocket pub/sub, rate tracking
Next.js 14      Dashboard, App Router, TypeScript, Framer Motion, animated canvas
Docker Compose  One-command local deployment
GitHub Actions  Benchmark CI runs on every push, posts leaderboard to job summary
Cloudflare      Global CDN deployment at neuralops.pages.dev
```

---

## Quickstart

**Prerequisites:** Docker, Python 3.10+

```bash
# 1. Clone
git clone https://github.com/Aprameya05/neuralops
cd neuralops

# 2. Add your free API keys (no credit card needed)
cp .env.example .env
# Edit .env with your Groq, Mistral, OpenRouter keys

# 3. Start infrastructure
docker compose up -d kafka clickhouse postgres redis

# 4. Start the API server
cd server && pip install -r requirements.txt
python -m uvicorn api.main:app --host 0.0.0.0 --port 8000

# 5. Start the Kafka consumer
python -m server.consumers.span_consumer

# 6. Install SDK and run example agent
pip install neuralops-observability
python examples/example_agent.py

# 7. Open dashboard
open https://neuralops.pages.dev
# or run locally: cd dashboard && npm install && npm run dev
```

Every call is traced. Every LLM call has cost attribution. Every error is replayable by causal chain ID.

---

## SDK

Drop-in instrumentation for any agent framework. Three lines to start, zero changes to business logic.

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
    return results  # your code unchanged
```

### Trace LLM calls with automatic cost attribution

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
# Agent A spawns Agent B across a network boundary
child_ctx = ctx.child(agent_id="sub-agent-01", framework="crewai")
headers = child_ctx.to_headers()  # serialize to HTTP headers

# Agent B reconstructs context on the other side
ctx = AgentContext.from_headers(request.headers)
```

Every span from both agents shares `causal_chain_id`. The full multi-hop decision tree is one ClickHouse query away.

### Cost estimation — 15 models, no API call at runtime

```python
cost = neuralops.estimate_cost(
    model="claude-sonnet-4-6",
    prompt_tokens=1200,
    completion_tokens=340,
)
# CostAttribution(model='claude-sonnet-4-6', estimated_usd=0.00000870)
```

Supported: GPT-4o, GPT-4o-mini, GPT-4, Claude Opus/Sonnet/Haiku, Gemini 1.5 Pro/Flash, Llama 3 70B/8B, Mistral Large/Small.

### Drift detection — no training data required

```python
detector = neuralops.DriftDetector(agent_id="planner")

alerts = detector.observe(span)

for alert in alerts:
    print(alert.drift_type)   # LATENCY / COST / ERROR_RATE
    print(alert.severity)     # warning / critical
    print(alert.z_score)      # 4.2
    print(alert.message)
    # "plan_step latency 8100ms is 4.2 standard deviations from baseline 1200ms"
```

Uses Welford's online algorithm — numerically stable, no training window, starts alerting from the 10th observation.

---

## Real AI Agents

NeuralOps ships with three real working agents backed by free LLM APIs. Run them out of the box.

```python
from server.agents.pipeline import run_full_pipeline

result = await run_full_pipeline(
    "What makes a great distributed systems engineer?"
)

print(result.plan)             # Planner (Groq, llama-3.3-70b)
print(result.research)         # Researcher (Mistral)
print(result.critique)         # Critic score + structured feedback
print(result.causal_chain_id)  # replay at neuralops.pages.dev/replay/<id>
```

Every call is traced. The 3-agent run produces 6 spans linked under one `causal_chain_id`, replayable in the dashboard.

---

## Free LLM Router

Auto-selects the best available free provider. Falls back instantly on rate limits. Zero billing risk.

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

**Provider priority:** Groq (100K tokens/day, llama-3.3-70b) → Mistral (free tier) → OpenRouter (:free suffix enforced)

All OpenRouter calls use the `:free` model suffix. Billing is structurally impossible.

---

## Benchmark Arena

Run the same prompt across all providers in parallel. Score each response with an LLM judge. Rank by quality, latency, and cost.

```python
from server.agents.benchmark import BenchmarkArena

arena = BenchmarkArena()
result = await arena.run("Explain the CAP theorem in one sentence.")
print(result.summary())
```

**Actual output from a real run:**

```
Benchmark: Explain the CAP theorem in one sentence.

Provider       Model                        Quality    Latency    Cost
----------------------------------------------------------------------
MISTRAL        mistral-small-latest          10.0/10    1758ms    FREE
GROQ           llama-3.3-70b-versatile       10.0/10    1811ms    FREE
OPENROUTER     openai/gpt-oss-20b:free       10.0/10   14744ms    FREE

Winner: MISTRAL
```

Benchmark CI runs automatically on every push to `main` via GitHub Actions. Results post to the job summary. Every provider is tested on 3 prompts. The build fails if fewer than 30% of providers succeed.

---

## Dashboard

Live at **[neuralops.pages.dev](https://neuralops.pages.dev)** — deployed on Cloudflare's global CDN, auto-deploys on every push to `main`.

**Overview** — stat cards with animated count-up (total spans, cost, active agents, error rate), spans-per-minute area chart, cost-by-agent bar chart, recent traces table with live WebSocket feed and drift alert toasts.

**Trace Explorer** — search and filter by agent ID, status, time range. Click any row to open causal replay.

**Causal Replay** — the core page. Left panel: visual tree of every span in the causal chain, colored by type (LLM=indigo, tool=violet, error=red), indented by parent-child relationship. Right panel: click any node for full telemetry — prompt, response, hallucination score, tool I/O, cost breakdown.

**Cost Analysis** — hourly USD spend per agent and model. Sortable attribution table with time range selector (1h, 6h, 24h, 7d).

**Agent Registry** — one card per agent with framework badge, error rate progress bar, avg latency, last seen timestamp.

**Benchmark Arena** — run any prompt from the UI, watch all providers respond in parallel, see the ranked leaderboard with quality scores and full response text.

**Agent Playground** — type a task, hit run, watch the 3-agent pipeline execute live with span-by-span updates.

---

## GitHub Actions CI

Two workflows run on every push to `main`.

**Benchmark CI** (`benchmark.yml`) — runs the arena on 3 prompts across all configured providers. Posts a formatted leaderboard table to the GitHub Actions job summary. Uploads results as artifacts. Fails the build if fewer than 30% of providers succeed.

**Lint CI** (`ci.yml`) — checks imports and code style across the SDK and server. Runs in under 30 seconds.

Both are visible at [github.com/Aprameya05/neuralops/actions](https://github.com/Aprameya05/neuralops/actions).

---

## Signals detected

**Latency drift** — Welford's online algorithm maintains a running mean and variance per operation with no training window. Fires a warning at 2.5 standard deviations and critical at 4.0. Works from the 10th observation onward.

**Cost spikes** — exponential moving average on USD per LLM call. Fires when a call exceeds 3x the EMA. Catches prompt injection attacks that inflate token counts silently.

**Error rate drift** — 50-span sliding window per operation. Fires when error rate exceeds 15%.

**Hallucination** — LLM-as-judge scores every LLM span asynchronously using a fast cheap model. Scores are written back to ClickHouse and visible in causal replay.

---

## Repo Structure

```
neuralops/
|
+-- sdk/                           Python SDK (pip install neuralops-observability)
|   +-- neuralops/
|       +-- tracer.py              @trace, trace_llm_call, trace_tool_call
|       +-- context.py             AgentContext, causal_chain_id propagation
|       +-- cost.py                Token counting, USD cost (15 models)
|       +-- drift.py               Welford z-score, EMA, sliding window
|       +-- exporter.py            Async batching, retry, backpressure
|       +-- router.py              Multi-LLM router, auto-fallback
|       +-- models.py              Span, LLMCallSpan, ToolCallSpan (Pydantic v2)
|
+-- server/
|   +-- api/
|       +-- main.py                FastAPI app, CORS, lifespan
|       +-- agent_routes.py        POST /v1/agents/run and /v1/agents/benchmark
|       +-- routes.py              GET /v1/traces, /cost, /drift, /agents
|       +-- kafka_producer.py      Async aiokafka producer, gzip compression
|       +-- websocket_manager.py   WebSocket fan-out to dashboard clients
|   +-- agents/
|       +-- pipeline.py            PlannerAgent, ResearcherAgent, CriticAgent
|       +-- benchmark.py           BenchmarkArena, parallel provider calls, LLM scoring
|   +-- consumers/
|       +-- span_consumer.py       Kafka to ClickHouse, Redis pub/sub, batch inserts
|   +-- engine/
|       +-- causal_stitcher.py     Assembles causal graph from spans
|       +-- eval_pipeline.py       LLM-as-judge async scoring, ClickHouse write-back
|   +-- schema.sql                 ClickHouse DDL, materialized views
|
+-- dashboard/                     Next.js 14, TypeScript, Framer Motion, Recharts
|                                   Live at neuralops.pages.dev
+-- notebooks/
|   +-- neuralops_a100.ipynb       Colab A100 notebook: vLLM + Llama 3.1 70B
+-- .github/workflows/
|   +-- benchmark.yml              Benchmark CI, artifacts, job summary
|   +-- ci.yml                     Lint and import checks
+-- docker-compose.yml             Kafka, ClickHouse, Postgres, Redis
+-- examples/
    +-- example_agent.py           Full working example with SDK instrumentation
```

---

## Environment Variables

```bash
# Free LLM providers (no credit card required)
GROQ_API_KEY=gsk_...
MISTRAL_API_KEY=...
OPENROUTER_API_KEY=sk-or-v1-...

# Infrastructure (defaults match Docker Compose)
KAFKA_BROKERS=localhost:29092
CLICKHOUSE_HOST=localhost
CLICKHOUSE_USER=neuralops
CLICKHOUSE_PASSWORD=neuralops
POSTGRES_URL=postgresql://neuralops:neuralops@localhost:5432/neuralops
REDIS_URL=redis://localhost:6379/0

# SDK endpoint
NEURALOPS_ENDPOINT=http://localhost:8000

# Optional: LLM-as-judge eval scoring
ANTHROPIC_API_KEY=sk-ant-...
JUDGE_MODEL=claude-haiku-4-5
```

---

## Roadmap

- [x] Python SDK with OpenTelemetry instrumentation
- [x] Causal chain propagation across agent hops
- [x] FastAPI ingestion server with Kafka
- [x] ClickHouse trace store with materialized views
- [x] Kafka to ClickHouse consumer with batch inserts
- [x] Causal stitching engine
- [x] LLM-as-judge eval pipeline
- [x] Welford drift detection (latency, cost, error rate)
- [x] Multi-LLM router with auto-fallback (Groq, Mistral, OpenRouter)
- [x] 3-agent pipeline (Planner, Researcher, Critic) using free APIs
- [x] Benchmark arena with parallel execution and LLM scoring
- [x] Next.js dashboard — 7 pages, Framer Motion, animated canvas background
- [x] GitHub Actions CI — benchmark on every push, leaderboard in job summary
- [x] Cloudflare Pages deployment (neuralops.pages.dev)
- [x] Full end-to-end pipeline verified: Agent → Kafka → ClickHouse → Dashboard
- [x] Colab A100 notebook — vLLM + Llama 3.1 70B self-hosted inference
- [x] PyPI publish (pip install neuralops-observability)
- [ ] JavaScript SDK
- [ ] LangChain auto-instrumentation
- [ ] LoRA fine-tuning on agent trace data
- [ ] Helm chart for Kubernetes
- [ ] Prometheus metrics endpoint

---

## Author

Built by **Aprameya**.

[GitHub](https://github.com/Aprameya05) &nbsp;|&nbsp; [neuralops](https://github.com/Aprameya05/neuralops) &nbsp;|&nbsp; [Live Demo](https://neuralops.pages.dev)

---

<div align="center">
Apache 2.0 &nbsp;|&nbsp; Built in public &nbsp;|&nbsp; PRs welcome
</div>
