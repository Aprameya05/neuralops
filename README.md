<div align="center">

<a href="https://neuralops.pages.dev">
<img src="https://img.shields.io/badge/Live_Demo-neuralops.pages.dev-6366f1?style=for-the-badge&labelColor=0a0a0a" alt="live demo"/>
</a>
&nbsp;
<img src="https://img.shields.io/github/actions/workflow/status/Aprameya05/neuralops/benchmark.yml?style=for-the-badge&label=Benchmark+CI&labelColor=0a0a0a&color=10b981" alt="CI"/>
&nbsp;
<img src="https://img.shields.io/badge/NeuralOps-v0.3.0-6366f1?style=for-the-badge&labelColor=0a0a0a" alt="version"/>
&nbsp;
<img src="https://img.shields.io/badge/License-Apache_2.0-6366f1?style=for-the-badge&labelColor=0a0a0a" alt="license"/>
&nbsp;
<img src="https://img.shields.io/badge/Python-3.10+-6366f1?style=for-the-badge&labelColor=0a0a0a" alt="python"/>
&nbsp;
<img src="https://img.shields.io/pypi/v/neuralops-observability?style=for-the-badge&label=PyPI&labelColor=0a0a0a&color=6366f1" alt="pypi"/>
<br/><br/>

```
 ███╗   ██╗███████╗██╗   ██╗██████╗  █████╗ ██╗      ██████╗ ██████╗███████╗
 ████╗  ██║██╔════╝██║   ██║██╔══██╗██╔══██╗██║     ██╔═══██╗██╔══██╗██╔════╝
 ██╔██╗ ██║█████╗  ██║   ██║██████╔╝███████║██║     ██║   ██║██████╔╝███████╗
 ██║╚██╗██║██╔══╝  ██║   ██║██╔══██╗██╔══██║██║     ██║   ██║██╔═══╝ ╚════██║
 ██║ ╚████║███████╗╚██████╔╝██║  ██║██║  ██║███████╗╚██████╔╝██║     ███████║
 ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝    ╚══════╝
```

**Production-Grade AI Agent Observability Platform**

Real-time tracing. Causal decision replay. Cost attribution. Drift detection. Multi-LLM benchmarking.
Self-hosted. Open source. Zero vendor lock-in.

<br/>

