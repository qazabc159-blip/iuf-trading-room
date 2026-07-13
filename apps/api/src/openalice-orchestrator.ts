/**
 * openalice-orchestrator.ts — OpenAlice M1 Decision Layer
 *
 * Consumes iuf_events + signals → LLM reasoning → writes iuf_decisions.
 * M1 scope: decision PRODUCTION only (status='proposed'). Execution is M2.
 *
 * Flow per tick (every 10 min):
 *   1. Query iuf_events from last 2h that have no existing iuf_decisions row
 *   2. Query signals from last 2h that have no existing iuf_decisions row
 *   3. For each trigger: call LLM → structured output → INSERT iuf_decisions
 *   4. Dedup: ON CONFLICT (trigger_type, trigger_id) DO NOTHING
 *   5. Safe-default: any per-trigger error is caught + logged; tick continues
 *
 * Budget: callLlm() enforces getDailyBudgetUsd() ($10/day default).
 * Per-tick: max 10 events + 5 signals = 15 LLM calls × ~800 tokens × $0.00015/1k = ~$0.002/tick.
 * At 10-min cadence: ~$0.3/day well within budget.
 *
 * Lane boundary:
 *   - Does NOT modify openalice-event-rule-engine.ts (producer)
 *   - Does NOT modify signal-auto-emitter.ts (producer)
 *   - Does NOT touch broker / risk-engine / market-data / web
 *   - M1 NEVER executes actions, submits orders, or modifies positions
 *
 * 2026-06-24: Initial M1 implementation (Jason, backend-strategy lane).
 */

import { sql as drizzleSql } from "drizzle-orm";
import { getDb, isDatabaseMode, execRows } from "@iuf-trading-room/db";
import { callLlm, stripCodeFences } from "./llm/llm-gateway.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type DecisionActionType =
  | "deep_analyze"
  | "rec_reweight"
  | "rebalance_suggest"
  | "priority_alert";

export type DecisionStatus = "proposed" | "executing" | "done" | "skipped";

export type IufDecision = {
  id: string;
  triggerType: "event" | "signal";
  triggerId: string;
  triggerRef: Record<string, unknown>;
  reasoning: string;
  actionType: DecisionActionType;
  actionPayload: Record<string, unknown>;
  confidence: number;       // [0, 1]
  priority: number;         // 1 (highest) .. 5 (lowest)
  status: DecisionStatus;
  outcome: Record<string, unknown> | null;
  modelKey: string | null;
  costUsd: number;
  createdAt: string;
};

type LlmDecisionOutput = {
  action_type: DecisionActionType;
  action_payload: Record<string, unknown>;
  confidence: number;
  priority: number;
  reasoning: string;
};

// Row shapes from raw SQL queries
type IufEventRow = {
  id?: string;
  rule_id?: string;
  rule_name?: string;
  severity?: string;
  ticker?: string | null;
  payload?: Record<string, unknown> | string;
  triggered_at?: string | Date;
};

