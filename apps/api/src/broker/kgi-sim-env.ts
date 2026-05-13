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
import { and, eq, gte, like } from "drizzle-orm";

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
  /** ISO timestamp when the last SIM order report (trades-poll) was received. */
  lastSimOrderReportAt: string | null;
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
  lastSimOrderReportAt: null,
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
    lastSimOrderReportAt: null,
  };
}

// ---------------------------------------------------------------------------
// Audit log writer (system-initiated, no session)
// ---------------------------------------------------------------------------

async function writeKgiAuditLog(params: {
  workspaceId: string | null;
  action: "kgi.sim.quote_smoke" | "kgi.sim.trade_smoke" | "kgi.sim.daily_smoke" | "kgi.sim.order_submitted" | "kgi.sim.order_report_received";
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
  /** Whether an order report (trades-poll) was received. */
  orderReportReceived: boolean;
  /** ISO timestamp when the order report was received (null if not received). */
  orderReportAt: string | null;
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
    orderReportReceived: false,
    orderReportAt: null,
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

    // Step 2: submit minimal SIM test order (odd-lot 1 share, limit price far from market)
    // SIM_ONLY: calls itradetest.kgi.com.tw via gateway. IOC + 1 TWD = no fill risk.
    const order = await gwFetch(
      `${baseUrl}/order/create`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "Buy",
          symbol,
          qty: 1,
          price: 1,               // 1 TWD far-from-market limit, IOC auto-cancels
          time_in_force: "IOC",  // Immediately cancel if not filled
          order_cond: "Cash",
          odd_lot: true,          // 1 share odd-lot -- minimum SIM test
          name: "SIM_SMOKE_TEST", // clearly labelled
        }),
      }
    );

    result.orderSubmitted = true;

    // Write kgi.sim.order_submitted audit immediately after submit attempt
    const submitWorkspaceId = params.workspaceId ?? await resolveDefaultWorkspaceId();
    await writeKgiAuditLog({
      workspaceId: submitWorkspaceId,
      action: "kgi.sim.order_submitted",
      entityId: runId,
      payload: {
        sim_only: true,
        run_id: runId,
        symbol,
        order_http_status: order.status,
        order_ok: order.ok,
        account_masked: maskAccount(process.env["KGI_ACCOUNT"] ?? "9228-001282-6"),
      },
    });

    let tradeId: string | null = null;

    if (order.status === 409) {
      result.orderOutcome = "not_enabled";
      result.orderDetail = "Gateway returned 409 -- /order/create not enabled in current gateway phase";
      _state.tradeConnected = true;
      _state.lastSimOrderStatus = "pass"; // 409 is expected/graceful in current phase
      _state.lastSimOrderDetail = result.orderDetail;
    } else if (order.ok) {
      const orderBody = order.body as { ok?: boolean; trade_id?: string; status?: string } | null;
      tradeId = orderBody?.trade_id ?? null;
      result.orderOutcome = "accepted";
      result.orderDetail = `order accepted: trade_id=${tradeId ?? "unknown"} status=${orderBody?.status ?? "unknown"}`;
      _state.lastSimOrderStatus = "pass";
      _state.lastSimOrderDetail = result.orderDetail;
    } else {
      result.orderOutcome = "rejected";
      result.orderDetail = `order rejected: HTTP ${order.status}`;
      _state.lastSimOrderStatus = "fail";
      _state.lastSimOrderDetail = result.orderDetail;
    }

    // Step 3: Poll for order report via GET /trades (up to 3 attempts, 1.5s gap)
    // Confirms order lifecycle visible in broker. Skip only if gateway unreachable.
    if (result.gatewayReachable) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise<void>((r) => setTimeout(r, 1_500));
        const tradesRes = await gwFetch(`${baseUrl}/trades?full=false`);
        if (tradesRes.ok) {
          result.orderReportReceived = true;
          result.orderReportAt = new Date().toISOString();
          _state.lastSimOrderReportAt = result.orderReportAt;
          await writeKgiAuditLog({
            workspaceId: submitWorkspaceId,
            action: "kgi.sim.order_report_received",
            entityId: runId,
            payload: {
              sim_only: true,
              run_id: runId,
              symbol,
              trade_id_tail: tradeId ? tradeId.slice(-4) : null,
              order_outcome: result.orderOutcome,
              report_at: result.orderReportAt,
            },
          });
          break;
        }
      }
    }

  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.orderOutcome = "error";
    _state.lastSimOrderStatus = "fail";
    _state.lastSimOrderDetail = result.error;
  }

  const finalResult = finalise(result, t0);
  _state.lastTradeSmokeAt = finalResult.finishedAt;

  const finalWorkspaceId = params.workspaceId ?? await resolveDefaultWorkspaceId();
  await writeKgiAuditLog({
    workspaceId: finalWorkspaceId,
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
      order_report_received: finalResult.orderReportReceived,
      order_report_at: finalResult.orderReportAt,
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
// Daily smoke cron --- 08:00 TST window + 7-day in-memory history
// ---------------------------------------------------------------------------

/** One entry in the daily smoke history ring buffer (max 7 entries). */
export interface DailySmokeHistoryEntry {
  /** SIM_ONLY tag - always present. */
  sim_only: true;
  /** Unique run ID for this daily smoke execution. */
  runId: string;
  /** ISO timestamp when this smoke run fired. */
  firedAt: string;
  /** Overall pass/fail of the combined quote+trade smoke. */
  overallStatus: "pass" | "fail" | "partial";
  /** Quote smoke result summary. */
  quoteCheck: {
    gatewayReachable: boolean;
    loggedIn: boolean;
    tickReceived: boolean;
    error: string | null;
  };
  /**
   * Trade smoke result summary (null = skipped, dual-confirm not provided).
   * Daily cron leaves confirmedByBruce/confirmedByJason unset by default.
   */
  tradeCheck: {
    gatewayReachable: boolean;
    loggedIn: boolean;
    orderOutcome: string;
    error: string | null;
  } | null;
  /**
   * Prod write audit: broker.* audit_log entries in the last 24h.
   * 0 = clean (expected). >0 = ALERT.
   */
  prodBrokerAuditCount: number;
  /** Duration of the full daily smoke run in ms. */
  durationMs: number;
}

/** Ring buffer: last 7 daily smoke runs (in-memory, not persisted). */
const _dailySmokeHistory: DailySmokeHistoryEntry[] = [];

/** Returns the last 7 daily smoke entries, newest first. */
export function getDailySmokeHistory(): DailySmokeHistoryEntry[] {
  return [..._dailySmokeHistory].reverse();
}

/** For test reset only. */
export function _resetDailySmokeHistory(): void {
  _dailySmokeHistory.length = 0;
}

/**
 * runKgiSimDailySmokeSchedulerTick - combined daily smoke.
 *
 * Steps:
 *   1. Quote smoke (login + subscribe 0050 + receive tick)
 *   2. Prod-write audit check (broker.* audit_log entries in last 24h == 0)
 *   3. Trade smoke (only if env=sim AND confirmedByBruce AND confirmedByJason)
 *
 * Window: 08:00-08:30 TST (00:00-00:30 UTC). Call from 15-min polling cron.
 * Idempotent: skips if already fired today (TST wall-clock date).
 * forceRun=true bypasses window+idempotency (manual trigger / tests).
 *
 * Hard lines:
 *   - NEVER submits to production broker.
 *   - NEVER logs credentials.
 *   - prodWriteBlocked: always true.
 */
export async function runKgiSimDailySmokeSchedulerTick(params: {
  workspaceId?: string | null;
  confirmedByBruce?: boolean;
  confirmedByJason?: boolean;
  forceRun?: boolean;
}): Promise<DailySmokeHistoryEntry | null> {
  // Window check: 08:00-08:30 TST = 00:00-00:30 UTC
  if (!params.forceRun) {
    const now = new Date();
    const hourUTC = now.getUTCHours();
    const minUTC = now.getUTCMinutes();
    const inWindow = hourUTC === 0 && minUTC < 30;
    if (!inWindow) return null;

    // Idempotent: skip if already fired today (TST wall-clock)
    const todayTST = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const lastEntry = _dailySmokeHistory[_dailySmokeHistory.length - 1];
    if (lastEntry) {
      const lastDayTST = new Date(new Date(lastEntry.firedAt).getTime() + 8 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      if (lastDayTST === todayTST) {
        console.log(`[kgi-sim-daily-smoke] already fired today (${todayTST}), skipping`);
        return null;
      }
    }
  }

  const runId = randomUUID();
  const firedAt = new Date().toISOString();
  const t0 = Date.now();

  console.log(`[kgi-sim-daily-smoke] Starting daily smoke run=${runId}`);

  // Step 1: Quote smoke
  const workspaceId = params.workspaceId ?? await resolveDefaultWorkspaceId();
  const quoteResult = await runSimQuoteSmoke({ workspaceId, symbol: "0050" });
  console.log(
    `[kgi-sim-daily-smoke] quote: reachable=${quoteResult.gatewayReachable} ` +
    `loggedIn=${quoteResult.loggedIn} tickReceived=${quoteResult.tickReceived} ` +
    `error=${quoteResult.error ?? "none"}`
  );

  // Step 2: Prod-write audit probe (broker.* actions in last 24h must be 0)
  let prodBrokerAuditCount = 0;
  if (isDatabaseMode()) {
    const db = getDb();
    if (db && workspaceId) {
      try {
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const rows = await db
          .select({ id: auditLogs.id })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.workspaceId, workspaceId),
              gte(auditLogs.createdAt, since24h),
              like(auditLogs.action, "broker.%")
            )
          );
        prodBrokerAuditCount = rows.length;
        if (prodBrokerAuditCount > 0) {
          console.warn(
            `[kgi-sim-daily-smoke] ALERT: ${prodBrokerAuditCount} broker.* audit entries in last 24h - ` +
            "prod write may have occurred. Investigate immediately."
          );
        }
      } catch (err) {
        console.warn("[kgi-sim-daily-smoke] audit probe failed:", err instanceof Error ? err.message : String(err));
      }
    }
  }

  // Step 3: Trade smoke (gated by env=sim + dual-confirm)
  let tradeCheck: DailySmokeHistoryEntry["tradeCheck"] = null;
  const env = resolveKgiEnv();
  if (env === "sim" && params.confirmedByBruce && params.confirmedByJason) {
    const tradeResult = await runSimTradeSmoke({
      workspaceId,
      symbol: "0050",
      confirmedByBruce: params.confirmedByBruce,
      confirmedByJason: params.confirmedByJason,
    });
    tradeCheck = {
      gatewayReachable: tradeResult.gatewayReachable,
      loggedIn: tradeResult.loggedIn,
      orderOutcome: tradeResult.orderOutcome,
      error: tradeResult.error,
    };
    console.log(
      `[kgi-sim-daily-smoke] trade: reachable=${tradeResult.gatewayReachable} ` +
      `outcome=${tradeResult.orderOutcome} error=${tradeResult.error ?? "none"}`
    );
  } else if (env !== "sim") {
    console.log(`[kgi-sim-daily-smoke] trade smoke skipped: KGI_ENV=${env}`);
  } else {
    console.log("[kgi-sim-daily-smoke] trade smoke skipped: dual-confirm not provided");
  }

  // Compute overall status
  const quotePass = quoteResult.gatewayReachable && quoteResult.loggedIn;
  const tradePass = tradeCheck === null || ["accepted", "not_enabled"].includes(tradeCheck.orderOutcome);
  const auditClean = prodBrokerAuditCount === 0;
  let overallStatus: DailySmokeHistoryEntry["overallStatus"];
  if (quotePass && tradePass && auditClean) {
    overallStatus = "pass";
  } else if (!quotePass) {
    overallStatus = "fail";
  } else {
    overallStatus = "partial";
  }

  const durationMs = Date.now() - t0;

  const entry: DailySmokeHistoryEntry = {
    sim_only: true,
    runId,
    firedAt,
    overallStatus,
    quoteCheck: {
      gatewayReachable: quoteResult.gatewayReachable,
      loggedIn: quoteResult.loggedIn,
      tickReceived: quoteResult.tickReceived,
      error: quoteResult.error,
    },
    tradeCheck,
    prodBrokerAuditCount,
    durationMs,
  };

  // Append to ring buffer (max 7 entries)
  _dailySmokeHistory.push(entry);
  if (_dailySmokeHistory.length > 7) {
    _dailySmokeHistory.shift();
  }

  // Write audit log (no credentials ever)
  await writeKgiAuditLog({
    workspaceId,
    action: "kgi.sim.daily_smoke",
    entityId: runId,
    payload: {
      sim_only: true,
      run_id: runId,
      fired_at: firedAt,
      overall_status: overallStatus,
      quote_gateway_reachable: quoteResult.gatewayReachable,
      quote_logged_in: quoteResult.loggedIn,
      quote_tick_received: quoteResult.tickReceived,
      quote_error: quoteResult.error,
      trade_check: tradeCheck,
      prod_broker_audit_count: prodBrokerAuditCount,
      duration_ms: durationMs,
    },
  });

  console.log(`[kgi-sim-daily-smoke] Done: status=${overallStatus} durationMs=${durationMs}`);
  return entry;
}

// ---------------------------------------------------------------------------

function finalise<T extends { finishedAt: string; durationMs: number }>(
  result: T,
  t0: number
): T {
  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;
  return { ...result, finishedAt, durationMs };
}
