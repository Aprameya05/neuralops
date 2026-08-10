"""
NeuralOps Causal Attribution Scoring Engine.

Given an error span, ranks all upstream spans in the causal chain by their
contribution to the failure. No other observability tool does this.

Algorithm:
  Each ancestor span receives a composite attribution score from four signals:

  1. Temporal proximity score
     Spans that completed immediately before the error are more likely causes.
     Score = exp(-delta_t / tau) where tau = median chain latency.

  2. Error propagation score
     If the ancestor itself errored, it almost certainly caused the downstream
     failure. Score = 1.0 if status=error, 0.3 if hallucination_score > 0.5.

  3. Latency anomaly score
     Spans with duration > 2 std deviations above chain mean are suspicious.
     Score = min(1.0, (duration - mean) / (2 * std)) clamped to [0, 1].

  4. Structural centrality score
     Spans with many downstream dependents have higher blast radius.
     Score = descendant_count / total_spans.

  Final score = weighted sum of the four signals, normalized to [0, 1].
  Weights: temporal=0.30, error=0.35, latency=0.20, centrality=0.15.

  This is O(n) in the number of spans per chain.
"""

from __future__ import annotations

import math
import os
import statistics
from dataclasses import dataclass, field
from typing import Any

import asyncpg
import structlog

log = structlog.get_logger(__name__)

POSTGRES_URL = os.environ.get("POSTGRES_URL", "")

# Attribution signal weights -- must sum to 1.0
W_TEMPORAL    = 0.30
W_ERROR       = 0.35
W_LATENCY     = 0.20
W_CENTRALITY  = 0.15

assert abs(W_TEMPORAL + W_ERROR + W_LATENCY + W_CENTRALITY - 1.0) < 1e-9


@dataclass
class AttributionResult:
    span_id:          str
    operation_name:   str
    agent_id:         str
    status:           str
    duration_ms:      float
    error_message:    str
    attribution_score: float          # 0.0 - 1.0, higher = more likely root cause
    temporal_score:   float
    error_score:      float
    latency_score:    float
    centrality_score: float
    descendant_count: int
    explanation:      str             # human-readable reason


@dataclass
class CausalAttributionReport:
    causal_chain_id:   str
    error_span_id:     str
    error_operation:   str
    total_spans:       int
    ranked_causes:     list[AttributionResult]
    root_cause:        AttributionResult | None   # top ranked
    confidence:        float                      # 0.0 - 1.0
    summary:           str


# ---------------------------------------------------------------------------
# Internal span node for tree operations
# ---------------------------------------------------------------------------

@dataclass
class _SpanNode:
    span_id:           str
    parent_span_id:    str | None
    operation_name:    str
    agent_id:          str
    status:            str
    duration_ms:       float
    error_message:     str
    hallucination_score: float | None
    started_at_ms:     float          # unix ms for arithmetic
    children:          list["_SpanNode"] = field(default_factory=list)
    descendant_count:  int = 0


# ---------------------------------------------------------------------------
# Core attribution engine
# ---------------------------------------------------------------------------

