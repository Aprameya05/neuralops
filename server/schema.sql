-- NeuralOps ClickHouse schema
-- Engine: ReplacingMergeTree for idempotent ingestion (SDK may retry)
-- Partition by day — supports cheap time-range queries
-- ORDER BY (causal_chain_id, started_at) — causal replay queries are fast

CREATE DATABASE IF NOT EXISTS neuralops;

-- ── Core span table ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS neuralops.spans
(
    -- Identity
    span_id             String,
    trace_id            String,
    parent_span_id      Nullable(String),
    causal_chain_id     String,

    -- Agent metadata
    agent_id            String,
    agent_framework     LowCardinality(String),
    service_name        LowCardinality(String),
    operation_name      LowCardinality(String),

    -- Timing
    started_at          DateTime64(3, 'UTC'),
    ended_at            Nullable(DateTime64(3, 'UTC')),
    duration_ms         Nullable(Float64),

    -- Status
    status              LowCardinality(String),
    error_message       Nullable(String),

    -- LLM-specific (nullable for non-LLM spans)
    model               Nullable(String),
    provider            Nullable(LowCardinality(String)),
    prompt_tokens       Nullable(UInt32),
    completion_tokens   Nullable(UInt32),
    total_tokens        Nullable(UInt32),
    estimated_usd       Nullable(Float64),
    hallucination_score Nullable(Float32),
    faithfulness_score  Nullable(Float32),

    -- Tool-specific (nullable for non-tool spans)
    tool_name           Nullable(LowCardinality(String)),
    autonomous          Nullable(UInt8),

    -- Free-form attributes as JSON string
    attributes          String DEFAULT '{}',

    -- Server-side enrichment
    received_at         DateTime64(3, 'UTC') DEFAULT now64(3),
    client_ip           Nullable(String),

    _version            UInt64  -- used by ReplacingMergeTree dedup
)
ENGINE = ReplacingMergeTree(_version)
PARTITION BY toYYYYMMDD(started_at)
ORDER BY (causal_chain_id, span_id, started_at)
SETTINGS index_granularity = 8192;


-- ── Materialized view: per-agent cost summary ────────────────────────────

CREATE TABLE IF NOT EXISTS neuralops.cost_by_agent
(
    agent_id        String,
    service_name    LowCardinality(String),
    model           LowCardinality(String),
    window_start    DateTime,
    total_calls     UInt64,
    total_tokens    UInt64,
    total_usd       Float64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMMDD(window_start)
ORDER BY (agent_id, service_name, model, window_start);

CREATE MATERIALIZED VIEW IF NOT EXISTS neuralops.mv_cost_by_agent
TO neuralops.cost_by_agent AS
SELECT
    agent_id,
    service_name,
    model,
    toStartOfHour(started_at) AS window_start,
    count()                   AS total_calls,
    sum(total_tokens)         AS total_tokens,
    sum(estimated_usd)        AS total_usd
FROM neuralops.spans
WHERE model IS NOT NULL
GROUP BY agent_id, service_name, model, window_start;


-- ── Materialized view: error rate by operation ───────────────────────────

CREATE TABLE IF NOT EXISTS neuralops.error_rate_by_op
(
    operation_name  LowCardinality(String),
    agent_id        String,
    window_start    DateTime,
    total_calls     UInt64,
    error_calls     UInt64
)
ENGINE = SummingMergeTree
PARTITION BY toYYYYMMDD(window_start)
ORDER BY (operation_name, agent_id, window_start);

CREATE MATERIALIZED VIEW IF NOT EXISTS neuralops.mv_error_rate_by_op
TO neuralops.error_rate_by_op AS
SELECT
    operation_name,
    agent_id,
    toStartOfMinute(started_at) AS window_start,
    count()                     AS total_calls,
    countIf(status = 'error')   AS error_calls
FROM neuralops.spans
GROUP BY operation_name, agent_id, window_start;


-- ── Causal replay query (use directly) ───────────────────────────────────
-- Returns the full decision tree for a causal_chain_id, ordered by time.
--
-- SELECT
--     span_id, parent_span_id, operation_name, agent_id,
--     started_at, duration_ms, status, model, tool_name,
--     estimated_usd, hallucination_score, attributes
-- FROM neuralops.spans
-- WHERE causal_chain_id = '{id}'
-- ORDER BY started_at ASC;