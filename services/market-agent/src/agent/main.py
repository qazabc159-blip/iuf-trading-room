"""
src/agent/main.py — W7 H3: Market Agent FastAPI application

Provides:
  GET  /health   — agent liveness + KGI connection status
  GET  /source/status  — per-symbol last quote/tick timestamps

Hard lines:
  - No KGI SDK import (skeleton only — wire in W7 D5+ after EC2 smoke PASS)
  - No /order/create
  - No kill-switch toggle
  - MARKET_AGENT_HMAC_SECRET never logged, never in response body
"""

from __future__ import annotations

import os
import time
from typing import Any

from fastapi import FastAPI

from .heartbeat import get_heartbeat_state
from .source_status import get_source_status

AGENT_VERSION = "0.2.0"
AGENT_ID: str = os.environ.get("AGENT_ID", "market-agent-dev")
_STARTED_AT = time.time()

app = FastAPI(
    title="IUF Market Agent",
    version=AGENT_VERSION,
    docs_url=None,   # disable swagger in prod
    redoc_url=None,
)


@app.get("/health")
async def health() -> dict[str, Any]:
    """
    Agent liveness + status.

    Shape:
      {
        "agent_id": str,
        "version": str,
        "kgi_logged_in": false,   # always false until libCGCrypt wired
        "last_push_at": str | null,
        "queue_depth": int,
        "uptime_seconds": float
      }
    """
    hb = get_heartbeat_state()
    return {
        "agent_id": AGENT_ID,
        "version": AGENT_VERSION,
        "kgi_logged_in": False,  # TODO(libCGCrypt): wire to real login state
        "last_push_at": hb.get("last_push_at"),
        "queue_depth": hb.get("queue_depth", 0),
        "uptime_seconds": round(time.time() - _STARTED_AT, 1),
    }


@app.get("/source/status")
async def source_status() -> dict[str, Any]:
    """Per-symbol last event timestamps."""
    return {"symbols": get_source_status()}
