"""
read_only_guard.py — read-only mode enforcement for KGI Gateway.

When KGI_READ_ONLY_MODE=true (default true), all mutation endpoints
(place_order / cancel_order / order/create etc.) are blocked with 403.

Usage:
    from read_only_guard import require_read_only

    @app.post("/order/create")
    @require_read_only
    async def create_order(...): ...

Design decisions:
- Default is true (safe). Operator must explicitly set KGI_READ_ONLY_MODE=false to enable writes.
- Deadline: 楊董 明示 ack 前永久 blocked (target date 2026-05-12 per tonight's discipline).
- Read-only endpoints are NOT decorated: /health, /quote/*, /account/list, /session/show-account,
  /session/login, /session/logout, /position (read), /trades, /deals.
- This module has no dependency on kgi_session or any SDK — pure env + HTTP guard.
"""

from __future__ import annotations

import functools
import logging
import os
from typing import Any, Callable

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from schemas import ErrorDetail, ErrorEnvelope

logger = logging.getLogger("kgi_gateway.read_only_guard")


class ReadOnlyModeBlocked(Exception):
    """
    Raised when a mutation endpoint is called while KGI_READ_ONLY_MODE=true.
    Maps to HTTP 403 KGI_READ_ONLY_MODE_BLOCKED.
    """

    def __init__(self, endpoint: str = "") -> None:
        self.endpoint = endpoint
        super().__init__(
            f"Read-only mode active — mutation endpoint blocked: {endpoint}"
        )


def is_read_only_mode() -> bool:
    """
    Returns True when KGI_READ_ONLY_MODE env var is 'true' (case-insensitive).
    Default: True (safe default — writes require explicit opt-out).
    """
    val = os.environ.get("KGI_READ_ONLY_MODE", "true").strip().lower()
    return val == "true"


def require_read_only(func: Callable) -> Callable:
    """
    Decorator for FastAPI route handlers that must be blocked in read-only mode.
    When KGI_READ_ONLY_MODE=true, returns 403 before any handler logic executes.

    Usage:
        @app.post("/some/write/endpoint")
        @require_read_only
        async def my_handler(...):
            ...

    The decorator works with both async and sync handlers.
    Response: 403 KGI_READ_ONLY_MODE_BLOCKED with safe Chinese message.
    Deadline message: 正式環境 read-only mode，下單路徑禁用至 5/12 楊董明示 ack
    """
    @functools.wraps(func)
    async def _wrapper(*args: Any, **kwargs: Any) -> Any:
        if is_read_only_mode():
            endpoint_name = func.__name__
            logger.warning(
                "read_only_guard BLOCKED: endpoint=%s KGI_READ_ONLY_MODE=true",
                endpoint_name,
            )
            raise HTTPException(
                status_code=403,
                detail=ErrorEnvelope(
                    error=ErrorDetail(
                        code="KGI_READ_ONLY_MODE_BLOCKED",
                        message=(
                            "正式環境 read-only mode，下單路徑禁用至 5/12 楊董明示 ack"
                        ),
                        upstream=f"endpoint={endpoint_name}",
                    )
                ).model_dump(),
            )
        return await func(*args, **kwargs)

    return _wrapper
