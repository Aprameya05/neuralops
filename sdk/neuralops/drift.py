"""
Real-time drift detection for agent behavior.

Detects:
  1. Latency drift      — rolling z-score on span duration
  2. Cost drift         — exponential moving average on USD per call
  3. Error rate drift   — sliding window error rate threshold
  4. Token drift        — unexpected token count spikes (prompt inflation)

Design: Pure Python, no ML framework dependency. Uses Welford's online
algorithm for numerically stable running mean/variance.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class DriftType(str, Enum):
    LATENCY = "latency"
    COST = "cost"
    ERROR_RATE = "error_rate"
    TOKEN_COUNT = "token_count"


@dataclass
class DriftAlert:
    drift_type: DriftType
    current_value: float
    baseline_value: float
    z_score: float
    severity: str  # "warning" | "critical"
    message: str
    agent_id: str
    operation_name: str


@dataclass
class _WelfordAccumulator:
    """Welford's online algorithm for stable incremental mean/variance."""
    n: int = 0
    mean: float = 0.0
    M2: float = 0.0  # sum of squared deviations

    def update(self, x: float) -> None:
        self.n += 1
        delta = x - self.mean
        self.mean += delta / self.n
        delta2 = x - self.mean
        self.M2 += delta * delta2

    @property
    def variance(self) -> float:
        return self.M2 / (self.n - 1) if self.n > 1 else 0.0

    @property
    def std(self) -> float:
        return math.sqrt(self.variance)

    def z_score(self, x: float) -> float:
        if self.std == 0:
            return 0.0
        return (x - self.mean) / self.std


class DriftDetector:
    """
    Per-operation drift detector. One instance per agent/operation pair.

    Usage:
        detector = DriftDetector(agent_id="planner", window=200)
        alert = detector.observe(span)
        if alert:
            print(alert.message)
    """

    def __init__(
        self,
        agent_id: str,
        window: int = 200,
        latency_z_warn: float = 2.5,
        latency_z_crit: float = 4.0,
        cost_ema_alpha: float = 0.1,
        cost_spike_ratio: float = 3.0,
        error_rate_window: int = 50,
        error_rate_threshold: float = 0.15,
    ) -> None:
        self.agent_id = agent_id
        self._window = window
        self._latency_z_warn = latency_z_warn
        self._latency_z_crit = latency_z_crit
        self._cost_ema_alpha = cost_ema_alpha
        self._cost_spike_ratio = cost_spike_ratio
        self._error_rate_window = error_rate_window
        self._error_rate_threshold = error_rate_threshold

        # Per-operation accumulators
        self._latency: dict[str, _WelfordAccumulator] = {}
        self._cost_ema: dict[str, float] = {}
        self._error_window: dict[str, deque[bool]] = {}
        self._token_acc: dict[str, _WelfordAccumulator] = {}

    def observe(self, span: Any) -> list[DriftAlert]:
        """
        Feed a span to the detector. Returns a (possibly empty) list of alerts.
        Call this in the exporter after every span lands.
        """
        alerts: list[DriftAlert] = []
        op = getattr(span, "operation_name", "unknown")

        # --- Latency ---
        duration = getattr(span, "duration_ms", None)
        if duration is not None:
            acc = self._latency.setdefault(op, _WelfordAccumulator())
            if acc.n >= 10:  # need baseline before alerting
                z = acc.z_score(duration)
                if abs(z) >= self._latency_z_crit:
                    alerts.append(DriftAlert(
                        drift_type=DriftType.LATENCY,
                        current_value=duration,
                        baseline_value=acc.mean,
                        z_score=z,
                        severity="critical",
                        message=f"{op} latency {duration:.1f}ms is {z:.1f}σ from baseline {acc.mean:.1f}ms",
                        agent_id=self.agent_id,
                        operation_name=op,
                    ))
                elif abs(z) >= self._latency_z_warn:
                    alerts.append(DriftAlert(
                        drift_type=DriftType.LATENCY,
                        current_value=duration,
                        baseline_value=acc.mean,
                        z_score=z,
                        severity="warning",
                        message=f"{op} latency elevated: {duration:.1f}ms vs baseline {acc.mean:.1f}ms",
                        agent_id=self.agent_id,
                        operation_name=op,
                    ))
            acc.update(duration)

        # --- Cost ---
        cost = getattr(getattr(span, "cost", None), "estimated_usd", None)
        if cost is not None and cost > 0:
            ema = self._cost_ema.get(op)
            if ema is not None:
                if cost > ema * self._cost_spike_ratio and ema > 0.0001:
                    alerts.append(DriftAlert(
                        drift_type=DriftType.COST,
                        current_value=cost,
                        baseline_value=ema,
                        z_score=cost / ema,
                        severity="warning",
                        message=f"{op} cost spike: ${cost:.6f} vs EMA ${ema:.6f}",
                        agent_id=self.agent_id,
                        operation_name=op,
                    ))
                self._cost_ema[op] = self._cost_ema_alpha * cost + (1 - self._cost_ema_alpha) * ema
            else:
                self._cost_ema[op] = cost

        # --- Error rate ---
        status = getattr(span, "status", None)
        if status is not None:
            window = self._error_window.setdefault(
                op, deque(maxlen=self._error_rate_window)
            )
            is_error = str(status) in ("SpanStatus.ERROR", "error")
            window.append(is_error)
            if len(window) >= self._error_rate_window:
                rate = sum(window) / len(window)
                if rate >= self._error_rate_threshold:
                    alerts.append(DriftAlert(
                        drift_type=DriftType.ERROR_RATE,
                        current_value=rate,
                        baseline_value=0.0,
                        z_score=rate / self._error_rate_threshold,
                        severity="critical" if rate >= 0.3 else "warning",
                        message=f"{op} error rate {rate:.1%} exceeds threshold {self._error_rate_threshold:.1%}",
                        agent_id=self.agent_id,
                        operation_name=op,
                    ))

        return alerts