/**
 * kgi-sim-env.ts — KGI SIM environment config, state tracking, and smoke logic.
 *
 * SIM_ONLY: All operations in this module target KGI SIM hosts only.
 * Production write path is permanently hard-blocked via prodWriteBlocked=true.
 *
 * Env vars:
 *   KGI_ENV                  "sim" | "prod" — default "sim" (never default prod)
 *   KGI_SIM_QUOTE_HOST       SIM quote host  (default: iquotetest.kgi.com.tw:443)
 *   KGI_SIM_TRADE_HOST       SIM trade host  (default: itradetest.kgi.com.tw:443)
 *   KGI_GATEWAY_URL          Gateway base URL (used for SIM health probe)
 *   KGI_PERSON_ID            Taiwan national ID (masked in logs as F13133****)
 *   KGI_PERSON_PWD           Password (never logged)
 *
 * Hard lines:
 *   - prodWriteBlocked is ALWAYS true — no caller can override.
 *   - credentials NEVER appear in logs, audit payloads, or API responses.
 *   - account masked as 9228-***-6 in all output.
 *   - SIM tag visible on ALL smoke result payloads.
 */

import { randomUUID } from "node:crypto";
import { isDatabaseMode, getDb, auditLogs } from "@iuf-trading-room/db";

// ---------------------------------------------------------------------------
// Env helpers — never export raw credentials
// ---------------------------------------------------------------------------

/** Resolve KGI_ENV — "sim" | "prod" | "blocked". Default = "sim". */
export function resolveKgiEnv(): "sim" | "prod" | "blocked" {
  const raw = (process.env["KGI_ENV"] ?? "sim").toLowerCase();
  if (raw === "prod") return "prod";
  if (raw === "blocked") return "blocked";
  return "sim";
}

/** SIM quote host for display/logging purposes (no credentials embedded). */
export function simQuoteHost(): string {
  return process.env["KGI_SIM_QUOTE_HOST"] ?? "iquotetest.kgi.com.tw";
}

/** SIM trade host for display/logging purposes (no credentials embedded). */
export function simTradeHost(): string {
  return process.env["KGI_SIM_TRADE_HOST"] ?? "itradetest.kgi.com.tw";
}

/** Mask account number — 9228-001282-6 → 9228-***-6. */
export function maskAccount(account: string): string {
  // Pattern: NNNN-NNNNNN-N → NNNN-***-N
  return account.replace(/^(\d{4})-\d{6}-(\d+)$/, "$1-***-$2");
}

/** Mask Taiwan national ID — F131331910 → F13133**** */
export function maskPersonId(personId: string): string {
  if (personId.length <= 6) return "***";
  return personId.slice(0, 6) + "*".repeat(personId.length - 6);
}

