"""
schemas.py — canonical Pydantic schemas for KGI gateway REST + WS API.

These MUST mirror the TypeScript types in:
  apps/api/src/broker/broker-port.ts  (KgiAccount, Tick, BidAsk, KgiPosition, etc.)
  apps/api/src/broker/kgi-gateway-client.ts (request/response envelopes)

See services/kgi-gateway/SCHEMA_MAPPING.md for the full mapping table.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, Union
from pydantic import BaseModel, field_validator


# ---------------------------------------------------------------------------
# Error envelope  (server + client must match)
# ---------------------------------------------------------------------------

class ErrorDetail(BaseModel):
    code: str
    message: str
    upstream: Optional[str] = None  # raw KGI error string if available


class ErrorEnvelope(BaseModel):
    error: ErrorDetail


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    person_id: str
    person_pwd: str
    simulation: bool = False


class Account(BaseModel):
    """
    Mirrors KgiAccount (TS).
    KGI raw shape: {'account': '0308732', 'account_flag': '證券', 'broker_id': '9204'}
    """
    account: str         # e.g. "0308732"
    account_flag: str    # e.g. "證券"
    broker_id: str       # e.g. "9204"


class LoginResponse(BaseModel):
    ok: bool
    accounts: list[Account]


class ShowAccountResponse(BaseModel):
    accounts: list[Account]


class SetAccountRequest(BaseModel):
    """
    CRITICAL: account must be a plain string.
    KGI set_Account() only accepts str — passing the full dict crashes the SDK.
    Source: brokerport_golden_2026-04-23.md §15-16
    """
    account: str

    @field_validator("account")
    @classmethod
    def must_be_string(cls, v: Any) -> str:
        if not isinstance(v, str):
            raise ValueError(
                "account must be a plain string (e.g. '0308732'), not a dict or other type. "
                "KGI set_Account() only accepts the account string."
            )
        return v


class SetAccountResponse(BaseModel):
    ok: bool
    account_flag: Optional[str] = None
    broker_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Quote
# ---------------------------------------------------------------------------

class SubscribeTickRequest(BaseModel):
    symbol: str
    odd_lot: bool = False


class SubscribeTickResponse(BaseModel):
    ok: bool
    label: str  # subscription label for unsubscribe


class SubscribeBidAskRequest(BaseModel):
    symbol: str
    odd_lot: bool = False


class SubscribeBidAskResponse(BaseModel):
    ok: bool
    label: Optional[str] = None  # None if SDK returned no label
    note: Optional[str] = None   # set if SDK does not support bidask subscription


# ---------------------------------------------------------------------------
# Tick / BidAsk  (broadcast via WS and also emitted as SSE in future)
# ---------------------------------------------------------------------------

class TickEvent(BaseModel):
    """
    Mirrors Tick (TS broker-port.ts).
    KGI: Tick_Stock_v1 single-param callback shape.
    Source: evidence_2026-04-23/step3a_live_opening_0900.log line 80
    """
    exchange: str           # "TWSE" | "TPEx"
    symbol: str
    delay_time: float       # ms (maps to TS delayTime)
    odd_lot: bool
    datetime: str           # "20260423090038" YYYYMMDDHHMMSS
    open: float
    high: float
    low: float
    close: float
    volume: float
    total_volume: float
    chg_type: int
    price_chg: float
    pct_chg: float
    simtrade: int
    suspend: int
    amount: float


class BidAskEvent(BaseModel):
    """
    Mirrors BidAsk (TS broker-port.ts).
    KGI: BidAsk_Stock_v1 single-param callback shape.
    Source: evidence_2026-04-23/step3a_live_opening_0900.log line 81
    """
    exchange: str
    symbol: str
    delay_time: float
    odd_lot: bool
    datetime: str
    bid_prices: list[float]    # 5 levels
    bid_volumes: list[int]
    ask_prices: list[float]
    ask_volumes: list[int]
    diff_ask_vol: list[int]
    diff_bid_vol: list[int]
    simtrade: int
    suspend: int


# ---------------------------------------------------------------------------
# Order events  (WS broadcast via /events/order/attach)
# ---------------------------------------------------------------------------

class OrderEventMessage(BaseModel):
    """
    Mirrors KgiOrderEventRaw (TS broker-port.ts).
    Single-param callback: on_order_event(data).
    Event codes: pending=6002 / NewOrder=4010 / Deal=4011.
    Source: brokerport_golden_2026-04-23.md §117-123
    """
    type: Literal["NewOrder", "Deal", "UpdatePrice", "UpdateQty", "CancelOrder", "Unknown"]
    code: Optional[int] = None     # 6002 / 4010 / 4011
    data: Any = None               # raw event payload — open schema until B1 dry-run


# ---------------------------------------------------------------------------
# Order create  (W1: route exists, handler returns 409 NotEnabledInW1)
# ---------------------------------------------------------------------------

class CreateOrderRequest(BaseModel):
    """Input shape — validated even though W1 handler returns 409."""
    action: Literal["Buy", "Sell"]
    symbol: str
    qty: int
    price: Optional[Union[float, Literal["MKT", "Reference", "LimitUp", "LimitDown"]]] = None
    time_in_force: Literal["ROD", "IOC", "FOK"] = "ROD"
    order_cond: Literal["Cash", "CashSelling", "Margin", "MarginDayTrade", "ShortSelling", "LendSelling"] = "Cash"
    odd_lot: Union[bool, Literal["Common", "Fixing", "Odd", "OddAfterMarket"]] = False
    name: str = ""


# ---------------------------------------------------------------------------
# Order read — positions / trades / deals
# ---------------------------------------------------------------------------

class PositionResponse(BaseModel):
    """
    Response envelope for GET /position.
    Each element is a raw row from api.Order.get_position() serialised to JSON.
    The TS client normalises to KgiPosition[].
    Shape: {positions: list[dict]} — open Any schema until B1 live evidence.
    """
    positions: list[Any]
    note: Optional[str] = None  # set to non-null if method stub returned empty


class TradesResponse(BaseModel):
    """
    Response envelope for GET /trades.
    full=false → dict keyed by order_id (or empty {})
    full=true  → bucket map e.g. {'無效單': []}
    Returned under 'trades' key regardless of full flag.
    """
    trades: Any  # dict (full=false) or dict[str, list] (full=true)
    note: Optional[str] = None


class DealsResponse(BaseModel):
    """
    Response envelope for GET /deals.
    dict keyed by symbol → list[Deal] when populated; empty {} otherwise.
    """
    deals: Any
    note: Optional[str] = None


class LogoutResponse(BaseModel):
    ok: bool


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: Literal["ok"]
    kgi_logged_in: bool
    account_set: bool
    note: Optional[str] = None  # populated when logged_in=true but account_set=false


# ---------------------------------------------------------------------------
# K-bar (OHLCV) — W3 B2
# ---------------------------------------------------------------------------

class KBarData(BaseModel):
    """
    Canonical K-bar shape — aligned with Jim sandbox mock-kbar shape.
    time: Unix milliseconds (int); normalised to UTC in gateway.
    """
    time: int        # Unix ms — for lightweight-charts compatibility
    open: float
    high: float
    low: float
    close: float
    volume: float


class SubscribeKbarRequest(BaseModel):
    """
    POST /quote/subscribe/kbar request body.
    Hard line: interval is accepted but NOT used to transcode SDK output.
    Unsupported intervals are recorded in UNSUPPORTED_INTERVAL_MATRIX.
    """
    symbol: str
    odd_lot: bool = False
    interval: Optional[str] = None  # hint only — SDK may not support all values


class SubscribeKbarResponse(BaseModel):
    ok: bool
    label: Optional[str] = None
    note: Optional[str] = None
    interval_status: Optional[str] = None  # "supported" | "unsupported" | "unknown"
    unsupported_reason: Optional[str] = None  # set if interval is in UNSUPPORTED_INTERVAL_MATRIX


class KbarRecoverResponse(BaseModel):
    """
    Response envelope for GET /quote/kbar/recover.
    """
    symbol: str
    bars: list[KBarData]
    count: int
    from_date: str
    to_date: str
    note: Optional[str] = None


class KbarLatestResponse(BaseModel):
    """
    Response envelope for GET /quote/kbar (ring buffer REST poll).
    """
    symbol: str
    bars: list[KBarData]
    count: int
    buffer_size: int
    buffer_used: int
