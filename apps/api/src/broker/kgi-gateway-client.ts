/**
 * kgi-gateway-client.ts — HTTP/WS client for the KGI Windows gateway
 *
 * Path B architecture: IUF API (Linux/Railway) → HTTP+WS → KGI Gateway (Windows/local)
 * The gateway process runs kgisuperpy on Windows and exposes a local REST+WS surface.
 *
 * B1 scope: real fetch/WS wiring.
 * - constructor: accepts {baseUrl, wsUrl} (default 127.0.0.1:8787)
 * - every method: fetch to corresponding endpoint, 5s timeout
 * - error classification: 5 typed error classes
 * - error envelope: {error: {code, message, upstream?}} — matches Python schemas.py
 *
 * mTLS / cert loading: deferred to Path B W2.
 *
 * Source: plans/kgi_adapter_design.md (skeleton spec)
 *         plans/path_b_windows_gateway_design.md (mTLS + REST+WS bridge architecture)
 *         services/kgi-gateway/schemas.py (canonical server-side schemas)
 *         services/kgi-gateway/SCHEMA_MAPPING.md (TS ↔ Pydantic field table)
 */

import type {
  BidAsk,
  KgiAccount,
  KgiBrokerCredentials,
  KgiContract,
  KgiCreateOrderInput,
  KgiDealsRaw,
  KgiOrderEventRaw,
  KgiPosition,
  KgiTradeRaw,
  KgiTradesFullRaw,
  Tick,
} from "./broker-port.js";

// ---------------------------------------------------------------------------
// Gateway client config
// ---------------------------------------------------------------------------

export interface KgiGatewayClientConfig {
  /**
   * Base URL of the KGI Windows gateway process.
   * Path B: typically http://127.0.0.1:8787 (local) or via tunnel.
   * Default: "http://127.0.0.1:8787"
   */
  gatewayBaseUrl?: string;

  /**
   * WebSocket URL for event streaming.
   * Default: "ws://127.0.0.1:8787"
   */
  gatewayWsUrl?: string;

  /**
   * Request timeout in milliseconds. Default: 5_000.
   */
  connectTimeoutMs?: number;

  /**
   * Whether to use mTLS cert for gateway connection.
   * Path B W2: cert loading implementation.
   */
  useMtls?: boolean;

  /**
   * Path to mTLS client cert (PEM). Used in W2+.
   */
  certPath?: string;

