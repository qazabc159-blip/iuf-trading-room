"""
tests/test_ws_order_hygiene.py — W5b A4: WS /events/order/attach passive hygiene design.

Design document + test stubs for proposed hardened WS handler.

DRAFT-ONLY — gate: operator-window-deferred (requires gateway restart after code change).

Design proposal (from jason_w5b_readonly_reliability_review.md §B4):

  Current behaviour:
    - Server sends order events to WS clients (passive broadcast)
    - Client → server: ping → pong keepalive
    - Client → server: any other text → logged at INFO level (no rejection)

  Proposed behaviour (DRAFT):
    - Server sends order events (UNCHANGED)
    - Client → server: ping → pong (UNCHANGED)
    - Client → server: any other text → silently drop (do NOT echo, do NOT process)
    - Optionally: close with code 1003 (unsupported data) after N violations

  Hardened handler pseudocode:
    async def order_events_ws_hardened(websocket: WebSocket) -> None:
        await websocket.accept()
        order_event_manager.register_ws_client(websocket)
        try:
            while True:
                data = await websocket.receive_text()
                if data.strip() == "ping":
                    await websocket.send_text("pong")
                else:
                    # Drop silently — no log leak, no echo, no processing
                    pass
        except WebSocketDisconnect:
            pass
        finally:
            order_event_manager.unregister_ws_client(websocket)

  Why silent drop vs code 1003 close:
    - Code 1003 close would disconnect legitimate clients that accidentally
      send non-ping data (e.g., browser WS reconnect libraries that send
      handshake frames)
    - Silent drop preserves connection while refusing to process
    - Future: add violation counter → close after N non-ping messages

Hard lines:
  - Does NOT enable any control-plane message types
  - Does NOT change auth
  - Does NOT touch order submission path
  - DRAFT-ONLY — no auto-merge

Run: PYTHONUTF8=1 python -m pytest tests/test_ws_order_hygiene.py -v
"""

from __future__ import annotations

import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Minimal kgisuperpy stub
# ---------------------------------------------------------------------------

def _make_kgisuperpy_stub():
    pkg = types.ModuleType("kgisuperpy")
    md = types.ModuleType("kgisuperpy.marketdata")
    qd_pkg = types.ModuleType("kgisuperpy.marketdata.quote_data")
    qd_mod = types.ModuleType("kgisuperpy.marketdata.quote_data.quotedata")

    class _QuoteData:
        class QuoteVersion:
            v1 = "v1"

    qd_mod.QuoteData = _QuoteData
    sys.modules.setdefault("kgisuperpy", pkg)
    sys.modules.setdefault("kgisuperpy.marketdata", md)
    sys.modules.setdefault("kgisuperpy.marketdata.quote_data", qd_pkg)
    sys.modules.setdefault("kgisuperpy.marketdata.quote_data.quotedata", qd_mod)


_make_kgisuperpy_stub()


# ---------------------------------------------------------------------------
# Unit tests on the hardened handler logic (not end-to-end WS)
# These test the pure decision logic extracted from the handler:
#   "ping" → reply "pong"
#   anything else → drop (no-op)
# ---------------------------------------------------------------------------

def _hardened_ws_message_handler(data: str) -> str | None:
    """
    Pure function extracted from the proposed hardened WS handler logic.
    Returns "pong" for ping; None for everything else (silent drop).
    This is the testable unit — no WebSocket object required.
    """
    if data.strip() == "ping":
        return "pong"
    return None  # silent drop


# ---------------------------------------------------------------------------
# A4-T1: ping → pong
# ---------------------------------------------------------------------------

def test_ws_hygiene_ping_returns_pong():
    """
    Proposed hardened handler: ping → pong.
    Unchanged from current behaviour.
    """
    result = _hardened_ws_message_handler("ping")
    assert result == "pong", f"ping must → pong, got: {result!r}"


# ---------------------------------------------------------------------------
# A4-T2: non-ping → silent drop (None)
# ---------------------------------------------------------------------------

def test_ws_hygiene_non_ping_silently_dropped():
    """
    Proposed hardened handler: non-ping messages → silent drop (return None).
    Currently, these are logged at INFO. After hardening, they are silently discarded.
    """
    for msg in ["PING", "hello", "{\"action\":\"Buy\"}", "  ", "", "pong", "CLOSE"]:
        result = _hardened_ws_message_handler(msg)
        assert result is None, (
            f"Non-ping message {msg!r} must be silently dropped (None), got: {result!r}"
        )


# ---------------------------------------------------------------------------
# A4-T3: whitespace-padded ping → pong (strip() applied)
# ---------------------------------------------------------------------------

