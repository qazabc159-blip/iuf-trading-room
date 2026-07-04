/**
 * fubon-gateway-client.ts — HTTP client for the Fubon (富邦) client-run gateway
 *
 * UTA-C3 skeleton (2026-07-04). Mirrors kgi-gateway-client.ts's shape, but talks
 * to the GAP-v1 contract (Broker-Agnostic Gateway Protocol) defined in
 * reports/fubon_adapter/FUBON_ADAPTER_INTERFACE_FREEZE_v1.md §2, NOT the KGI
 * gateway's endpoints — GAP-v1 is a new normalised contract, KGI is grandfathered.
 *
 * Architecture (楊董 6/17 裁決 + 證交法159): Option A, gateway runs on the
 * client's own machine, credentials never leave it. This client only talks
 * HTTP to that local/tunnelled process — same Path B shape as KGI.
 *
 * Until the real `services/fubon-gateway/` (Neo SDK, Python) exists, all callers
 * point this client at `services/fubon-gateway-mock/` (contract-mock, fixture-only).
 *
 * Quantity convention (GAP-v1 §2): qty is ALWAYS shares (never lots) on the wire.
 * LOT↔SHARE conversion is an adapter-layer concern — see fubon-broker-adapter.ts.
 */

// ---------------------------------------------------------------------------
// Wire shapes (normalised camelCase; gateway JSON is snake_case per GAP-v1)
// ---------------------------------------------------------------------------

export interface FubonHealthResponse {
  ok: boolean;
  broker: "fubon";
  isSimulation: boolean;
  readOnlyMode: boolean;
}

export interface FubonSessionStatus {
  loggedIn: boolean;
  accountMasked: string;
  env: string;
}

export interface FubonPositionRaw {
  symbol: string;
  qty: number;          // shares, always
  avgPrice: number;
  lastPrice: number;
  unrealized: number;
  realized: number;
}

export interface FubonBalanceRaw {
  cashAvailable: number; // whole TWD, no decimals
}

export interface FubonOrderCreateInput {
  symbol: string;
  action: "Buy" | "Sell";
  qty: number;                 // shares, always — caller must convert LOT->shares first
  price?: number | "MKT";
}

export interface FubonOrderResult {
  externalOrderId: string;
  status: string;
}

export interface FubonOrderCancelResult {
  externalOrderId: string;
  status: "cancelled" | "already_cancelled";
}

export interface FubonOrderTodayEntry {
  symbol: string;
  action: "Buy" | "Sell";
  qty: number;
  status: string;
  externalOrderId: string | null;
  filledQty: number;
  filledPrice: number | null;
  submittedAt: string | null;
}

// ---------------------------------------------------------------------------
// Error types — mirrors kgi-gateway-client.ts's classification pattern
// ---------------------------------------------------------------------------

