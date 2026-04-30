"""
test_health_account_set.py — unit tests for /health account_set + note field.

Tests:
  1. health_not_logged_in: account_set=False, note=None (no guidance when not logged in)
  2. health_logged_in_account_not_set: account_set=False, note contains guidance
  3. health_logged_in_account_set: account_set=True, note=None (fully healthy)
"""

import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app
from kgi_session import session


client = TestClient(app)


def test_health_not_logged_in_no_note():
    """When not logged in, account_set=False and note should be None (not noisy)."""
    with patch.object(session, "_api", None):
        with patch.object(session, "_active_account", None):
            response = client.get("/health")
            assert response.status_code == 200
            body = response.json()
            assert body["kgi_logged_in"] is False
            assert body["account_set"] is False
            assert body["note"] is None


def test_health_logged_in_account_not_set_shows_note():
    """After login but before set_account, /health note should guide operator."""
    sentinel = object()  # non-None api handle
    with patch.object(session, "_api", sentinel):
        with patch.object(session, "_active_account", None):
            response = client.get("/health")
            assert response.status_code == 200
            body = response.json()
            assert body["kgi_logged_in"] is True
            assert body["account_set"] is False
            assert body["note"] is not None
            assert "set-account" in body["note"]


def test_health_logged_in_account_set_no_note():
    """Fully healthy state: logged in + account set → note should be None."""
    sentinel = object()  # non-None api handle
    with patch.object(session, "_api", sentinel):
        with patch.object(session, "_active_account", "TEST_ACCT_SENTINEL"):
            response = client.get("/health")
            assert response.status_code == 200
            body = response.json()
            assert body["kgi_logged_in"] is True
            assert body["account_set"] is True
            assert body["note"] is None
