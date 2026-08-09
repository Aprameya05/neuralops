"""
NeuralOps Alert Integrations — Slack and PagerDuty.

Sends drift alerts, error spikes, and cost anomalies to:
- Slack: webhook-based, rich formatted messages
- PagerDuty: Events API v2, severity-based routing

Usage:
    from server.engine.alerts import AlertManager

    manager = AlertManager(
        slack_webhook_url=os.environ.get('SLACK_WEBHOOK_URL'),
        pagerduty_routing_key=os.environ.get('PAGERDUTY_ROUTING_KEY'),
    )

    await manager.send_drift_alert(alert)
    await manager.send_cost_spike(agent_id, current_usd, baseline_usd)
    await manager.send_error_rate_alert(operation, error_rate)
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx
import structlog

log = structlog.get_logger(__name__)


@dataclass
class AlertPayload:
    title: str
    severity: str        # critical / warning / info
    agent_id: str
    operation: str
    current_value: float
    baseline_value: float
    message: str
    drift_type: str
    causal_chain_id: str | None = None


class SlackAlerter:
    """
    Sends formatted alerts to a Slack webhook.
    Free, no SDK needed, just a webhook URL.
    """

    SEVERITY_EMOJI = {
        "critical": ":red_circle:",
        "warning":  ":yellow_circle:",
        "info":     ":blue_circle:",
    }

    SEVERITY_COLOR = {
        "critical": "#ef4444",
        "warning":  "#f59e0b",
        "info":     "#6366f1",
    }

    def __init__(self, webhook_url: str) -> None:
        self._webhook_url = webhook_url

    async def send(self, alert: AlertPayload) -> bool:
        emoji = self.SEVERITY_EMOJI.get(alert.severity, ":white_circle:")
        color = self.SEVERITY_COLOR.get(alert.severity, "#888888")

        dashboard_url = "https://neuralops.pages.dev"
        replay_url = (
            f"{dashboard_url}/replay/{alert.causal_chain_id}"
            if alert.causal_chain_id
            else f"{dashboard_url}/traces"
        )

        payload = {
            "text": f"{emoji} *NeuralOps Alert* — {alert.title}",
            "attachments": [
                {
                    "color": color,
                    "blocks": [
                        {
                            "type": "section",
                            "fields": [
                                {"type": "mrkdwn", "text": f"*Agent*\n`{alert.agent_id}`"},
                                {"type": "mrkdwn", "text": f"*Operation*\n`{alert.operation}`"},
                                {"type": "mrkdwn", "text": f"*Type*\n{alert.drift_type}"},
                                {"type": "mrkdwn", "text": f"*Severity*\n{alert.severity.upper()}"},
                                {"type": "mrkdwn", "text": f"*Current*\n`{alert.current_value:.4f}`"},
                                {"type": "mrkdwn", "text": f"*Baseline*\n`{alert.baseline_value:.4f}`"},
                            ],
                        },
                        {
                            "type": "section",
                            "text": {"type": "mrkdwn", "text": f"_{alert.message}_"},
                        },
                        {
                            "type": "actions",
                            "elements": [
                                {
                                    "type": "button",
                                    "text": {"type": "plain_text", "text": "View Dashboard"},
                                    "url": dashboard_url,
                                    "style": "primary",
                                },
                                {
                                    "type": "button",
                                    "text": {"type": "plain_text", "text": "Replay Trace"},
                                    "url": replay_url,
                                },
                            ],
                        },
                    ],
                }
            ],
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(self._webhook_url, json=payload)
                if resp.status_code == 200:
                    log.info("slack.alert_sent", title=alert.title, severity=alert.severity)
                    return True
                else:
                    log.warning("slack.alert_failed", status=resp.status_code, body=resp.text[:100])
                    return False
        except Exception as exc:
            log.error("slack.alert_error", error=str(exc))
            return False


class PagerDutyAlerter:
    """
    Sends alerts to PagerDuty via Events API v2.
    Free tier supports unlimited events.
    """

    SEVERITY_MAP = {
        "critical": "critical",
        "warning":  "warning",
        "info":     "info",
    }

    EVENTS_URL = "https://events.pagerduty.com/v2/enqueue"

    def __init__(self, routing_key: str) -> None:
        self._routing_key = routing_key

    async def send(self, alert: AlertPayload) -> bool:
        payload = {
            "routing_key": self._routing_key,
            "event_action": "trigger",
            "dedup_key": f"neuralops-{alert.agent_id}-{alert.operation}-{alert.drift_type}",
            "payload": {
                "summary": f"[NeuralOps] {alert.title}",
                "severity": self.SEVERITY_MAP.get(alert.severity, "warning"),
                "source": f"neuralops/{alert.agent_id}",
                "component": alert.operation,
                "group": alert.agent_id,
                "class": alert.drift_type,
                "custom_details": {
                    "agent_id":       alert.agent_id,
                    "operation":      alert.operation,
                    "drift_type":     alert.drift_type,
                    "current_value":  alert.current_value,
                    "baseline_value": alert.baseline_value,
                    "message":        alert.message,
                    "dashboard":      "https://neuralops.pages.dev",
                    "causal_chain":   alert.causal_chain_id or "N/A",
                },
            },
            "links": [
                {
                    "href": "https://neuralops.pages.dev",
                    "text": "NeuralOps Dashboard",
                }
            ],
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(self.EVENTS_URL, json=payload)
                if resp.status_code in (200, 202):
                    data = resp.json()
                    log.info(
                        "pagerduty.alert_sent",
                        title=alert.title,
                        dedup_key=data.get("dedup_key"),
                    )
                    return True
                else:
                    log.warning("pagerduty.alert_failed", status=resp.status_code)
                    return False
        except Exception as exc:
            log.error("pagerduty.alert_error", error=str(exc))
            return False


class AlertManager:
    """
    Unified alert manager — sends to Slack and/or PagerDuty.

    Usage:
        manager = AlertManager.from_env()
        await manager.fire(alert)
    """

    def __init__(
        self,
        slack_webhook_url: str | None = None,
        pagerduty_routing_key: str | None = None,
    ) -> None:
        self._slack = SlackAlerter(slack_webhook_url) if slack_webhook_url else None
        self._pd    = PagerDutyAlerter(pagerduty_routing_key) if pagerduty_routing_key else None

        configured = []
        if self._slack:
            configured.append("Slack")
        if self._pd:
            configured.append("PagerDuty")

        if configured:
            log.info("alert_manager.configured", integrations=configured)
        else:
            log.warning("alert_manager.no_integrations — set SLACK_WEBHOOK_URL or PAGERDUTY_ROUTING_KEY")

    @classmethod
    def from_env(cls) -> "AlertManager":
        return cls(
            slack_webhook_url=os.environ.get("SLACK_WEBHOOK_URL"),
            pagerduty_routing_key=os.environ.get("PAGERDUTY_ROUTING_KEY"),
        )

    async def fire(self, alert: AlertPayload) -> None:
        """Send alert to all configured integrations."""
        if self._slack:
            await self._slack.send(alert)
        if self._pd and alert.severity == "critical":
            # Only page on critical — warnings go to Slack only
            await self._pd.send(alert)

    async def send_drift_alert(
        self,
        drift_type: str,
        agent_id: str,
        operation: str,
        current_value: float,
        baseline_value: float,
        severity: str,
        message: str,
        causal_chain_id: str | None = None,
    ) -> None:
        alert = AlertPayload(
            title=f"{drift_type.upper()} drift detected in {operation}",
            severity=severity,
            agent_id=agent_id,
            operation=operation,
            current_value=current_value,
            baseline_value=baseline_value,
            message=message,
            drift_type=drift_type,
            causal_chain_id=causal_chain_id,
        )
        await self.fire(alert)

    async def send_cost_spike(
        self,
        agent_id: str,
        operation: str,
        current_usd: float,
        baseline_usd: float,
        causal_chain_id: str | None = None,
    ) -> None:
        ratio = current_usd / baseline_usd if baseline_usd > 0 else 999
        alert = AlertPayload(
            title=f"Cost spike {ratio:.1f}x baseline for {agent_id}",
            severity="critical" if ratio > 5 else "warning",
            agent_id=agent_id,
            operation=operation,
            current_value=current_usd,
            baseline_value=baseline_usd,
            message=f"${current_usd:.6f} vs baseline ${baseline_usd:.6f} — {ratio:.1f}x spike",
            drift_type="COST",
            causal_chain_id=causal_chain_id,
        )
        await self.fire(alert)

    async def send_error_rate_alert(
        self,
        agent_id: str,
        operation: str,
        error_rate: float,
        threshold: float = 0.15,
        causal_chain_id: str | None = None,
    ) -> None:
        alert = AlertPayload(
            title=f"High error rate {error_rate:.1%} in {operation}",
            severity="critical" if error_rate > 0.3 else "warning",
            agent_id=agent_id,
            operation=operation,
            current_value=error_rate,
            baseline_value=threshold,
            message=f"Error rate {error_rate:.1%} exceeds threshold {threshold:.1%}",
            drift_type="ERROR_RATE",
            causal_chain_id=causal_chain_id,
        )
        await self.fire(alert)
