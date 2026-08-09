"""
Vector similarity search API routes.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/v1/search", tags=["search"])


class SearchRequest(BaseModel):
    query: str
    limit: int = 10
    filter_agent_id: str | None = None
    filter_status: str | None = None


@router.post("/spans")
async def search_spans(req: SearchRequest) -> list[dict[str, Any]]:
    """
    Semantic search over spans.
    Find spans similar to a natural language query.

    Example:
        POST /v1/search/spans
        {"query": "planner agent timeout error", "limit": 10}
    """
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    from engine.vector_search import search_similar_spans
    results = await search_similar_spans(
        query=req.query,
        limit=min(req.limit, 50),
        filter_agent_id=req.filter_agent_id,
        filter_status=req.filter_status,
    )
    return results


@router.post("/chains")
async def search_chains(req: SearchRequest) -> list[dict[str, Any]]:
    """
    Semantic search over causal chains.
    Find entire agent workflows similar to a query.

    Example:
        POST /v1/search/chains
        {"query": "hallucination in research step", "limit": 5}
    """
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    from engine.vector_search import search_similar_chains
    results = await search_similar_chains(
        query=req.query,
        limit=min(req.limit, 20),
    )
    return results


@router.post("/index")
async def trigger_indexing(hours: int = Query(24, ge=1, le=168)) -> dict[str, Any]:
    """
    Trigger embedding indexing for recent unindexed spans.
    Call this after enabling pgvector or after a backfill.

    GET /v1/search/index?hours=24
    """
    from engine.vector_search import index_recent_spans
    indexed = await index_recent_spans(hours=hours)
    return {"indexed": indexed, "message": f"Indexed {indexed} spans"}
