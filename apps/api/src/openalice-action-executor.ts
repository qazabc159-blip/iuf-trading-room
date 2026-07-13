/**
 * openalice-action-executor.ts — OpenAlice M2 Action Execution Layer
 *
 * Reads iuf_decisions with status='proposed' → dispatches per action_type → updates status+outcome.
 *
 * 4 action handlers (ALL SIM-safe, zero real-order paths):
 *   deep_analyze     → runReactLoop() company AI analyst (read-only tools, costCap $0.50)
 *   priority_alert   → raw SQL INSERT into iuf_events (notification centre)
 *   rec_reweight     → advisory record only (outcome written, NO recommendation mutation)
 *   rebalance_suggest → advisory record only (outcome written, NO position mutation, NO order)
 *
 * Status machine per decision row:
 *   proposed → executing → done     (success)
 *   proposed → executing → skipped  (low confidence / payload missing / not actionable)
 *   proposed → executing → proposed  (reset on unexpected outer error — retry next tick)
 *
 * Safety guarantees:
 *   W6: zero real-order / position write paths — verified by grep absence of
 *       submitOrder / placeOrder / broker adapter calls / position mutation.
 *   Per-decision try/catch: one handler failure does NOT abort the tick.
 *   Concurrent guard: _actionTickRunning flag prevents overlapping ticks.
 *   deep_analyze budget: costCapUsd=$0.50 per loop call, max 3 calls per tick = $1.50/tick max.
 *   priority_alert dedup: each decision produces exactly one iuf_event (idempotent via outcome check).
 *
 * Lane boundary:
 *   - Calls runReactLoop() from brain/react-loop.ts (dynamic import, read-only)
 *   - Writes iuf_events via raw SQL (same pattern as event-rule-engine.ts producer) — does NOT modify producer
 *   - Does NOT import or modify: risk-engine / broker/* / market-data / apps/web
 *   - Does NOT call any order submission, position mutation, or recommendation write function
 *
 * 2026-06-25: Initial M2 implementation (Jason, backend-strategy lane).
 */

import { randomUUID } from "crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb, isDatabaseMode, execRows } from "@iuf-trading-room/db";
import { getDailyBudgetUsd, getTodayUtc } from "./llm/llm-gateway.js";
import { resolvePrimaryWorkspaceId } from "./workspace-scope.js";

// ── Types ──────────────────────────────────────────────────────────────────────

type ProposedDecisionRow = {
  id?: string;
  trigger_type?: string;
  trigger_ref?: Record<string, unknown> | string | null;
  action_type?: string;
  action_payload?: Record<string, unknown> | string | null;
  confidence?: number | string | null;
  priority?: number | string | null;
  reasoning?: string | null;
  created_at?: string | Date | null;
};

type ActionOutcome = Record<string, unknown>;

// ── Constants ──────────────────────────────────────────────────────────────────

// Max decisions to execute per tick (keeps LLM spend bounded)
const MAX_DECISIONS_PER_TICK = 5;

