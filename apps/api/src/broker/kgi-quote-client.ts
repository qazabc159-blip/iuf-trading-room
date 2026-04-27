/**
 * kgi-quote-client.ts — READ-ONLY quote consumption client for KGI gateway.
 *
 * W2d scope: REST poll interface for Trading Room API to consume gateway quote data.
 * This module is intentionally separate from kgi-gateway-client.ts which carries
 * session/order/position surfaces.
 *
 * Hard lines (no-order guarantee):
 *  - NO import from kgi-gateway-client.ts (no accidental order surface exposure)
 *  - NO createOrder / cancelOrder / updateOrder / submitOrder / placeOrder methods
 *  - NO reference to /order/create URL
 *  - NO risk-engine import
 *  - Only read-only methods: getQuoteStatus / subscribeSymbolTick / subscribeSymbolBidAsk /
 *    getRecentTicks / getLatestBidAsk
 *
 * Spec: evidence/path_b_w2a_20260426/w2d_quote_consumption_plan.md §2, §7, §8
 * Decisions: D-W2D-1 (stale=5000ms), D-W2D-2 (whitelist=env var), D-W2D-4 (prefix)
 */

// ---------------------------------------------------------------------------
// Error classes (re-declared here — no import from kgi-gateway-client.ts)
// ---------------------------------------------------------------------------