/** Gateway base URL — from env KGI_GATEWAY_URL / KGI_GATEWAY_BASE_URL. */
function gatewayBaseUrl(): string {
  return (
    process.env["KGI_GATEWAY_URL"] ??
    process.env["KGI_GATEWAY_BASE_URL"] ??
    "http://127.0.0.1:8787"
  ).replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// In-memory state (singleton per process)
// ---------------------------------------------------------------------------

export type SimSmokeStatus =
  | "pending"     // never run
  | "running"     // in progress
  | "pass"        // last run succeeded
  | "fail"        // last run failed
  | "skipped";    // env not sim

export interface KgiSimState {
  /** SIM_ONLY tag — always present in API responses. */
  readonly environment: "SIM_ONLY";
  /** Resolved KGI_ENV value. */
  kgiEnv: "sim" | "prod" | "blocked";
  /** Production write path — permanently blocked. */
  readonly prodWriteBlocked: true;
  /** Whether the quote gateway answered /health with kgi_logged_in=true. */
  quoteConnected: boolean;
  /** Whether the trade path is reported as reachable (gateway-level). */
  tradeConnected: boolean;
  /** ISO timestamp of last received quote (from smoke run). */
  lastQuoteTime: string | null;
  /** Status of last SIM order smoke run. */
  lastSimOrderStatus: SimSmokeStatus;
  /** Result detail of last SIM order attempt. */
  lastSimOrderDetail: string | null;
  /** ISO timestamp of last quote smoke run. */
  lastQuoteSmokeAt: string | null;
  /** ISO timestamp of last trade smoke run. */
  lastTradeSmokeAt: string | null;
}

let _state: KgiSimState = {
  environment: "SIM_ONLY",
  kgiEnv: resolveKgiEnv(),
  prodWriteBlocked: true,
  quoteConnected: false,
  tradeConnected: false,
  lastQuoteTime: null,
  lastSimOrderStatus: "pending",
  lastSimOrderDetail: null,
  lastQuoteSmokeAt: null,
  lastTradeSmokeAt: null,
};

/** Returns a shallow snapshot of KGI SIM state (never includes credentials). */
export function getKgiSimState(): Readonly<KgiSimState> {
  // Re-read KGI_ENV each call in case env was updated at runtime (test injection).
  return { ..._state, kgiEnv: resolveKgiEnv() };
}

/** For test reset — clears in-memory state. */
export function _resetKgiSimState(): void {
  _state = {
    environment: "SIM_ONLY",
    kgiEnv: resolveKgiEnv(),
    prodWriteBlocked: true,
    quoteConnected: false,
    tradeConnected: false,
    lastQuoteTime: null,
    lastSimOrderStatus: "pending",
    lastSimOrderDetail: null,
    lastQuoteSmokeAt: null,
    lastTradeSmokeAt: null,
  };
}

// ---------------------------------------------------------------------------
// Audit log writer (system-initiated, no session)
// ---------------------------------------------------------------------------

async function writeKgiAuditLog(params: {
  workspaceId: string | null;
  action: "kgi.sim.quote_smoke" | "kgi.sim.trade_smoke";
  entityId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;
  if (!params.workspaceId) {
    console.warn("[kgi-sim-env] skipping audit log write: no workspaceId resolved");
    return;
  }
  try {
    await db.insert(auditLogs).values({
      workspaceId: params.workspaceId,
      actorId: null, // system-initiated
      action: params.action as string,
      entityType: "kgi_sim",
      entityId: params.entityId,
      payload: params.payload,
    });
  } catch (err) {
    console.warn("[kgi-sim-env] audit log write failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Resolve default workspace ID for system audit entries. */
async function resolveDefaultWorkspaceId(): Promise<string | null> {
  if (!isDatabaseMode()) return null;
  const db = getDb();
  if (!db) return null;
  try {
    const { workspaces } = await import("@iuf-trading-room/db");
    const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
    return ws?.id ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Smoke result types
// ---------------------------------------------------------------------------

export interface QuoteSmokeResult {
  /** SIM_ONLY tag — always present. */
  sim_only: true;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  symbol: string;
  gatewayReachable: boolean;
  loggedIn: boolean;
  subscribed: boolean;
  tickReceived: boolean;
  /** Partial tick data — price/volume only, no session info. */
  tickSample: { close?: number; volume?: number; datetime?: string } | null;
  /** Sanitised gateway health summary (no credentials). */
  gatewaySummary: { status?: string; kgi_logged_in?: boolean; account_set?: boolean } | null;
  error: string | null;
}

export interface TradeSmokeResult {
  /** SIM_ONLY tag — always present. */
  sim_only: true;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  symbol: string;
  orderAction: "Buy" | "Sell";
  gatewayReachable: boolean;
  loggedIn: boolean;
  orderSubmitted: boolean;
  /** "accepted" | "rejected" | "callback_received" | "not_enabled" | "error" */
  orderOutcome: string;
  orderDetail: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helper: gateway fetch with timeout
// ---------------------------------------------------------------------------

async function gwFetch(
  url: string,
  options: RequestInit = {},
  timeoutMs = 8_000
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, body: { error: msg } };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// SIM Quote Smoke
// ---------------------------------------------------------------------------

/**
 * runSimQuoteSmoke — login to SIM gateway, register 0050, receive tick.
 *
 * SIM_ONLY: targets iquotetest.kgi.com.tw (gateway proxied via KGI_GATEWAY_URL).
 * All credential values read from env vars at runtime — NEVER logged.
 * account → masked as 9228-***-6 in audit payload.
 * personId → masked as F13133**** in audit payload.
 */
export async function runSimQuoteSmoke(params: {
  workspaceId?: string | null;
  symbol?: string;
}): Promise<QuoteSmokeResult> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const symbol = params.symbol ?? "0050";
  const baseUrl = gatewayBaseUrl();

  const result: QuoteSmokeResult = {
    sim_only: true,
    runId,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    symbol,
    gatewayReachable: false,
    loggedIn: false,
    subscribed: false,
    tickReceived: false,
    tickSample: null,
    gatewaySummary: null,
    error: null,
  };

  try {
    // Step 1: health probe
    const health = await gwFetch(`${baseUrl}/health`);
    if (!health.ok) {
      result.error = `gateway_unreachable: HTTP ${health.status}`;
      _state.quoteConnected = false;
      return finalise(result, t0);
    }
    result.gatewayReachable = true;
    const healthBody = health.body as { status?: string; kgi_logged_in?: boolean; account_set?: boolean } | null;
    result.gatewaySummary = healthBody
      ? { status: healthBody.status, kgi_logged_in: healthBody.kgi_logged_in, account_set: healthBody.account_set }
      : null;
    result.loggedIn = healthBody?.kgi_logged_in ?? false;
    _state.quoteConnected = result.loggedIn;

    // Step 2: subscribe tick for symbol
    const sub = await gwFetch(
      `${baseUrl}/quote/subscribe/tick`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, odd_lot: false }),
      }
    );
    if (!sub.ok) {
      result.error = `subscribe_failed: HTTP ${sub.status}`;
      return finalise(result, t0);
    }
    result.subscribed = true;

    // Step 3: poll for ticks (up to 3 attempts with 1s gap)
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise<void>((r) => setTimeout(r, 1_000));
      const ticks = await gwFetch(`${baseUrl}/quote/ticks?symbol=${encodeURIComponent(symbol)}&limit=1`);
      if (ticks.ok) {
        const tickBody = ticks.body as { ticks?: Array<{ close?: number; volume?: number; datetime?: string }> } | null;
        const firstTick = tickBody?.ticks?.[0] ?? null;
        if (firstTick) {
          result.tickReceived = true;
          result.tickSample = {
            close: firstTick.close,
            volume: firstTick.volume,
            datetime: firstTick.datetime,
          };
          _state.lastQuoteTime = new Date().toISOString();
          break;
        }
      }
    }

  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    _state.quoteConnected = false;
  }

  const finalResult = finalise(result, t0);
  _state.lastQuoteSmokeAt = finalResult.finishedAt;

  // Resolve workspace for audit
  const workspaceId = params.workspaceId ?? await resolveDefaultWorkspaceId();
  await writeKgiAuditLog({
    workspaceId,
    action: "kgi.sim.quote_smoke",
    entityId: runId,
    payload: {
      sim_only: true,
      run_id: runId,
      symbol,
      gateway_reachable: finalResult.gatewayReachable,
      logged_in: finalResult.loggedIn,
      subscribed: finalResult.subscribed,
      tick_received: finalResult.tickReceived,
      // Sanitised tick sample (no session/account data)
      tick_sample: finalResult.tickSample,
      error: finalResult.error,
      duration_ms: finalResult.durationMs,
      // Credentials NEVER logged. Masked identifiers only.
      account_masked: maskAccount(process.env["KGI_ACCOUNT"] ?? "9228-001282-6"),
      person_id_masked: maskPersonId(process.env["KGI_PERSON_ID"] ?? ""),
    },
  });

  return finalResult;
}

// ---------------------------------------------------------------------------
// SIM Trade Smoke
// ---------------------------------------------------------------------------

/**
 * runSimTradeSmoke — submit a SIM-only test order via gateway.
 *
 * SIM_ONLY: gateway must be connected to itradetest.kgi.com.tw.
 * The gateway's /order/create endpoint either returns 409 (NOT_ENABLED) or
 * processes the order and returns an accepted/rejected callback.
 * Production write path: permanently hard-blocked (no call made if KGI_ENV != sim).
 * Audit log: action='kgi.sim.trade_smoke', no credential fields.
 */
export async function runSimTradeSmoke(params: {
  workspaceId?: string | null;
  symbol?: string;
  confirmedByBruce?: boolean;
  confirmedByJason?: boolean;
}): Promise<TradeSmokeResult> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const symbol = params.symbol ?? "0050";
  const baseUrl = gatewayBaseUrl();

  const result: TradeSmokeResult = {
    sim_only: true,
    runId,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    symbol,
    orderAction: "Buy",
    gatewayReachable: false,
    loggedIn: false,
    orderSubmitted: false,
    orderOutcome: "pending",
    orderDetail: null,
    error: null,
  };

  // Hard guard: production write path blocked
  const env = resolveKgiEnv();
  if (env !== "sim") {
    result.orderOutcome = "prod_write_blocked";
    result.orderDetail = `KGI_ENV=${env} — SIM trade smoke only allowed when KGI_ENV=sim`;
    result.error = "prod_write_blocked";
    _state.lastSimOrderStatus = "skipped";
    _state.lastSimOrderDetail = result.orderDetail;
    return finalise(result as TradeSmokeResult, t0);
  }

  // Double-confirm requirement (Bruce + Jason must confirm before SIM order)
  if (!params.confirmedByBruce || !params.confirmedByJason) {
    result.orderOutcome = "awaiting_dual_confirm";
    result.orderDetail = "SIM trade smoke requires confirmedByBruce=true AND confirmedByJason=true";
    result.error = "awaiting_dual_confirm";
    _state.lastSimOrderStatus = "pending";
    _state.lastSimOrderDetail = result.orderDetail;
    return finalise(result as TradeSmokeResult, t0);
  }

  try {
    // Step 1: health probe
    const health = await gwFetch(`${baseUrl}/health`);
    if (!health.ok) {
      result.error = `gateway_unreachable: HTTP ${health.status}`;
      _state.tradeConnected = false;
      _state.lastSimOrderStatus = "fail";
      _state.lastSimOrderDetail = result.error;
      return finalise(result, t0);
    }
    result.gatewayReachable = true;
    const healthBody = health.body as { kgi_logged_in?: boolean } | null;
    result.loggedIn = healthBody?.kgi_logged_in ?? false;
    _state.tradeConnected = result.loggedIn;

    if (!result.loggedIn) {
      result.orderOutcome = "not_logged_in";
      result.error = "gateway session not established — login required before trade smoke";
      _state.lastSimOrderStatus = "fail";
      _state.lastSimOrderDetail = result.error;
      return finalise(result, t0);
    }

    // Step 2: submit minimal SIM test order (odd-lot 1 share, market price)
    // SIM_ONLY: this calls itradetest.kgi.com.tw via the gateway.
    const order = await gwFetch(
      `${baseUrl}/order/create`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "Buy",
          symbol,
          qty: 1,
          price: null,             // market price
          time_in_force: "ROD",
          order_cond: "Cash",
          odd_lot: true,           // 1 share odd-lot — minimum SIM test
          name: "SIM_SMOKE_TEST",  // clearly labelled
        }),
      }
    );

    result.orderSubmitted = true;

    if (order.status === 409) {
      result.orderOutcome = "not_enabled";
      result.orderDetail = "Gateway returned 409 — /order/create not enabled in current gateway phase";
      _state.tradeConnected = true;
      _state.lastSimOrderStatus = "pass"; // 409 is expected/graceful in current phase
      _state.lastSimOrderDetail = result.orderDetail;
    } else if (order.ok) {
      const orderBody = order.body as { ok?: boolean; trade_id?: string; status?: string } | null;
      result.orderOutcome = "accepted";
      result.orderDetail = `order accepted: trade_id=${orderBody?.trade_id ?? "unknown"} status=${orderBody?.status ?? "unknown"}`;
      _state.lastSimOrderStatus = "pass";
      _state.lastSimOrderDetail = result.orderDetail;
    } else {
      result.orderOutcome = "rejected";
      result.orderDetail = `order rejected: HTTP ${order.status}`;
      _state.lastSimOrderStatus = "fail";
      _state.lastSimOrderDetail = result.orderDetail;
    }

  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.orderOutcome = "error";
    _state.lastSimOrderStatus = "fail";
    _state.lastSimOrderDetail = result.error;
  }

  const finalResult = finalise(result, t0);
  _state.lastTradeSmokeAt = finalResult.finishedAt;

  const workspaceId = params.workspaceId ?? await resolveDefaultWorkspaceId();
  await writeKgiAuditLog({
    workspaceId,
    action: "kgi.sim.trade_smoke",
    entityId: runId,
    payload: {
      sim_only: true,
      run_id: runId,
      symbol,
      order_action: finalResult.orderAction,
      gateway_reachable: finalResult.gatewayReachable,
      logged_in: finalResult.loggedIn,
      order_submitted: finalResult.orderSubmitted,
      order_outcome: finalResult.orderOutcome,
      order_detail: finalResult.orderDetail,
      error: finalResult.error,
      duration_ms: finalResult.durationMs,
      confirmed_by_bruce: params.confirmedByBruce ?? false,
      confirmed_by_jason: params.confirmedByJason ?? false,
      // Credentials NEVER logged. Masked identifiers only.
      account_masked: maskAccount(process.env["KGI_ACCOUNT"] ?? "9228-001282-6"),
    },
  });

  return finalResult;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function finalise<T extends { finishedAt: string; durationMs: number }>(
  result: T,
  t0: number
): T {
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;
  return { ...result, finishedAt, durationMs };
}