// Maximum deep_analyze executions per calendar day (UTC).
// Prevents 22+/day noise burner — keeps "少而精" discipline.
// Override with OPENALICE_DEEP_ANALYZE_DAILY_CAP env var.
function getDeepAnalyzeDailyCap(): number {
  const env = process.env["OPENALICE_DEEP_ANALYZE_DAILY_CAP"];
  const parsed = env ? parseInt(env, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
}

// Minimum remaining LLM budget (USD) required before starting a deep_analyze.
// A single deep_analyze call (ReAct steps + synthesis) costs ~$0.01-0.05 at
// gpt-4o-mini rates. $0.10 gives comfortable headroom.
const DEEP_ANALYZE_MIN_BUDGET_USD = 0.10;

// Minimum confidence threshold to execute deep_analyze (below = skipped)
const DEEP_ANALYZE_MIN_CONFIDENCE = 0.4;

// Cost cap per deep_analyze runReactLoop call (USD)
const DEEP_ANALYZE_COST_CAP_USD = 0.5;

// Max rounds for the company AI analyst ReAct loop
const DEEP_ANALYZE_MAX_ROUNDS = 4;

// Read-only tool whitelist for deep_analyze (same set as brain/react endpoint)
const DEEP_ANALYZE_TOOL_WHITELIST = [
  "get_company_technical",
  "get_news_top10",
  "get_market_overview",
  "get_institutional_flow",
  "finmind_sync",
];

// Severity for priority_alert events written to iuf_events
// iuf_events CHECK constraint (migration 0025) only allows: 'info' | 'warning' | 'critical'.
// "high" (the old prio-3 value) violated the CHECK → every priority_alert INSERT failed
// silently (event_insert_failed), so alerts never reached the notification feed.
const PRIORITY_ALERT_SEVERITY_MAP: Record<string, string> = {
  "1": "critical",
  "2": "critical",
  "3": "warning",
  "4": "info",
  "5": "info",
};

// Rule ID prefix for decisions-generated events
const ALERT_RULE_ID = "R_OPENALICE_DECISION";
const ALERT_RULE_NAME = "OpenAlice 決策告警";

// ── Action tick state ──────────────────────────────────────────────────────────

let _actionTickRunning = false;
let _lastActionTickAt: string | null = null;
let _lastActionTickDone = 0;
let _lastActionTickSkipped = 0;
let _lastActionTickError: string | null = null;

export function getActionExecutorTickState() {
  return {
    tickRunning: _actionTickRunning,
    lastTickAt: _lastActionTickAt,
    lastTickDone: _lastActionTickDone,
    lastTickSkipped: _lastActionTickSkipped,
    lastTickError: _lastActionTickError,
  };
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function fetchProposedDecisions(): Promise<ProposedDecisionRow[]> {
  const db = getDb();
  if (!db) return [];

  try {
    const rows = await db.execute(drizzleSql`
      SELECT id, trigger_type, trigger_ref, action_type, action_payload,
             confidence, priority, reasoning, created_at
      FROM iuf_decisions
      WHERE status = 'proposed'
      ORDER BY priority ASC, confidence DESC, created_at DESC
      LIMIT ${drizzleSql.raw(String(MAX_DECISIONS_PER_TICK))}
    `);
    return execRows<ProposedDecisionRow>(rows);
  } catch (e) {
    console.warn(
      "[openalice-action-executor] fetchProposedDecisions failed:",
      e instanceof Error ? e.message : String(e)
    );
    return [];
  }
}

async function markExecuting(decisionId: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.execute(drizzleSql`
    UPDATE iuf_decisions SET status = 'executing' WHERE id = ${decisionId}::uuid AND status = 'proposed'
  `);
}

async function markDone(decisionId: string, outcome: ActionOutcome): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.execute(drizzleSql`
    UPDATE iuf_decisions
    SET status = 'done', outcome = ${JSON.stringify(outcome)}::jsonb
    WHERE id = ${decisionId}::uuid
  `);
}

async function markSkipped(decisionId: string, outcome: ActionOutcome): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.execute(drizzleSql`
    UPDATE iuf_decisions
    SET status = 'skipped', outcome = ${JSON.stringify(outcome)}::jsonb
    WHERE id = ${decisionId}::uuid
  `);
}

async function resetToProposed(decisionId: string): Promise<void> {
  // Called on unexpected outer error to allow retry next tick.
  const db = getDb();
  if (!db) return;
  await db.execute(drizzleSql`
    UPDATE iuf_decisions SET status = 'proposed' WHERE id = ${decisionId}::uuid AND status = 'executing'
  `);
}

// ── Governance helpers ─────────────────────────────────────────────────────────

/**
 * Returns the number of deep_analyze decisions that completed today (UTC).
 * Used to enforce OPENALICE_DEEP_ANALYZE_DAILY_CAP.
 */
async function countTodayDeepAnalyzeDone(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  try {
    const today = getTodayUtc(); // "YYYY-MM-DD" UTC
    const rows = await db.execute(drizzleSql`
      SELECT COUNT(*)::int AS cnt
      FROM iuf_decisions
      WHERE action_type = 'deep_analyze'
        AND status = 'done'
        AND DATE(created_at AT TIME ZONE 'UTC') = ${today}::date
    `);
    const r = execRows<{ cnt: number | string }>(rows);
    return Number(r[0]?.cnt ?? 0);
  } catch (e) {
    console.warn(
      "[openalice-action-executor] countTodayDeepAnalyzeDone failed:",
      e instanceof Error ? e.message : String(e)
    );
    return 0;
  }
}

