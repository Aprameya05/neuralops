"""
NeuralOps Vector Similarity Search.

Changes from v1:
  - set_pool() allows the shared asyncpg pool from cloud_main to be injected.
    No more per-call pool creation (was opening up to 3 connections per search).
  - embed_text() tries Groq first, falls back to hash embedding silently.
  - index_span() and index_recent_spans() use the injected pool.
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

POSTGRES_URL  = os.environ.get("POSTGRES_URL", "")
GROQ_API_KEY  = os.environ.get("GROQ_API_KEY", "")
EMBEDDING_DIM = 384

# Shared pool injected from cloud_main at startup
_pool: asyncpg.Pool | None = None


def set_pool(pool: asyncpg.Pool) -> None:
    """Inject the shared asyncpg pool. Call once at startup."""
    global _pool
    _pool = pool


async def _get_pool() -> asyncpg.Pool:
    if _pool is not None:
        return _pool
    # Fallback: create a minimal pool if called before injection (e.g. in tests)
    return await asyncpg.create_pool(POSTGRES_URL, min_size=1, max_size=3)


# ---------------------------------------------------------------------------
# Embedding generation
# ---------------------------------------------------------------------------

async def embed_text(text: str) -> list[float]:
    """
    Generate a 384-dim embedding for text.
    Tries Groq API first; falls back to deterministic hash embedding.
    """
    if GROQ_API_KEY:
        try:
            return await _embed_via_groq(text)
        except Exception as exc:
            log.debug("embed.groq_failed", error=str(exc), fallback="hash")
    return _hash_embed(text)


async def _embed_via_groq(text: str) -> list[float]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/embeddings",
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "llama3-groq-8b-8192-tool-use-preview",
                "input": text[:512],
            },
        )
        if resp.status_code != 200:
            raise ValueError(f"Groq embedding API {resp.status_code}: {resp.text[:100]}")
        data = resp.json()
        embedding = data["data"][0]["embedding"]
        if len(embedding) > EMBEDDING_DIM:
            return embedding[:EMBEDDING_DIM]
        if len(embedding) < EMBEDDING_DIM:
            return embedding + [0.0] * (EMBEDDING_DIM - len(embedding))
        return embedding


def _hash_embed(text: str) -> list[float]:
    """
    Deterministic pseudo-embedding via character 3-gram hashing.
    O(n) time, O(d) space. Not semantically meaningful but consistent
    and useful for pipeline testing without an embedding API.
    """
    vec = [0.0] * EMBEDDING_DIM
    text = text.lower().strip()
    for i in range(len(text) - 2):
        ngram = text[i:i + 3]
        h = int(hashlib.md5(ngram.encode()).hexdigest(), 16)
        vec[h % EMBEDDING_DIM] += 1.0
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def _span_to_text(span: dict[str, Any]) -> str:
    """Convert a span dict to a text representation for embedding."""
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


# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------

async def index_span(span: dict[str, Any], pg: asyncpg.Pool | None = None) -> None:
    """
    Generate and store embedding for a single span.
    Called after each consumer flush for newly written spans.
    """
    span_id = span.get("span_id", "")
    if not span_id:
        return

    text = _span_to_text(span)
    if not text.strip():
        return

    pool = pg or await _get_pool()
    try:
        embedding = await embed_text(text)
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
        await pool.execute(
            "UPDATE spans SET embedding = $1::vector WHERE span_id = $2",
            embedding_str, span_id,
        )
    except Exception as exc:
        log.error("vector.index_failed", span_id=span_id, error=str(exc))


async def index_recent_spans(hours: int = 24, batch_size: int = 100) -> int:
    """
    Backfill embeddings for recent spans that don't have one yet.
    Useful after enabling pgvector or after a long outage.
    """
    pg = await _get_pool()
    rows = await pg.fetch(
        """SELECT span_id, operation_name, agent_id, model, status,
                  error_message, tool_name, attributes
           FROM spans
           WHERE embedding IS NULL
             AND started_at >= NOW() - INTERVAL '1 hour' * $1
           LIMIT $2""",
        hours, batch_size,
    )
    indexed = 0
    for row in rows:
        await index_span(dict(row), pg)
        indexed += 1
    log.info("vector.backfill_complete", indexed=indexed)
    return indexed


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

async def search_similar_spans(
    query: str,
    limit: int = 10,
    filter_agent_id: str | None = None,
    filter_status: str | None = None,
) -> list[dict[str, Any]]:
    """
    Find spans semantically similar to a natural language query.
    Uses pgvector cosine distance on the embedding column.
    Falls back to keyword ILIKE search if no embeddings exist yet.
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
        f"""SELECT
                span_id, causal_chain_id, operation_name, agent_id,
                model, status, error_message, duration_ms, estimated_usd,
                started_at,
                1 - (embedding <=> $1::vector) AS similarity
            FROM spans
            WHERE {where}
            ORDER BY embedding <=> $1::vector
            LIMIT $2""",
        *params,
    )

    # If no embedded spans yet, fall back to keyword search
    if not rows:
        keyword = f"%{query}%"
        rows = await pg.fetch(
            """SELECT
                   span_id, causal_chain_id, operation_name, agent_id,
                   model, status, error_message, duration_ms, estimated_usd,
                   started_at,
                   0.5 AS similarity
               FROM spans
               WHERE operation_name ILIKE $1
                  OR agent_id ILIKE $1
                  OR error_message ILIKE $1
               ORDER BY started_at DESC
               LIMIT $2""",
            keyword, limit,
        )

    return [dict(r) for r in rows]


async def search_similar_chains(
    query: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """
    Find entire causal chains similar to the query by averaging span embeddings.
    Falls back to keyword aggregation if no embeddings exist.
    """
    pg = await _get_pool()
    embedding = await embed_text(query)
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

    rows = await pg.fetch(
        """SELECT
               causal_chain_id,
               avg(1 - (embedding <=> $1::vector)) AS similarity,
               count(*) AS span_count,
               array_agg(DISTINCT agent_id) AS agent_ids,
               min(started_at) AS started_at,
               sum(estimated_usd) AS total_cost_usd,
               bool_or(status = 'error') AS has_errors,
               count(*) FILTER (WHERE status = 'error') AS error_count
           FROM spans
           WHERE embedding IS NOT NULL
           GROUP BY causal_chain_id
           ORDER BY similarity DESC
           LIMIT $2""",
        embedding_str, limit,
    )

    if not rows:
        # Fallback: return most recent chains
        rows = await pg.fetch(
            """SELECT
                   causal_chain_id,
                   0.5 AS similarity,
                   count(*) AS span_count,
                   array_agg(DISTINCT agent_id) AS agent_ids,
                   min(started_at) AS started_at,
                   sum(estimated_usd) AS total_cost_usd,
                   bool_or(status = 'error') AS has_errors,
                   count(*) FILTER (WHERE status = 'error') AS error_count
               FROM spans
               GROUP BY causal_chain_id
               ORDER BY started_at DESC
               LIMIT $1""",
            limit,
        )

    return [dict(r) for r in rows]
