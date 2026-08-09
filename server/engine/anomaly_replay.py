"""
NeuralOps Anomaly Replay Engine.

Finds anomalous traces by statistical analysis and enables:
1. Side-by-side comparison of anomalous vs normal spans
2. Root cause attribution — which span caused the anomaly
3. Counterfactual replay — what would have happened with a different model/provider
4. Timeline reconstruction of cascading failures

This is the "why did it fail" answer that no other tool provides.
"""

from __future__ import annotations

import os
import statistics
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import asyncpg
import structlog

log = structlog.get_logger(__name__)

POSTGRES_URL = os.environ.get("POSTGRES_URL", "")


@dataclass
class AnomalySpan:
    span_id: str
    causal_chain_id: str
    operation_name: str
    agent_id: str
    model: str
    duration_ms: float
    estimated_usd: float
    status: str
    error_message: str
    started_at: datetime
    anomaly_type: str        # LATENCY / COST / ERROR / HALLUCINATION
    anomaly_score: float     # how anomalous (higher = worse)
    baseline_value: float
    actual_value: float


@dataclass
class ReplayComparison:
    causal_chain_id: str
    anomaly_type: str
    root_cause_span: AnomalySpan
    all_anomalies: list[AnomalySpan]
    normal_baseline: dict[str, float]   # operation -> avg value
    timeline: list[dict[str, Any]]
    recommendation: str