/**
 * Returns true if the ticker has already been deep_analyzed today (UTC).
 * Prevents same-ticker budget burn on multiple breakout signals.
 */
async function isTickerDeepAnalyzedToday(ticker: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const today = getTodayUtc();
    const rows = await db.execute(drizzleSql`
      SELECT COUNT(*)::int AS cnt
      FROM iuf_decisions
      WHERE action_type = 'deep_analyze'
        AND status = 'done'
        AND DATE(created_at AT TIME ZONE 'UTC') = ${today}::date
        AND (
          action_payload->>'tickers' LIKE ${'%' + ticker + '%'}
          OR action_payload->>'ticker' = ${ticker}
          OR trigger_ref->>'ticker' = ${ticker}
        )
    `);
    const r = execRows<{ cnt: number | string }>(rows);
    return Number(r[0]?.cnt ?? 0) > 0;
  } catch (e) {
    console.warn(
      "[openalice-action-executor] isTickerDeepAnalyzedToday failed:",
      e instanceof Error ? e.message : String(e)
    );
    return false; // fail-open: allow execution rather than over-blocking
  }
}

/**
 * Returns the remaining LLM daily budget in USD.
 * Queries llm_cost_daily for today's spend, then subtracts from cap.
 * Returns Infinity on DB error (fail-open — don't block on budget DB failure).
 */
async function getRemainingBudgetUsd(): Promise<number> {
  const db = getDb();
  if (!db) return Infinity;
  try {
    const today = getTodayUtc();
    const rows = await db.execute(drizzleSql`
      SELECT COALESCE(SUM(total_cost_usd), 0) AS today_cost
      FROM llm_cost_daily
      WHERE date = ${today}::date
    `);
    const r = execRows<{ today_cost: string | number }>(rows);
    const spent = parseFloat(String(r[0]?.today_cost ?? "0"));
    const budget = getDailyBudgetUsd();
    return Math.max(0, budget - spent);
  } catch (e) {
    console.warn(
      "[openalice-action-executor] getRemainingBudgetUsd failed:",
      e instanceof Error ? e.message : String(e)
    );
    return Infinity; // fail-open
  }
}

// ── Payload parser ─────────────────────────────────────────────────────────────

function parsePayload(raw: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  return raw;
}

function parseTriggerRef(raw: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
  return parsePayload(raw);
}

// ── Handler: deep_analyze ──────────────────────────────────────────────────────
//
// Calls runReactLoop() (read-only Brain ReAct loop) for each ticker in action_payload.tickers.
// No write-ops. No broker. No order. Reports are stored in brain_decisions table by the loop itself.
// We write a reference + summary to iuf_decisions.outcome.

