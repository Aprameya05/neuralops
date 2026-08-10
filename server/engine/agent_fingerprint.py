"""
NeuralOps Agent Fingerprinting Engine.

Clusters agents by behavioral signature extracted from their trace patterns.
Answers:
  - "Which agents behave similarly?"
  - "Are these two agents doing redundant work?"
  - "What is this agent's behavioral archetype?"

Behavioral signature vector (per agent):
  1. Operation distribution  -- normalized histogram of operation_name frequencies
  2. Latency profile         -- [p50, p95, p99] normalized by global max
  3. Error profile           -- [error_rate, error_burstiness]
  4. Cost profile            -- [avg_cost_per_span, cost_variance]
  5. Temporal pattern        -- avg spans per chain, chain depth estimate
  6. Tool affinity           -- fraction of spans that are tool calls

Similarity = cosine similarity between signature vectors.
Clustering = agglomerative clustering with cosine distance threshold 0.3.

Archetypes (assigned based on dominant signal):
  ORCHESTRATOR  -- low latency, high centrality, many downstream spans
  RESEARCHER    -- high tool affinity, moderate latency, web search heavy
  PLANNER       -- low tool affinity, high LLM cost, reasoning heavy
  CRITIC        -- low cost, fast, evaluation operations dominant
  EXECUTOR      -- high autonomy, tool-heavy, low LLM cost
  UNKNOWN       -- insufficient data
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


@dataclass
class AgentFingerprint:
    agent_id:          str
    agent_framework:   str
    service_name:      str
    archetype:         str               # ORCHESTRATOR, RESEARCHER, PLANNER, CRITIC, EXECUTOR, UNKNOWN
    signature:         list[float]       # raw feature vector (normalized)
    total_spans:       int
    total_chains:      int
    # Feature breakdown
    top_operations:    list[tuple[str, float]]   # (op_name, fraction)
    avg_latency_ms:    float
    p95_latency_ms:    float
    error_rate:        float
    tool_affinity:     float             # 0-1, fraction of spans that are tool calls
    avg_cost_per_span: float
    spans_per_chain:   float


@dataclass
class AgentSimilarity:
    agent_a:     str
    agent_b:     str
    similarity:  float    # 0-1, cosine similarity of signature vectors
    shared_ops:  list[str]
    explanation: str


@dataclass
class AgentCluster:
    cluster_id:   int
    archetype:    str
    agents:       list[str]
    centroid:     list[float]
    cohesion:     float       # avg intra-cluster similarity
    description:  str


@dataclass
class FingerprintReport:
    fingerprints:    list[AgentFingerprint]
    similarities:    list[AgentSimilarity]
    clusters:        list[AgentCluster]
    summary:         str


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------

_TOOL_OP_PREFIXES = ("tool_call", "tool.", "execute_", "fetch_", "search_", "read_")
_LLM_OP_PREFIXES  = ("llm_", "llm.", "generate_", "chat_", "complete_")


def _is_tool_op(op: str) -> bool:
    return any(op.lower().startswith(p) for p in _TOOL_OP_PREFIXES)


def _assign_archetype(fp: AgentFingerprint) -> str:
    """Rule-based archetype assignment from feature vector."""
    if fp.total_spans < 5:
        return "UNKNOWN"

    # Orchestrator: many spans per chain, low tool affinity, moderate latency
    if fp.spans_per_chain > 4 and fp.tool_affinity < 0.2:
        return "ORCHESTRATOR"

    # Researcher: high tool affinity
    if fp.tool_affinity > 0.4:
        return "RESEARCHER"

    # Critic: fast, low cost, evaluation ops
    eval_ops = {"critic_evaluate_output", "evaluate", "score", "validate", "verify"}
    top_op_names = {op for op, _ in fp.top_operations[:3]}
    if top_op_names & eval_ops or (fp.avg_latency_ms < 500 and fp.avg_cost_per_span < 0.0001):
        return "CRITIC"

    # Planner: high cost, reasoning ops, low tool affinity
    plan_ops = {"plan_decompose_query", "plan", "decompose", "reason", "think"}
    if top_op_names & plan_ops or (fp.avg_cost_per_span > 0.0005 and fp.tool_affinity < 0.3):
        return "PLANNER"

    # Executor: autonomous tool calls
    if fp.tool_affinity > 0.25:
        return "EXECUTOR"

    return "UNKNOWN"


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot  = sum(x * y for x, y in zip(a, b))
    na   = math.sqrt(sum(x * x for x in a))
    nb   = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return round(dot / (na * nb), 4)


# ---------------------------------------------------------------------------
# Main engine
# ---------------------------------------------------------------------------

class AgentFingerprintEngine:
    def __init__(self, pg: asyncpg.Pool) -> None:
        self._pg = pg

    async def fingerprint(self, hours: int = 24) -> FingerprintReport:
        spans = await self._fetch_spans(hours)
        if not spans:
            return FingerprintReport([], [], [], "No span data available.")

        fps = self._compute_fingerprints(spans)
        similarities = self._compute_similarities(fps)
        clusters = self._cluster(fps)
        summary = self._summarize(fps, clusters)

        return FingerprintReport(
            fingerprints=fps,
            similarities=similarities,
            clusters=clusters,
            summary=summary,
        )

    async def _fetch_spans(self, hours: int) -> list[dict[str, Any]]:
        rows = await self._pg.fetch(
            """
            SELECT
                agent_id, agent_framework, service_name,
                operation_name, status, duration_ms,
                estimated_usd, tool_name,
                causal_chain_id
            FROM spans
            WHERE started_at >= NOW() - INTERVAL '1 hour' * $1
            """,
            hours,
        )
        return [dict(r) for r in rows]

    def _compute_fingerprints(self, spans: list[dict]) -> list[AgentFingerprint]:
        # Group by (agent_id, agent_framework, service_name)
        groups: dict[tuple, list[dict]] = {}
        for s in spans:
            key = (s["agent_id"], s["agent_framework"] or "unknown", s["service_name"] or "unknown")
            groups.setdefault(key, []).append(s)

        fps: list[AgentFingerprint] = []
        for (agent_id, framework, service), agent_spans in groups.items():
            if len(agent_spans) < 2:
                continue

            # Operation distribution
            op_counts: dict[str, int] = {}
            for s in agent_spans:
                op = s["operation_name"]
                op_counts[op] = op_counts.get(op, 0) + 1
            total_ops = len(agent_spans)
            op_dist = {op: cnt / total_ops for op, cnt in op_counts.items()}
            top_ops = sorted(op_dist.items(), key=lambda x: x[1], reverse=True)[:5]

            # Latency
            durations = [float(s["duration_ms"] or 0) for s in agent_spans if s["duration_ms"]]
            avg_lat = statistics.mean(durations) if durations else 0.0
            p95_lat = sorted(durations)[int(len(durations) * 0.95)] if durations else 0.0

            # Error rate
            error_rate = sum(1 for s in agent_spans if s["status"] == "error") / total_ops

            # Tool affinity
            tool_affinity = sum(1 for s in agent_spans if _is_tool_op(s["operation_name"])) / total_ops

            # Cost
            costs = [float(s["estimated_usd"] or 0) for s in agent_spans]
            avg_cost = statistics.mean(costs) if costs else 0.0

            # Chains
            chains = set(s["causal_chain_id"] for s in agent_spans)
            spans_per_chain = total_ops / len(chains) if chains else 1.0

            # Build signature vector (normalized features)
            # [avg_lat_norm, p95_lat_norm, error_rate, tool_affinity,
            #  avg_cost_norm, spans_per_chain_norm, top3_op_fractions...]
            sig = [
                min(1.0, avg_lat / 3000.0),           # avg latency (3s = 1.0)
                min(1.0, p95_lat / 5000.0),            # p95 latency (5s = 1.0)
                error_rate,                            # already 0-1
                tool_affinity,                         # already 0-1
                min(1.0, avg_cost * 10000),            # cost ($0.0001 = 1.0)
                min(1.0, spans_per_chain / 10.0),      # spans/chain (10 = 1.0)
            ]
            # Add top-3 operation fractions (pad with 0 if fewer ops)
            for _, frac in (top_ops[:3] + [(None, 0.0)] * 3)[:3]:
                sig.append(frac)

            fp = AgentFingerprint(
                agent_id=agent_id,
                agent_framework=framework,
                service_name=service,
                archetype="UNKNOWN",  # assigned below
                signature=sig,
                total_spans=total_ops,
                total_chains=len(chains),
                top_operations=top_ops,
                avg_latency_ms=round(avg_lat, 2),
                p95_latency_ms=round(p95_lat, 2),
                error_rate=round(error_rate, 4),
                tool_affinity=round(tool_affinity, 4),
                avg_cost_per_span=round(avg_cost, 8),
                spans_per_chain=round(spans_per_chain, 2),
            )
            fp.archetype = _assign_archetype(fp)
            fps.append(fp)

        return fps

    def _compute_similarities(self, fps: list[AgentFingerprint]) -> list[AgentSimilarity]:
        results: list[AgentSimilarity] = []
        for i in range(len(fps)):
            for j in range(i + 1, len(fps)):
                a, b = fps[i], fps[j]
                sim = _cosine_similarity(a.signature, b.signature)

                ops_a = {op for op, _ in a.top_operations}
                ops_b = {op for op, _ in b.top_operations}
                shared = sorted(ops_a & ops_b)

                if sim > 0.95:
                    desc = "nearly identical behavior -- possible redundancy"
                elif sim > 0.8:
                    desc = "highly similar behavior patterns"
                elif sim > 0.6:
                    desc = "moderately similar -- same archetype likely"
                elif sim > 0.4:
                    desc = "some behavioral overlap"
                else:
                    desc = "distinct behavioral profiles"

                results.append(AgentSimilarity(
                    agent_a=a.agent_id,
                    agent_b=b.agent_id,
                    similarity=sim,
                    shared_ops=shared,
                    explanation=desc,
                ))

        results.sort(key=lambda r: r.similarity, reverse=True)
        return results

    def _cluster(self, fps: list[AgentFingerprint]) -> list[AgentCluster]:
        """
        Simple agglomerative clustering with cosine distance threshold 0.4.
        O(n^2) -- fine for the number of agents in any real deployment.
        """
        if not fps:
            return []

        # Start: each agent in its own cluster
        clusters: list[list[int]] = [[i] for i in range(len(fps))]

        # Merge until no pair has similarity > 0.6
        changed = True
        while changed:
            changed = False
            best_sim = 0.0
            best_pair = (-1, -1)

            for i in range(len(clusters)):
                for j in range(i + 1, len(clusters)):
                    # Average linkage
                    sims = [
                        _cosine_similarity(fps[a].signature, fps[b].signature)
                        for a in clusters[i]
                        for b in clusters[j]
                    ]
                    avg_sim = statistics.mean(sims) if sims else 0.0
                    if avg_sim > best_sim:
                        best_sim = avg_sim
                        best_pair = (i, j)

            if best_sim > 0.6 and best_pair[0] >= 0:
                i, j = best_pair
                clusters[i].extend(clusters[j])
                clusters.pop(j)
                changed = True

        # Build AgentCluster objects
        result: list[AgentCluster] = []
        for cid, member_idxs in enumerate(clusters):
            members = [fps[i] for i in member_idxs]
            agent_ids = [m.agent_id for m in members]

            # Centroid = mean of signatures
            sig_len = len(members[0].signature)
            centroid = [
                statistics.mean(m.signature[k] for m in members)
                for k in range(sig_len)
            ]

            # Cohesion = avg pairwise similarity
            if len(members) > 1:
                pairs = [
                    _cosine_similarity(members[a].signature, members[b].signature)
                    for a in range(len(members))
                    for b in range(a + 1, len(members))
                ]
                cohesion = round(statistics.mean(pairs), 4)
            else:
                cohesion = 1.0

            # Dominant archetype
            archetypes = [m.archetype for m in members]
            dominant = max(set(archetypes), key=archetypes.count)

            # Description
            avg_err  = statistics.mean(m.error_rate for m in members)
            avg_tool = statistics.mean(m.tool_affinity for m in members)
            desc = (
                f"{dominant} cluster: {len(members)} agent(s), "
                f"avg error rate {avg_err:.1%}, "
                f"tool affinity {avg_tool:.1%}, "
                f"cohesion {cohesion:.2f}"
            )

            result.append(AgentCluster(
                cluster_id=cid,
                archetype=dominant,
                agents=agent_ids,
                centroid=centroid,
                cohesion=cohesion,
                description=desc,
            ))

        return result

    def _summarize(self, fps: list[AgentFingerprint], clusters: list[AgentCluster]) -> str:
        archetype_counts: dict[str, int] = {}
        for fp in fps:
            archetype_counts[fp.archetype] = archetype_counts.get(fp.archetype, 0) + 1

        lines = [
            f"Analyzed {len(fps)} agents across {len(clusters)} behavioral clusters.",
            "Archetype distribution: " + ", ".join(f"{k}={v}" for k, v in archetype_counts.items()),
        ]

        high_err = [fp for fp in fps if fp.error_rate > 0.3]
        if high_err:
            lines.append(f"High error rate agents (>30%): {', '.join(fp.agent_id for fp in high_err)}")

        redundant = [c for c in clusters if len(c.agents) > 1 and c.cohesion > 0.9]
        if redundant:
            lines.append(f"Potential redundancy detected in {len(redundant)} cluster(s).")

        return " ".join(lines)


# ---------------------------------------------------------------------------
# Shared pool injection
# ---------------------------------------------------------------------------

_pool: asyncpg.Pool | None = None


def set_pool(pool: asyncpg.Pool) -> None:
    global _pool
    _pool = pool


def get_engine() -> AgentFingerprintEngine:
    if _pool is None:
        raise RuntimeError("AgentFingerprintEngine: pool not initialized.")
    return AgentFingerprintEngine(_pool)