type SignalRow = {
  id?: string;
  category?: string;
  direction?: string;
  title?: string;
  summary?: string;
  confidence?: number;
  company_ids?: unknown;
  created_at?: string | Date;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const VALID_ACTION_TYPES = new Set<DecisionActionType>([
  "deep_analyze",
  "rec_reweight",
  "rebalance_suggest",
  "priority_alert",
]);

// How far back to look for unprocessed events/signals per tick
const LOOKBACK_HOURS = 2;

// Per-tick limits to bound LLM spend
const MAX_EVENTS_PER_TICK = 10;
const MAX_SIGNALS_PER_TICK = 5;

// The brain must NOT consume its own priority_alert notifications as new triggers.
// The action-executor writes executed priority_alert decisions back into iuf_events
// with rule_id = "R_OPENALICE_DECISION" (openalice-action-executor.ts ALERT_RULE_ID).
// If the orchestrator picks those up, each one yields another priority_alert decision
// → executed into another iuf_event → consumed again = a self-amplification loop.
// 2026-06-26: during the OpenAI 429 outage every decision fell back to priority_alert,
// and this loop produced 322 near-identical "LLM unavailable" alerts in ~1h. Excluding
// self-emitted alert events breaks the loop at the source.
const SELF_ALERT_RULE_ID = "R_OPENALICE_DECISION";

// LLM config
const ORCHESTRATOR_MODEL = "gpt-4o-mini";
const ORCHESTRATOR_MAX_TOKENS = 800;
const ORCHESTRATOR_TEMPERATURE = 0.1;

// ── LLM prompt builders ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are OpenAlice, the decision-making brain of an AI trading room.

You receive a market event or signal. Your job is to reason about it and decide the SINGLE best next action.

Action types (choose EXACTLY one):
- "deep_analyze": Trigger detailed AI analysis for a specific stock (e.g. institutional buy surge, revenue spike, breakout signal)
- "rec_reweight": Adjust recommendation weights (e.g. market risk elevated, reduce risk exposure)
- "rebalance_suggest": Suggest portfolio rebalancing (e.g. S1 positions empty, concentration risk)
- "priority_alert": Surface a critical alert to the operator (e.g. system health failure, budget exceeded)

Rules:
- NEVER suggest placing real trades or submitting orders
- NEVER suggest actions involving real money execution
- NEVER mention specific returns, profit guarantees, or follow-trade suggestions
- Be concise in reasoning (2-3 sentences max)
- confidence: 0.0-1.0 (how confident you are this is the right action)
- priority: 1 (urgent/critical) to 5 (low/informational)
- action_type and all JSON keys MUST remain in English (enum values unchanged)
- The "reasoning" field MUST be written in Traditional Chinese (繁體中文)
- If the trigger involves a specific stock ticker, include it in action_payload.tickers as an array (e.g. ["2330"])

Return ONLY valid JSON matching this exact schema:
{
  "action_type": "deep_analyze" | "rec_reweight" | "rebalance_suggest" | "priority_alert",
  "action_payload": { ... },
  "confidence": 0.0..1.0,
  "priority": 1..5,
  "reasoning": "2-3 句繁體中文說明"
}`;

function buildUserPrompt(
  triggerType: "event" | "signal",
  triggerRef: Record<string, unknown>
): string {
  if (triggerType === "event") {
    const ruleId = String(triggerRef["ruleId"] ?? "unknown");
    const ruleName = String(triggerRef["ruleName"] ?? "unknown");
    const severity = String(triggerRef["severity"] ?? "info");
    const ticker = triggerRef["ticker"] ? String(triggerRef["ticker"]) : null;
    const payload = triggerRef["payload"] ?? {};

    return [
      `Market event triggered:`,
      `Rule: ${ruleId} — ${ruleName}`,
      `Severity: ${severity}`,
      ticker ? `Stock ticker: ${ticker}` : `Scope: system-level`,
      `Event data: ${JSON.stringify(payload, null, 0)}`,
      ``,
      ticker
        ? `IMPORTANT: This event is related to stock ${ticker}. If you choose deep_analyze, you MUST include {"tickers": ["${ticker}"]} in action_payload.`
        : ``,
      `Decide the best action for OpenAlice to take.`,
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    const source = String(triggerRef["source"] ?? "unknown");
    const direction = String(triggerRef["direction"] ?? "unknown");
    const title = String(triggerRef["title"] ?? "");
    const summary = String(triggerRef["summary"] ?? "");
    const confidence = triggerRef["confidence"] ?? "unknown";
    // Signals may carry company_ids or a ticker-like field — extract best-effort
    const ticker = triggerRef["ticker"]
      ? String(triggerRef["ticker"])
      : null;

    return [
      `Strategy/market signal received:`,
      `Source: ${source}`,
      `Direction: ${direction}`,
      title ? `Title: ${title}` : "",
      summary ? `Summary: ${summary}` : "",
      `Confidence: ${confidence}`,
      ticker ? `Stock ticker: ${ticker}` : "",
      ``,
      ticker
        ? `IMPORTANT: This signal is related to stock ${ticker}. If you choose deep_analyze, you MUST include {"tickers": ["${ticker}"]} in action_payload.`
        : `If you choose deep_analyze, include the most relevant stock tickers in action_payload.tickers as an array.`,
      `Decide the best action for OpenAlice to take.`,
    ]
      .filter(Boolean)
      .join("\n");
  }
}

// ── LLM decision call ──────────────────────────────────────────────────────────

async function callOrchestratorLlm(
  triggerType: "event" | "signal",
  triggerRef: Record<string, unknown>
): Promise<{ output: LlmDecisionOutput; costUsd: number; modelKey: string } | null> {
  const userPrompt = buildUserPrompt(triggerType, triggerRef);

  const result = await callLlm(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    {
      modelKey: ORCHESTRATOR_MODEL,
      callerModule: "openalice_orchestrator",
      taskType: "decision",
      maxTokens: ORCHESTRATOR_MAX_TOKENS,
      temperature: ORCHESTRATOR_TEMPERATURE,
      responseFormat: "json_object",
    }
  );

  if (!result) return null;

  // Parse LLM JSON output
  let parsed: unknown;
  try {
    const clean = stripCodeFences(result.content);
    parsed = JSON.parse(clean);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  // Validate action_type
  const rawActionType = String(obj["action_type"] ?? "");
  const actionType: DecisionActionType = VALID_ACTION_TYPES.has(rawActionType as DecisionActionType)
    ? (rawActionType as DecisionActionType)
    : "priority_alert";

  const actionPayload =
    obj["action_payload"] &&
    typeof obj["action_payload"] === "object" &&
    !Array.isArray(obj["action_payload"])
      ? (obj["action_payload"] as Record<string, unknown>)
      : {};

  const rawConf = Number(obj["confidence"] ?? 0);
  const confidence = Number.isFinite(rawConf) ? Math.max(0, Math.min(1, rawConf)) : 0;

  const rawPriority = Number(obj["priority"] ?? 3);
  const priority =
    Number.isFinite(rawPriority) && rawPriority >= 1 && rawPriority <= 5
      ? Math.round(rawPriority)
      : 3;

  const reasoning = typeof obj["reasoning"] === "string" ? obj["reasoning"].trim() : "";

  return {
    output: { action_type: actionType, action_payload: actionPayload, confidence, priority, reasoning },
    costUsd: result.costUsd,
    modelKey: ORCHESTRATOR_MODEL,
  };
}

// ── Safe fallback decision (when LLM fails) ───────────────────────────────────

function buildFallbackDecision(
  triggerRef: Record<string, unknown>
): LlmDecisionOutput {
  const ruleName = String(triggerRef["ruleName"] ?? triggerRef["title"] ?? "unknown trigger");
  return {
    action_type: "priority_alert",
    action_payload: {
      message: `OpenAlice decision LLM unavailable for trigger: ${ruleName}`,
      fallback: true,
    },
    confidence: 0,
    priority: 4,
    reasoning: "LLM call failed or returned unparseable output — defaulting to priority_alert as safe fallback.",
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function fetchUnprocessedEvents(): Promise<IufEventRow[]> {
  const db = getDb();
  if (!db) return [];

  try {
    const rows = await db.execute(drizzleSql`
      SELECT e.id, e.rule_id, e.rule_name, e.severity, e.ticker, e.payload, e.triggered_at
      FROM iuf_events e
      WHERE e.triggered_at > NOW() - INTERVAL '${drizzleSql.raw(String(LOOKBACK_HOURS))} hours'
        AND e.rule_id IS DISTINCT FROM ${SELF_ALERT_RULE_ID}
        AND NOT EXISTS (
          SELECT 1 FROM iuf_decisions d
          WHERE d.trigger_type = 'event'
            AND d.trigger_id = e.id::text
        )
      ORDER BY e.triggered_at DESC
      LIMIT ${drizzleSql.raw(String(MAX_EVENTS_PER_TICK))}
    `);
    return execRows<IufEventRow>(rows);
  } catch (e) {
    console.warn("[openalice-orchestrator] fetchUnprocessedEvents failed:", e instanceof Error ? e.message : String(e));
    return [];
  }
}

async function fetchUnprocessedSignals(): Promise<SignalRow[]> {
  const db = getDb();
  if (!db) return [];

  try {
    const rows = await db.execute(drizzleSql`
      SELECT s.id, s.category, s.direction, s.title, s.summary, s.confidence, s.created_at
      FROM signals s
      WHERE s.created_at > NOW() - INTERVAL '${drizzleSql.raw(String(LOOKBACK_HOURS))} hours'
        AND NOT EXISTS (
          SELECT 1 FROM iuf_decisions d
          WHERE d.trigger_type = 'signal'
            AND d.trigger_id = s.id::text
        )
      ORDER BY s.created_at DESC
      LIMIT ${drizzleSql.raw(String(MAX_SIGNALS_PER_TICK))}
    `);
    return execRows<SignalRow>(rows);
  } catch (e) {
    console.warn("[openalice-orchestrator] fetchUnprocessedSignals failed:", e instanceof Error ? e.message : String(e));
    return [];
  }
}

async function insertDecision(
  triggerType: "event" | "signal",
  triggerId: string,
  triggerRef: Record<string, unknown>,
  output: LlmDecisionOutput,
  modelKey: string,
  costUsd: number
): Promise<void> {
  const db = getDb();
  if (!db) return;

  // ON CONFLICT DO NOTHING: dedup guard — same trigger can't produce two decisions
  await db.execute(drizzleSql`
    INSERT INTO iuf_decisions
      (trigger_type, trigger_id, trigger_ref, reasoning, action_type, action_payload,
       confidence, priority, status, model_key, cost_usd)
    VALUES (
      ${triggerType},
      ${triggerId},
      ${JSON.stringify(triggerRef)}::jsonb,
      ${output.reasoning},
      ${output.action_type},
      ${JSON.stringify(output.action_payload)}::jsonb,
      ${output.confidence},
      ${output.priority},
      'proposed',
      ${modelKey},
      ${costUsd}
    )
    ON CONFLICT (trigger_type, trigger_id) DO NOTHING
  `);
}

// ── Tick function ──────────────────────────────────────────────────────────────

let _tickRunning = false;
let _lastTickAt: string | null = null;
let _lastTickDecisions = 0;
let _lastTickError: string | null = null;

export function getOrchestratorTickState() {
  return {
    tickRunning: _tickRunning,
    lastTickAt: _lastTickAt,
    lastTickDecisions: _lastTickDecisions,
    lastTickError: _lastTickError,
  };
}

/**
 * Observability read for the orchestrator state endpoint (M1 + M2 verification + M3 UI).
 * Returns decision counts by status/action_type + most recent decisions.
 * Also includes M2 action executor tick state so the state endpoint shows the full pipeline.
 * Read-only.
 */
// Inline type for M2 action executor tick state (avoids import() type reference in return type)
type ActionTickState = {
  tickRunning: boolean;
  lastTickAt: string | null;
  lastTickDone: number;
  lastTickSkipped: number;
  lastTickError: string | null;
};

// Inline type for M4 decision performance (mirrors DecisionPerformanceSummary in verifier)
type DecisionPerformanceSummary = {
  eligible: number;
  verified_1d: number;
  verified_5d: number;
  hit_rate_1d: number | null;
  hit_rate_5d: number | null;
  avg_excess_1d: number | null;
  avg_excess_5d: number | null;
  benchmark: string;
  computed_at: string;
};

export async function getOrchestratorObservability(limit = 20): Promise<{
  tick: ReturnType<typeof getOrchestratorTickState>;
  actionTick?: ActionTickState;
  decisionPerformance?: DecisionPerformanceSummary;
  totals: { total: number; byStatus: Record<string, number>; byActionType: Record<string, number> };
  recent: Array<{
    id: string;
    triggerType: string;
    actionType: string;
    confidence: number;
    priority: number;
    status: string;
    reasoning: string;
    outcome: Record<string, unknown> | null;
    createdAt: string;
  }>;
}> {
  const tick = getOrchestratorTickState();
  const empty = { total: 0, byStatus: {}, byActionType: {} };

  // Lazily fetch M2 action tick state — dynamic import avoids circular dep
  let actionTick: ActionTickState | undefined;
  try {
    const { getActionExecutorTickState } = await import("./openalice-action-executor.js");
    actionTick = getActionExecutorTickState();
  } catch {
    // M2 not loaded yet (startup race) — omit from response
  }

  // Lazily fetch M4 decision performance summary — dynamic import avoids circular dep
  let decisionPerformance: DecisionPerformanceSummary | undefined;
  try {
    const { getDecisionPerformance } = await import("./openalice-decision-verifier.js");
    decisionPerformance = await getDecisionPerformance();
  } catch {
    // Verifier not loaded or DB error — omit from response (fail-open)
  }

  if (!isDatabaseMode()) return { tick, actionTick, decisionPerformance, totals: empty, recent: [] };
  const db = getDb();
  if (!db) return { tick, actionTick, totals: empty, recent: [] };

  try {
    // NOTE: execRows() is SYNCHRONOUS and expects the *resolved* query result.
    // Must await db.execute() FIRST, then pass to execRows — passing the unresolved
    // Promise makes Array.isArray()=false → always [] (the 2026-06-25 zero-decisions bug).
    const statusRows = execRows<{ status: string; n: string | number }>(
      await db.execute(drizzleSql`SELECT status, count(*) AS n FROM iuf_decisions GROUP BY status`)
    );
    const actionRows = execRows<{ action_type: string; n: string | number }>(
      await db.execute(drizzleSql`SELECT action_type, count(*) AS n FROM iuf_decisions GROUP BY action_type`)
    );
    const recentRows = execRows<{
      id: string; trigger_type: string; action_type: string; confidence: number;
      priority: number; status: string; reasoning: string; outcome: Record<string, unknown> | null;
      created_at: string | Date;
    }>(
      await db.execute(drizzleSql`
        SELECT id, trigger_type, action_type, confidence, priority, status, reasoning, outcome, created_at
        FROM iuf_decisions ORDER BY created_at DESC LIMIT ${limit}
      `)
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of statusRows) { const n = Number(r.n) || 0; byStatus[r.status] = n; total += n; }
    const byActionType: Record<string, number> = {};
    for (const r of actionRows) byActionType[r.action_type] = Number(r.n) || 0;
    return {
      tick,
      actionTick,
      decisionPerformance,
      totals: { total, byStatus, byActionType },
      recent: recentRows.map((r) => ({
        id: r.id,
        triggerType: r.trigger_type,
        actionType: r.action_type,
        confidence: Number(r.confidence),
        priority: Number(r.priority),
        status: r.status,
        reasoning: r.reasoning,
        outcome: r.outcome ?? null,
        createdAt: typeof r.created_at === "string" ? r.created_at : new Date(r.created_at).toISOString(),
      })),
    };
  } catch (e) {
    console.warn("[openalice-orchestrator] getObservability failed:", e instanceof Error ? e.message : String(e));
    return { tick, actionTick, decisionPerformance, totals: empty, recent: [] };
  }
}

/**
 * runOpenAliceDecisionTick
 *
 * Called every 10 minutes by the scheduler registered in server.ts.
 * Fetches unprocessed events + signals → LLM reasoning → writes iuf_decisions.
 * Safe-default: never throws. All per-trigger errors are caught internally.
 */
export async function runOpenAliceDecisionTick(): Promise<void> {
  if (!isDatabaseMode()) return;
  if (_tickRunning) {
    console.log("[openalice-orchestrator] tick already running — skipping");
    return;
  }

  _tickRunning = true;
  _lastTickError = null;
  let decisionsWritten = 0;

  try {
    const [events, signals] = await Promise.all([
      fetchUnprocessedEvents(),
      fetchUnprocessedSignals(),
    ]);

    const totalTriggers = events.length + signals.length;
    if (totalTriggers === 0) {
      console.log("[openalice-orchestrator] no new triggers — tick complete");
      _lastTickAt = new Date().toISOString();
      return;
    }

    console.log(
      `[openalice-orchestrator] processing ${events.length} events + ${signals.length} signals`
    );

    // Process events
    for (const row of events) {
      if (!row.id) continue;

      const triggerRef: Record<string, unknown> = {
        type: "event",
        id: row.id,
        ruleId: row.rule_id ?? null,
        ruleName: row.rule_name ?? null,
        severity: row.severity ?? "info",
        ticker: row.ticker ?? null,
        payload: row.payload ?? {},
        triggeredAt: row.triggered_at ? String(row.triggered_at) : null,
      };

      try {
        const llmResult = await callOrchestratorLlm("event", triggerRef);
        const decision = llmResult?.output ?? buildFallbackDecision(triggerRef);
        const cost = llmResult?.costUsd ?? 0;
        const model = llmResult?.modelKey ?? "fallback";

        await insertDecision("event", String(row.id), triggerRef, decision, model, cost);
        decisionsWritten++;

        console.log(
          `[openalice-orchestrator] event ${row.rule_id} → ${decision.action_type} ` +
          `(confidence=${decision.confidence.toFixed(2)}, priority=${decision.priority})`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[openalice-orchestrator] event ${row.id} failed — skipping: ${msg}`);
        // Attempt fallback insert so this event isn't retried indefinitely
        try {
          const fallback = buildFallbackDecision(triggerRef);
          await insertDecision("event", String(row.id), triggerRef, fallback, "fallback", 0);
          decisionsWritten++;
        } catch {
          // Double failure — log and move on; dedup will prevent retry storm
        }
      }
    }

    // Process signals
    for (const row of signals) {
      if (!row.id) continue;

      const triggerRef: Record<string, unknown> = {
        type: "signal",
        id: row.id,
        source: row.category ?? null,
        direction: row.direction ?? null,
        title: row.title ?? null,
        summary: row.summary ?? null,
        confidence: row.confidence ?? null,
        createdAt: row.created_at ? String(row.created_at) : null,
      };

      try {
        const llmResult = await callOrchestratorLlm("signal", triggerRef);
        const decision = llmResult?.output ?? buildFallbackDecision(triggerRef);
        const cost = llmResult?.costUsd ?? 0;
        const model = llmResult?.modelKey ?? "fallback";

        await insertDecision("signal", String(row.id), triggerRef, decision, model, cost);
        decisionsWritten++;

        console.log(
          `[openalice-orchestrator] signal ${row.category}/${row.direction} → ${decision.action_type} ` +
          `(confidence=${decision.confidence.toFixed(2)}, priority=${decision.priority})`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[openalice-orchestrator] signal ${row.id} failed — skipping: ${msg}`);
        try {
          const fallback = buildFallbackDecision(triggerRef);
          await insertDecision("signal", String(row.id), triggerRef, fallback, "fallback", 0);
          decisionsWritten++;
        } catch {
          // Double failure — log and move on
        }
      }
    }

    _lastTickDecisions = decisionsWritten;
    _lastTickAt = new Date().toISOString();
    console.log(
      `[openalice-orchestrator] tick complete — ${decisionsWritten} decisions written from ${totalTriggers} triggers`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    _lastTickError = msg;
    console.error("[openalice-orchestrator] tick fatal error (contained):", msg);
  } finally {
    _tickRunning = false;
  }
}
