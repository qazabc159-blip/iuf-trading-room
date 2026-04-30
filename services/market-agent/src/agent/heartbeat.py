"""
src/agent/heartbeat.py — W7 H3: 30s heartbeat sender

Sends POST to HEARTBEAT_URL every 30 seconds with agent liveness info.
Hard lines: HMAC secret never logged.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from .ingest_pusher import get_queue_depth, get_last_push_at

logger = logging.getLogger("market-agent.heartbeat")

HEARTBEAT_URL: str = os.environ.get(
    "HEARTBEAT_URL", "http://localhost:3001/internal/market/heartbeat"
)
AGENT_ID: str = os.environ.get("AGENT_ID", "market-agent-dev")
HEARTBEAT_INTERVAL_SEC = 30.0

# State snapshot accessible to /health endpoint
_state: dict[str, Any] = {
    "last_push_at": None,
    "queue_depth": 0,
}


def get_heartbeat_state() -> dict[str, Any]:
    """Return last known heartbeat state for /health endpoint."""
    _state["queue_depth"] = get_queue_depth()
    last = get_last_push_at()
    if last is not None:
        _state["last_push_at"] = datetime.fromtimestamp(last, tz=timezone.utc).isoformat()
    return dict(_state)


async def send_heartbeat(client: httpx.AsyncClient, symbols: list[str]) -> None:
    """POST a heartbeat ping to HEARTBEAT_URL."""
    secret = os.environ.get("MARKET_AGENT_HMAC_SECRET", "")
    if not secret:
        logger.warning("heartbeat: MARKET_AGENT_HMAC_SECRET not set — skipping")
        return

    ts = datetime.now(timezone.utc).isoformat()
    payload = {
        "agentId": AGENT_ID,
        "ts": ts,
        "symbols": symbols,
        "version": "0.2.0",
    }
    headers = {"Authorization": f"Bearer {secret}"}

    try:
        resp = await client.post(HEARTBEAT_URL, json=payload, headers=headers, timeout=5.0)
        if resp.status_code == 200:
            logger.info("heartbeat OK agentId=%s ts=%s queueDepth=%d", AGENT_ID, ts, get_queue_depth())
        else:
            logger.warning("heartbeat rejected: HTTP %d", resp.status_code)
    except httpx.RequestError as exc:
        logger.error("heartbeat network error: %s", exc)


async def heartbeat_loop(client: httpx.AsyncClient, symbols: list[str]) -> None:
    """Run heartbeat every HEARTBEAT_INTERVAL_SEC seconds."""
    while True:
        await send_heartbeat(client, symbols)
        await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)
