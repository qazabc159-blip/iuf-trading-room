"""
app.py — KGI Gateway FastAPI entry point.

Path B architecture:
  IUF API (Linux/Railway) → HTTP/WS → KGI Gateway (Windows local/EC2)

Endpoints:
  GET  /health
  POST /session/login
  GET  /session/show-account
  POST /session/set-account
  POST /session/logout
  GET  /position
  GET  /trades?full=<bool>
  GET  /deals
  POST /quote/subscribe/tick
  WS   /events/order/attach
  POST /order/create          ← W1: returns 409 NotEnabledInW1

Hardlines:
  - Server does NOT auto-login on startup — wait for POST /session/login
  - /order/create always returns 409 in W1
  - set_Account only accepts account string, not dict (enforced in schemas.py)
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from config import settings
from kgi_events import order_event_manager
from read_only_guard import require_read_only
from kgi_quote import (
    get_latest_bidask,
    get_quote_status,
    get_recent_ticks,
    is_tick_subscribed,
    quote_manager,
)
from kgi_kbar import (
    get_kbar_buffer_status,
    get_recent_kbars,
    is_kbar_subscribed,
    kbar_manager,
    recover_kbar_from_sdk,
    SUPPORTED_INTERVALS,
    UNSUPPORTED_INTERVAL_MATRIX,
)
from kgi_session import (
    session,
    KgiLoginFailedError,
    KgiLoginObjectMissingAttr,
    KgiPermissionOrCredentialRejected,
    KgiSimEnvNotAuthorized,
)
from schemas import (
    CreateOrderRequest,
    DealsResponse,
    ErrorDetail,
    ErrorEnvelope,
    HealthResponse,
    KbarLatestResponse,
    KBarData,
    KbarRecoverResponse,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    OrderCreateResponse,
    PositionResponse,
    SetAccountRequest,
    SetAccountResponse,
    ShowAccountResponse,
    SubscribeBidAskRequest,
    SubscribeBidAskResponse,
    SubscribeKbarRequest,
    SubscribeKbarResponse,
    SubscribeTickRequest,
    SubscribeTickResponse,
    TradesResponse,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("kgi_gateway")


# ---------------------------------------------------------------------------
# Lifespan: register event loop with managers + start background pumps
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    quote_manager.set_event_loop(loop)
    order_event_manager.set_event_loop(loop)
    # W3 B2: register kbar_manager event loop for K-bar WS broadcast
    kbar_manager.set_event_loop(loop)

    # Start background broadcast pumps
    tick_pump_task = asyncio.create_task(quote_manager.tick_broadcast_pump())
    event_pump_task = asyncio.create_task(order_event_manager.order_event_broadcast_pump())
    # W3 B2: K-bar broadcast pump (DRAFT-only / sandbox-only)
    kbar_pump_task = asyncio.create_task(kbar_manager.kbar_broadcast_pump())

    logger.info(
        "KGI Gateway starting on %s:%d — waiting for POST /session/login",
        settings.HOST, settings.PORT,
    )

    yield  # server runs here

    tick_pump_task.cancel()
    event_pump_task.cancel()
    kbar_pump_task.cancel()
    logger.info("KGI Gateway shutting down")


app = FastAPI(
    title="KGI Gateway",
    description="REST+WS bridge between IUF Trading Room and kgisuperpy (Windows)",
    version="0.1.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    note = None
    if session.is_logged_in and not session.is_account_set:
        note = "logged_in=true but account_set=false: call POST /session/set-account to complete startup"
    return HealthResponse(
        status="ok",
        kgi_logged_in=session.is_logged_in,
        account_set=session.is_account_set,
        note=note,
    )


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

def _mask_person_id(person_id: str) -> str:
    """
    Mask the middle portion of person_id for safe logging / response.
    e.g. "A123456789" → "A12*****89"
    Keeps first 3 and last 2 chars; replaces middle with '*'.
    For IDs shorter than 6 chars, returns a fixed mask.
    """
    pid = str(person_id)
    if len(pid) <= 5:
        return "***"
    keep_head = 3
    keep_tail = 2
    masked_len = len(pid) - keep_head - keep_tail
    return pid[:keep_head] + "*" * masked_len + pid[-keep_tail:]


def _safe_attr_name(value: object) -> str:
    text = str(value)
    marker = "has no attribute "
    if marker in text:
        text = text.rsplit(marker, 1)[1].strip().strip("'\"")
    candidate = text.strip().strip("'\"")
    if candidate.replace("_", "").isalnum() and candidate[:1].isalpha():
        return candidate[:64]
    return "unknown"


def _redact_sensitive_text(text: object, *secrets: object) -> str:
    safe = str(text)
    for secret in secrets:
        if secret is None:
            continue
        value = str(secret)
        if not value:
            continue
        safe = safe.replace(value, "[REDACTED]")
        safe = safe.replace(value.upper(), "[REDACTED]")
    return safe


@app.post("/session/login", response_model=LoginResponse)
async def login(body: LoginRequest) -> LoginResponse:
    """
    Login to KGI via kgisuperpy.login().
    Does NOT call set_Account — caller must POST /session/set-account separately.

    Error handling (4 distinct codes, no more 502 vague):
      KgiSimEnvNotAuthorized            → 400 SIM_ENV_NOT_AVAILABLE_OR_NOT_AUTHORIZED
          (simulation=True + error code 78: sim env permission not granted;
           remedy: switch to simulation=false — live env read-only access works)
      KgiPermissionOrCredentialRejected → 401 KGI_PERMISSION_OR_CREDENTIAL_REJECTED
          (simulation=False + error code 78: TradeCom 元件使用權限 not enabled;
           action: contact KGI 業務窗口)
      KgiLoginFailedError               → 401 KGI_LOGIN_FAILED
          (wrong credentials, account locked, or other KGI rejection)
      KgiLoginObjectMissingAttr         → 400 KGI_LOGIN_OBJECT_MISSING_ATTR
          (login result missing expected method — SDK shape mismatch)
      AttributeError                    → 400 KGI_LOGIN_OBJECT_MISSING_ATTR
          (raw SDK attr miss, redacted to attr=<name>)
      Other exceptions                  → 400 KGI_LOGIN_ERROR
          (network / unexpected failure)

    SECURITY:
      - person_id is masked in logs (middle chars replaced with '*')
      - password is NEVER logged or included in any response
      - raw error messages are trimmed to safe wording only
      - attr_name in OBJECT_MISSING_ATTR is an attribute name string only (no data values)
    """
    masked_pid = _mask_person_id(body.person_id)

    try:
        accounts = session.login(
            person_id=body.person_id,
            person_pwd=body.person_pwd,
            simulation=body.simulation,
        )
        logger.info("Login OK: person_id=%s simulation=%s accounts=%d",
                    masked_pid, body.simulation, len(accounts))
        return LoginResponse(ok=True, accounts=accounts)

    except KgiSimEnvNotAuthorized as exc:
        # Code 78 on simulation=True → sim env permission not granted.
        # This is NOT a credential error. Business meaning: broker opened live-only API access.
        # Safe remedy message: switch to simulation=False (live, read-only).
        # NEVER include person_id literal / password in log or response.
        logger.warning(
            "Login rejected (sim env code 78): person_id=%s simulation=%s error_code=%d",
            masked_pid, body.simulation, exc.error_code,
        )
        raise HTTPException(
            status_code=400,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="SIM_ENV_NOT_AVAILABLE_OR_NOT_AUTHORIZED",
                    message=(
                        "測試環境權限未開或不同步，請改用 simulation=false 正式環境（read-only only）"
                    ),
                    upstream=f"code={exc.error_code}",
                )
            ).model_dump(),
        ) from exc

    except KgiPermissionOrCredentialRejected as exc:
        # Code 78 on simulation=False: TradeCom 元件使用權限 not enabled.
        # Distinct from generic auth failure — tells caller exactly what to do.
        # NEVER include person_id literal / password in log or response.
        logger.warning(
            "Login rejected (code 78 permission): person_id=%s simulation=%s error_code=%d",
            masked_pid, body.simulation, exc.error_code,
        )
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_PERMISSION_OR_CREDENTIAL_REJECTED",
                    message="KGI 登入拒絕：TradeCom 元件使用權限未啟用，請洽凱基業務窗口申請開通",
                    upstream=f"code={exc.error_code}",
                )
            ).model_dump(),
        ) from exc

    except KgiLoginFailedError as exc:
        # KGI explicitly rejected credentials (non-78 code) — return 401 with safe wording.
        # Log KGI error code + ReplyString (safe — no credentials here).
        # NEVER include person_id literal / password in log or response.
        safe_reply = _redact_sensitive_text(exc.reply_string, body.person_id, body.person_pwd)
        logger.warning(
            "Login rejected by KGI: person_id=%s simulation=%s error_code=%d reply=%s",
            masked_pid, body.simulation, exc.error_code, safe_reply,
        )
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_LOGIN_FAILED",
                    message="KGI 帳密驗證失敗",
                    upstream=f"code={exc.error_code}",
                )
            ).model_dump(),
        ) from exc

    except KgiLoginObjectMissingAttr as exc:
        # SDK returned a result without expected attribute (show_account etc).
        # This is an SDK contract issue, not a credential problem → 400.
        # attr_name is safe to include (it's an attribute name, not a data value).
        # NEVER include person_id literal / password.
        safe_attr = _safe_attr_name(exc.attr_name)
        logger.error(
            "Login result missing attribute: person_id=%s simulation=%s attr=%s",
            masked_pid, body.simulation, safe_attr,
        )
        raise HTTPException(
            status_code=400,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_LOGIN_OBJECT_MISSING_ATTR",
                    message="KGI SDK 回傳物件缺少必要屬性，請確認 SDK 版本或聯絡技術支援",
                    upstream=f"attr={safe_attr}",
                )
            ).model_dump(),
        ) from exc

    except AttributeError as exc:
        # Raw SDK AttributeError is also an object-shape issue. Keep the response
        # redacted and specific instead of falling through to KGI_LOGIN_ERROR.
        safe_attr = _safe_attr_name(exc)
        logger.error(
            "Login raw AttributeError: person_id=%s simulation=%s attr=%s",
            masked_pid, body.simulation, safe_attr,
        )
        raise HTTPException(
            status_code=400,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_LOGIN_OBJECT_MISSING_ATTR",
                    message="KGI SDK 回傳物件缺少必要屬性，請確認 SDK 版本或聯絡技術支援",
                    upstream=f"attr={safe_attr}",
                )
            ).model_dump(),
        ) from exc

    except Exception as exc:
        # Unexpected error (network, SDK crash, etc.) — return 400, log class only.
        # str(exc) might contain credentials if SDK formats its own errors — log class only.
        logger.error(
            "Login error (unexpected): person_id=%s simulation=%s exc_class=%s",
            masked_pid, body.simulation, type(exc).__name__,
        )
        raise HTTPException(
            status_code=400,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_LOGIN_ERROR",
                    message="KGI 登入失敗：連線或系統錯誤",
                    upstream=type(exc).__name__,
                )
            ).model_dump(),
        ) from exc


@app.get("/session/show-account", response_model=ShowAccountResponse)
async def show_account() -> ShowAccountResponse:
    """Return cached account list (populated after login)."""
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Call POST /session/login first.")
            ).model_dump(),
        )
    return ShowAccountResponse(accounts=session.show_account())


@app.get("/account/list", response_model=ShowAccountResponse)
async def account_list() -> ShowAccountResponse:
    """
    GET /account/list — read-only alias for /session/show-account.
    Returns cached account list (populated after login).
    Allowed in read-only mode (楊董 2026-05-08: tonight read-only scope includes account list).
    """
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Call POST /session/login first.")
            ).model_dump(),
        )
    return ShowAccountResponse(accounts=session.show_account())


@app.post("/session/set-account", response_model=SetAccountResponse)
async def set_account(body: SetAccountRequest) -> SetAccountResponse:
    """
    Set active trading account.
    CRITICAL: body.account must be a plain string — enforced by SetAccountRequest schema.
    After set_Account, attach the order event listener.
    """
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Call POST /session/login first.")
            ).model_dump(),
        )
    try:
        account_flag, broker_id = session.set_account(body.account)

        # Attach order event listener after account is set (api.Order is now populated)
        if session.api is not None:
            order_event_manager.attach(session.api)

        logger.info("set_Account OK: account=%s broker_id=%s", body.account, broker_id)
        return SetAccountResponse(ok=True, account_flag=account_flag, broker_id=broker_id)
    except TypeError as exc:
        # set_account() raised because input was not a string
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("set_Account failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_SET_ACCOUNT_FAILED",
                    message=str(exc),
                    upstream=str(exc),
                )
            ).model_dump(),
        ) from exc


# ---------------------------------------------------------------------------
# Session logout
# ---------------------------------------------------------------------------

@app.post("/session/logout", response_model=LogoutResponse)
async def logout() -> LogoutResponse:
    """
    Logout from KGI. Tears down the SDK connection and clears session state.
    Returns 401 if not currently logged in.
    """
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Not logged in.")
            ).model_dump(),
        )
    session.logout()
    logger.info("Logout OK")
    return LogoutResponse(ok=True)


# ---------------------------------------------------------------------------
# Order read — passive, no order submission
# ---------------------------------------------------------------------------

@app.get("/position", response_model=PositionResponse)
async def get_position() -> PositionResponse:
    """
    GET /position — returns current portfolio positions.
    Calls api.Order.get_position() which returns a pandas DataFrame.
    The DataFrame is serialised to a list of row dicts keyed by symbol.
    TS client normalises each row into KgiPosition.

    W1.5 scope: read-only / passive only.
    Source: kgisuperpy Order.get_position() docstring + step7_order_state_probe.log
    SDK method: api.Order.get_position() — returns DataFrame indexed by symbol.
    """
    # W2a Candidate F circuit breaker — mechanism-agnostic containment.
    # When KGI_GATEWAY_POSITION_DISABLED=true, return 503 BEFORE any KGI SDK / pandas / serialization call.
    # This does NOT fix the root cause of the native crash; it contains blast radius while mechanism is investigated.
    if settings.POSITION_DISABLED:
        logger.info("position_circuit_breaker tripped: returning 503 (KGI_GATEWAY_POSITION_DISABLED=true)")
        raise HTTPException(
            status_code=503,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="POSITION_DISABLED",
                    message="/position endpoint is administratively disabled (Candidate F circuit breaker active).",
                )
            ).model_dump(),
        )
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Login first.")
            ).model_dump(),
        )
    if session.api is None or not hasattr(session.api, "Order"):
        # api.Order is only available after set_Account — return empty + note
        return PositionResponse(
            positions=[],
            note="session.api.Order not available — call POST /session/set-account first",
        )
    # Phase 0 diagnostic markers — local-only, no commit, no deploy.
    # Discriminate Mechanism A (crash inside get_position) vs B (crash in pandas serialization).
    # Hard line: no raw positions / no DataFrame rows / no account / no broker / no secret in logs.
    t0 = time.perf_counter()
    try:
        logger.info("position_diag step=before_get_position")
        df = session.api.Order.get_position()
        df_is_none = df is None
        df_is_empty = bool(hasattr(df, "empty") and df.empty) if df is not None else None
        logger.info("position_diag step=after_get_position df_is_none=%s df_empty=%s elapsed_ms=%.1f",
                    df_is_none, df_is_empty, (time.perf_counter() - t0) * 1000)
        if df_is_none or df_is_empty:
            logger.info("position_diag step=return reason=empty elapsed_ms=%.1f", (time.perf_counter() - t0) * 1000)
            return PositionResponse(positions=[])
        logger.info("position_diag step=before_reset_index rows=%d cols=%d", len(df), len(df.columns))
        df_reset = df.reset_index()
        logger.info("position_diag step=after_reset_index rows=%d cols=%d", len(df_reset), len(df_reset.columns))
        df_reset.columns = [str(c) for c in df_reset.columns]
        logger.info("position_diag step=before_to_dict")
        positions = df_reset.to_dict(orient="records")
        logger.info("position_diag step=after_to_dict count=%d", len(positions))
        logger.info("position_diag step=return reason=ok elapsed_ms=%.1f", (time.perf_counter() - t0) * 1000)
        return PositionResponse(positions=positions)
    except Exception as exc:
        logger.error("position_diag step=exception class=%s elapsed_ms=%.1f",
                     type(exc).__name__, (time.perf_counter() - t0) * 1000)
        # A-0 safety micro patch 2026-04-26: mask raw upstream message for Phase 0 hard-line compliance.
        logger.error("get_position failed class=%s", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_GET_POSITION_FAILED",
                    message=str(exc),
                    upstream=str(exc),
                )
            ).model_dump(),
        ) from exc


@app.get("/trades", response_model=TradesResponse)
async def get_trades(full: bool = False) -> TradesResponse:
    """
    GET /trades?full=<bool> — returns submitted orders.
    full=false (default): dict keyed by order_id.
    full=true: bucket map e.g. {'無效單': []}.
    Calls api.Order.get_trades(full=<bool>).
    Source: kgisuperpy Order.get_trades() docstring.
    """
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Login first.")
            ).model_dump(),
        )
    if session.api is None or not hasattr(session.api, "Order"):
        return TradesResponse(
            trades={},
            note="session.api.Order not available — call POST /session/set-account first",
        )
    try:
        raw = session.api.Order.get_trades(full=full)
        if raw is None:
            return TradesResponse(trades={})
        # Convert SDK objects to plain JSON-serialisable form
        # get_trades returns dict; values may be Trade objects — convert via __dict__ or str
        serialised: dict = {}
        for k, v in raw.items():
            try:
                serialised[str(k)] = v.__dict__ if hasattr(v, "__dict__") else v
            except Exception:
                serialised[str(k)] = str(v)
        return TradesResponse(trades=serialised)
    except Exception as exc:
        logger.error("get_trades failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_GET_TRADES_FAILED",
                    message=str(exc),
                    upstream=str(exc),
                )
            ).model_dump(),
        ) from exc


@app.get("/deals", response_model=DealsResponse)
async def get_deals() -> DealsResponse:
    """
    GET /deals — returns filled deals.
    Calls api.Order.get_deals() which returns dict keyed by symbol.
    Source: kgisuperpy Order.get_deals() docstring.
    """
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Login first.")
            ).model_dump(),
        )
    if session.api is None or not hasattr(session.api, "Order"):
        return DealsResponse(
            deals={},
            note="session.api.Order not available — call POST /session/set-account first",
        )
    try:
        raw = session.api.Order.get_deals()
        if raw is None:
            return DealsResponse(deals={})
        # Convert SDK Deal objects to plain dicts
        serialised: dict = {}
        for k, v in raw.items():
            if isinstance(v, list):
                serialised[str(k)] = [
                    item.__dict__ if hasattr(item, "__dict__") else item for item in v
                ]
            else:
                try:
                    serialised[str(k)] = v.__dict__ if hasattr(v, "__dict__") else v
                except Exception:
                    serialised[str(k)] = str(v)
        return DealsResponse(deals=serialised)
    except Exception as exc:
        logger.error("get_deals failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_GET_DEALS_FAILED",
                    message=str(exc),
                    upstream=str(exc),
                )
            ).model_dump(),
        ) from exc


# ---------------------------------------------------------------------------
# Quote
# ---------------------------------------------------------------------------

@app.get("/quote/status")
async def quote_status():
    """
    GET /quote/status — gateway quote subsystem state.
    No auth required (reveals buffer counts only, no credentials / positions / orders).
    Always 200 when gateway is alive.
    """
    status = get_quote_status()
    return {
        **status,
        "kgi_logged_in": session.is_logged_in,
        "quote_disabled_flag": settings.QUOTE_DISABLED,
    }


@app.post("/quote/subscribe/tick", response_model=SubscribeTickResponse)
async def subscribe_tick(body: SubscribeTickRequest) -> SubscribeTickResponse:
    """
    Subscribe to tick stream for a symbol.
    Returns subscription label for use with unsubscribe.
    W2b: callback also writes into ring buffer (_TICK_BUFFER[symbol]).
    W2d subscribe-gap pre-fix: QUOTE_DISABLED checked first (mirrors breaker pattern on /ticks).
    """
    # W2d subscribe-gap pre-fix: QUOTE_DISABLED is a system-level circuit breaker.
    # Check it before auth so callers see the system state, not a misleading 401.
    if settings.QUOTE_DISABLED:
        raise HTTPException(
            status_code=503,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="QUOTE_DISABLED",
                    message="Quote service is disabled via KGI_GATEWAY_QUOTE_DISABLED",
                )
            ).model_dump(),
        )
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Login first.")
            ).model_dump(),
        )
    if session.api is None:
        raise HTTPException(status_code=500, detail="No API handle")

    try:
        label = quote_manager.subscribe_tick(session.api, body.symbol, odd_lot=body.odd_lot)
        logger.info("subscribe_tick OK: symbol=%s label=%s", body.symbol, label)
        return SubscribeTickResponse(ok=True, label=label)
    except Exception as exc:
        logger.error("subscribe_tick failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_SUBSCRIBE_FAILED",
                    message=str(exc),
                    upstream=str(exc),
                )
            ).model_dump(),
        ) from exc


@app.get("/quote/ticks")
async def get_quote_ticks(symbol: str, limit: int = 10):
    """
    GET /quote/ticks?symbol=<S>&limit=<N> — last N ticks from ring buffer.
    W2b: REST poll interface for cross-machine consumers (Elva on Linux EC2).

    Responses:
      503 if KGI_GATEWAY_QUOTE_DISABLED=true (circuit breaker)
      401 if not logged in
      404 if symbol not in ring buffer (never subscribed)
      200 + ticks list (may be empty if subscribed but no tick arrived yet)
    """
    if settings.QUOTE_DISABLED:
        raise HTTPException(
            status_code=503,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="QUOTE_DISABLED",
                    message="/quote/ticks is administratively disabled (KGI_GATEWAY_QUOTE_DISABLED=true).",
                )
            ).model_dump(),
        )
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Login first.")
            ).model_dump(),
        )
    if not is_tick_subscribed(symbol):
        raise HTTPException(
            status_code=404,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="SYMBOL_NOT_SUBSCRIBED",
                    message=f"Symbol '{symbol}' has not been subscribed. Call POST /quote/subscribe/tick first.",
                )
            ).model_dump(),
        )
    ticks = get_recent_ticks(symbol, limit=limit)
    return {
        "symbol": symbol,
        "ticks": ticks,
        "count": len(ticks),
        "buffer_size": 200,
        "buffer_used": len(get_recent_ticks(symbol, limit=200)),
    }


@app.post("/quote/subscribe/bidask", response_model=SubscribeBidAskResponse)
async def subscribe_bidask(body: SubscribeBidAskRequest) -> SubscribeBidAskResponse:
    """
    POST /quote/subscribe/bidask — subscribe to bid/ask stream for a symbol.
    Mirrors tick subscribe pattern.

    If KGI SDK does not support bidask subscription on this version → 501 NOT_IMPLEMENTED.
    Endpoint surface always exists (楊董 hard requirement: bidask must not disappear from design).
    W2d subscribe-gap pre-fix: QUOTE_DISABLED checked first.
    """
    # W2d subscribe-gap pre-fix: mirrors QUOTE_DISABLED check on /quote/bidask read endpoint.
    if settings.QUOTE_DISABLED:
        raise HTTPException(
            status_code=503,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="QUOTE_DISABLED",
                    message="Quote service is disabled via KGI_GATEWAY_QUOTE_DISABLED",
                )
            ).model_dump(),
        )
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Login first.")
            ).model_dump(),
        )
    if session.api is None:
        raise HTTPException(status_code=500, detail="No API handle")

    try:
        label = quote_manager.subscribe_bidask(session.api, body.symbol, odd_lot=body.odd_lot)
        logger.info("subscribe_bidask OK: symbol=%s label=%s", body.symbol, label)
        return SubscribeBidAskResponse(ok=True, label=label, note=None)
    except NotImplementedError as exc:
        logger.info("subscribe_bidask NOT_IMPLEMENTED: %s", exc)
        from fastapi.responses import JSONResponse as _JSONResponse
        return _JSONResponse(
            status_code=501,
            content=ErrorEnvelope(
                error=ErrorDetail(
                    code="BIDASK_NOT_IMPLEMENTED",
                    message=str(exc),
                )
            ).model_dump(),
        )
    except Exception as exc:
        logger.error("subscribe_bidask failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_SUBSCRIBE_BIDASK_FAILED",
                    message=str(exc),
                    upstream=str(exc),
                )
            ).model_dump(),
        ) from exc


@app.get("/quote/bidask")
async def get_quote_bidask(symbol: str):
    """
    GET /quote/bidask?symbol=<S> — latest bid/ask snapshot from ring buffer.
    W2b: REST poll interface. Populated only after subscribe_bidask succeeds.

    Responses:
      503 if KGI_GATEWAY_QUOTE_DISABLED=true
      401 if not logged in
      404 if symbol not in bidask latest (never subscribed or no data yet)
      200 + bidask snapshot
    """
    if settings.QUOTE_DISABLED:
        raise HTTPException(
            status_code=503,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="QUOTE_DISABLED",
                    message="/quote/bidask is administratively disabled (KGI_GATEWAY_QUOTE_DISABLED=true).",
                )
            ).model_dump(),
        )
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Login first.")
            ).model_dump(),
        )
    snap = get_latest_bidask(symbol)
    if snap is None:
        raise HTTPException(
            status_code=404,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="BIDASK_NOT_AVAILABLE",
                    message=f"No bidask data for '{symbol}'. Call POST /quote/subscribe/bidask first.",
                )
            ).model_dump(),
        )
    return {"symbol": symbol, "bidask": snap}


# ---------------------------------------------------------------------------
# K-bar routes — W3 B2
# ---------------------------------------------------------------------------

@app.get("/quote/kbar/recover", response_model=KbarRecoverResponse)
async def recover_kbar(symbol: str, from_date: str, to_date: str):
    """
    GET /quote/kbar/recover?symbol=<S>&from=<YYYYMMDD>&to=<YYYYMMDD>

    Calls TWStockQuote.recover_kbar(symbol, from, to) for historical K-bar data.

    Responses:
      503 if QUOTE_DISABLED (circuit breaker — mirrors W2d pattern)
      401 if not logged in
      422 if from/to dates are missing or malformed
      200 + KbarRecoverResponse with bars list (may be empty if no data)

    Hard lines:
      - No signal/order write in this handler
      - Symbol whitelist: applied via whitelist check (mirrors quote pattern)
      - Mock fallback: returns empty bars (not 500) if SDK unavailable
    """
    if settings.QUOTE_DISABLED:
        raise HTTPException(
            status_code=503,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="QUOTE_DISABLED",
                    message="/quote/kbar/recover is administratively disabled (KGI_GATEWAY_QUOTE_DISABLED=true).",
                )
            ).model_dump(),
        )
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Login first.")
            ).model_dump(),
        )
    if not from_date or not to_date:
        raise HTTPException(
            status_code=422,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="MISSING_DATE_RANGE", message="from and to are required (YYYYMMDD).")
            ).model_dump(),
        )
    if session.api is None:
        # Empty-safe: return empty bars instead of 500
        logger.warning("recover_kbar: session.api is None, returning empty bars")
        return KbarRecoverResponse(
            symbol=symbol, bars=[], count=0,
            from_date=from_date, to_date=to_date,
            note="session.api not available — call POST /session/set-account first",
        )

    try:
        raw_bars = recover_kbar_from_sdk(session.api, symbol, from_date, to_date)
        bars = [KBarData(**b) for b in raw_bars]
        logger.info("recover_kbar OK: symbol=%s from=%s to=%s count=%d", symbol, from_date, to_date, len(bars))
        return KbarRecoverResponse(
            symbol=symbol, bars=bars, count=len(bars),
            from_date=from_date, to_date=to_date,
        )
    except NotImplementedError as exc:
        logger.warning("recover_kbar NOT_IMPLEMENTED: %s", exc)
        return KbarRecoverResponse(
            symbol=symbol, bars=[], count=0,
            from_date=from_date, to_date=to_date,
            note=f"SDK recover_kbar not available: {exc}",
        )
    except Exception as exc:
        logger.error("recover_kbar failed: class=%s", type(exc).__name__)
        # Empty-safe fallback: return empty bars not 500
        return KbarRecoverResponse(
            symbol=symbol, bars=[], count=0,
            from_date=from_date, to_date=to_date,
            note=f"recover_kbar error: {type(exc).__name__}",
        )


@app.post("/quote/subscribe/kbar", response_model=SubscribeKbarResponse)
async def subscribe_kbar(body: SubscribeKbarRequest):
    """
    POST /quote/subscribe/kbar — subscribe to K-bar stream for a symbol.

    Mirrors W2d subscribe-gap fix pattern:
      QUOTE_DISABLED check BEFORE auth (system-level breaker fires first).

    Interval handling:
      - If interval is in UNSUPPORTED_INTERVAL_MATRIX → return 200 with
        interval_status="unsupported" and unsupported_reason (NOT a hard error)
      - If interval is in SUPPORTED_INTERVALS → proceed
      - If interval is None → proceed (SDK determines granularity)

    Hard lines:
      - NO interval hard-transcoding (unsupported → recorded, not converted)
      - NO signal/order trigger in this handler
      - Production-side WS: DRAFT-only / sandbox-only
    """
    # W3 B2 subscribe-gap pre-fix: mirrors W2d QUOTE_DISABLED-first pattern
    if settings.QUOTE_DISABLED:
        raise HTTPException(
            status_code=503,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="QUOTE_DISABLED",
                    message="Quote service is disabled via KGI_GATEWAY_QUOTE_DISABLED",
                )
            ).model_dump(),
        )
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Login first.")
            ).model_dump(),
        )

    # Interval validation (no hard-transcode)
    interval_status = "unknown"
    unsupported_reason = None
    if body.interval is not None:
        if body.interval in UNSUPPORTED_INTERVAL_MATRIX:
            unsupported_reason = UNSUPPORTED_INTERVAL_MATRIX[body.interval]
            logger.info(
                "subscribe_kbar: unsupported interval=%s reason=%s symbol=%s",
                body.interval, unsupported_reason, body.symbol,
            )
            return SubscribeKbarResponse(
                ok=True,
                label=None,
                note=f"Interval '{body.interval}' is not supported — see unsupported matrix",
                interval_status="unsupported",
                unsupported_reason=unsupported_reason,
            )
        elif body.interval in SUPPORTED_INTERVALS:
            interval_status = "supported"
        else:
            interval_status = "unknown"

    if session.api is None:
        raise HTTPException(status_code=500, detail="No API handle")

    try:
        label = kbar_manager.subscribe_kbar(session.api, body.symbol, odd_lot=body.odd_lot)
        logger.info("subscribe_kbar OK: symbol=%s label=%s interval=%s", body.symbol, label, body.interval)
        return SubscribeKbarResponse(
            ok=True,
            label=label,
            interval_status=interval_status,
            note="DRAFT: WS push is sandbox-only; use GET /quote/kbar for REST poll",
        )
    except NotImplementedError as exc:
        logger.info("subscribe_kbar NOT_IMPLEMENTED: %s", exc)
        from fastapi.responses import JSONResponse as _JSONResponse
        return _JSONResponse(
            status_code=501,
            content=ErrorEnvelope(
                error=ErrorDetail(
                    code="KBAR_NOT_IMPLEMENTED",
                    message=str(exc),
                )
            ).model_dump(),
        )
    except Exception as exc:
        logger.error("subscribe_kbar failed: class=%s symbol=%s", type(exc).__name__, body.symbol)
        raise HTTPException(
            status_code=502,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_SUBSCRIBE_KBAR_FAILED",
                    message=str(exc),
                    upstream=str(exc),
                )
            ).model_dump(),
        ) from exc


@app.get("/quote/kbar", response_model=KbarLatestResponse)
async def get_quote_kbar(symbol: str, limit: int = 10):
    """
    GET /quote/kbar?symbol=<S>&limit=<N> — last N K-bars from ring buffer.
    REST poll interface (mirrors /quote/ticks pattern).

    Responses:
      503 if QUOTE_DISABLED
      401 if not logged in
      404 if symbol not in kbar buffer (never subscribed)
      200 + KbarLatestResponse (may have empty bars if subscribed but no data yet)
    """
    if settings.QUOTE_DISABLED:
        raise HTTPException(
            status_code=503,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="QUOTE_DISABLED",
                    message="/quote/kbar is administratively disabled (KGI_GATEWAY_QUOTE_DISABLED=true).",
                )
            ).model_dump(),
        )
    if not session.is_logged_in:
        raise HTTPException(
            status_code=401,
            detail=ErrorEnvelope(
                error=ErrorDetail(code="NOT_LOGGED_IN", message="Login first.")
            ).model_dump(),
        )
    if not is_kbar_subscribed(symbol):
        raise HTTPException(
            status_code=404,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KBAR_NOT_SUBSCRIBED",
                    message=f"Symbol '{symbol}' has no K-bar subscription. Call POST /quote/subscribe/kbar first.",
                )
            ).model_dump(),
        )
    bars_raw = get_recent_kbars(symbol, limit=limit)
    bars = [KBarData(**b) for b in bars_raw]
    from kgi_kbar import _KBAR_BUFFER, _KBAR_LOCK, _KBAR_BUFFER_MAXLEN
    with _KBAR_LOCK:
        buf = _KBAR_BUFFER.get(symbol)
        buf_used = len(buf) if buf is not None else 0
    return KbarLatestResponse(
        symbol=symbol,
        bars=bars,
        count=len(bars),
        buffer_size=_KBAR_BUFFER_MAXLEN,
        buffer_used=buf_used,
    )


@app.get("/quote/kbar/status")
async def kbar_status():
    """
    GET /quote/kbar/status — K-bar buffer state.
    No auth required (diagnostic surface — mirrors /quote/status pattern).
    """
    status = get_kbar_buffer_status()
    return {
        **status,
        "kgi_logged_in": session.is_logged_in,
        "quote_disabled_flag": settings.QUOTE_DISABLED,
    }


# ---------------------------------------------------------------------------
# WS: order event stream
# ---------------------------------------------------------------------------

@app.websocket("/events/order/attach")
async def order_events_ws(websocket: WebSocket) -> None:
    """
    WebSocket endpoint — passive broadcast of order lifecycle events.
    Events arrive via api.Order.set_event() callback → asyncio queue → here.
    W1 scope: passive only. No order submission.
    """
    await websocket.accept()
    order_event_manager.register_ws_client(websocket)
    logger.info("WS /events/order/attach: client connected")
    try:
        # Keep connection alive; events are pushed by order_event_broadcast_pump
        while True:
            # We don't expect messages from client; just detect disconnect
            data = await websocket.receive_text()
            # Echo ping for keepalive support
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        logger.info("WS /events/order/attach: client disconnected")
    finally:
        order_event_manager.unregister_ws_client(websocket)


# ---------------------------------------------------------------------------
# Order create — 3-gate: NOT_LOGGED_IN / LIVE_ORDER_BLOCKED / SIM-only SDK call
# ---------------------------------------------------------------------------

@app.post("/order/create")
async def create_order(body: Optional[Any] = Body(default=None)) -> JSONResponse:
    """
    Order submission route — 3-gate (P0-A 2026-05-13).

    Gate 1 (no session)         → 409 NOT_LOGGED_IN
    Gate 2 (LIVE session)       → 409 LIVE_ORDER_BLOCKED (permanent hard line)
    Gate 3 (SIM session)        → validate body, call SDK, return 200 sim_only=true

    Hard line: production broker write is permanently disabled at this endpoint.
    LIVE-session order placement returns 409 LIVE_ORDER_BLOCKED regardless of payload.
    Only SIM-session callers reach the SDK; response carries sim_only=true literal.
    """
    # Gate 1: NOT_LOGGED_IN
    if not session.is_logged_in:
        logger.info("POST /order/create rejected: NOT_LOGGED_IN")
        return JSONResponse(
            status_code=409,
            content=ErrorEnvelope(
                error=ErrorDetail(
                    code="NOT_LOGGED_IN",
                    message="Session not logged in. POST /session/login first.",
                )
            ).model_dump(),
        )

    # Gate 2: LIVE_ORDER_BLOCKED — permanent
    if session.is_simulation is False:
        logger.info("POST /order/create rejected: LIVE_ORDER_BLOCKED (simulation=False)")
        return JSONResponse(
            status_code=409,
            content=ErrorEnvelope(
                error=ErrorDetail(
                    code="LIVE_ORDER_BLOCKED",
                    message=(
                        "Live order writes are permanently blocked at this endpoint. "
                        "Re-login with simulation=true to exercise SIM order path."
                    ),
                )
            ).model_dump(),
        )

    # Gate 3: SIM session — body validation + SDK call
    try:
        order_req = CreateOrderRequest.model_validate(body)
    except Exception as exc:
        return JSONResponse(
            status_code=422,
            content=ErrorEnvelope(
                error=ErrorDetail(
                    code="INVALID_ORDER_REQUEST",
                    message=f"Order request validation failed: {exc}",
                )
            ).model_dump(),
        )

    if session.api is None:
        return JSONResponse(
            status_code=500,
            content=ErrorEnvelope(
                error=ErrorDetail(
                    code="SESSION_API_MISSING",
                    message="Session reports logged_in=true but api handle is missing.",
                )
            ).model_dump(),
        )

    try:
        from kgisuperpy import Action, OddLot, OrderCond, PriceType, TimeInForce

        action = getattr(Action, order_req.action)
        time_in_force = getattr(TimeInForce, order_req.time_in_force)
        order_cond = {
            "Cash": OrderCond.CASH,
            "CashSelling": OrderCond.CASH_SELLING,
            "Margin": OrderCond.MARGIN,
            "MarginDayTrade": OrderCond.MARGIN_DayTrade,
            "ShortSelling": OrderCond.SHORT_SELLING,
            "LendSelling": OrderCond.Lend_SELLING,
        }[order_req.order_cond]
        price = order_req.price
        if isinstance(price, str):
            price = getattr(PriceType, price)
        odd_lot = order_req.odd_lot
        if isinstance(odd_lot, str):
            odd_lot = {
                "Common": OddLot.Common,
                "Fixing": OddLot.Fixing,
                "Odd": OddLot.Odd,
                "OddAfterMarket": OddLot.Odd_AfterMarket,
            }[odd_lot]

        sdk_response = session.api.Order.create_order(
            action=action,
            symbol=order_req.symbol,
            qty=order_req.qty,
            price=price,
            time_in_force=time_in_force,
            order_cond=order_cond,
            odd_lot=odd_lot,
            name=order_req.name,
        )
        logger.info(
            "POST /order/create SIM accepted symbol=%s qty=%d action=%s",
            order_req.symbol, order_req.qty, order_req.action,
        )
        sdk_repr = str(sdk_response)[:500] if sdk_response is not None else None
        return JSONResponse(
            status_code=200,
            content=OrderCreateResponse(
                ok=True,
                sim_only=True,
                status="accepted",
                kgi_response_repr=sdk_repr,
            ).model_dump(),
        )
    except Exception as exc:
        logger.warning("POST /order/create SIM SDK error: %s", type(exc).__name__)
        return JSONResponse(
            status_code=502,
            content=ErrorEnvelope(
                error=ErrorDetail(
                    code="SIM_SDK_ERROR",
                    message=f"KGI SDK order create failed: {type(exc).__name__}",
                )
            ).model_dump(),
        )


# ---------------------------------------------------------------------------
# Dev entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=False,  # reload=True via CLI only (--reload flag)
        log_level="info",
    )
