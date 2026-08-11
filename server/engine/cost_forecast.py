"""
NeuralOps Cost Forecasting Engine
----------------------------------
Simple Exponential Smoothing (Holt-Winters single-parameter) on hourly
cost aggregates.  No external dependencies — pure Python.

Algorithm:
    S_0 = x_0
    S_t = α * x_t + (1 - α) * S_{t-1}    (level smoothing)

Confidence intervals:
    σ² tracked via rolling variance.
    interval = ±z * sqrt(σ²)  where z = 1.645 (90% CI)
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


@dataclass
class ForecastPoint:
    hour: str         # ISO-8601 hour string
    actual: float | None
    forecast: float
    lower: float
    upper: float


class CostForecastEngine:
    """
    Exponential smoothing cost forecaster.

    Parameters
    ----------
    alpha   : smoothing factor (0 < α < 1). Higher = more reactive.
    z_score : z-value for confidence interval (default 1.645 = 90%)
    """

    def __init__(self, alpha: float = 0.25, z_score: float = 1.645):
        self.alpha = alpha
        self.z_score = z_score

    async def forecast(
        self,
        pg,
        hours_history: int = 168,   # 7 days of history
        hours_ahead: int = 24,
    ) -> list[ForecastPoint]:
        """
        Pull hourly cost series from Postgres, fit SES, return history + forecast.
        """
        rows = await pg.fetch(
            """
            SELECT
                date_trunc('hour', started_at)  AS hour,
                COALESCE(sum(estimated_usd), 0) AS cost_usd
            FROM spans
            WHERE started_at >= NOW() - INTERVAL '1 hour' * $1
              AND estimated_usd IS NOT NULL
            GROUP BY hour
            ORDER BY hour ASC
            """,
            hours_history,
        )

        # Build complete hourly grid (fill gaps with 0)
        observed: dict[datetime, float] = {}
        for r in rows:
            observed[r["hour"].replace(tzinfo=timezone.utc)] = float(r["cost_usd"] or 0)

        now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        start = now - timedelta(hours=hours_history)

        history: list[tuple[datetime, float]] = []
        t = start
        while t <= now:
            history.append((t, observed.get(t, 0.0)))
            t += timedelta(hours=1)

        if not history:
            return []

        # Fit SES
        xs = [v for _, v in history]
        level = xs[0]
        residuals: list[float] = []

        smoothed: list[float] = [level]
        for x in xs[1:]:
            pred = level
            level = self.alpha * x + (1 - self.alpha) * level
            residuals.append(x - pred)
            smoothed.append(level)

        # Rolling variance of residuals
        variance = sum(r ** 2 for r in residuals) / max(len(residuals), 1) if residuals else 0.0
        std_dev = math.sqrt(variance)

        result: list[ForecastPoint] = []

        # Historical portion (actual + fitted)
        for i, (ts, actual) in enumerate(history):
            result.append(ForecastPoint(
                hour=ts.strftime("%Y-%m-%dT%H:00:00Z"),
                actual=actual,
                forecast=round(smoothed[i], 8),
                lower=round(max(0, smoothed[i] - self.z_score * std_dev), 8),
                upper=round(smoothed[i] + self.z_score * std_dev, 8),
            ))

        # Forecast future hours
        for h in range(1, hours_ahead + 1):
            ts = now + timedelta(hours=h)
            # For future, level stays flat (SES with no trend)
            # Confidence interval widens with horizon
            horizon_std = std_dev * math.sqrt(1 + (h - 1) * self.alpha ** 2)
            result.append(ForecastPoint(
                hour=ts.strftime("%Y-%m-%dT%H:00:00Z"),
                actual=None,
                forecast=round(max(0, level), 8),
                lower=round(max(0, level - self.z_score * horizon_std), 8),
                upper=round(max(0, level + self.z_score * horizon_std), 8),
            ))

        return result