export class FubonGatewayUnreachableError extends Error {
  constructor(method: string, cause?: unknown) {
    super(`Fubon gateway unreachable in ${method}(): ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "FubonGatewayUnreachableError";
    if (cause instanceof Error) this.cause = cause;
  }
}

/** 403 — FUBON_READ_ONLY_MODE_BLOCKED (§3.1: gateway-wide mutation block, default ON). */
export class FubonGatewayReadOnlyBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FubonGatewayReadOnlyBlockedError";
  }
}

/** 409 — FUBON_LIVE_DISABLED_STAGE_GATE (§3.2: planned-unlock stage gate, NOT a permanent hard line). */
export class FubonGatewayStageGateBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FubonGatewayStageGateBlockedError";
  }
}

export class FubonGatewayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FubonGatewayValidationError";
  }
}

export class FubonGatewayUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FubonGatewayUpstreamError";
  }
}

interface FubonErrorEnvelope {
  error: { code: string; message: string };
}

async function classifyError(res: Response, context: string): Promise<never> {
  let envelope: FubonErrorEnvelope | null = null;
  try {
    envelope = (await res.json()) as FubonErrorEnvelope;
  } catch {
    // non-JSON body
  }
  const code = envelope?.error?.code ?? "";
  const msg = envelope?.error?.message ?? res.statusText;

  if (res.status === 403) {
    if (code === "FUBON_READ_ONLY_MODE_BLOCKED") {
      throw new FubonGatewayReadOnlyBlockedError(`${context}: [FUBON_READ_ONLY_MODE_BLOCKED] ${msg}`);
    }
    throw new FubonGatewayUpstreamError(`${context}: HTTP 403 ${msg}`);
  }
  if (res.status === 409) {
    if (code === "FUBON_LIVE_DISABLED_STAGE_GATE") {
      throw new FubonGatewayStageGateBlockedError(`${context}: [FUBON_LIVE_DISABLED_STAGE_GATE] ${msg}`);
    }
    throw new FubonGatewayUpstreamError(`${context}: HTTP 409 ${msg}`);
  }
  if (res.status === 422) {
    throw new FubonGatewayValidationError(`${context}: ${msg}`);
  }
  throw new FubonGatewayUpstreamError(`${context}: HTTP ${res.status} ${msg}`);
}

async function gatewayFetch(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new FubonGatewayUnreachableError(url, new Error(`Request timed out after ${timeoutMs}ms`));
    }
    throw new FubonGatewayUnreachableError(url, err);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// FubonGatewayClient
// ---------------------------------------------------------------------------

export interface FubonGatewayClientConfig {
  /** Default: "http://127.0.0.1:8788" (distinct port from KGI gateway's 8787). */
  gatewayBaseUrl?: string;
  /** Request timeout in milliseconds. Default: 5_000. */
  connectTimeoutMs?: number;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8788";
const DEFAULT_TIMEOUT = 5_000;

export class FubonGatewayClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: FubonGatewayClientConfig = {}) {
    this.baseUrl = config.gatewayBaseUrl?.replace(/\/$/, "") ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.connectTimeoutMs ?? DEFAULT_TIMEOUT;
  }

  async health(): Promise<FubonHealthResponse> {
    const res = await gatewayFetch(`${this.baseUrl}/health`, { method: "GET" }, this.timeoutMs);
    if (!res.ok) await classifyError(res, "health");
    const data = (await res.json()) as { ok: boolean; broker: "fubon"; is_simulation: boolean; read_only_mode: boolean };
    return { ok: data.ok, broker: data.broker, isSimulation: data.is_simulation, readOnlyMode: data.read_only_mode };
  }

  async sessionStatus(): Promise<FubonSessionStatus> {
    const res = await gatewayFetch(`${this.baseUrl}/session/status`, { method: "GET" }, this.timeoutMs);
    if (!res.ok) await classifyError(res, "sessionStatus");
    const data = (await res.json()) as { logged_in: boolean; account_masked: string; env: string };
    return { loggedIn: data.logged_in, accountMasked: data.account_masked, env: data.env };
  }

  async getPositions(): Promise<FubonPositionRaw[]> {
    const res = await gatewayFetch(`${this.baseUrl}/positions`, { method: "GET" }, this.timeoutMs);
    if (!res.ok) await classifyError(res, "getPositions");
    const data = (await res.json()) as {
      positions: Array<{ symbol: string; qty: number; avg_price: number; last_price: number; unrealized: number; realized: number }>;
    };
    return data.positions.map((p) => ({
      symbol: p.symbol,
      qty: p.qty,
      avgPrice: p.avg_price,
      lastPrice: p.last_price,
      unrealized: p.unrealized,
      realized: p.realized,
    }));
  }

  async getBalances(): Promise<FubonBalanceRaw> {
    const res = await gatewayFetch(`${this.baseUrl}/balances`, { method: "GET" }, this.timeoutMs);
    if (!res.ok) await classifyError(res, "getBalances");
    const data = (await res.json()) as { cash_available: number };
    return { cashAvailable: data.cash_available };
  }

  /** POST /order/create — gated by FUBON_READ_ONLY_MODE + FUBON_LIVE_TRADING_ENABLED on the gateway side (§3). */
  async createOrder(input: FubonOrderCreateInput): Promise<FubonOrderResult> {
    const res = await gatewayFetch(
      `${this.baseUrl}/order/create`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: input.symbol, action: input.action, qty: input.qty, price: input.price ?? "MKT" }),
      },
      this.timeoutMs
    );
    if (!res.ok) await classifyError(res, "createOrder");
    const data = (await res.json()) as { external_order_id: string; status: string };
    return { externalOrderId: data.external_order_id, status: data.status };
  }

  /** POST /order/cancel — same stage-gate as createOrder; idempotent (repeat cancel -> already_cancelled). */
  async cancelOrder(orderId: string): Promise<FubonOrderCancelResult> {
    const res = await gatewayFetch(
      `${this.baseUrl}/order/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ external_order_id: orderId }),
      },
      this.timeoutMs
    );
    if (!res.ok) await classifyError(res, "cancelOrder");
    const data = (await res.json()) as { external_order_id: string; status: "cancelled" | "already_cancelled" };
    return { externalOrderId: data.external_order_id, status: data.status };
  }

  async getOrdersToday(): Promise<FubonOrderTodayEntry[]> {
    const res = await gatewayFetch(`${this.baseUrl}/orders/today`, { method: "GET" }, this.timeoutMs);
    if (!res.ok) await classifyError(res, "getOrdersToday");
    const data = (await res.json()) as {
      orders: Array<{
        symbol: string;
        action: "Buy" | "Sell";
        qty: number;
        status: string;
        external_order_id: string | null;
        filled_qty: number;
        filled_price: number | null;
        submitted_at: string | null;
      }>;
    };
    return data.orders.map((o) => ({
      symbol: o.symbol,
      action: o.action,
      qty: o.qty,
      status: o.status,
      externalOrderId: o.external_order_id,
      filledQty: o.filled_qty,
      filledPrice: o.filled_price,
      submittedAt: o.submitted_at,
    }));
  }

  get gatewayBaseUrl(): string {
    return this.baseUrl;
  }
}