def test_ws_hygiene_padded_ping_returns_pong():
    """
    Handler applies .strip() to message before comparison.
    " ping " and "ping\\n" must both respond with pong.
    """
    for msg in ["  ping  ", "ping\n", "\tping\t"]:
        result = _hardened_ws_message_handler(msg)
        assert result == "pong", f"Padded ping {msg!r} must → pong, got: {result!r}"


# ---------------------------------------------------------------------------
# A4-T4: order-shaped payload → silent drop (hard line: no order processing)
# ---------------------------------------------------------------------------

def test_ws_hygiene_order_payload_silently_dropped():
    """
    Hard line: any order-shaped JSON payload sent by a client to the WS endpoint
    must be silently dropped — never parsed, never forwarded, never executed.
    """
    order_payloads = [
        '{"action":"Buy","symbol":"2330","qty":1}',
        '{"order":"create","symbol":"2330"}',
        '{"type":"submit_order"}',
    ]
    for payload in order_payloads:
        result = _hardened_ws_message_handler(payload)
        assert result is None, (
            f"Order-shaped payload {payload!r} must be silently dropped, got: {result!r}"
        )


# ---------------------------------------------------------------------------
# A4-T5: current handler static audit — no control-plane message processing
# ---------------------------------------------------------------------------

def test_ws_hygiene_current_handler_no_control_plane():
    """
    Static audit of current /events/order/attach handler in app.py:
    Verify it only handles "ping" → "pong" and does not process any
    control-plane commands (subscribe, unsubscribe, place_order, etc.).

    This test reads the source and asserts absence of control-plane patterns.
    """
    import importlib
    import re

    spec = importlib.util.find_spec("app")
    assert spec and spec.origin, "app module must be importable with source"

    with open(spec.origin, "r", encoding="utf-8") as f:
        source = f.read()

    # Find the order_events_ws function block (up to the next top-level @app.* decorator)
    ws_handler_match = re.search(
        r"async def order_events_ws\(.*?(?=^@app\.|\Z)",
        source,
        re.MULTILINE | re.DOTALL,
    )
    assert ws_handler_match is not None, "order_events_ws function must exist in app.py"
    handler_source_raw = ws_handler_match.group(0)

    # Strip docstrings + line comments before pattern matching so descriptive prose
    # (e.g., "Events arrive via api.Order.set_event() callback") is not flagged as a code call.
    # We only want to catch ACTUAL code patterns invoking order submission.
    handler_source = re.sub(r'""".*?"""', "", handler_source_raw, flags=re.DOTALL)
    handler_source = re.sub(r"'''.*?'''", "", handler_source, flags=re.DOTALL)
    handler_source = re.sub(r"#.*?$", "", handler_source, flags=re.MULTILINE)

    # Verify: no order submission calls in the WS handler (code only, not docstrings/comments)
    forbidden_patterns = [
        r"\bcreate_order\s*\(",
        r"\bplace_order\s*\(",
        r"\bsubmit_order\s*\(",
        r"\bapi\.Order\.",
        r"\bsession\.api\.Order\.",
    ]
    for pattern in forbidden_patterns:
        matches = re.findall(pattern, handler_source, re.IGNORECASE)
        assert not matches, (
            f"WS handler order_events_ws must not contain order submission pattern "
            f"'{pattern}'. Found: {matches}"
        )


# ---------------------------------------------------------------------------
# A4-T6: no-order guarantee — WS hygiene module has no order-path imports
# ---------------------------------------------------------------------------

def test_ws_hygiene_no_order_imports():
    """
    This test file itself must not import any order-related module.
    """
    import re
    import os
    this_file = os.path.abspath(__file__)
    with open(this_file, "r", encoding="utf-8") as f:
        lines = f.readlines()

    import_lines = [
        ln.strip() for ln in lines
        if re.match(r"^\s*(import|from)\s+", ln) and "#" not in ln.split("import")[0]
    ]
    for line in import_lines:
        assert "kgisuperpy.order" not in line, (
            f"test file must not import kgisuperpy.order. Found: {line!r}"
        )
        assert "place_order" not in line, f"test file must not reference place_order: {line!r}"
        assert "submit_order" not in line, f"test file must not reference submit_order: {line!r}"


# ---------------------------------------------------------------------------
# A4-T7: design gap analysis — document current vs proposed state
# ---------------------------------------------------------------------------

def test_ws_hygiene_design_gap_documented():
    """
    Meta-test: asserts that the design gap documentation exists.
    Verifies this module's docstring contains the required design sections.
    """
    module_doc = __doc__
    assert module_doc is not None, "Module must have a docstring with design documentation"

    required_sections = [
        "Current behaviour",
        "Proposed behaviour",
        "silent drop",
        "ping",
        "pong",
        "DRAFT-ONLY",
    ]
    for section in required_sections:
        assert section in module_doc, (
            f"Design doc missing required section: '{section}'"
        )