  /**
   * Path to mTLS client key (PEM). Used in W2+.
   */
  keyPath?: string;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_WS_URL  = "ws://127.0.0.1:8787";
const DEFAULT_TIMEOUT = 5_000;

// ---------------------------------------------------------------------------
// Error types — 5 canonical classes
// ---------------------------------------------------------------------------

/** Gateway is unreachable (connection refused, timeout, network error). */
export class KgiGatewayUnreachableError extends Error {
  constructor(method: string, cause?: unknown) {
    super(`KGI gateway unreachable in ${method}(): ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "KgiGatewayUnreachableError";
    if (cause instanceof Error) this.cause = cause;
  }
}

/** Session expired or credentials rejected (401). */
export class KgiGatewayAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KgiGatewayAuthError";
  }
}

/** KGI upstream error (502 — gateway reached but KGI SDK failed). */
export class KgiGatewayUpstreamError extends Error {
  readonly upstream?: string;
  constructor(message: string, upstream?: string) {
    super(message);
    this.name = "KgiGatewayUpstreamError";
    this.upstream = upstream;
  }
}

/** Feature not enabled in current W-phase (409). */
export class KgiGatewayNotEnabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KgiGatewayNotEnabledError";
  }
}

/** Request validation failed (422). */
export class KgiGatewayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KgiGatewayValidationError";
  }
}

/** B0 compatibility — only kept to not break any existing import. */
export class KgiGatewayConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KgiGatewayConnectionError";
  }
}

// ---------------------------------------------------------------------------
// Error envelope shape (matches schemas.py ErrorEnvelope)
// ---------------------------------------------------------------------------

export interface GatewayErrorDetail {
  code: string;
  message: string;
  upstream?: string;
}

export interface GatewayErrorEnvelope {
  error: GatewayErrorDetail;
}

// ---------------------------------------------------------------------------
// Internal: fetch with timeout + error classification
// ---------------------------------------------------------------------------

async function gatewayFetch(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new KgiGatewayUnreachableError(url, new Error(`Request timed out after ${timeoutMs}ms`));
    }
    throw new KgiGatewayUnreachableError(url, err);
  } finally {
    clearTimeout(timer);
  }
}

async function classifyError(res: Response, context: string): Promise<never> {
  let envelope: GatewayErrorEnvelope | null = null;
  try {
    envelope = (await res.json()) as GatewayErrorEnvelope;
  } catch {
    // non-JSON body
  }

  const msg = envelope?.error?.message ?? res.statusText;
  const upstream = envelope?.error?.upstream;

  if (res.status === 401) {
    throw new KgiGatewayAuthError(`${context}: ${msg}`);
  }
  if (res.status === 409) {
    throw new KgiGatewayNotEnabledError(`${context}: ${msg}`);
  }
  if (res.status === 422) {
    throw new KgiGatewayValidationError(`${context}: ${msg}`);
  }
  if (res.status === 502) {
    throw new KgiGatewayUpstreamError(`${context}: ${msg}`, upstream);
  }
  throw new KgiGatewayUpstreamError(`${context}: HTTP ${res.status} ${msg}`, upstream);
}

// ---------------------------------------------------------------------------
// KgiGatewayClient
// ---------------------------------------------------------------------------

/**
 * KgiGatewayClient wraps all HTTP and WebSocket calls to the Windows gateway.
 * KgiBroker delegates all network I/O here, keeping broker-port semantics
 * separate from transport details.
 *
 * B1: real fetch wiring. W2+ adds mTLS.
 */
export class KgiGatewayClient {
  private readonly baseUrl: string;
  private readonly wsUrl: string;
  private readonly timeoutMs: number;
  private readonly config: KgiGatewayClientConfig;

  private tickCallback: ((tick: Tick) => void) | null = null;
  private bidAskCallback: ((bidask: BidAsk) => void) | null = null;
  private orderEventCallback: ((event: KgiOrderEventRaw) => void) | null = null;

  // WS handle for order events
  private _orderEventWs: WebSocket | null = null;

  constructor(config: KgiGatewayClientConfig) {
    this.config = config;
    this.baseUrl  = config.gatewayBaseUrl?.replace(/\/$/, "") ?? DEFAULT_BASE_URL;
    this.wsUrl    = config.gatewayWsUrl?.replace(/\/$/, "") ?? DEFAULT_WS_URL;
    this.timeoutMs = config.connectTimeoutMs ?? DEFAULT_TIMEOUT;
  }

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  /**
   * POST /session/login
   * Maps to kgisuperpy.login() on the gateway.
   */
  async login(credentials: KgiBrokerCredentials): Promise<{ ok: boolean; accounts: KgiAccount[]; connectedAt: string }> {
    const res = await gatewayFetch(
      `${this.baseUrl}/session/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_id: credentials.personId,
          person_pwd: credentials.personPwd,
          simulation: credentials.simulation ?? false,
        }),
      },
      this.timeoutMs
    );

    if (!res.ok) await classifyError(res, "login");

    const data = (await res.json()) as { ok: boolean; accounts: Array<{ account: string; account_flag: string; broker_id: string }> };

    // Normalise snake_case → camelCase for TS consumers
    const accounts: KgiAccount[] = data.accounts.map((a) => ({
      account: a.account,
      accountFlag: a.account_flag,
      brokerId: a.broker_id,
    }));

    return {
      ok: data.ok,
      accounts,
      connectedAt: new Date().toISOString(),
    };
  }

  /**
   * POST /session/logout
   * Calls gateway /session/logout to tear down the SDK connection,
   * then closes the local WS handle.
   */
  async logout(): Promise<void> {
    const res = await gatewayFetch(
      `${this.baseUrl}/session/logout`,
      { method: "POST" },
      this.timeoutMs
    );
    if (!res.ok) await classifyError(res, "logout");
    await res.json();
    this._closeOrderEventWs();
  }

  /**
   * GET /session/show-account
   * Returns cached account list (populated after login).
   */
  async showAccounts(): Promise<KgiAccount[]> {
    const res = await gatewayFetch(
      `${this.baseUrl}/session/show-account`,
      { method: "GET" },
      this.timeoutMs
    );

    if (!res.ok) await classifyError(res, "showAccounts");

    const data = (await res.json()) as { accounts: Array<{ account: string; account_flag: string; broker_id: string }> };
    return data.accounts.map((a) => ({
      account: a.account,
      accountFlag: a.account_flag,
      brokerId: a.broker_id,
    }));
  }

  /**
   * POST /session/set-account
   * CRITICAL: only passes the account STRING — not the full dict.
   * Source: brokerport_golden_2026-04-23.md §15-16
   */
  async setAccount(accountId: string): Promise<void> {
    const res = await gatewayFetch(
      `${this.baseUrl}/session/set-account`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: accountId }), // string only
      },
      this.timeoutMs
    );

    if (!res.ok) await classifyError(res, "setAccount");
    // Response consumed — discard body
    await res.json();
  }

  // -------------------------------------------------------------------------
  // Quote — callbacks (local registration)
  // -------------------------------------------------------------------------

  setTickCallback(cb: (tick: Tick) => void): void {
    this.tickCallback = cb;
  }

  setBidAskCallback(cb: (bidask: BidAsk) => void): void {
    this.bidAskCallback = cb;
  }

  /**
   * POST /quote/subscribe/tick
   * Instructs gateway to subscribe and stream ticks via WS pump.
   */
  async subscribeTick(symbol: string, opts?: { oddLot?: boolean }): Promise<void> {
    const res = await gatewayFetch(
      `${this.baseUrl}/quote/subscribe/tick`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, odd_lot: opts?.oddLot ?? false }),
      },
      this.timeoutMs
    );

    if (!res.ok) await classifyError(res, "subscribeTick");
    await res.json();
  }

  /**
   * POST /quote/subscribe/bidask — not yet on gateway; stub with error
   * until gateway exposes this endpoint.
   */
  async subscribeBidAsk(_symbol: string, _opts?: { oddLot?: boolean }): Promise<void> {
    // Gateway W1 does not expose /quote/subscribe/bidask yet.
    // Tick subscription is the primary W1 surface.
    throw new KgiGatewayNotEnabledError(
      "subscribeBidAsk: /quote/subscribe/bidask not yet enabled in W1 gateway. Use subscribeTick."
    );
  }

  /**
   * POST /quote/unsubscribe — not yet on gateway; stub.
   */
  async unsubscribe(_label: string): Promise<void> {
    throw new KgiGatewayNotEnabledError(
      "unsubscribe: /quote/unsubscribe not yet enabled in W1 gateway."
    );
  }

  // -------------------------------------------------------------------------
  // Order write
  // -------------------------------------------------------------------------

  /**
   * POST /order/create
   * W1 gateway returns 409 NotEnabledInW1 — this will throw KgiGatewayNotEnabledError.
   * Not verified in Phase 0; deferred to B1 paper dry-run.
   */
  async createOrder(input: KgiCreateOrderInput): Promise<KgiTradeRaw> {
    const res = await gatewayFetch(
      `${this.baseUrl}/order/create`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: input.action,
          symbol: input.symbol,
          qty: input.qty,
          price: input.price ?? null,
          time_in_force: input.timeInForce ?? "ROD",
          order_cond: input.orderCond ?? "Cash",
          odd_lot: input.oddLot ?? false,
          name: input.name ?? "",
        }),
      },
      this.timeoutMs
    );

    if (!res.ok) await classifyError(res, "createOrder");
    return (await res.json()) as KgiTradeRaw;
  }

  /**
   * POST /order/cancel — gateway endpoint not yet implemented.
   */
  async cancelOrder(_orderId: string): Promise<void> {
    throw new KgiGatewayNotEnabledError("cancelOrder: not enabled in W1 gateway.");
  }

  /**
   * POST /order/update — gateway endpoint not yet implemented.
   */
  async updateOrder(_orderId: string, _patch: { price?: number; qty?: number }): Promise<void> {
    throw new KgiGatewayNotEnabledError("updateOrder: not enabled in W1 gateway.");
  }

  // -------------------------------------------------------------------------
  // Order read — W1.5: real wiring (passive/read-only, no order submission)
  // -------------------------------------------------------------------------

  async getTrades(full?: false): Promise<KgiTradeRaw>;
  async getTrades(full: true): Promise<KgiTradesFullRaw>;
  async getTrades(full?: boolean): Promise<KgiTradeRaw | KgiTradesFullRaw> {
    const url = `${this.baseUrl}/trades?full=${full === true ? "true" : "false"}`;
    const res = await gatewayFetch(url, { method: "GET" }, this.timeoutMs);
    if (!res.ok) await classifyError(res, "getTrades");
    const data = (await res.json()) as { trades: KgiTradeRaw | KgiTradesFullRaw };
    return data.trades;
  }

  async getDeals(): Promise<KgiDealsRaw> {
    const res = await gatewayFetch(
      `${this.baseUrl}/deals`,
      { method: "GET" },
      this.timeoutMs
    );
    if (!res.ok) await classifyError(res, "getDeals");
    const data = (await res.json()) as { deals: KgiDealsRaw };
    return data.deals;
  }

  /**
   * GET /position
   * Gateway calls api.Order.get_position() (pandas DataFrame → JSON list).
   * Each row dict is normalised into KgiPosition here.
   * Source: broker-port.ts KgiPosition fields, brokerport_golden_2026-04-23.md §172-184,
   *         kgisuperpy Order.get_position() docstring (columns: type, quantity_yd,
   *         quantity_B, quantity_S, quantity_td, lastprice, unrealized, realized).
   * Index column in DataFrame is reset to "index" (the symbol string).
   */
  async getPosition(): Promise<KgiPosition[]> {
    const res = await gatewayFetch(
      `${this.baseUrl}/position`,
      { method: "GET" },
      this.timeoutMs
    );
    if (!res.ok) await classifyError(res, "getPosition");

    const data = (await res.json()) as {
      positions: Array<Record<string, unknown>>;
      note?: string;
    };

    return data.positions.map((row) => {
      // symbol: DataFrame index was reset_index()'d → column name "index"
      const symbol = String(row["index"] ?? row["symbol"] ?? "");

      // quantity arrays: [odd, cash, margin, short]
      const qYd  = (row["quantity_yd"]  as number[] | null) ?? [0, 0, 0, 0];
      const qTd  = (row["quantity_td"]  as number[] | null) ?? [0, 0, 0, 0];
      const qB   = (row["quantity_B"]   as number[] | null) ?? [0, 0, 0, 0];
      const qS   = (row["quantity_S"]   as number[] | null) ?? [0, 0, 0, 0];

      const lastPrice  = Number(row["lastprice"]  ?? 0);
      const unrealized = Number(row["unrealized"] ?? 0);
      const realized   = Number(row["realized"]   ?? 0);

      const quantityCashTd   = qTd[1] ?? 0;
      const quantityMarginTd = qTd[2] ?? 0;

      return {
        symbol,
        quantityOddYd:      qYd[0] ?? 0,
        quantityCashYd:     qYd[1] ?? 0,
        quantityMarginYd:   qYd[2] ?? 0,
        quantityShortYd:    qYd[3] ?? 0,
        quantityOddTd:      qTd[0] ?? 0,
        quantityCashTd,
        quantityMarginTd,
        quantityShortTd:    qTd[3] ?? 0,
        quantityBoughtOdd:    qB[0] ?? 0,
        quantityBoughtCash:   qB[1] ?? 0,
        quantityBoughtMargin: qB[2] ?? 0,
        quantityBoughtShort:  qB[3] ?? 0,
        quantitySoldOdd:    qS[0] ?? 0,
        quantitySoldCash:   qS[1] ?? 0,
        quantitySoldMargin: qS[2] ?? 0,
        quantitySoldShort:  qS[3] ?? 0,
        lastPrice,
        realized,
        unrealized,
        // Adapter-side enrichment — boardLot / netQuantity
        // boardLot: default 1000 (regular lot); kgi-contract-rules.ts refines per symbol
        boardLot: 1000,
        netQuantity: quantityCashTd + quantityMarginTd,
      } satisfies KgiPosition;
    });
  }

  // -------------------------------------------------------------------------
  // Contract meta — not yet on gateway W1
  // -------------------------------------------------------------------------

  async getContract(_symbol: string): Promise<KgiContract | null> {
    throw new KgiGatewayNotEnabledError("getContract: not enabled in W1 gateway. Deferred to W1.5.");
  }

  async listContracts(): Promise<Map<string, KgiContract>> {
    throw new KgiGatewayNotEnabledError("listContracts: not enabled in W1 gateway. Deferred to W1.5.");
  }

  // -------------------------------------------------------------------------
  // Order event streaming — WS /events/order/attach
  // -------------------------------------------------------------------------

  setOrderEventCallback(cb: (event: KgiOrderEventRaw) => void): void {
    this.orderEventCallback = cb;
  }

  /**
   * Open a WebSocket connection to /events/order/attach and start receiving events.
   * Events are dispatched to the registered orderEventCallback.
   * Reconnection logic is deferred to W2.
   */
  connectOrderEventStream(): void {
    if (this._orderEventWs) return; // already connected

    const wsEndpoint = `${this.wsUrl}/events/order/attach`;
    const ws = new WebSocket(wsEndpoint);
    this._orderEventWs = ws;

    ws.addEventListener("message", (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as { type: string; data: unknown };
        if (msg.type === "order_event" && this.orderEventCallback) {
          // Cast data to KgiOrderEventRaw (open schema until B1 dry-run)
          this.orderEventCallback(msg.data as KgiOrderEventRaw);
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.addEventListener("error", (evt) => {
      console.error("[KgiGatewayClient] order event WS error", evt);
    });

    ws.addEventListener("close", () => {
      this._orderEventWs = null;
    });
  }

  private _closeOrderEventWs(): void {
    if (this._orderEventWs) {
      this._orderEventWs.close();
      this._orderEventWs = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal dispatch helpers (for testing without real WS)
  // -------------------------------------------------------------------------

  /** Inject a synthetic order event (for unit tests). */
  _dispatchOrderEvent(event: KgiOrderEventRaw): void {
    this.orderEventCallback?.(event);
  }

  /** Inject a synthetic tick (for unit tests). */
  _dispatchTick(tick: Tick): void {
    this.tickCallback?.(tick);
  }

  /** Inject a synthetic bidask (for unit tests). */
  _dispatchBidAsk(bidask: BidAsk): void {
    this.bidAskCallback?.(bidask);
  }

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  /**
   * GET /health — verify gateway is reachable.
   */
  async health(): Promise<{ status: string; kgi_logged_in: boolean; account_set: boolean }> {
    const res = await gatewayFetch(
      `${this.baseUrl}/health`,
      { method: "GET" },
      this.timeoutMs
    );
    if (!res.ok) await classifyError(res, "health");
    return res.json() as Promise<{ status: string; kgi_logged_in: boolean; account_set: boolean }>;
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  get gatewayBaseUrl(): string {
    return this.baseUrl;
  }
}

// Keep B0 backward-compat alias
export class KgiGatewayNotImplementedError extends Error {
  constructor(method: string) {
    super(
      `KgiGatewayClient.${method}() is not implemented. ` +
        "Check W-phase scope for this endpoint."
    );
    this.name = "KgiGatewayNotImplementedError";
  }
}
