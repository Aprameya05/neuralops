"""
NeuralOps Trace Diff Engine.

Compares two causal chains structurally and statistically.
Shows exactly where two agent executions diverged -- which operations
ran in one but not the other, where latency spiked, which agent
behaved differently.

This is like git diff but for AI agent execution paths.

Output:
  - Operation set diff (added / removed / common)
  - Agent participation diff
  - Per-operation latency comparison (delta_ms, delta_pct)
  - Cost diff
  - Divergence score (0 = identical, 1 = completely different)
  - First divergence point (operation where chains first differ)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import asyncpg
import structlog

log = structlog.get_logger(__name__)

POSTGRES_URL = os.environ.get("POSTGRES_URL", "")


@dataclass
class OperationDiff:
    operation_name:  str
    in_chain_a:      bool
    in_chain_b:      bool
    duration_ms_a:   float | None
    duration_ms_b:   float | None
    delta_ms:        float | None      # b - a (positive = b slower)
    delta_pct:       float | None      # percentage change
    status_a:        str | None
    status_b:        str | None
    status_changed:  bool
    agent_a:         str | None
    agent_b:         str | None
    agent_changed:   bool


@dataclass
class TraceDiff:
    chain_a:             str
    chain_b:             str
    divergence_score:    float          # 0 = identical, 1 = completely different
    first_divergence:    str | None     # operation name where chains first differ
    operations_only_a:   list[str]      # ran in a but not b
    operations_only_b:   list[str]      # ran in b but not a
    common_operations:   list[str]      # ran in both
    operation_diffs:     list[OperationDiff]
    agents_only_a:       list[str]
    agents_only_b:       list[str]
    common_agents:       list[str]
    total_cost_a:        float
    total_cost_b:        float
    cost_delta:          float          # b - a
    total_duration_ms_a: float
    total_duration_ms_b: float
    duration_delta_ms:   float          # b - a
    span_count_a:        int
    span_count_b:        int
    error_count_a:       int
    error_count_b:       int
    summary:             str


class TraceDiffEngine:
    def __init__(self, pg: asyncpg.Pool) -> None:
        self._pg = pg

    async def diff(self, chain_a: str, chain_b: str) -> dict[str, Any]:
        spans_a = await self._fetch_spans(chain_a)
        spans_b = await self._fetch_spans(chain_b)

        result = self._compute_diff(chain_a, chain_b, spans_a, spans_b)
        return self._serialize(result)

    async def _fetch_spans(self, causal_chain_id: str) -> list[dict[str, Any]]:
        rows = await self._pg.fetch(
            """
            SELECT
                span_id, operation_name, agent_id, status,
                duration_ms, estimated_usd, error_message,
                EXTRACT(EPOCH FROM started_at) * 1000 AS started_at_ms
            FROM spans
            WHERE causal_chain_id = $1
            ORDER BY started_at ASC
            """,
            causal_chain_id,
        )
        return [dict(r) for r in rows]

    def _compute_diff(
        self,
        chain_a: str,
        chain_b: str,
        spans_a: list[dict],
        spans_b: list[dict],
    ) -> TraceDiff:
        # Index by operation name (last wins for duplicates -- use mean for latency)
        def index_by_op(spans: list[dict]) -> dict[str, dict]:
            idx: dict[str, list[dict]] = {}
            for s in spans:
                op = s["operation_name"]
                idx.setdefault(op, []).append(s)
            # Aggregate: mean duration, first status and agent
            result = {}
            for op, ss in idx.items():
                result[op] = {
                    "operation_name": op,
                    "duration_ms":    sum(s.get("duration_ms") or 0 for s in ss) / len(ss),
                    "status":         ss[0]["status"],
                    "agent_id":       ss[0]["agent_id"],
                    "count":          len(ss),
                }
            return result

        idx_a = index_by_op(spans_a)
        idx_b = index_by_op(spans_b)

        ops_a = set(idx_a.keys())
        ops_b = set(idx_b.keys())
        only_a  = sorted(ops_a - ops_b)
        only_b  = sorted(ops_b - ops_a)
        common  = sorted(ops_a & ops_b)

        # Agents
        agents_a = set(s["agent_id"] for s in spans_a)
        agents_b = set(s["agent_id"] for s in spans_b)

        # Per-operation diffs
        op_diffs: list[OperationDiff] = []

        for op in only_a:
            s = idx_a[op]
            op_diffs.append(OperationDiff(
                operation_name=op,
                in_chain_a=True, in_chain_b=False,
                duration_ms_a=s["duration_ms"], duration_ms_b=None,
                delta_ms=None, delta_pct=None,
                status_a=s["status"], status_b=None,
                status_changed=False,
                agent_a=s["agent_id"], agent_b=None,
                agent_changed=False,
            ))

        for op in only_b:
            s = idx_b[op]
            op_diffs.append(OperationDiff(
                operation_name=op,
                in_chain_a=False, in_chain_b=True,
                duration_ms_a=None, duration_ms_b=s["duration_ms"],
                delta_ms=None, delta_pct=None,
                status_a=None, status_b=s["status"],
                status_changed=False,
                agent_a=None, agent_b=s["agent_id"],
                agent_changed=False,
            ))

        for op in common:
            sa = idx_a[op]
            sb = idx_b[op]
            dur_a = sa["duration_ms"]
            dur_b = sb["duration_ms"]
            delta = dur_b - dur_a
            pct   = (delta / dur_a * 100) if dur_a > 0 else 0.0
            op_diffs.append(OperationDiff(
                operation_name=op,
                in_chain_a=True, in_chain_b=True,
                duration_ms_a=round(dur_a, 2),
                duration_ms_b=round(dur_b, 2),
                delta_ms=round(delta, 2),
                delta_pct=round(pct, 1),
                status_a=sa["status"], status_b=sb["status"],
                status_changed=sa["status"] != sb["status"],
                agent_a=sa["agent_id"], agent_b=sb["agent_id"],
                agent_changed=sa["agent_id"] != sb["agent_id"],
            ))

        # Sort: only_a first, then only_b, then common sorted by |delta_ms|
        op_diffs.sort(key=lambda d: (
            0 if not d.in_chain_b else (1 if not d.in_chain_a else 2),
            -(abs(d.delta_ms) if d.delta_ms is not None else 0),
        ))

        # Divergence score
        # = (|only_a| + |only_b|) / (|ops_a| + |ops_b|) weighted by status changes
        union_size = len(ops_a | ops_b)
        sym_diff   = len(only_a) + len(only_b)
        status_changes = sum(1 for d in op_diffs if d.status_changed)
        divergence = (sym_diff / union_size * 0.6 + status_changes / max(len(common), 1) * 0.4) if union_size > 0 else 0.0
        divergence = min(1.0, divergence)

        # First divergence point: first op in ordering of chain_a that differs
        first_divergence: str | None = None
        ops_a_ordered = [s["operation_name"] for s in spans_a]
        for op in ops_a_ordered:
            if op in only_a:
                first_divergence = op
                break
            d = next((x for x in op_diffs if x.operation_name == op and x.status_changed), None)
            if d:
                first_divergence = op
                break

        # Aggregate stats
        total_cost_a = sum(s.get("estimated_usd") or 0 for s in spans_a)
        total_cost_b = sum(s.get("estimated_usd") or 0 for s in spans_b)
        total_dur_a  = sum(s.get("duration_ms") or 0 for s in spans_a)
        total_dur_b  = sum(s.get("duration_ms") or 0 for s in spans_b)
        err_a = sum(1 for s in spans_a if s["status"] == "error")
        err_b = sum(1 for s in spans_b if s["status"] == "error")

        # Summary
        if divergence < 0.1:
            verdict = "nearly identical execution paths"
        elif divergence < 0.3:
            verdict = "minor divergence in latency or agent assignment"
        elif divergence < 0.6:
            verdict = "moderate divergence with some missing operations"
        else:
            verdict = "significantly different execution paths"

        summary = (
            f"Chains diverge at '{first_divergence}' with divergence score {divergence:.2f} ({verdict}). "
            f"Chain A: {len(spans_a)} spans, {err_a} errors, ${total_cost_a:.4f}. "
            f"Chain B: {len(spans_b)} spans, {err_b} errors, ${total_cost_b:.4f}. "
            f"Cost delta: ${total_cost_b - total_cost_a:+.4f}, "
            f"Duration delta: {total_dur_b - total_dur_a:+.0f}ms."
        )

        return TraceDiff(
            chain_a=chain_a,
            chain_b=chain_b,
            divergence_score=round(divergence, 4),
            first_divergence=first_divergence,
            operations_only_a=only_a,
            operations_only_b=only_b,
            common_operations=common,
            operation_diffs=op_diffs,
            agents_only_a=sorted(agents_a - agents_b),
            agents_only_b=sorted(agents_b - agents_a),
            common_agents=sorted(agents_a & agents_b),
            total_cost_a=round(total_cost_a, 6),
            total_cost_b=round(total_cost_b, 6),
            cost_delta=round(total_cost_b - total_cost_a, 6),
            total_duration_ms_a=round(total_dur_a, 2),
            total_duration_ms_b=round(total_dur_b, 2),
            duration_delta_ms=round(total_dur_b - total_dur_a, 2),
            span_count_a=len(spans_a),
            span_count_b=len(spans_b),
            error_count_a=err_a,
            error_count_b=err_b,
            summary=summary,
        )

    def _serialize(self, diff: TraceDiff) -> dict[str, Any]:
        return {
            "chain_a":             diff.chain_a,
            "chain_b":             diff.chain_b,
            "divergence_score":    diff.divergence_score,
            "first_divergence":    diff.first_divergence,
            "summary":             diff.summary,
            "operations_only_a":   diff.operations_only_a,
            "operations_only_b":   diff.operations_only_b,
            "common_operations":   diff.common_operations,
            "agents_only_a":       diff.agents_only_a,
            "agents_only_b":       diff.agents_only_b,
            "common_agents":       diff.common_agents,
            "stats": {
                "span_count_a":        diff.span_count_a,
                "span_count_b":        diff.span_count_b,
                "error_count_a":       diff.error_count_a,
                "error_count_b":       diff.error_count_b,
                "total_cost_a":        diff.total_cost_a,
                "total_cost_b":        diff.total_cost_b,
                "cost_delta":          diff.cost_delta,
                "total_duration_ms_a": diff.total_duration_ms_a,
                "total_duration_ms_b": diff.total_duration_ms_b,
                "duration_delta_ms":   diff.duration_delta_ms,
            },
            "operation_diffs": [
                {
                    "operation_name":  d.operation_name,
                    "in_chain_a":      d.in_chain_a,
                    "in_chain_b":      d.in_chain_b,
                    "duration_ms_a":   d.duration_ms_a,
                    "duration_ms_b":   d.duration_ms_b,
                    "delta_ms":        d.delta_ms,
                    "delta_pct":       d.delta_pct,
                    "status_a":        d.status_a,
                    "status_b":        d.status_b,
                    "status_changed":  d.status_changed,
                    "agent_a":         d.agent_a,
                    "agent_b":         d.agent_b,
                    "agent_changed":   d.agent_changed,
                }
                for d in diff.operation_diffs
            ],
        }
