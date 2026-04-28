"""
kgi_events.py — wrap api.Order.set_event into asyncio WS broadcast.

Order event callback runs in KGI internal thread → bridge to asyncio queue
→ WS broadcast to /events/order/attach subscribers.

W1 scope: passive only — no order submission.
Event types: NewOrder(4010) / Deal(4011) / UpdatePrice / UpdateQty / CancelOrder
Source: brokerport_golden_2026-04-23.md §117-123
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Optional

logger = logging.getLogger("kgi_events")

# Map KGI event data type names to canonical event type strings
_KGI_TYPE_MAP: dict[str, str] = {
    "NewOrder": "NewOrder",
    "Deal": "Deal",
    "UpdatePrice": "UpdatePrice",
    "UpdateQty": "UpdateQty",
    "CancelOrder": "CancelOrder",
}


class KgiOrderEventManager:
    """Manages the order event listener and WS broadcast."""

    def __init__(self) -> None:
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._event_queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=500)
        self._ws_clients: set = set()
        self._attached: bool = False
        self._lock = threading.Lock()

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def register_ws_client(self, ws) -> None:
        self._ws_clients.add(ws)

    def unregister_ws_client(self, ws) -> None:
        self._ws_clients.discard(ws)

    # ------------------------------------------------------------------
    # Attach listener to api.Order.set_event
    # ------------------------------------------------------------------

    def attach(self, api) -> None:
        """
        Register the order event callback. Call after set_Account.
        Only attaches once per session — idempotent.
        Source: brokerport_golden_2026-04-23.md §114 (api.Order.set_event)
        """
        if self._attached:
            return

        def on_order_event(data):
            """Single-param callback. data is the raw KGI event object."""
            try:
                event_dict = _order_event_to_dict(data)
                if self._loop and self._loop.is_running():
                    asyncio.run_coroutine_threadsafe(
                        self._event_queue.put(event_dict), self._loop
                    )
            except Exception:
                logger.exception("Error in on_order_event bridge")

        api.Order.set_event(on_order_event)
        with self._lock:
            self._attached = True
        logger.info("Order event listener attached")

    # ------------------------------------------------------------------
    # WS broadcast pump
    # ------------------------------------------------------------------

    async def order_event_broadcast_pump(self) -> None:
        """
        Runs as asyncio background task.
        Drains event_queue and broadcasts JSON to all /events/order/attach WS clients.
        """
        while True:
            event_dict = await self._event_queue.get()
            if not self._ws_clients:
                continue
            message = json.dumps({"type": "order_event", "data": event_dict})
            dead = set()
            for ws in self._ws_clients:
                try:
                    await ws.send_text(message)
                except Exception:
                    dead.add(ws)
            for ws in dead:
                self._ws_clients.discard(ws)


# ---------------------------------------------------------------------------
# Helper: convert KGI order event object to plain dict
# ---------------------------------------------------------------------------

def _order_event_to_dict(data) -> dict:
    """
    Convert a raw KGI order event to canonical OrderEventMessage shape.
    KGI event objects vary by type — use getattr with fallbacks.
    The type string is inferred from the class name or code.
    """
    # Try to get event type from class name
    class_name = type(data).__name__
    event_type = _KGI_TYPE_MAP.get(class_name, "Unknown")

    # Try common code attribute
    code: Optional[int] = getattr(data, "code", None)
    if code is None:
        code = getattr(data, "status_code", None)

    # Serialize what we can from the data object
    raw_data: dict = {}
    for attr in dir(data):
        if attr.startswith("_"):
            continue
        try:
            val = getattr(data, attr)
            if not callable(val):
                raw_data[attr] = _safe_serialize(val)
        except Exception:
            pass

    return {
        "type": event_type,
        "code": code,
        "data": raw_data,
    }


def _safe_serialize(val) -> object:
    """Convert value to JSON-serializable primitive."""
    if isinstance(val, (str, int, float, bool, type(None))):
        return val
    return str(val)


# Module-level singleton
order_event_manager = KgiOrderEventManager()