class AnomalyReplayEngine:
    """
    Finds anomalous traces and builds replay comparisons.

    Usage:
        engine = AnomalyReplayEngine()
        anomalies = await engine.find_anomalies(hours=24)
        replay = await engine.build_replay(anomalies[0].causal_chain_id)
        print(replay.recommendation)
    """

    def __init__(self) -> None:
        self._pg: asyncpg.Pool | None = None

    async def _get_pool(self) -> asyncpg.Pool:
        if self._pg is None:
            self._pg = await asyncpg.create_pool(POSTGRES_URL, min_size=1, max_size=3)
        return self._pg

    async def find_anomalies(
        self,
        hours: int = 24,
        min_anomaly_score: float = 2.0,
        limit: int = 50,
    ) -> list[AnomalySpan]:
        """
        Find anomalous spans using z-score analysis.
        Returns spans sorted by anomaly score descending.
        """
        pg = await self._get_pool()

        # Fetch all spans in the window with stats
        rows = await pg.fetch(
            """
            WITH stats AS (
                SELECT
                    operation_name,
                    avg(duration_ms)        AS avg_dur,
                    stddev(duration_ms)     AS std_dur,
                    avg(estimated_usd)      AS avg_cost,
                    stddev(estimated_usd)   AS std_cost
                FROM spans
                WHERE started_at >= NOW() - INTERVAL '7 days'
                  AND duration_ms IS NOT NULL
                GROUP BY operation_name
                HAVING count(*) >= 5
            )
            SELECT
                s.span_id, s.causal_chain_id, s.operation_name,
                s.agent_id, s.model, s.duration_ms, s.estimated_usd,
                s.status, s.error_message, s.started_at,
                st.avg_dur, st.std_dur, st.avg_cost, st.std_cost
            FROM spans s
            JOIN stats st ON s.operation_name = st.operation_name
            WHERE s.started_at >= NOW() - INTERVAL '1 hour' * $1
              AND s.duration_ms IS NOT NULL
            ORDER BY s.started_at DESC
            LIMIT 10000
            """,
            hours,
        )

        anomalies: list[AnomalySpan] = []

        for row in rows:
            anomaly_type = None
            anomaly_score = 0.0
            baseline = 0.0
            actual = 0.0

            # Check latency anomaly
            if row["std_dur"] and row["std_dur"] > 0:
                z = abs(row["duration_ms"] - row["avg_dur"]) / row["std_dur"]
                if z >= min_anomaly_score:
                    anomaly_type = "LATENCY"
                    anomaly_score = z
                    baseline = row["avg_dur"]
                    actual = row["duration_ms"]

            # Check error
            if row["status"] == "error":
                anomaly_type = "ERROR"
                anomaly_score = max(anomaly_score, 5.0)
                baseline = 0.0
                actual = 1.0

            # Check cost anomaly
            if row["estimated_usd"] and row["std_cost"] and row["std_cost"] > 0:
                z_cost = abs(row["estimated_usd"] - row["avg_cost"]) / row["std_cost"]
                if z_cost >= min_anomaly_score and z_cost > anomaly_score:
                    anomaly_type = "COST"
                    anomaly_score = z_cost
                    baseline = row["avg_cost"]
                    actual = row["estimated_usd"]

            if anomaly_type and anomaly_score >= min_anomaly_score:
                anomalies.append(AnomalySpan(
                    span_id=row["span_id"],
                    causal_chain_id=row["causal_chain_id"],
                    operation_name=row["operation_name"],
                    agent_id=row["agent_id"],
                    model=row["model"] or "",
                    duration_ms=row["duration_ms"] or 0,
                    estimated_usd=row["estimated_usd"] or 0,
                    status=row["status"],
                    error_message=row["error_message"] or "",
                    started_at=row["started_at"],
                    anomaly_type=anomaly_type,
                    anomaly_score=anomaly_score,
                    baseline_value=baseline,
                    actual_value=actual,
                ))

        anomalies.sort(key=lambda a: a.anomaly_score, reverse=True)
        return anomalies[:limit]

    async def build_replay(self, causal_chain_id: str) -> ReplayComparison | None:
        """
        Build a full replay comparison for an anomalous causal chain.
        Shows timeline, root cause, and recommendation.
        """
        pg = await self._get_pool()

        # Get all spans in the chain
        chain_rows = await pg.fetch(
            """
            SELECT * FROM spans
            WHERE causal_chain_id = $1
            ORDER BY started_at ASC
            """,
            causal_chain_id,
        )

        if not chain_rows:
            return None

        # Get baseline stats for each operation in this chain
        operations = list(set(r["operation_name"] for r in chain_rows))
        baseline_rows = await pg.fetch(
            """
            SELECT operation_name, avg(duration_ms) AS avg_dur, avg(estimated_usd) AS avg_cost
            FROM spans
            WHERE operation_name = ANY($1::text[])
              AND started_at >= NOW() - INTERVAL '7 days'
            GROUP BY operation_name
            """,
            operations,
        )
        baseline = {r["operation_name"]: {
            "avg_dur": r["avg_dur"] or 0,
            "avg_cost": r["avg_cost"] or 0,
        } for r in baseline_rows}

        # Find anomalies within this chain
        chain_anomalies: list[AnomalySpan] = []
        for row in chain_rows:
            op_baseline = baseline.get(row["operation_name"], {})
            avg_dur = op_baseline.get("avg_dur", 0)

            if row["status"] == "error":
                chain_anomalies.append(AnomalySpan(
                    span_id=row["span_id"],
                    causal_chain_id=causal_chain_id,
                    operation_name=row["operation_name"],
                    agent_id=row["agent_id"],
                    model=row["model"] or "",
                    duration_ms=row["duration_ms"] or 0,
                    estimated_usd=row["estimated_usd"] or 0,
                    status=row["status"],
                    error_message=row["error_message"] or "",
                    started_at=row["started_at"],
                    anomaly_type="ERROR",
                    anomaly_score=5.0,
                    baseline_value=0.0,
                    actual_value=1.0,
                ))
            elif avg_dur > 0 and row["duration_ms"] and row["duration_ms"] > avg_dur * 3:
                chain_anomalies.append(AnomalySpan(
                    span_id=row["span_id"],
                    causal_chain_id=causal_chain_id,
                    operation_name=row["operation_name"],
                    agent_id=row["agent_id"],
                    model=row["model"] or "",
                    duration_ms=row["duration_ms"] or 0,
                    estimated_usd=row["estimated_usd"] or 0,
                    status=row["status"],
                    error_message="",
                    started_at=row["started_at"],
                    anomaly_type="LATENCY",
                    anomaly_score=row["duration_ms"] / avg_dur,
                    baseline_value=avg_dur,
                    actual_value=row["duration_ms"],
                ))

        # Determine root cause (first anomaly in timeline)
        chain_anomalies.sort(key=lambda a: a.started_at)
        root_cause = chain_anomalies[0] if chain_anomalies else None

        if not root_cause:
            return None

        # Build recommendation
        if root_cause.anomaly_type == "ERROR":
            recommendation = (
                f"Root cause: {root_cause.operation_name} failed with error. "
                f"Check provider availability and retry logic. "
                f"Consider adding fallback to a different provider."
            )
        elif root_cause.anomaly_type == "LATENCY":
            recommendation = (
                f"Root cause: {root_cause.operation_name} took {root_cause.actual_value:.0f}ms "
                f"vs baseline {root_cause.baseline_value:.0f}ms. "
                f"Consider switching from {root_cause.model} to a faster provider or reducing prompt length."
            )
        else:
            recommendation = f"Anomaly detected in {root_cause.operation_name}. Review span details."

        # Build timeline
        timeline = [
            {
                "span_id":        r["span_id"],
                "operation_name": r["operation_name"],
                "agent_id":       r["agent_id"],
                "started_at":     r["started_at"].isoformat(),
                "duration_ms":    r["duration_ms"],
                "status":         r["status"],
                "is_anomalous":   any(a.span_id == r["span_id"] for a in chain_anomalies),
            }
            for r in chain_rows
        ]

        return ReplayComparison(
            causal_chain_id=causal_chain_id,
            anomaly_type=root_cause.anomaly_type,
            root_cause_span=root_cause,
            all_anomalies=chain_anomalies,
            normal_baseline={op: b["avg_dur"] for op, b in baseline.items()},
            timeline=timeline,
            recommendation=recommendation,
        )
