"""
Causal stitching engine.

Given a causal_chain_id, this pulls all related spans from ClickHouse
and assembles them into a causal graph — a directed tree where each node
is a span and edges represent parent→child relationships.

This answers: "why did the agent do that?"

Output: CausalGraph — serializable to JSON for the dashboard replay view.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from clickhouse_driver import Client as CHClient

CH_HOST     = os.environ.get("CLICKHOUSE_HOST", "localhost")
CH_USER     = os.environ.get("CLICKHOUSE_USER", "neuralops")
CH_PASSWORD = os.environ.get("CLICKHOUSE_PASSWORD", "neuralops")
CH_DB       = os.environ.get("CLICKHOUSE_DB", "neuralops")


@dataclass
class CausalNode:
    span_id: str
    parent_span_id: str | None
    operation_name: str
    agent_id: str
    agent_framework: str
    service_name: str
    started_at: datetime
    duration_ms: float | None
    status: str
    error_message: str | None
    model: str | None
    tool_name: str | None
    estimated_usd: float | None
    hallucination_score: float | None
    attributes: dict[str, Any] = field(default_factory=dict)
    children: list["CausalNode"] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "span_id":            self.span_id,
            "parent_span_id":     self.parent_span_id,
            "operation_name":     self.operation_name,
            "agent_id":           self.agent_id,
            "agent_framework":    self.agent_framework,
            "service_name":       self.service_name,
            "started_at":         self.started_at.isoformat(),
            "duration_ms":        self.duration_ms,
            "status":             self.status,
            "error_message":      self.error_message,
            "model":              self.model,
            "tool_name":          self.tool_name,
            "estimated_usd":      self.estimated_usd,
            "hallucination_score": self.hallucination_score,
            "attributes":         self.attributes,
            "children":           [c.to_dict() for c in self.children],
        }


@dataclass
class CausalGraph:
    causal_chain_id: str
    roots: list[CausalNode]
    total_spans: int
    total_duration_ms: float
    total_cost_usd: float
    agent_ids: list[str]
    has_errors: bool
    has_hallucinations: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "causal_chain_id":    self.causal_chain_id,
            "roots":              [r.to_dict() for r in self.roots],
            "total_spans":        self.total_spans,
            "total_duration_ms":  self.total_duration_ms,
            "total_cost_usd":     round(self.total_cost_usd, 8),
            "agent_ids":          self.agent_ids,
            "has_errors":         self.has_errors,
            "has_hallucinations": self.has_hallucinations,
        }


class CausalStitcher:
    """
    Assembles a CausalGraph from raw spans stored in ClickHouse.

    Usage:
        stitcher = CausalStitcher()
        graph = stitcher.build(causal_chain_id="abc-123")
        print(graph.to_dict())
    """

    def __init__(self) -> None:
        self._ch = CHClient(
            host=CH_HOST,
            user=CH_USER,
            password=CH_PASSWORD,
            database=CH_DB,
        )

    def build(self, causal_chain_id: str) -> CausalGraph:
        rows = self._fetch_spans(causal_chain_id)
        if not rows:
            return CausalGraph(
                causal_chain_id=causal_chain_id,
                roots=[],
                total_spans=0,
                total_duration_ms=0.0,
                total_cost_usd=0.0,
                agent_ids=[],
                has_errors=False,
                has_hallucinations=False,
            )
        return self._stitch(causal_chain_id, rows)

    def _fetch_spans(self, causal_chain_id: str) -> list[dict[str, Any]]:
        query = """
            SELECT
                span_id, parent_span_id, operation_name,
                agent_id, agent_framework, service_name,
                started_at, duration_ms, status, error_message,
                model, tool_name, estimated_usd, hallucination_score,
                attributes
            FROM neuralops.spans
            WHERE causal_chain_id = %(cid)s
            ORDER BY started_at ASC
            LIMIT 10000
        """
        rows = self._ch.execute(query, {"cid": causal_chain_id}, with_column_types=True)
        data, columns = rows
        col_names = [c[0] for c in columns]
        return [dict(zip(col_names, row)) for row in data]

    def _stitch(self, causal_chain_id: str, rows: list[dict[str, Any]]) -> CausalGraph:
        # Build node map
        nodes: dict[str, CausalNode] = {}
        for row in rows:
            import json
            attrs = row.get("attributes") or "{}"
            if isinstance(attrs, str):
                try:
                    attrs = json.loads(attrs)
                except Exception:
                    attrs = {}

            node = CausalNode(
                span_id=row["span_id"],
                parent_span_id=row.get("parent_span_id"),
                operation_name=row["operation_name"],
                agent_id=row["agent_id"],
                agent_framework=row.get("agent_framework", "unknown"),
                service_name=row.get("service_name", "unknown"),
                started_at=row["started_at"],
                duration_ms=row.get("duration_ms"),
                status=row.get("status", "ok"),
                error_message=row.get("error_message"),
                model=row.get("model"),
                tool_name=row.get("tool_name"),
                estimated_usd=row.get("estimated_usd"),
                hallucination_score=row.get("hallucination_score"),
                attributes=attrs,
            )
            nodes[node.span_id] = node

        # Wire parent→child edges
        roots: list[CausalNode] = []
        for node in nodes.values():
            if node.parent_span_id and node.parent_span_id in nodes:
                nodes[node.parent_span_id].children.append(node)
            else:
                roots.append(node)

        # Sort children by start time
        def sort_children(n: CausalNode) -> None:
            n.children.sort(key=lambda c: c.started_at)
            for child in n.children:
                sort_children(child)

        for root in roots:
            sort_children(root)
        roots.sort(key=lambda r: r.started_at)

        # Aggregate stats
        all_nodes = list(nodes.values())
        total_cost = sum(n.estimated_usd or 0.0 for n in all_nodes)
        total_dur  = sum(n.duration_ms or 0.0 for n in all_nodes)
        agent_ids  = sorted(set(n.agent_id for n in all_nodes))
        has_errors = any(n.status == "error" for n in all_nodes)
        has_halluc = any(
            n.hallucination_score is not None and n.hallucination_score > 0.7
            for n in all_nodes
        )

        return CausalGraph(
            causal_chain_id=causal_chain_id,
            roots=roots,
            total_spans=len(all_nodes),
            total_duration_ms=round(total_dur, 3),
            total_cost_usd=total_cost,
            agent_ids=agent_ids,
            has_errors=has_errors,
            has_hallucinations=has_halluc,
        )