[**Live Demo**](https://neuralops.pages.dev) &nbsp;|&nbsp; [**Quickstart**](#quickstart) &nbsp;|&nbsp; [**Architecture**](#architecture) &nbsp;|&nbsp; [**SDK**](#sdk) &nbsp;|&nbsp; [**Benchmark Arena**](#benchmark-arena) &nbsp;|&nbsp; [**Dashboard**](#dashboard)

</div>
<br/>

![NeuralOps Demo](demo.gif)

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
| Semantic search over traces | No | No | **Yes** |
| LLM-as-judge eval | No | Yes | **Yes** |
| Multi-LLM benchmark arena | No | No | **Yes** |
| Root cause attribution scoring | No | No | **Yes** |
| Trace diff (git diff for agents) | No | No | **Yes** |
| Agent fingerprinting + clustering | No | No | **Yes** |
| Agent genealogy force graph | No | No | **Yes** |
| Time-travel counterfactual debugger | No | No | **Yes** |
| Prompt mutation lab (5 auto-variants) | No | No | **Yes** |
| 24h cost forecasting w/ CI | Partial | No | **Yes** |
| Hallucination risk prediction | No | Partial | **Yes** |
| Auto-firing Slack/PagerDuty alerts | Yes | No | **Yes** |
| LangGraph / AutoGen / CrewAI auto-instr. | No | Partial | **Yes** |
| gRPC ingestion endpoint | No | No | **Yes** |
| OpenTelemetry collector config | Yes | No | **Yes** |
| Built-in real AI agents | No | No | **Yes** |
| Self-hosted, open source | No | Yes | **Yes** |
| Built-in free LLM router | No | No | **Yes** |
| Live span feed (WebSocket/polling) | No | No | **Yes** |

The core innovation is the `causal_chain_id` -- a UUID that travels across every agent hop, tool call, and service boundary. When Agent A delegates to Agent B which calls a tool which hits an LLM, every span shares one chain ID. The full decision tree is queryable in a single Postgres scan with pgvector semantic similarity.

---

## Architecture

```
Agents (LangGraph / CrewAI / AutoGen / custom)
         |
         | NeuralOps SDK  (3 lines to instrument)
         |
    +----+----+
    |         |
    v         v
HTTP REST    gRPC (port 50051)
    |         |
    v         v
 +------------------+
 |  FastAPI /ingest |  validates, enriches, batches
 +------------------+
         |
         v
 +------------------+
 | Redis Streams    |  async span queue, at-least-once delivery
 | (Upstash)        |
 +------------------+
         |
         v
 +------------------+
 | Background       |  batch consumer, Welford drift detection,
 | Consumer         |  pgvector embedding indexing
 +------------------+
         |
    +----+----+
    v         v
+----------+  +--------------+
|  Neon    |  | pgvector     |
| Postgres |  | embeddings   |
| (spans)  |  | (search)     |
+----------+  +--------------+
    |
    v
+----------------------+      +------------------+
|   Next.js Dashboard  | <--> | WebSocket / Poll |
|   neuralops.pages.dev|      | Live Span Feed   |
|                      |      +------------------+
|  Overview (live feed)|
|  Trace Explorer      |
|  Causal Replay       |
|  Cost Analysis       |
|  Agent Registry      |
|  Benchmark Arena     |
|  Semantic Search     |
|  Anomaly Replay      |
|  Alert Config        |
+----------------------+
         |
         v
+------------------+
| Prometheus       |  /metrics with real gauge values
| + Alert Rules    |  error rate, latency p99, cost spike
+------------------+
         |
         v
+------------------+
| OTel Collector   |  drop-in for any existing OTel pipeline
| (OTLP gRPC/HTTP) |  no SDK changes required
+------------------+
```

**Stack:**

```
Python SDK        OpenTelemetry instrumentation, async batching exporter, Welford drift
FastAPI           Ingestion API (REST + gRPC), agent routes, WebSocket live feed
Redis Streams     Span queue, at-least-once delivery, consumer group (Upstash free tier)
Neon Postgres     Columnar trace store, pgvector semantic search, sub-second queries
pgvector          384-dim embeddings per span, cosine similarity search, IVFFlat index
Prometheus        Real-time metrics (spans/min, error rate, latency, cost), alert rules
OTel Collector    OTLP gRPC/HTTP receiver, NeuralOps exporter, host metrics
Next.js 14        Dashboard, App Router, TypeScript, Framer Motion, Recharts
Docker Compose    Full local stack: API + Redis + Prometheus + Grafana + OTel Collector
GitHub Actions    Benchmark CI on every push, leaderboard in job summary
Cloudflare Pages  Global CDN deployment, auto-deploys on git push
Render            Free-tier API hosting, kept alive via UptimeRobot
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

# 3. Start the full local stack
docker compose up -d

# 4. Install SDK and run the data seeder
pip install neuralops-observability
python scripts/seed_production_data.py

# 5. Open dashboard
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
    endpoint="https://neuralops-api-cmgf.onrender.com",  # or your self-hosted endpoint
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
headers = ctx.to_headers()  # {"x-causal-chain-id": "csl_...", "x-trace-id": "..."}
await http_client.post("http://agent-b/run", headers=headers, json=payload)

# Agent B picks up the chain
ctx_b = AgentContext.from_headers(request.headers)
neuralops.set_current_context(ctx_b)
```

### OpenTelemetry compatibility

Any agent already instrumented with OpenTelemetry can send spans to NeuralOps with zero SDK changes. Point your existing OTel collector at NeuralOps:

```yaml
# otel-collector-config.yaml (see infra/ for full config)
exporters:
  otlphttp/neuralops:
    endpoint: https://neuralops-api-cmgf.onrender.com

service:
  pipelines:
    traces:
      exporters: [otlphttp/neuralops]
```

### gRPC ingestion (high-throughput)

```python
import grpc
from api import neuralops_pb2, neuralops_pb2_grpc

channel = grpc.insecure_channel("neuralops-api:50051")
stub = neuralops_pb2_grpc.NeuralOpsIngestStub(channel)

stub.IngestBatch(neuralops_pb2.IngestBatchRequest(spans=[
    neuralops_pb2.SpanProto(
        span_id="...",
        agent_id="planner-agent",
        operation_name="plan_decompose_query",
        status="ok",
        duration_ms=342.5,
    )
]))
```

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

**Provider priority:** Groq (llama-3.3-70b) → Mistral (free tier) → OpenRouter (`:free` suffix enforced)

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

Benchmark CI runs automatically on every push to `main` via GitHub Actions.

---

## Dashboard

Live at **[neuralops.pages.dev](https://neuralops.pages.dev)** -- deployed on Cloudflare's global CDN, auto-deploys on every push to `main`.

**Overview** -- stat cards (total spans, cost, active agents, error rate), real-time spans-per-minute area chart wired to live DB data, cost-by-agent bar chart, live span feed streaming real agent events every 3 seconds.

**Trace Explorer** -- search and filter by agent ID, status, time range across all ingested causal chains.

**Causal Replay** -- visual tree of every span in the causal chain, colored by type (LLM=indigo, tool=violet, error=red). Click any node for full telemetry: prompt, response, hallucination score, tool I/O, cost breakdown.

**Semantic Search** -- natural language search over spans and causal chains using pgvector cosine similarity. Find traces by describing agent behavior in plain English.

**Anomaly Replay** -- statistically detected anomalies with root cause attribution. Welford z-score drift detection, per-operation error rate tracking, side-panel with data-driven latency sparkline.

**Cost Analysis** -- hourly USD spend per agent and model with time range selector.

**Agent Registry** -- one card per agent with framework badge, error rate, avg latency, last seen.

**Benchmark Arena** -- run any prompt from the UI, watch all providers respond in parallel, ranked leaderboard with quality scores.

**Agent Playground** -- type a task, watch the 3-agent pipeline (Planner/Groq, Researcher/Groq, Critic/Mistral) execute live.

**Alert Config** -- Slack and PagerDuty webhook configuration UI.

---

## Observability Infrastructure

### Prometheus metrics

Real gauge values scraped from live span data at `/metrics`:

```
neuralops_spans_ingested_total       # by agent_id, status
neuralops_spans_per_minute           # rolling 60s window
neuralops_span_latency_ms            # histogram with p50/p95/p99
neuralops_error_rate                 # rolling error rate (0-1)
neuralops_cost_usd_total             # by agent_id, model
neuralops_active_agents              # distinct agents last 5 minutes
```

Alert rules defined in `infra/neuralops_alerts.yml` fire on high error rate, cost spikes, p99 latency, and ingestion gaps.

### OpenTelemetry Collector

Full collector config at `infra/otel-collector-config.yaml`. Accepts OTLP gRPC (port 4317) and HTTP (port 4318). Transforms OTel semantic conventions to NeuralOps field names. Makes NeuralOps a drop-in for any existing OTel pipeline.

### Docker Compose

One command to start the full local stack:

```bash
docker compose up -d
# Starts: neuralops-api, redis, otel-collector, prometheus, grafana
```

---

## GitHub Actions CI

Two workflows run on every push to `main`.

**Benchmark CI** (`benchmark.yml`) -- runs the arena on 3 prompts across all configured providers. Posts a formatted leaderboard table to the GitHub Actions job summary. Fails if fewer than 30% of providers succeed.

**Lint CI** (`ci.yml`) -- checks imports and code style. Runs in under 30 seconds.

Both visible at [github.com/Aprameya05/neuralops/actions](https://github.com/Aprameya05/neuralops/actions).

---

## Signals detected

**Latency drift** -- Welford's online algorithm maintains running mean and variance per operation with no training window. Fires warning at 2.5 standard deviations, critical at 4.0. Works from the 10th observation.

**Cost spikes** -- exponential moving average on USD per LLM call. Fires when a call exceeds 3x the EMA. Catches prompt injection attacks that inflate token counts silently.

**Error rate drift** -- 50-span sliding window per operation. Fires when error rate exceeds 15%.

**Hallucination** -- LLM-as-judge scores every LLM span asynchronously. Scores written to Postgres, visible in causal replay.

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
|       +-- integrations/
|           +-- langchain.py       LangChain auto-instrumentation
|
+-- sdk-js/                        JavaScript SDK
|
+-- server/
|   +-- api/
|       +-- cloud_main.py          FastAPI app, Redis consumer, gRPC server, WebSocket
|       +-- search_routes.py       POST /v1/search/spans and /v1/search/chains
|       +-- metrics.py             Prometheus /metrics endpoint
|       +-- neuralops.proto        gRPC proto: IngestSpan, IngestBatch, IngestResponse
|       +-- neuralops_pb2.py       Generated gRPC stubs
|       +-- tenants.py             Multi-tenant API key isolation
|   +-- agents/
|       +-- pipeline.py            PlannerAgent, ResearcherAgent, CriticAgent
|       +-- benchmark.py           BenchmarkArena, parallel execution, LLM scoring
|   +-- engine/
|       +-- vector_search.py       pgvector semantic search, shared pool, hash fallback
|       +-- anomaly_replay.py      Anomaly detection engine
|       +-- alerts.py              Slack + PagerDuty integrations
|
+-- dashboard/                     Next.js 14, TypeScript, Framer Motion, Recharts
|   +-- src/app/                   11 pages: overview, traces, replay, cost, agents,
|   |                              alerts, arena, playground, search, anomalies, alerts-config
|   +-- src/components/
|       +-- LiveEventFeed.tsx      Real-time span ticker, polls API every 3s
|       +-- SpanChart.tsx          Spans-per-minute area chart (live DB data)
|
+-- scripts/
|   +-- seed_production_data.py    Seeds live API with real Groq LLM traces
|
+-- infra/
|   +-- otel-collector-config.yaml OTel collector: OTLP receiver, NeuralOps exporter
|   +-- prometheus.yml             Prometheus scrape config
|   +-- neuralops_alerts.yml       Alert rules: error rate, latency, cost, agents
|   +-- helm/                      Helm chart for Kubernetes deployment
|
+-- notebooks/
|   +-- neuralops_a100.ipynb       Colab A100: vLLM + Llama 3.1 70B self-hosted
|   +-- neuralops_lora.ipynb       LoRA fine-tuning on agent trace data
|
+-- .github/workflows/
|   +-- benchmark.yml              Benchmark CI, artifacts, job summary
|   +-- ci.yml                     Lint and import checks
|
+-- docker-compose.yml             Full stack: API + Redis + OTel + Prometheus + Grafana
+-- examples/
    +-- example_agent.py           Full working example with SDK instrumentation
    +-- langchain_example.py       LangChain auto-instrumentation example
```

---

## Environment Variables

```bash
# Free LLM providers (no credit card required)
GROQ_API_KEY=gsk_...
MISTRAL_API_KEY=...
OPENROUTER_API_KEY=sk-or-v1-...

# Infrastructure
REDIS_URL=redis://localhost:6379/0          # or Upstash free tier URL
POSTGRES_URL=postgresql://...               # or Neon free tier URL

# Dashboard
NEXT_PUBLIC_API_URL=https://neuralops-api-cmgf.onrender.com
NEXT_PUBLIC_WS_URL=wss://neuralops-api-cmgf.onrender.com

# SDK endpoint
NEURALOPS_ENDPOINT=https://neuralops-api-cmgf.onrender.com
```

---

## Roadmap

- [x] Python SDK with OpenTelemetry instrumentation
- [x] Causal chain propagation across agent hops
- [x] FastAPI ingestion server (REST + gRPC)
- [x] Redis Streams span queue (Upstash free tier)
- [x] Neon Postgres trace store with pgvector
- [x] Semantic search over spans and causal chains (pgvector cosine similarity)
- [x] Background consumer with inline embedding indexing
- [x] Causal stitching engine
- [x] LLM-as-judge eval pipeline
- [x] Welford drift detection (latency, cost, error rate)
- [x] Multi-LLM router with auto-fallback (Groq, Mistral, OpenRouter)
- [x] 3-agent pipeline (Planner, Researcher, Critic)
- [x] Benchmark arena with parallel execution and LLM scoring
- [x] Next.js dashboard -- 11 pages, Framer Motion, animated canvas
- [x] Live span feed (polling, 3s interval, real DB data)
- [x] Real spans-per-minute chart wired to live timeseries endpoint
- [x] GitHub Actions CI -- benchmark on every push
- [x] Cloudflare Pages deployment (neuralops.pages.dev)
- [x] Render API deployment (kept alive via UptimeRobot)
- [x] Production data seeder with real Groq LLM calls
- [x] Colab A100 notebook -- vLLM + Llama 3.1 70B self-hosted inference
- [x] PyPI publish (pip install neuralops-observability)
- [x] JavaScript SDK
- [x] LangChain auto-instrumentation
- [x] LoRA fine-tuning on agent trace data
- [x] Anomaly replay with root cause attribution and data-driven sparkline
- [x] Multi-tenant support with API key isolation
- [x] Slack and PagerDuty alert integrations
- [x] Prometheus metrics wired to real span data with alert rules
- [x] OpenTelemetry collector config (OTLP gRPC/HTTP receiver)
- [x] gRPC ingestion endpoint with proto stubs
- [x] Full Docker Compose stack (API + Redis + OTel + Prometheus + Grafana)
- [x] Helm chart for Kubernetes
- [ ] WebSocket real-time push (blocked by Render free tier; polling fallback active)
- [ ] Grafana dashboard provisioning
- [ ] Multi-region deployment

---

## Author

Built by **Aprameya** -- computational biology researcher (CSIR, protein synergy docking) turned AI infrastructure engineer.

[GitHub](https://github.com/Aprameya05) &nbsp;|&nbsp; [neuralops](https://github.com/Aprameya05/neuralops) &nbsp;|&nbsp; [Live Demo](https://neuralops.pages.dev)

---

<div align="center">
Apache 2.0 &nbsp;|&nbsp; Built in public &nbsp;|&nbsp; PRs welcome
</div>
