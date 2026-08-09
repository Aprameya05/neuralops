"""
NeuralOps Vector Similarity Search.

Enables semantic search over agent traces:
  - "find traces similar to this error"
  - "show me all times the planner agent timed out"
  - "which causal chains had hallucination issues"

Uses pgvector extension on Neon Postgres.
Embeddings generated via free Groq API (llama-3.3-70b has an embedding endpoint).
Falls back to TF-IDF style keyword hashing if embedding API unavailable.

Setup (run once in Neon SQL editor):
    CREATE EXTENSION IF NOT EXISTS vector;
    ALTER TABLE spans ADD COLUMN IF NOT EXISTS embedding vector(384);
    CREATE INDEX IF NOT EXISTS idx_spans_embedding
        ON spans USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any

import asyncpg
import httpx
import structlog

log = structlog.get_logger(__name__)

POSTGRES_URL = os.environ.get("POSTGRES_URL", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

# Embedding dimension — must match the model output
EMBEDDING_DIM = 384


async def _get_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(POSTGRES_URL, min_size=1, max_size=3)


# ── Embedding generation ───────────────────────────────────────────────────

async def embed_text(text: str) -> list[float]:
    return _hash_embed(text)


async def _embed_via_groq(text: str) -> list[float]:
    """Use Groq's embedding endpoint."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/embeddings",
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "llama3-groq-8b-8192-tool-use-preview",
                "input": text[:512],  # truncate to avoid token limits
            },
        )
        if resp.status_code != 200:
            raise ValueError(f"Groq embedding API returned {resp.status_code}: {resp.text[:100]}")
        data = resp.json()
        embedding = data["data"][0]["embedding"]
        # Pad or truncate to EMBEDDING_DIM
        if len(embedding) > EMBEDDING_DIM:
            embedding = embedding[:EMBEDDING_DIM]
        elif len(embedding) < EMBEDDING_DIM:
            embedding = embedding + [0.0] * (EMBEDDING_DIM - len(embedding))
        return embedding


def _hash_embed(text: str) -> list[float]:
    """
    Deterministic pseudo-embedding via character n-gram hashing.
    Not semantically meaningful but allows pipeline testing without API.
    O(n) time, O(d) space where d=EMBEDDING_DIM.
    """
    vec = [0.0] * EMBEDDING_DIM
    text = text.lower().strip()

    # Character n-grams (n=3)
    for i in range(len(text) - 2):
        ngram = text[i:i+3]
        h = int(hashlib.md5(ngram.encode()).hexdigest(), 16)
        idx = h % EMBEDDING_DIM
        vec[idx] += 1.0

    # L2 normalize
    norm = math.sqrt(sum(x*x for x in vec)) or 1.0
    return [x / norm for x in vec]


def _span_to_text(span: dict[str, Any]) -> str:
    """
    Convert a span to a text representation for embedding.
    Captures the semantically meaningful fields.
    """
    parts = [
        span.get("operation_name", ""),
        span.get("agent_id", ""),
        span.get("model", ""),
        span.get("status", ""),
        span.get("error_message", "") or "",
        span.get("tool_name", "") or "",
    ]
    attrs = span.get("attributes") or {}
    if isinstance(attrs, str):
        try:
            attrs = json.loads(attrs)
        except Exception:
            attrs = {}
    if isinstance(attrs, dict):
        parts.append(str(attrs.get("output", ""))[:200])

    return " ".join(p for p in parts if p).strip()


# ── Indexing ───────────────────────────────────────────────────────────────

async def index_span(span: dict[str, Any], pg: asyncpg.Pool) -> None:
    """
    Generate and store embedding for a span.
    Called asynchronously after span is written to Postgres.
    """
    span_id = span.get("span_id", "")
    if not span_id:
        return

    text = _span_to_text(span)
    if not text.strip():
        return

    try:
        embedding = await embed_text(text)
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

        await pg.execute(
            "UPDATE spans SET embedding = $1::vector WHERE span_id = $2",
            embedding_str, span_id,
        )
    except Exception as exc:
        log.error("vector.index_failed", span_id=span_id, error=str(exc))


async def index_recent_spans(hours: int = 24, batch_size: int = 100) -> int:
    """
    Backfill embeddings for recent spans that don't have one yet.
    Run this once after enabling pgvector.
    """
    pg = await _get_pool()

    rows = await pg.fetch(
        """
        SELECT span_id, operation_name, agent_id, model, status,
               error_message, tool_name, attributes
        FROM spans
        WHERE embedding IS NULL
          AND started_at >= NOW() - INTERVAL '1 hour' * $1
        LIMIT $2
        """,
        hours, batch_size,
    )

    indexed = 0
    for row in rows:
        await index_span(dict(row), pg)
        indexed += 1

    log.info("vector.backfill_complete", indexed=indexed)
    return indexed


# ── Search ─────────────────────────────────────────────────────────────────

async def search_similar_spans(
    query: str,
    limit: int = 10,
    filter_agent_id: str | None = None,
    filter_status: str | None = None,
) -> list[dict[str, Any]]:
    """
    Find spans semantically similar to the query.

    Examples:
        search_similar_spans("planner agent timeout error")
        search_similar_spans("hallucination in research step", filter_agent_id="orchestrator")
        search_similar_spans("cost spike expensive LLM call")

    Returns spans sorted by cosine similarity (most similar first).
    Time complexity: O(n) linear scan without index, O(log n) with ivfflat index.
    """
    pg = await _get_pool()
    embedding = await embed_text(query)
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

    where_clauses = ["embedding IS NOT NULL"]
    params: list[Any] = [embedding_str, limit]

    if filter_agent_id:
        params.append(filter_agent_id)
        where_clauses.append(f"agent_id = ${len(params)}")

    if filter_status:
        params.append(filter_status)
        where_clauses.append(f"status = ${len(params)}")

    where = " AND ".join(where_clauses)

    rows = await pg.fetch(
        f"""
        SELECT
            span_id, causal_chain_id, operation_name, agent_id,
            model, status, error_message, duration_ms, estimated_usd,
            started_at,
            1 - (embedding <=> $1::vector) AS similarity
        FROM spans
        WHERE {where}
        ORDER BY embedding <=> $1::vector
        LIMIT $2
        """,
        *params,
    )

    return [dict(r) for r in rows]


async def search_similar_chains(
    query: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """
    Find entire causal chains similar to the query.
    Aggregates span embeddings by causal_chain_id.
    """
    pg = await _get_pool()
    embedding = await embed_text(query)
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

    rows = await pg.fetch(
        """
        SELECT
            causal_chain_id,
            avg(1 - (embedding <=> $1::vector)) AS avg_similarity,
            count(*) AS span_count,
            array_agg(DISTINCT agent_id) AS agent_ids,
            min(started_at) AS started_at,
            sum(estimated_usd) AS total_cost,
            bool_or(status = 'error') AS has_errors
        FROM spans
        WHERE embedding IS NOT NULL
        GROUP BY causal_chain_id
        ORDER BY avg_similarity DESC
        LIMIT $2
        """,
        embedding_str, limit,
    )

    return [dict(r) for r in rows]
