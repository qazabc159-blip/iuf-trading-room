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

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from config import settings
from kgi_events import order_event_manager
from kgi_quote import (
    get_latest_bidask,
    get_quote_status,
    get_recent_ticks,
    is_tick_subscribed,
    quote_manager,
)
from kgi_session import session
from schemas import (
    CreateOrderRequest,
    DealsResponse,
    ErrorDetail,
    ErrorEnvelope,
    HealthResponse,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
    PositionResponse,
    SetAccountRequest,
    SetAccountResponse,
    ShowAccountResponse,
    SubscribeBidAskRequest,
    SubscribeBidAskResponse,
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

    # Start background broadcast pumps
    tick_pump_task = asyncio.create_task(quote_manager.tick_broadcast_pump())
    event_pump_task = asyncio.create_task(order_event_manager.order_event_broadcast_pump())

    logger.info(
        "KGI Gateway starting on %s:%d — waiting for POST /session/login",
        settings.HOST, settings.PORT,
    )

    yield  # server runs here

    tick_pump_task.cancel()
    event_pump_task.cancel()
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

@app.post("/session/login", response_model=LoginResponse)
async def login(body: LoginRequest) -> LoginResponse:
    """
    Login to KGI via kgisuperpy.login().
    Does NOT call set_Account — caller must POST /session/set-account separately.
    """
    try:
        accounts = session.login(
            person_id=body.person_id,
            person_pwd=body.person_pwd,
            simulation=body.simulation,
        )
        logger.info("Login OK: person_id=%s accounts=%d", body.person_id.upper(), len(accounts))
        return LoginResponse(ok=True, accounts=accounts)
    except Exception as exc:
        logger.error("Login failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=ErrorEnvelope(
                error=ErrorDetail(
                    code="KGI_LOGIN_FAILED",
                    message=str(exc),
                    upstream=str(exc),
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
# Order create — W1: always 409 NotEnabledInW1
# ---------------------------------------------------------------------------

@app.post("/order/create")
async def create_order(body: CreateOrderRequest) -> JSONResponse:
    """
    Order submission route — input is validated by CreateOrderRequest schema
    but handler always returns 409 in W1.

    W2+ will wire this to api.Order.create_order() after paper dry-run evidence.
    """
    logger.info("POST /order/create received (returning 409 NotEnabledInW1): symbol=%s", body.symbol)
    return JSONResponse(
        status_code=409,
        content=ErrorEnvelope(
            error=ErrorDetail(
                code="NOT_ENABLED_IN_W1",
                message=(
                    "Order submission is not enabled in W1. "
                    "createOrder will be wired in W2 after paper dry-run verification."
                ),
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