/** Gateway is unreachable (connection refused, timeout, network error). */
export class KgiQuoteUnreachableError extends Error {
  constructor(context: string, cause?: unknown) {
    super(`KGI gateway unreachable [${context}]: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "KgiQuoteUnreachableError";
    if (cause instanceof Error) this.cause = cause;
  }
}

/** Symbol not on the whitelist — request rejected before any network call. */
export class KgiQuoteSymbolNotAllowedError extends Error {
  constructor(symbol: string) {
    super(`Symbol '${symbol}' is not on the quote whitelist (KGI_QUOTE_SYMBOL_WHITELIST).`);
    this.name = "KgiQuoteSymbolNotAllowedError";
  }
}

/** Quote service is administratively disabled (QUOTE_DISABLED=true on gateway). */
export class KgiQuoteDisabledError extends Error {
  constructor() {
    super("Quote service is disabled via KGI_GATEWAY_QUOTE_DISABLED.");
    this.name = "KgiQuoteDisabledError";
  }
}

/** Gateway returned 401 — session not established. */
export class KgiQuoteAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KgiQuoteAuthError";
  }
}

/** Symbol has no data (not subscribed / empty buffer). */
export class KgiQuoteNotAvailableError extends Error {
  constructor(symbol: string, code: string) {
    super(`No quote data for '${symbol}' (code=${code}).`);
    this.name = "KgiQuoteNotAvailableError";
  }
}

// ---------------------------------------------------------------------------
// Response shapes (internal to this module — NOT applied to packages/contracts)
// Types here are W2d draft; see plan §3 for contract proposal candidates.
// ---------------------------------------------------------------------------

export interface KgiQuoteStatusRaw {
  subscribed_symbols: { tick: string[]; bidask: string[] };
  buffer: {
    tick: Record<string, { count: number; maxlen: number; last_received_at: string | null }>;
    bidask: Record<string, { present: boolean; last_received_at: string | null }>;
  };
  kgi_logged_in: boolean;
  quote_disabled_flag: boolean;
}

export interface KgiTickRaw {
  exchange?: string;
  symbol?: string;
  close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  total_volume?: number;
  chg_type?: number;
  price_chg?: number;
  pct_chg?: number;
  simtrade?: number;
  suspend?: number;
  amount?: number;
  delay_time?: number;
  odd_lot?: boolean;
  datetime?: string;
  _received_at?: string;
}

export interface KgiTicksRaw {
  symbol: string;
  ticks: KgiTickRaw[];
  count: number;
  buffer_size: number;
  buffer_used: number;
}

export interface KgiBidAskRaw {
  exchange?: string;
  symbol?: string;
  bid_prices?: number[];
  bid_volumes?: number[];
  ask_prices?: number[];
  ask_volumes?: number[];
  diff_ask_vol?: number[];
  diff_bid_vol?: number[];
  simtrade?: number;
  suspend?: number;
  delay_time?: number;
  odd_lot?: boolean;
  datetime?: string;
  _received_at?: string;
}

export interface KgiBidAskResponseRaw {
  symbol: string;
  bidask: KgiBidAskRaw | null;
}

// ---------------------------------------------------------------------------
// Stale detection (D-W2D-1: threshold = 5000ms)
// ---------------------------------------------------------------------------

export const STALE_THRESHOLD_MS = 5_000;

export type QuoteFreshness = "fresh" | "stale" | "not-available";

export interface StalenessInfo {
  freshness: QuoteFreshness;
  stale: boolean;
  staleSince: string | null;
}

/**
 * Classify data freshness against D-W2D-1 threshold.
 * lastReceivedAt: ISO 8601 UTC string from gateway, or null if no data.
 */
export function classifyFreshness(
  lastReceivedAt: string | null | undefined,
  thresholdMs = STALE_THRESHOLD_MS
): StalenessInfo {
  if (!lastReceivedAt) {
    return { freshness: "not-available", stale: false, staleSince: null };
  }
  const ageMs = Date.now() - Date.parse(lastReceivedAt);
  if (ageMs <= thresholdMs) {
    return { freshness: "fresh", stale: false, staleSince: null };
  }
  return { freshness: "stale", stale: true, staleSince: lastReceivedAt };
}

// ---------------------------------------------------------------------------
// Symbol whitelist (D-W2D-2: env var KGI_QUOTE_SYMBOL_WHITELIST)
// ---------------------------------------------------------------------------

/**
 * Parse KGI_QUOTE_SYMBOL_WHITELIST env var.
 * Format: comma-separated symbols, e.g. "2330,2317,2454"
 * Default: ["2330"] (Step 3a evidence scope)
 */
export function parseSymbolWhitelist(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return ["2330"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface KgiQuoteClientConfig {
  /**
   * Base URL of the KGI Windows gateway.
   * Default: process.env.KGI_GATEWAY_BASE_URL ?? "http://127.0.0.1:8787"
   */
  gatewayBaseUrl?: string;

  /**
   * Request timeout in milliseconds. Default: 5_000.
   */
  connectTimeoutMs?: number;

  /**
   * Allowed symbols. Default: parsed from KGI_QUOTE_SYMBOL_WHITELIST env var.
   * Injected here for testability (avoids process.env coupling in tests).
   */
  symbolWhitelist?: string[];

  /**
   * Stale threshold in ms. Default: STALE_THRESHOLD_MS (5000).
   */
  staleThresholdMs?: number;
}

// ---------------------------------------------------------------------------
// Internal fetch helper (self-contained — no shared dep with gateway-client)
// ---------------------------------------------------------------------------

async function quoteFetch(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new KgiQuoteUnreachableError(url, new Error(`Timed out after ${timeoutMs}ms`));
    }
    throw new KgiQuoteUnreachableError(url, err);
  } finally {
    clearTimeout(timer);
  }
}

async function classifyQuoteError(res: Response, context: string): Promise<never> {
  let code = "";
  let message = res.statusText;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    code = body?.error?.code ?? "";
    message = body?.error?.message ?? message;
  } catch {
    // non-JSON
  }
  if (res.status === 503 && code === "QUOTE_DISABLED") {
    throw new KgiQuoteDisabledError();
  }
  if (res.status === 401) {
    throw new KgiQuoteAuthError(`${context}: ${message}`);
  }
  if (res.status === 404) {
    // caller handles not-available
    throw new KgiQuoteNotAvailableError(context, code);
  }
  throw new KgiQuoteUnreachableError(context, new Error(`HTTP ${res.status} ${message}`));
}

// ---------------------------------------------------------------------------
// KgiQuoteClient — READ-ONLY surface
// ---------------------------------------------------------------------------

/**
 * KgiQuoteClient exposes only quote read methods.
 * No order path. No session management. No position access.
 *
 * Module boundary: this class MUST NOT be given methods that touch /order/* endpoints.
 * Tests enumerate all method names and assert 0 order-related names.
 */
export class KgiQuoteClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly whitelist: string[];
  private readonly staleThresholdMs: number;

  constructor(config: KgiQuoteClientConfig = {}) {
    this.baseUrl =
      (config.gatewayBaseUrl ?? process.env["KGI_GATEWAY_BASE_URL"] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
    this.timeoutMs = config.connectTimeoutMs ?? 5_000;
    this.whitelist =
      config.symbolWhitelist ??
      parseSymbolWhitelist(process.env["KGI_QUOTE_SYMBOL_WHITELIST"]);
    this.staleThresholdMs = config.staleThresholdMs ?? STALE_THRESHOLD_MS;
  }

  // -------------------------------------------------------------------------
  // Whitelist enforcement
  // -------------------------------------------------------------------------

  /** Returns true if the symbol is on the whitelist. */
  isSymbolAllowed(symbol: string): boolean {
    return this.whitelist.includes(symbol);
  }

  private enforceWhitelist(symbol: string): void {
    if (!this.isSymbolAllowed(symbol)) {
      throw new KgiQuoteSymbolNotAllowedError(symbol);
    }
  }

  // -------------------------------------------------------------------------
  // GET /quote/status (no whitelist check — diagnostic surface)
  // -------------------------------------------------------------------------

  async getQuoteStatus(): Promise<KgiQuoteStatusRaw> {
    const res = await quoteFetch(`${this.baseUrl}/quote/status`, { method: "GET" }, this.timeoutMs);
    if (!res.ok) await classifyQuoteError(res, "getQuoteStatus");
    return res.json() as Promise<KgiQuoteStatusRaw>;
  }

  // -------------------------------------------------------------------------
  // POST /quote/subscribe/tick
  // -------------------------------------------------------------------------

  async subscribeSymbolTick(symbol: string, opts?: { oddLot?: boolean }): Promise<string> {
    this.enforceWhitelist(symbol);
    const res = await quoteFetch(
      `${this.baseUrl}/quote/subscribe/tick`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, odd_lot: opts?.oddLot ?? false }),
      },
      this.timeoutMs
    );
    if (!res.ok) await classifyQuoteError(res, `subscribeSymbolTick(${symbol})`);
    const data = (await res.json()) as { label: string };
    return data.label;
  }

  // -------------------------------------------------------------------------
  // POST /quote/subscribe/bidask
  // -------------------------------------------------------------------------

  async subscribeSymbolBidAsk(symbol: string, opts?: { oddLot?: boolean }): Promise<string> {
    this.enforceWhitelist(symbol);
    const res = await quoteFetch(
      `${this.baseUrl}/quote/subscribe/bidask`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, odd_lot: opts?.oddLot ?? false }),
      },
      this.timeoutMs
    );
    // 501 is a special non-error case (SDK not available) — surface as error for caller to handle
    if (!res.ok) await classifyQuoteError(res, `subscribeSymbolBidAsk(${symbol})`);
    const data = (await res.json()) as { label: string };
    return data.label;
  }

  // -------------------------------------------------------------------------
  // GET /quote/ticks — with stale detection (D-W2D-1)
  // -------------------------------------------------------------------------

  async getRecentTicks(
    symbol: string,
    limit = 10
  ): Promise<KgiTicksRaw & StalenessInfo> {
    this.enforceWhitelist(symbol);
    const res = await quoteFetch(
      `${this.baseUrl}/quote/ticks?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
      { method: "GET" },
      this.timeoutMs
    );
    if (!res.ok) await classifyQuoteError(res, `getRecentTicks(${symbol})`);
    const raw = (await res.json()) as KgiTicksRaw;

    // Stale detection: use last tick's _received_at
    const lastReceivedAt = raw.ticks.length > 0
      ? (raw.ticks[raw.ticks.length - 1]._received_at ?? null)
      : null;
    const staleness = classifyFreshness(lastReceivedAt, this.staleThresholdMs);

    return { ...raw, ...staleness };
  }

  // -------------------------------------------------------------------------
  // GET /quote/bidask — with stale detection (D-W2D-1)
  // -------------------------------------------------------------------------

  async getLatestBidAsk(
    symbol: string
  ): Promise<KgiBidAskResponseRaw & StalenessInfo> {
    this.enforceWhitelist(symbol);
    const res = await quoteFetch(
      `${this.baseUrl}/quote/bidask?symbol=${encodeURIComponent(symbol)}`,
      { method: "GET" },
      this.timeoutMs
    );
    if (!res.ok) await classifyQuoteError(res, `getLatestBidAsk(${symbol})`);
    const raw = (await res.json()) as KgiBidAskResponseRaw;

    // Stale detection: use bidask._received_at
    const lastReceivedAt = raw.bidask?._received_at ?? null;
    const staleness = classifyFreshness(lastReceivedAt, this.staleThresholdMs);

    return { ...raw, ...staleness };
  }

  // -------------------------------------------------------------------------
  // Accessors (for tests / diagnostics)
  // -------------------------------------------------------------------------

  get symbolWhitelist(): readonly string[] {
    return this.whitelist;
  }
}
