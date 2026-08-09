"""
WebSocket connection manager — broadcasts drift alerts and live span events
to all connected dashboard clients.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import structlog
from fastapi import WebSocket

log = structlog.get_logger(__name__)


class WebSocketManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)
        log.info("ws.connected", total=len(self._connections))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)
        log.info("ws.disconnected", total=len(self._connections))

    async def broadcast(self, event_type: str, payload: Any) -> None:
        """Fan-out to all connected clients. Drops lagging clients."""
        if not self._connections:
            return
        message = json.dumps({"type": event_type, "payload": payload}, default=str)
        dead: set[WebSocket] = set()
        async with self._lock:
            conns = set(self._connections)
        for ws in conns:
            try:
                await asyncio.wait_for(ws.send_text(message), timeout=1.0)
            except Exception:
                dead.add(ws)
        if dead:
            async with self._lock:
                self._connections -= dead