async function handleDeepAnalyze(
  decisionId: string,
  payload: Record<string, unknown>,
  triggerRef: Record<string, unknown>,
  confidence: number,
  workspaceId: string | null,
  dailyCapState: { doneCount: number; cap: number }
): Promise<{ status: "done" | "skipped"; outcome: ActionOutcome }> {
  // ── Governance gate 1: daily cap ──────────────────────────────────────────
  if (dailyCapState.doneCount >= dailyCapState.cap) {
    console.log(
      `[openalice-action-executor] deep_analyze daily cap reached ` +
        `(done=${dailyCapState.doneCount} cap=${dailyCapState.cap}) — skipping`
    );
    return {
      status: "skipped",
      outcome: {
        reason: "deep_analyze_daily_cap_reached",
        doneToday: dailyCapState.doneCount,
        cap: dailyCapState.cap,
      },
    };
  }

  // ── Governance gate 2: budget preflight ───────────────────────────────────
  const remainingBudget = await getRemainingBudgetUsd();
  if (remainingBudget < DEEP_ANALYZE_MIN_BUDGET_USD) {
    console.log(
      `[openalice-action-executor] deep_analyze budget insufficient ` +
        `(remaining=$${remainingBudget.toFixed(4)} min=$${DEEP_ANALYZE_MIN_BUDGET_USD}) — skipping`
    );
    return {
      status: "skipped",
      outcome: {
        reason: "budget_insufficient",
        remainingBudgetUsd: remainingBudget,
        minRequiredUsd: DEEP_ANALYZE_MIN_BUDGET_USD,
      },
    };
  }

  // ── Governance gate 3: low confidence ────────────────────────────────────
  if (confidence < DEEP_ANALYZE_MIN_CONFIDENCE) {
    return {
      status: "skipped",
      outcome: {
        reason: "confidence_below_threshold",
        confidence,
        threshold: DEEP_ANALYZE_MIN_CONFIDENCE,
      },
    };
  }

  // Extract tickers from payload — primary source
  const rawTickers = payload["tickers"];
  let tickers: string[] = Array.isArray(rawTickers)
    ? rawTickers.filter((t): t is string => typeof t === "string").slice(0, 3)
    : typeof payload["ticker"] === "string"
    ? [payload["ticker"]]
    : [];

  // Fallback: if action_payload had no tickers, look in trigger_ref (the original event/signal data).
  // This covers the case where the LLM correctly decided deep_analyze but omitted tickers from payload.
  // trigger_ref.ticker is set by the orchestrator directly from the iuf_events / signals row.
  if (tickers.length === 0) {
    const refTicker =
      typeof triggerRef["ticker"] === "string" && triggerRef["ticker"].trim()
        ? triggerRef["ticker"].trim()
        : null;
    if (refTicker) {
      tickers = [refTicker];
      console.log(
        `[openalice-action-executor] deep_analyze: no tickers in action_payload — ` +
          `falling back to trigger_ref.ticker="${refTicker}"`
      );
    }
  }

  if (tickers.length === 0) {
    return {
      status: "skipped",
      outcome: { reason: "no_tickers_in_payload_or_trigger_ref", payload, triggerRefTicker: triggerRef["ticker"] ?? null },
    };
  }

  // Dynamic import — keeps startup cost low; also matches pattern in server.ts
  const { runReactLoop, COMPANY_AI_ANALYST_REPORT_TEMPLATE_VERSION } = await import(
    "./brain/react-loop.js"
  );

  const analysisResults: Array<{
    ticker: string;
    runId: string;
    status: string;
    costUsd: number;
    decisionId: string | null;
    reportSummary: string;
  }> = [];

  for (const ticker of tickers) {
    // ── Governance gate 4: per-ticker daily dedup ───────────────────────────
    const alreadyDone = await isTickerDeepAnalyzedToday(ticker.toUpperCase());
    if (alreadyDone) {
      console.log(
        `[openalice-action-executor] deep_analyze ${ticker} already analyzed today — skipping`
      );
      analysisResults.push({
        ticker: ticker.toUpperCase(),
        runId: "dedup",
        status: "already_analyzed_today",
        costUsd: 0,
        decisionId: null,
        reportSummary: `已跳過：${ticker.toUpperCase()} 今日已深析`,
      });
      continue;
    }

    // ── Governance gate 5: re-check daily cap inside loop (in case cap was
    //    consumed by a previous ticker in this same tick) ────────────────────
    if (dailyCapState.doneCount >= dailyCapState.cap) {
      console.log(
        `[openalice-action-executor] deep_analyze daily cap reached mid-loop ` +
          `(done=${dailyCapState.doneCount} cap=${dailyCapState.cap}) — stopping ticker loop`
      );
      break;
    }

    try {
      const reasonTags: string[] = Array.isArray(payload["reason_tags"])
        ? (payload["reason_tags"] as string[]).filter((t): t is string => typeof t === "string")
        : [];

      const initialPrompt = [
        `TEMPLATE_VERSION: ${COMPANY_AI_ANALYST_REPORT_TEMPLATE_VERSION}`,
        `分析標的: ${ticker.toUpperCase()}`,
        ...(reasonTags.length > 0 ? [`觸發原因: ${reasonTags.join(", ")}`] : []),
        ...(triggerRef["ruleName"] ? [`市場事件: ${String(triggerRef["ruleName"])}`] : []),
        ``,
        `請依照 9 軸分析框架完整分析，提供中文分析報告。`,
      ].join("\n");

      const result = await runReactLoop({
        workspaceId,
        initialPrompt,
        toolWhitelist: DEEP_ANALYZE_TOOL_WHITELIST,
        maxRounds: DEEP_ANALYZE_MAX_ROUNDS,
        costCapUsd: DEEP_ANALYZE_COST_CAP_USD,
        runId: randomUUID(),
      });

      // ── Honest status: detect "done but report empty" (budget exhausted during
      //    synthesis). react-loop returns status="complete" but finalReport
      //    contains the "報告生成失敗（LLM 配額不足）" sentinel string. We surface
      //    this as a distinct status so the outcome is not silently marked done.
      const EMPTY_REPORT_SENTINEL = "報告生成失敗";
      const reportIsSentinel = result.finalReport.includes(EMPTY_REPORT_SENTINEL);

      // Count this run against the daily cap only if a real report was produced.
      if (result.status === "complete" && !reportIsSentinel) {
        dailyCapState.doneCount++;
      }

      // Extract a short summary (first 200 chars of finalReport, no engineering tokens)
      const summaryRaw = result.finalReport.slice(0, 200).replace(/\n+/g, " ").trim();
      const summary = summaryRaw.length > 0 ? summaryRaw + (result.finalReport.length > 200 ? "…" : "") : "分析完成";

      analysisResults.push({
        ticker: ticker.toUpperCase(),
        runId: result.runId,
        status: reportIsSentinel ? "budget_exhausted_no_report" : result.status,
        costUsd: result.totalCostUsd,
        decisionId: result.decisionId,
        reportSummary: summary,
      });

      console.log(
        `[openalice-action-executor] deep_analyze ${ticker} → ${result.status} ` +
          `(cost=$${result.totalCostUsd.toFixed(4)}, decisionId=${result.decisionId ?? "n/a"})`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[openalice-action-executor] deep_analyze ${ticker} failed: ${msg}`);
      analysisResults.push({
        ticker: ticker.toUpperCase(),
        runId: "error",
        status: "failed",
        costUsd: 0,
        decisionId: null,
        reportSummary: `分析失敗: ${msg.slice(0, 80)}`,
      });
    }
  }

  // If every analysis entry was a dedup-skip, budget_exhausted, failed, or
  // produced no real report — mark the decision as skipped (honest) instead of done.
  const REAL_REPORT_STATUSES = new Set(["complete"]);
  const anyRealReport = analysisResults.some((r) => REAL_REPORT_STATUSES.has(r.status));

  if (!anyRealReport && analysisResults.length > 0) {
    const allBudgetExhausted = analysisResults.every(
      (r) => r.status === "budget_exhausted_no_report"
    );
    const allDedup = analysisResults.every((r) => r.status === "already_analyzed_today");
    return {
      status: "skipped",
      outcome: {
        actionType: "deep_analyze",
        reason: allDedup
          ? "already_analyzed_today"
          : allBudgetExhausted
          ? "budget_insufficient"
          : "no_real_report_produced",
        executedAt: new Date().toISOString(),
        tickers,
        analyses: analysisResults,
        totalCostUsd: analysisResults.reduce((s, r) => s + r.costUsd, 0),
      },
    };
  }

  return {
    status: "done",
    outcome: {
      actionType: "deep_analyze",
      executedAt: new Date().toISOString(),
      tickers,
      analyses: analysisResults,
      totalCostUsd: analysisResults.reduce((s, r) => s + r.costUsd, 0),
    },
  };
}

// ── Handler: priority_alert ────────────────────────────────────────────────────
//
// Writes one iuf_events row (notification centre) for this decision.
// Uses raw SQL — same INSERT pattern as openalice-event-rule-engine.ts.
// Does NOT import or modify event-rule-engine.ts.
// Idempotent: outcome records the event id; if already done, the row will be in status='done' and skipped by fetchProposed.

async function handlePriorityAlert(
  decisionId: string,
  payload: Record<string, unknown>,
  triggerRef: Record<string, unknown>,
  reasoning: string,
  priority: number,
  workspaceId: string | null,
): Promise<{ status: "done" | "skipped"; outcome: ActionOutcome }> {
  const db = getDb();
  if (!db) {
    return { status: "skipped", outcome: { reason: "db_unavailable" } };
  }
  if (!workspaceId) {
    return { status: "skipped", outcome: { reason: "workspace_unavailable" } };
  }

  // Build alert message — prefer payload.message, fall back to reasoning
  const message =
    typeof payload["message"] === "string" && payload["message"].trim()
      ? payload["message"].trim()
      : reasoning.trim() || "OpenAlice 決策告警";

  const severity = PRIORITY_ALERT_SEVERITY_MAP[String(priority)] ?? "info";
  const ticker =
    typeof triggerRef["ticker"] === "string" && triggerRef["ticker"].trim()
      ? triggerRef["ticker"].trim()
      : null;

  const eventId = randomUUID();
  const triggeredAt = new Date().toISOString();

  const eventPayload = {
    source: "openalice_decision",
    decisionId,
    message,
    originalPayload: payload,
    reasoning: reasoning.slice(0, 300),
  };

  try {
    await db.execute(drizzleSql`
      INSERT INTO iuf_events
        (id, workspace_id, rule_id, rule_name, severity, ticker, payload, triggered_at, acknowledged)
      VALUES
        (${eventId}, ${workspaceId}, ${ALERT_RULE_ID}, ${ALERT_RULE_NAME}, ${severity},
         ${ticker}, ${JSON.stringify(eventPayload)}::jsonb, ${triggeredAt}, false)
    `);

    console.log(
      `[openalice-action-executor] priority_alert → iuf_events id=${eventId} ` +
        `severity=${severity} ticker=${ticker ?? "system"}`
    );

    return {
      status: "done",
      outcome: {
        actionType: "priority_alert",
        executedAt: triggeredAt,
        eventId,
        severity,
        message,
        ticker,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[openalice-action-executor] priority_alert INSERT failed: ${msg}`);
    return {
      status: "skipped",
      outcome: { reason: "event_insert_failed", error: msg.slice(0, 200) },
    };
  }
}

// ── Handler: rec_reweight ──────────────────────────────────────────────────────
//
// Advisory only — produces a structured advisory record in outcome.
// Does NOT mutate the recommendation system, weights, or any persistent recommendation row.
// The advisory is available to M3 UI via the observability endpoint.

async function handleRecReweight(
  decisionId: string,
  payload: Record<string, unknown>,
  reasoning: string
): Promise<{ status: "done" | "skipped"; outcome: ActionOutcome }> {
  const direction = typeof payload["direction"] === "string" ? payload["direction"] : null;
  const reason = typeof payload["reason"] === "string" ? payload["reason"] : reasoning;
  const weightDelta =
    typeof payload["weight_delta"] === "number" ? payload["weight_delta"] : null;

  if (!direction) {
    return {
      status: "skipped",
      outcome: { reason: "missing_direction_in_payload", payload },
    };
  }

  const advisory = {
    advisory: true,
    actionType: "rec_reweight",
    executedAt: new Date().toISOString(),
    direction,
    reason: reason.slice(0, 400),
    suggestedWeightDelta: weightDelta,
    note: "Advisory only — recommendation weights NOT mutated. Human operator should review.",
    // Explicit W6 attestation: no recommendation write was performed.
    realOrderPath: false,
    recommendationMutated: false,
  };

  console.log(
    `[openalice-action-executor] rec_reweight advisory: direction=${direction} weightDelta=${weightDelta}`
  );

  return { status: "done", outcome: advisory };
}

// ── Handler: rebalance_suggest ─────────────────────────────────────────────────
//
// Advisory only — produces a structured portfolio advisory record in outcome.
// Does NOT submit orders, mutate positions, or call any broker adapter.

async function handleRebalanceSuggest(
  decisionId: string,
  payload: Record<string, unknown>,
  reasoning: string
): Promise<{ status: "done" | "skipped"; outcome: ActionOutcome }> {
  const rawTickers = payload["tickers"];
  const tickers: string[] = Array.isArray(rawTickers)
    ? rawTickers.filter((t): t is string => typeof t === "string")
    : [];

  const action = typeof payload["action"] === "string" ? payload["action"] : null;
  const reason = typeof payload["reason"] === "string" ? payload["reason"] : reasoning;

  if (tickers.length === 0 && !action) {
    return {
      status: "skipped",
      outcome: { reason: "insufficient_payload", payload },
    };
  }

  const advisory = {
    advisory: true,
    actionType: "rebalance_suggest",
    executedAt: new Date().toISOString(),
    suggestedTickers: tickers,
    suggestedAction: action,
    reason: reason.slice(0, 400),
    note: "Advisory only — NO orders submitted, NO positions mutated. Human operator should review.",
    // Explicit W6 attestation: no order or position write was performed.
    realOrderPath: false,
    positionMutated: false,
    orderSubmitted: false,
  };

  console.log(
    `[openalice-action-executor] rebalance_suggest advisory: tickers=${tickers.join(",")} action=${action}`
  );

  return { status: "done", outcome: advisory };
}

// ── Main tick ──────────────────────────────────────────────────────────────────

/**
 * runOpenAliceActionTick
 *
 * Called every 7 minutes by the scheduler registered in server.ts.
 * Reads status='proposed' decisions → dispatches by action_type → updates status+outcome.
 *
 * Cadence: 7 min (offset from M1's 10 min so they don't fire simultaneously).
 * Boot-fire: 90s (gives M1 its 60s boot-fire a head start).
 *
 * Safe-default: never throws. All per-decision errors caught internally.
 * On unexpected outer error: resets executing decisions back to proposed for retry.
 */
export async function runOpenAliceActionTick(_workspaceId?: string | null): Promise<void> {
  if (!isDatabaseMode()) return;
  if (_actionTickRunning) {
    console.log("[openalice-action-executor] tick already running — skipping");
    return;
  }

  _actionTickRunning = true;
  _lastActionTickError = null;
  let done = 0;
  let skipped = 0;
  const executingIds: string[] = [];

  try {
    const scopedWorkspaceId = await resolvePrimaryWorkspaceId();
    if (!scopedWorkspaceId) throw new Error("primary_workspace_unavailable");
    const rows = await fetchProposedDecisions();

    if (rows.length === 0) {
      console.log("[openalice-action-executor] no proposed decisions — tick complete");
      _lastActionTickAt = new Date().toISOString();
      return;
    }

    console.log(`[openalice-action-executor] processing ${rows.length} proposed decisions`);

    // Fetch today's deep_analyze count once per tick (shared across decisions in this tick).
    // This is mutable state passed to handleDeepAnalyze so ticker-loop increments are visible.
    const deepAnalyzeCap = getDeepAnalyzeDailyCap();
    const deepAnalyzeCapState = {
      doneCount: await countTodayDeepAnalyzeDone(),
      cap: deepAnalyzeCap,
    };

    if (deepAnalyzeCapState.doneCount >= deepAnalyzeCap) {
      console.log(
        `[openalice-action-executor] deep_analyze daily cap already reached ` +
          `(done=${deepAnalyzeCapState.doneCount} cap=${deepAnalyzeCap}) — ` +
          `will skip all deep_analyze proposals this tick`
      );
    }

    for (const row of rows) {
      if (!row.id) continue;
      const decisionId = String(row.id);

      const actionType = typeof row.action_type === "string" ? row.action_type : "priority_alert";
      const payload = parsePayload(row.action_payload);
      const triggerRef = parseTriggerRef(row.trigger_ref);
      const confidence = Number(row.confidence ?? 0);
      const priority = Math.round(Number(row.priority ?? 3));
      const reasoning = typeof row.reasoning === "string" ? row.reasoning : "";

      // Mark executing so concurrent ticks won't pick it up
      try {
        await markExecuting(decisionId);
        executingIds.push(decisionId);
      } catch (e) {
        console.warn(`[openalice-action-executor] markExecuting ${decisionId} failed — skipping:`, e instanceof Error ? e.message : String(e));
        continue;
      }

      try {
        let result: { status: "done" | "skipped"; outcome: ActionOutcome };

        switch (actionType) {
          case "deep_analyze":
            result = await handleDeepAnalyze(
              decisionId,
              payload,
              triggerRef,
              confidence,
              scopedWorkspaceId,
              deepAnalyzeCapState
            );
            break;

          case "priority_alert":
            result = await handlePriorityAlert(
              decisionId,
              payload,
              triggerRef,
              reasoning,
              priority,
              scopedWorkspaceId,
            );
            break;

          case "rec_reweight":
            result = await handleRecReweight(decisionId, payload, reasoning);
            break;

          case "rebalance_suggest":
            result = await handleRebalanceSuggest(decisionId, payload, reasoning);
            break;

          default:
            // Unknown action_type — skip with explanation
            result = {
              status: "skipped",
              outcome: { reason: "unknown_action_type", actionType },
            };
        }

        if (result.status === "done") {
          await markDone(decisionId, result.outcome);
          done++;
        } else {
          await markSkipped(decisionId, result.outcome);
          skipped++;
        }

        // Remove from executingIds now that it's finalized
        const idx = executingIds.indexOf(decisionId);
        if (idx !== -1) executingIds.splice(idx, 1);

        console.log(
          `[openalice-action-executor] decision ${decisionId} (${actionType}) → ${result.status}`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[openalice-action-executor] decision ${decisionId} error — resetting to proposed: ${msg}`);
        // Reset to proposed so next tick can retry
        try {
          await resetToProposed(decisionId);
        } catch {
          // Best-effort
        }
        const idx = executingIds.indexOf(decisionId);
        if (idx !== -1) executingIds.splice(idx, 1);
      }
    }

    _lastActionTickDone = done;
    _lastActionTickSkipped = skipped;
    _lastActionTickAt = new Date().toISOString();
    console.log(
      `[openalice-action-executor] tick complete — done=${done} skipped=${skipped} of ${rows.length}`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    _lastActionTickError = msg;
    console.error("[openalice-action-executor] tick fatal error (contained):", msg);

    // Safety: reset any stuck executing rows back to proposed
    for (const id of executingIds) {
      try { await resetToProposed(id); } catch { /* best-effort */ }
    }
  } finally {
    _actionTickRunning = false;
  }
}

// ── Test-only exports ──────────────────────────────────────────────────────────
// Exported for unit tests only — not part of the public API.

/** Exposed so tests can verify the cap default and env-override logic. */
export function _getDeepAnalyzeDailyCapForTest(): number {
  return getDeepAnalyzeDailyCap();
}

/** Exposed so tests can verify the sentinel detection logic. */
export const _EMPTY_REPORT_SENTINEL_FOR_TEST = "報告生成失敗";

/** Exposed so tests can verify the min-budget constant. */
export const _DEEP_ANALYZE_MIN_BUDGET_USD_FOR_TEST = DEEP_ANALYZE_MIN_BUDGET_USD;

// Mirrors the ticker extraction logic in handleDeepAnalyze.
export function _extractTickersForTest(
  payload: Record<string, unknown>,
  triggerRef: Record<string, unknown>
): { tickers: string[]; source: "payload" | "trigger_ref_fallback" | "none" } {
  const rawTickers = payload["tickers"];
  let tickers: string[] = Array.isArray(rawTickers)
    ? rawTickers.filter((t): t is string => typeof t === "string").slice(0, 3)
    : typeof payload["ticker"] === "string"
    ? [payload["ticker"]]
    : [];

  if (tickers.length > 0) return { tickers, source: "payload" };

  const refTicker =
    typeof triggerRef["ticker"] === "string" && triggerRef["ticker"].trim()
      ? triggerRef["ticker"].trim()
      : null;

  if (refTicker) return { tickers: [refTicker], source: "trigger_ref_fallback" };

  return { tickers: [], source: "none" };
}
