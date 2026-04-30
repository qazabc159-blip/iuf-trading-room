"""
tests/test_ingest_pusher.py — W7 H3: ingest_pusher unit tests

T4: HMAC sig verify — signed event matches expected HMAC format
T5: Retry simulator — retries on 5xx, succeeds on 3rd call
T6: Queue depth — enqueue increments, drain decrements
"""

import sys
import os
import asyncio
import hashlib
import hmac as _hmac
import json
import unittest.mock as mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import pytest

from agent import ingest_pusher


def compute_expected_hmac(secret: str, event_type: str, symbol: str, ts: str, seq: int, data: dict) -> str:
    """Replicate the canonical HMAC format from TypeScript server."""
    message = f"{event_type}:{symbol}:{ts}:{seq}:{json.dumps(data, separators=(',', ':'))}"
    return _hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def test_hmac_sig_matches_canonical_format():
    """T4: HMAC sig verify — signed event matches expected HMAC format."""
    secret = "test-hmac-secret-for-h3-tests"
    event_type = "quote"
    symbol = "2330.TW"
    ts = "2026-04-30T10:00:00.000Z"
    seq = 42
    data = {"last": 950.0, "bid": 949.5, "ask": 950.5}

    # Use the internal _sign_event from ingest_pusher
    computed = ingest_pusher._sign_event(secret, event_type, symbol, ts, seq, data)
    expected = compute_expected_hmac(secret, event_type, symbol, ts, seq, data)

    assert computed == expected, "HMAC must match canonical format used by TypeScript server"


@pytest.mark.asyncio
async def test_retry_on_5xx_then_succeed():
    """T5: Retry simulator — retries on 5xx, succeeds on 3rd call."""
    secret = "test-secret"
    os.environ["MARKET_AGENT_HMAC_SECRET"] = secret
    os.environ["INGEST_URL"] = "http://test-ingest/internal/market/ingest"

    call_count = 0

    async def mock_post(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        resp = mock.MagicMock()
        if call_count < 3:
            resp.status_code = 503
        else:
            resp.status_code = 201
        return resp

    import httpx
    client = mock.AsyncMock(spec=httpx.AsyncClient)
    client.post = mock_post

    # Reset state
    ingest_pusher._last_push_at = None

    ok = await ingest_pusher.push_event(
        client=client,
        event_type="quote",
        symbol="2330.TW",
        ts="2026-04-30T10:00:00.000Z",
        seq=1,
        data={"last": 950.0},
    )

    assert ok is True, "Should succeed after retries"
    assert call_count == 3, f"Expected 3 calls (2 retries), got {call_count}"


def test_queue_depth_enqueue_and_drain():
    """T6: Queue depth — enqueue increments depth, drain clears items."""
    # Clear queue state
    ingest_pusher._queue.clear()
    ingest_pusher._seq_counters.clear()

    assert ingest_pusher.get_queue_depth() == 0

    # Enqueue 3 events
    for i in range(3):
        ingest_pusher.enqueue_event(
            event_type="quote",
            symbol=f"test-{i}.TW",
            ts="2026-04-30T10:00:00.000Z",
            data={"last": 100.0 + i},
        )

    assert ingest_pusher.get_queue_depth() == 3

    # Drain — mock push that always succeeds
    import httpx

    async def run_drain():
        secret = "test-drain-secret"
        os.environ["MARKET_AGENT_HMAC_SECRET"] = secret

        client = mock.AsyncMock(spec=httpx.AsyncClient)
        resp_mock = mock.MagicMock()
        resp_mock.status_code = 201
        client.post = mock.AsyncMock(return_value=resp_mock)

        pushed = await ingest_pusher.drain_queue(client, max_events=10)
        return pushed

    pushed = asyncio.run(run_drain())
    assert pushed == 3
    assert ingest_pusher.get_queue_depth() == 0
