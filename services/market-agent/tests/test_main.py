"""
tests/test_main.py — W7 H3: FastAPI /health endpoint tests

T1: GET /health returns 200 with correct shape
T2: GET /health kgi_logged_in is always false (skeleton)
T3: GET /source/status returns 200 with symbols list
"""

import sys
import os

# Ensure src is on the path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import pytest
from fastapi.testclient import TestClient

from agent.main import app


@pytest.fixture()
def client():
    return TestClient(app)


def test_health_returns_200(client):
    """T1: GET /health returns 200 with correct shape."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert "agent_id" in data
    assert "version" in data
    assert "kgi_logged_in" in data
    assert "last_push_at" in data
    assert "queue_depth" in data
    assert "uptime_seconds" in data


def test_health_kgi_logged_in_is_false(client):
    """T2: kgi_logged_in must always be false in skeleton mode."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["kgi_logged_in"] is False, (
        "kgi_logged_in must be false until libCGCrypt is wired (W7 H3 skeleton constraint)"
    )


def test_source_status_returns_200(client):
    """T3: GET /source/status returns 200 with symbols key."""
    resp = client.get("/source/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "symbols" in data
    assert isinstance(data["symbols"], list)