class CausalAttributionEngine:
    """
    Scores every span in a causal chain by its contribution to a target error.

    Usage:
        engine = CausalAttributionEngine(pg_pool)
        report = await engine.attribute(causal_chain_id, error_span_id)
    """

    def __init__(self, pg: asyncpg.Pool) -> None:
        self._pg = pg

    async def attribute(
        self,
        causal_chain_id: str,
        error_span_id:   str | None = None,
    ) -> CausalAttributionReport:
        """
        Attribute root causes for a causal chain.

        If error_span_id is None, uses the first error span found in the chain.
        If no error spans exist, scores all spans by latency anomaly.
        """
        rows = await self._fetch_spans(causal_chain_id)
        if not rows:
            return CausalAttributionReport(
                causal_chain_id=causal_chain_id,
                error_span_id="",
                error_operation="",
                total_spans=0,
                ranked_causes=[],
                root_cause=None,
                confidence=0.0,
                summary="No spans found for this causal chain.",
            )

        nodes = self._build_tree(rows)

        # Find the target error span
        error_node: _SpanNode | None = None
        if error_span_id:
            error_node = nodes.get(error_span_id)
        if error_node is None:
            # Use first error span by time
            error_candidates = [n for n in nodes.values() if n.status == "error"]
            if error_candidates:
                error_node = min(error_candidates, key=lambda n: n.started_at_ms)

        # Compute chain-level stats for latency scoring
        durations = [n.duration_ms for n in nodes.values() if n.duration_ms > 0]
        dur_mean = statistics.mean(durations) if durations else 0.0
        dur_std  = statistics.stdev(durations) if len(durations) > 1 else 1.0

        # Compute temporal decay constant (tau = median latency)
        tau = statistics.median(durations) if durations else 1000.0

        total = len(nodes)
        results: list[AttributionResult] = []

        for node in nodes.values():
            if error_node and node.span_id == error_node.span_id:
                continue  # don't score the error span itself

            # Signal 1: temporal proximity
            if error_node:
                delta_ms = max(0.0, error_node.started_at_ms - node.started_at_ms)
                temporal = math.exp(-delta_ms / max(tau, 1.0))
            else:
                temporal = 0.5

            # Signal 2: error propagation
            if node.status == "error":
                error_sig = 1.0
            elif node.hallucination_score is not None and node.hallucination_score > 0.5:
                error_sig = 0.3 + 0.4 * node.hallucination_score
            else:
                error_sig = 0.0

            # Signal 3: latency anomaly
            if dur_std > 0:
                z = (node.duration_ms - dur_mean) / dur_std
                latency_sig = min(1.0, max(0.0, z / 3.0))
            else:
                latency_sig = 0.0

            # Signal 4: structural centrality (blast radius)
            centrality_sig = node.descendant_count / max(total, 1)

            # Composite score
            score = (
                W_TEMPORAL   * temporal    +
                W_ERROR      * error_sig   +
                W_LATENCY    * latency_sig +
                W_CENTRALITY * centrality_sig
            )

            # Build explanation
            reasons: list[str] = []
            if error_sig > 0.8:
                reasons.append(f"span itself errored: {node.error_message[:80] if node.error_message else 'unknown error'}")
            if latency_sig > 0.5:
                reasons.append(f"latency {node.duration_ms:.0f}ms is {((node.duration_ms - dur_mean) / dur_std):.1f}σ above chain mean")
            if temporal > 0.7 and error_node:
                reasons.append(f"executed {delta_ms:.0f}ms before the error")
            if centrality_sig > 0.3:
                reasons.append(f"has {node.descendant_count} downstream dependents")
            if node.hallucination_score and node.hallucination_score > 0.5:
                reasons.append(f"hallucination score {node.hallucination_score:.2f} exceeds threshold")

            explanation = "; ".join(reasons) if reasons else "low attribution signal"

            results.append(AttributionResult(
                span_id=node.span_id,
                operation_name=node.operation_name,
                agent_id=node.agent_id,
                status=node.status,
                duration_ms=node.duration_ms,
                error_message=node.error_message,
                attribution_score=round(score, 4),
                temporal_score=round(temporal, 4),
                error_score=round(error_sig, 4),
                latency_score=round(latency_sig, 4),
                centrality_score=round(centrality_sig, 4),
                descendant_count=node.descendant_count,
                explanation=explanation,
            ))

        # Sort by attribution score descending
        results.sort(key=lambda r: r.attribution_score, reverse=True)

        root_cause = results[0] if results else None

        # Confidence: how much does the top score stand out from the second?
        if len(results) >= 2:
            gap = results[0].attribution_score - results[1].attribution_score
            confidence = min(1.0, gap * 5.0 + results[0].attribution_score * 0.5)
        elif results:
            confidence = results[0].attribution_score
        else:
            confidence = 0.0

        # Summary
        if root_cause:
            summary = (
                f"Root cause identified with {confidence:.0%} confidence: "
                f"{root_cause.operation_name} on {root_cause.agent_id} "
                f"(score {root_cause.attribution_score:.3f}). "
                f"Reason: {root_cause.explanation}."
            )
        else:
            summary = "No significant root cause identified. All spans have low attribution scores."

        return CausalAttributionReport(
            causal_chain_id=causal_chain_id,
            error_span_id=error_node.span_id if error_node else "",
            error_operation=error_node.operation_name if error_node else "",
            total_spans=total,
            ranked_causes=results[:10],  # top 10
            root_cause=root_cause,
            confidence=round(confidence, 4),
            summary=summary,
        )

    async def _fetch_spans(self, causal_chain_id: str) -> list[dict[str, Any]]:
        rows = await self._pg.fetch(
            """
            SELECT
                span_id, parent_span_id, operation_name, agent_id,
                status, duration_ms, error_message, hallucination_score,
                EXTRACT(EPOCH FROM started_at) * 1000 AS started_at_ms
            FROM spans
            WHERE causal_chain_id = $1
            ORDER BY started_at ASC
            LIMIT 10000
            """,
            causal_chain_id,
        )
        return [dict(r) for r in rows]

    def _build_tree(self, rows: list[dict[str, Any]]) -> dict[str, _SpanNode]:
        nodes: dict[str, _SpanNode] = {}

        for row in rows:
            node = _SpanNode(
                span_id=row["span_id"],
                parent_span_id=row.get("parent_span_id") or None,
                operation_name=row["operation_name"],
                agent_id=row["agent_id"],
                status=row.get("status", "ok"),
                duration_ms=float(row.get("duration_ms") or 0.0),
                error_message=row.get("error_message") or "",
                hallucination_score=row.get("hallucination_score"),
                started_at_ms=float(row.get("started_at_ms") or 0.0),
            )
            nodes[node.span_id] = node

        # Wire parent-child
        for node in nodes.values():
            if node.parent_span_id and node.parent_span_id in nodes:
                nodes[node.parent_span_id].children.append(node)

        # Compute descendant counts (post-order DFS)
        def count_descendants(n: _SpanNode) -> int:
            total = len(n.children)
            for child in n.children:
                total += count_descendants(child)
            n.descendant_count = total
            return total

        roots = [n for n in nodes.values() if not n.parent_span_id or n.parent_span_id not in nodes]
        for root in roots:
            count_descendants(root)

        return nodes


# ---------------------------------------------------------------------------
# Shared pool injection (mirrors vector_search.py pattern)
# ---------------------------------------------------------------------------

_pool: asyncpg.Pool | None = None

def set_pool(pool: asyncpg.Pool) -> None:
    global _pool
    _pool = pool

def get_engine() -> CausalAttributionEngine:
    if _pool is None:
        raise RuntimeError("CausalAttributionEngine: pool not initialized. Call set_pool() first.")
    return CausalAttributionEngine(_pool)
