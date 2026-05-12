/**
 * openalice-event-rule-engine.ts
 *
 * Event-driven rule engine for OpenAlice — BLOCK #6 axis.
 * Upgrades OpenAlice from passive daily-brief to active event-push.
 *
 * 10 event rules (expandable stub design):
 *   1.  月營收 yoy > 50%  (revenue surge)
 *   2.  三大法人連5日同向買進  (all-3 institutional consecutive buy — foreign+trust+dealer)
 *   3.  三大法人連5日同向賣出  (all-3 institutional consecutive sell — foreign+trust+dealer)
 *   4.  籌碼集中度 HHI 突破 N 日高  (shareholding concentration breakout)
 *   5.  月營收 yoy < -30%  (revenue decline)
 *   6.  大股東持股突破 N% threshold  (major shareholder threshold)
 *   7.  重大公告事件  (new announcements after ingest tick)
 *   8.  AI brief published  (pipeline auto-published a brief)
 *   9.  Hallucination rejected  (brief rejected for hallucination)
 *   10. KGI gateway state change  (connectivity event — active post-5/12)
 *
 * Persistence: writes triggered events to `iuf_events` table.
 * DRAFT migration 0025 — not promoted until Mike audit.
 *
 * Engine: poll tick every 5 min via scheduler in server.ts.
 * Safe-default: any rule evaluation error is contained and logged; engine continues.
 */

import { randomUUID } from "node:crypto";

import { sql as drizzleSql, desc, gte, and, eq } from "drizzle-orm";
import { getDb, isDatabaseMode, auditLogs } from "@iuf-trading-room/db";

// ── Types ──────────────────────────────────────────────────────────────────────

export type EventSeverity = "info" | "warning" | "critical";

export type IufEvent = {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: EventSeverity;
  ticker: string | null;  // null for system-level events
  payload: Record<string, unknown>;
  triggeredAt: string;    // ISO 8601
  acknowledged: boolean;
};

/**
 * Lightweight state snapshot passed to each rule trigger function.
 * Engine gathers this from DB before firing rules.
 */
export type EngineStateSnapshot = {
  // FinMind dataset availability (table existence flags)
  hasMonthlyRevenue: boolean;
  hasInstitutional: boolean;
  hasShareholding: boolean;
  hasMarketValue: boolean;
  hasAnnouncements: boolean;
  // Audit log tail (last N rows for system-event rules)
  recentAuditActions: Array<{ action: string; entityId: string; createdAt: Date }>;
  // Snapshot timestamp
  snapshotAt: string;
};

export type EventRule = {
  id: string;
  name: string;
  severity: EventSeverity;
  /**
   * Trigger predicate. Receives the engine state snapshot.
   * Returns array of zero or more candidate events to write.
   * Empty array = rule did not fire.
   * Must never throw — caller wraps in try/catch.
   */
  trigger: (state: EngineStateSnapshot) => Promise<Omit<IufEvent, "id" | "triggeredAt" | "acknowledged">[]>;
};

// ── Rule definitions ───────────────────────────────────────────────────────────
// Stub design: each rule checks for DB table existence before querying.
// When tables are not migrated, rules return [] gracefully (DEGRADED, not crash).

const RULES: EventRule[] = [
  // ── Rule 1: 月營收 yoy > 50% ──────────────────────────────────────────────
  {
    id: "R01_REVENUE_SURGE_YOY50",
    name: "月營收 yoy > 50%",
    severity: "warning",
    trigger: async (state) => {
      if (!state.hasMonthlyRevenue) return [];
      const db = getDb();
      if (!db) return [];

      try {
        // Find companies where revenue growth yoy exceeds 50%
        // tw_monthly_revenue has columns: ticker_symbol, revenue, revenue_growth (as percentage)
        const rows = await db.execute(
          drizzleSql`
            SELECT ticker_symbol, revenue_growth
            FROM tw_monthly_revenue
            WHERE revenue_growth > 50
              AND date >= CURRENT_DATE - INTERVAL '35 days'
            ORDER BY revenue_growth DESC
            LIMIT 10
          `
        ) as { rows?: Array<{ ticker_symbol?: string; revenue_growth?: number }> };

        const matches = (rows.rows ?? []).filter(
          (r) => r.ticker_symbol && typeof r.revenue_growth === "number"
        );

        return matches.map((r) => ({
          ruleId: "R01_REVENUE_SURGE_YOY50",
          ruleName: "月營收 yoy > 50%",
          severity: "warning" as EventSeverity,
          ticker: r.ticker_symbol ?? null,
          payload: { revenueGrowth: r.revenue_growth }
        }));
      } catch {
        return [];
      }
    }
  },

  // ── Rule 2: 三大法人連5日同向買進 ────────────────────────────────────────────
  // tw_institutional_buysell is a long-table: each row is (stock_id, date, name, buy, sell)
  // where name ∈ {'外資及陸資', '投信', '自營商'}. We use conditional aggregation to
  // verify that ALL THREE institutions net-bought (buy > sell) for ≥ 5 of the last 7 days.
  {
    id: "R02_INSTITUTIONAL_CONSECUTIVE_BUY_5D",
    name: "三大法人連5日同向買進",
    severity: "info",
    trigger: async (state) => {
      if (!state.hasInstitutional) return [];
      const db = getDb();
      if (!db) return [];

      try {
        // Per-day net: positive = net buy. Require all 3 institutions net-buy on ≥ 5 days.
        const rows = await db.execute(
          drizzleSql`
            WITH daily_net AS (
              SELECT stock_id,
                     date,
                     SUM(CASE WHEN name LIKE '%外%' OR name LIKE '%陸%' THEN (buy - sell) ELSE 0 END) AS foreign_net,
                     SUM(CASE WHEN name = '投信'      THEN (buy - sell) ELSE 0 END) AS trust_net,
                     SUM(CASE WHEN name LIKE '%自營%'  THEN (buy - sell) ELSE 0 END) AS dealer_net
              FROM tw_institutional_buysell
              WHERE date >= TO_CHAR(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')
              GROUP BY stock_id, date
            )
            SELECT stock_id AS ticker_symbol,
                   COUNT(*) FILTER (WHERE foreign_net > 0 AND trust_net > 0 AND dealer_net > 0) AS all_buy_days
            FROM daily_net
            GROUP BY stock_id
            HAVING COUNT(*) FILTER (WHERE foreign_net > 0 AND trust_net > 0 AND dealer_net > 0) >= 5
            LIMIT 20
          `
        ) as { rows?: Array<{ ticker_symbol?: string; all_buy_days?: number }> };

        return (rows.rows ?? [])
          .filter((r) => r.ticker_symbol)
          .map((r) => ({
            ruleId: "R02_INSTITUTIONAL_CONSECUTIVE_BUY_5D",
            ruleName: "三大法人連5日同向買進",
            severity: "info" as EventSeverity,
            ticker: r.ticker_symbol ?? null,
            payload: { allBuyDays: r.all_buy_days }
          }));
      } catch {
        return [];
      }
    }
  },

  // ── Rule 3: 三大法人連5日同向賣出 ────────────────────────────────────────────
  {
    id: "R03_INSTITUTIONAL_CONSECUTIVE_SELL_5D",
    name: "三大法人連5日同向賣出",
    severity: "warning",
    trigger: async (state) => {
      if (!state.hasInstitutional) return [];
      const db = getDb();
      if (!db) return [];

      try {
        const rows = await db.execute(
          drizzleSql`
            WITH daily_net AS (
              SELECT stock_id,
                     date,
                     SUM(CASE WHEN name LIKE '%外%' OR name LIKE '%陸%' THEN (buy - sell) ELSE 0 END) AS foreign_net,
                     SUM(CASE WHEN name = '投信'      THEN (buy - sell) ELSE 0 END) AS trust_net,
                     SUM(CASE WHEN name LIKE '%自營%'  THEN (buy - sell) ELSE 0 END) AS dealer_net
              FROM tw_institutional_buysell
              WHERE date >= TO_CHAR(CURRENT_DATE - INTERVAL '7 days', 'YYYY-MM-DD')
              GROUP BY stock_id, date
            )
            SELECT stock_id AS ticker_symbol,
                   COUNT(*) FILTER (WHERE foreign_net < 0 AND trust_net < 0 AND dealer_net < 0) AS all_sell_days
            FROM daily_net
            GROUP BY stock_id
            HAVING COUNT(*) FILTER (WHERE foreign_net < 0 AND trust_net < 0 AND dealer_net < 0) >= 5
            LIMIT 20
          `
        ) as { rows?: Array<{ ticker_symbol?: string; all_sell_days?: number }> };

        return (rows.rows ?? [])
          .filter((r) => r.ticker_symbol)
          .map((r) => ({
            ruleId: "R03_INSTITUTIONAL_CONSECUTIVE_SELL_5D",
            ruleName: "三大法人連5日同向賣出",
            severity: "warning" as EventSeverity,
            ticker: r.ticker_symbol ?? null,
            payload: { allSellDays: r.all_sell_days }
          }));
      } catch {
        return [];
      }
    }
  },

  // ── Rule 4: 籌碼集中度 HHI 突破 N 日高 ───────────────────────────────────
  {
    id: "R04_SHAREHOLDING_HHI_BREAKOUT",
    name: "籌碼集中度突破近期高點",
    severity: "info",
    trigger: async (state) => {
      if (!state.hasShareholding) return [];
      const db = getDb();
      if (!db) return [];

      // HHI approximation: use foreign_ownership_ratio as concentration proxy
      // Real HHI requires per-holder data; this is a stub using available field
      try {
        const rows = await db.execute(
          drizzleSql`
            WITH recent AS (
              SELECT ticker_symbol,
                     foreign_ownership_ratio AS ratio,
                     date,
                     MAX(foreign_ownership_ratio) OVER (
                       PARTITION BY ticker_symbol
                       ORDER BY date
                       ROWS BETWEEN 20 PRECEDING AND 1 PRECEDING
                     ) AS prev_20d_max
              FROM tw_shareholding
              WHERE date >= CURRENT_DATE - INTERVAL '25 days'
            )
            SELECT ticker_symbol, ratio, prev_20d_max
            FROM recent
            WHERE date = (SELECT MAX(date) FROM tw_shareholding)
              AND ratio > prev_20d_max
            ORDER BY (ratio - prev_20d_max) DESC
            LIMIT 10
          `
        ) as { rows?: Array<{ ticker_symbol?: string; ratio?: number; prev_20d_max?: number }> };

        return (rows.rows ?? [])
          .filter((r) => r.ticker_symbol)
          .map((r) => ({
            ruleId: "R04_SHAREHOLDING_HHI_BREAKOUT",
            ruleName: "籌碼集中度突破近期高點",
            severity: "info" as EventSeverity,
            ticker: r.ticker_symbol ?? null,
            payload: { concentrationRatio: r.ratio, prev20dMax: r.prev_20d_max }
          }));
      } catch {
        return [];
      }
    }
  },

  // ── Rule 5: 月營收 yoy < -30% ─────────────────────────────────────────────
  {
    id: "R05_REVENUE_DECLINE_YOY30",
    name: "月營收 yoy < -30%",
    severity: "critical",
    trigger: async (state) => {
      if (!state.hasMonthlyRevenue) return [];
      const db = getDb();
      if (!db) return [];

      try {
        const rows = await db.execute(
          drizzleSql`
            SELECT ticker_symbol, revenue_growth
            FROM tw_monthly_revenue
            WHERE revenue_growth < -30
              AND date >= CURRENT_DATE - INTERVAL '35 days'
            ORDER BY revenue_growth ASC
            LIMIT 10
          `
        ) as { rows?: Array<{ ticker_symbol?: string; revenue_growth?: number }> };

        return (rows.rows ?? [])
          .filter((r) => r.ticker_symbol)
          .map((r) => ({
            ruleId: "R05_REVENUE_DECLINE_YOY30",
            ruleName: "月營收 yoy < -30%",
            severity: "critical" as EventSeverity,
            ticker: r.ticker_symbol ?? null,
            payload: { revenueGrowth: r.revenue_growth }
          }));
      } catch {
        return [];
      }
    }
  },

  // ── Rule 6: 大股東持股突破 N% threshold ───────────────────────────────────
  {
    id: "R06_MAJOR_SHAREHOLDER_THRESHOLD",
    name: "大股東持股突破 40% 門檻",
    severity: "info",
    trigger: async (state) => {
      if (!state.hasShareholding) return [];
      const db = getDb();
      if (!db) return [];

      // Threshold: foreign_ownership_ratio crosses 40% from below
      try {
        const rows = await db.execute(
          drizzleSql`
            WITH ordered AS (
              SELECT ticker_symbol, date, foreign_ownership_ratio AS ratio,
                     LAG(foreign_ownership_ratio) OVER (
                       PARTITION BY ticker_symbol ORDER BY date
                     ) AS prev_ratio
              FROM tw_shareholding
              WHERE date >= CURRENT_DATE - INTERVAL '10 days'
            )
            SELECT ticker_symbol, ratio, prev_ratio
            FROM ordered
            WHERE date = (SELECT MAX(date) FROM tw_shareholding)
              AND ratio >= 40
              AND (prev_ratio IS NULL OR prev_ratio < 40)
            LIMIT 10
          `
        ) as { rows?: Array<{ ticker_symbol?: string; ratio?: number; prev_ratio?: number }> };

        return (rows.rows ?? [])
          .filter((r) => r.ticker_symbol)
          .map((r) => ({
            ruleId: "R06_MAJOR_SHAREHOLDER_THRESHOLD",
            ruleName: "大股東持股突破 40% 門檻",
            severity: "info" as EventSeverity,
            ticker: r.ticker_symbol ?? null,
            payload: { ownershipRatio: r.ratio, prevRatio: r.prev_ratio }
          }));
      } catch {
        return [];
      }
    }
  },

  // ── Rule 7: 重大公告事件 ──────────────────────────────────────────────────
  {
    id: "R07_MAJOR_ANNOUNCEMENT",
    name: "重大公告事件",
    severity: "warning",
    trigger: async (state) => {
      if (!state.hasAnnouncements) return [];
      const db = getDb();
      if (!db) return [];

      // New announcements in last 30 minutes (ingest tick cadence)
      try {
        const rows = await db.execute(
          drizzleSql`
            SELECT ticker_symbol, title, announced_at
            FROM tw_announcements
            WHERE announced_at >= NOW() - INTERVAL '30 minutes'
            ORDER BY announced_at DESC
            LIMIT 20
          `
        ) as { rows?: Array<{ ticker_symbol?: string; title?: string; announced_at?: string }> };

        return (rows.rows ?? [])
          .filter((r) => r.ticker_symbol)
          .map((r) => ({
            ruleId: "R07_MAJOR_ANNOUNCEMENT",
            ruleName: "重大公告事件",
            severity: "warning" as EventSeverity,
            ticker: r.ticker_symbol ?? null,
            payload: { title: r.title, announcedAt: r.announced_at }
          }));
      } catch {
        return [];
      }
    }
  },

  // ── Rule 8: AI brief published ────────────────────────────────────────────
  {
    id: "R08_AI_BRIEF_PUBLISHED",
    name: "AI brief published",
    severity: "info",
    trigger: async (state) => {
      // Detect "content_draft.ai_approved" in recent audit log tail
      const publishEvents = state.recentAuditActions.filter(
        (a) => a.action === "content_draft.ai_approved"
      );
      return publishEvents.map((e) => ({
        ruleId: "R08_AI_BRIEF_PUBLISHED",
        ruleName: "AI brief published",
        severity: "info" as EventSeverity,
        ticker: null,
        payload: { draftId: e.entityId, publishedAt: e.createdAt.toISOString() }
      }));
    }
  },

  // ── Rule 9: Hallucination rejected ───────────────────────────────────────
  {
    id: "R09_HALLUCINATION_REJECTED",
    name: "Hallucination rejected",
    severity: "warning",
    trigger: async (state) => {
      const rejectEvents = state.recentAuditActions.filter(
        (a) => a.action === "hallucination_reject"
      );
      return rejectEvents.map((e) => ({
        ruleId: "R09_HALLUCINATION_REJECTED",
        ruleName: "Hallucination rejected",
        severity: "warning" as EventSeverity,
        ticker: null,
        payload: { draftId: e.entityId, rejectedAt: e.createdAt.toISOString() }
      }));
    }
  },

  // ── Rule 10: KGI gateway state change (active post-5/12) ─────────────────
  {
    id: "R10_KGI_GATEWAY_STATE_CHANGE",
    name: "KGI gateway state change",
    severity: "critical",
    trigger: async (state) => {
      // Detect KGI gateway connect/disconnect events in audit log
      // Active after 5/12 (KGI live trading enablement date)
      const kgiEvents = state.recentAuditActions.filter(
        (a) =>
          a.action === "kgi_gateway.connected" ||
          a.action === "kgi_gateway.disconnected" ||
          a.action === "kgi_gateway.auth_failed"
      );
      return kgiEvents.map((e) => ({
        ruleId: "R10_KGI_GATEWAY_STATE_CHANGE",
        ruleName: "KGI gateway state change",
        severity: "critical" as EventSeverity,
        ticker: null,
        payload: { auditAction: e.action, entityId: e.entityId, at: e.createdAt.toISOString() }
      }));
    }
  }
];

// ── Table existence helpers ────────────────────────────────────────────────────

async function tableExists(tableName: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    await db.execute(drizzleSql`SELECT 1 FROM ${drizzleSql.identifier(tableName)} LIMIT 0`);
    return true;
  } catch {
    return false;
  }
}

// ── Engine state snapshot collector ───────────────────────────────────────────

async function collectEngineState(): Promise<EngineStateSnapshot> {
  const [
    hasMonthlyRevenue,
    hasInstitutional,
    hasShareholding,
    hasMarketValue,
    hasAnnouncements
  ] = await Promise.all([
    tableExists("tw_monthly_revenue"),
    tableExists("tw_institutional_buysell"),
    tableExists("tw_shareholding"),
    tableExists("tw_market_value"),
    tableExists("tw_announcements")
  ]);

  // Load last 100 audit log rows for system-event rules (R08, R09, R10)
  let recentAuditActions: EngineStateSnapshot["recentAuditActions"] = [];
  if (isDatabaseMode()) {
    const db = getDb();
    if (db) {
      try {
        const rows = await db
          .select({
            action: auditLogs.action,
            entityId: auditLogs.entityId,
            createdAt: auditLogs.createdAt
          })
          .from(auditLogs)
          .where(
            gte(auditLogs.createdAt, new Date(Date.now() - 6 * 60 * 1000)) // last 6 min (covers 5-min poll)
          )
          .orderBy(desc(auditLogs.createdAt))
          .limit(100);
        recentAuditActions = rows;
      } catch {
        // Non-critical
      }
    }
  }

  return {
    hasMonthlyRevenue,
    hasInstitutional,
    hasShareholding,
    hasMarketValue,
    hasAnnouncements,
    recentAuditActions,
    snapshotAt: new Date().toISOString()
  };
}

// ── Deduplication: skip re-firing same rule+ticker within 1 hour ──────────────

async function isDuplicateEvent(ruleId: string, ticker: string | null): Promise<boolean> {
  if (!isDatabaseMode()) return false;
  const db = getDb();
  if (!db) return false;

  try {
    const rows = await db.execute(
      drizzleSql`
        SELECT 1 FROM iuf_events
        WHERE rule_id = ${ruleId}
          AND (
            ${ticker === null ? drizzleSql`ticker IS NULL` : drizzleSql`ticker = ${ticker}`}
          )
          AND triggered_at >= NOW() - INTERVAL '1 hour'
        LIMIT 1
      `
    ) as { rows?: unknown[] };
    return (rows.rows?.length ?? 0) > 0;
  } catch {
    // Table not migrated yet → no dedup check
    return false;
  }
}

// ── Event writer ───────────────────────────────────────────────────────────────

async function writeEvent(event: Omit<IufEvent, "id" | "triggeredAt" | "acknowledged">): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;

  const id = randomUUID();
  const triggeredAt = new Date().toISOString();

  try {
    await db.execute(
      drizzleSql`
        INSERT INTO iuf_events
          (id, rule_id, rule_name, severity, ticker, payload, triggered_at, acknowledged)
        VALUES
          (${id}, ${event.ruleId}, ${event.ruleName}, ${event.severity},
           ${event.ticker}, ${JSON.stringify(event.payload)}::jsonb, ${triggeredAt}, false)
      `
    );
    console.info(
      `[event-engine] Event written: rule=${event.ruleId} ticker=${event.ticker ?? "system"} severity=${event.severity}`
    );
  } catch (e) {
    // Table not migrated (DRAFT) — log and continue
    console.warn(
      `[event-engine] Failed to write event (table not migrated?): ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

// ── Engine in-memory state ─────────────────────────────────────────────────────

export type EventEngineState = {
  lastTickAt: string | null;
  lastTickEvents: number;
  totalEventsThisProcess: number;
  lastError: string | null;
};

let _engineState: EventEngineState = {
  lastTickAt: null,
  lastTickEvents: 0,
  totalEventsThisProcess: 0,
  lastError: null
};

export function getEventEngineState(): EventEngineState {
  return { ..._engineState };
}

// ── Main tick ──────────────────────────────────────────────────────────────────

/**
 * Run one engine tick: evaluate all 10 rules, write triggered events to DB.
 * Called every 5 minutes from server.ts scheduler.
 * Never throws — all errors are contained.
 */
export async function runEventEngineTick(): Promise<void> {
  if (!isDatabaseMode()) {
    return;
  }

  const tickStart = Date.now();
  let eventsWritten = 0;

  try {
    const state = await collectEngineState();

    for (const rule of RULES) {
      let candidates: Omit<IufEvent, "id" | "triggeredAt" | "acknowledged">[] = [];

      try {
        candidates = await rule.trigger(state);
      } catch (e) {
        console.warn(
          `[event-engine] Rule ${rule.id} trigger error: ${e instanceof Error ? e.message : String(e)}`
        );
        continue;
      }

      for (const candidate of candidates) {
        try {
          const isDup = await isDuplicateEvent(candidate.ruleId, candidate.ticker);
          if (isDup) continue;
          await writeEvent(candidate);
          eventsWritten++;
        } catch (e) {
          console.warn(
            `[event-engine] Failed to process candidate event from rule ${rule.id}: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    }

    _engineState = {
      lastTickAt: new Date().toISOString(),
      lastTickEvents: eventsWritten,
      totalEventsThisProcess: _engineState.totalEventsThisProcess + eventsWritten,
      lastError: null
    };

    const elapsed = Date.now() - tickStart;
    console.info(`[event-engine] Tick complete: events=${eventsWritten} elapsed=${elapsed}ms`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    _engineState = { ..._engineState, lastError: msg };
    console.error(`[event-engine] Tick error: ${msg}`);
  }
}

/**
 * Force-dispatch tick: evaluate all rules, write ALL triggered events (bypasses 1h dedup).
 * Writes audit_logs entries with action="alerts.dispatch" (dispatch start) and
 * "alert.fire" (per event fired). Used by POST /api/v1/internal/alerts/force-dispatch.
 *
 * 5/12 FIX: Normal tick's 1h dedup prevented testing / manual recovery when engine
 * had 0 events due to missing iuf_events table or no qualifying data in trading windows.
 * Force-dispatch lets Bruce verify the engine can write events to iuf_events.
 */
export async function runEventEngineTickForce(): Promise<{
  eventsWritten: number;
  rulesEvaluated: number;
  errors: string[];
}> {
  const result = { eventsWritten: 0, rulesEvaluated: 0, errors: [] as string[] };

  if (!isDatabaseMode()) {
    result.errors.push("memory_mode");
    return result;
  }
  const db = getDb();
  if (!db) {
    result.errors.push("db_unavailable");
    return result;
  }

  const tickStart = Date.now();

  // Write dispatch-start audit log via raw SQL (workspace_id nullable workaround)
  try {
    await db.execute(
      drizzleSql`
        INSERT INTO audit_logs (id, workspace_id, actor_id, action, entity_type, entity_id, payload, created_at)
        SELECT gen_random_uuid(), w.id, NULL, 'alerts.dispatch', 'event_engine',
               ${'force-' + new Date().toISOString()}, ${JSON.stringify({ trigger: "force_dispatch", rulesCount: RULES.length })}::jsonb, NOW()
        FROM workspaces w
        LIMIT 1
      `
    );
  } catch {
    // Non-critical — continue
  }

  try {
    const state = await collectEngineState();

    for (const rule of RULES) {
      result.rulesEvaluated++;
      let candidates: Omit<IufEvent, "id" | "triggeredAt" | "acknowledged">[] = [];

      try {
        candidates = await rule.trigger(state);
      } catch (e) {
        const msg = `rule ${rule.id}: ${e instanceof Error ? e.message : String(e)}`;
        result.errors.push(msg);
        console.warn(`[event-engine/force] Rule ${rule.id} trigger error: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      for (const candidate of candidates) {
        try {
          // Force-dispatch: SKIP dedup check, always write
          await writeEvent(candidate);
          result.eventsWritten++;

          // Write per-event audit log via raw SQL (workspace_id via subquery)
          try {
            await db.execute(
              drizzleSql`
                INSERT INTO audit_logs (id, workspace_id, actor_id, action, entity_type, entity_id, payload, created_at)
                SELECT gen_random_uuid(), w.id, NULL, 'alert.fire', 'iuf_event', ${candidate.ruleId},
                       ${JSON.stringify({ ruleId: candidate.ruleId, ticker: candidate.ticker, severity: candidate.severity, forced: true })}::jsonb, NOW()
                FROM workspaces w
                LIMIT 1
              `
            );
          } catch {
            // Non-critical — event was written, audit is best-effort
          }
        } catch (e) {
          const msg = `write ${candidate.ruleId}: ${e instanceof Error ? e.message : String(e)}`;
          result.errors.push(msg);
        }
      }
    }

    _engineState = {
      lastTickAt: new Date().toISOString(),
      lastTickEvents: result.eventsWritten,
      totalEventsThisProcess: _engineState.totalEventsThisProcess + result.eventsWritten,
      lastError: null
    };

    const elapsed = Date.now() - tickStart;
    console.info(`[event-engine/force] Force-dispatch complete: events=${result.eventsWritten} elapsed=${elapsed}ms`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    _engineState = { ..._engineState, lastError: msg };
    result.errors.push(`tick_error:${msg}`);
    console.error(`[event-engine/force] Force-dispatch error: ${msg}`);
  }

  return result;
}

// ── List/ack helpers (used by notification endpoints) ─────────────────────────

export async function listEvents(opts: {
  limit?: number;
  unreadOnly?: boolean;
}): Promise<IufEvent[]> {
  if (!isDatabaseMode()) return [];
  const db = getDb();
  if (!db) return [];

  const limit = Math.min(opts.limit ?? 50, 200);

  try {
    const rows = await db.execute(
      opts.unreadOnly
        ? drizzleSql`
            SELECT id, rule_id, rule_name, severity, ticker, payload, triggered_at, acknowledged
            FROM iuf_events
            WHERE acknowledged = false
            ORDER BY triggered_at DESC
            LIMIT ${limit}
          `
        : drizzleSql`
            SELECT id, rule_id, rule_name, severity, ticker, payload, triggered_at, acknowledged
            FROM iuf_events
            ORDER BY triggered_at DESC
            LIMIT ${limit}
          `
    ) as {
      rows?: Array<{
        id?: string;
        rule_id?: string;
        rule_name?: string;
        severity?: string;
        ticker?: string | null;
        payload?: unknown;
        triggered_at?: string;
        acknowledged?: boolean;
      }>;
    };

    return (rows.rows ?? [])
      .filter((r) => r.id && r.rule_id)
      .map((r) => ({
        id: r.id!,
        ruleId: r.rule_id!,
        ruleName: r.rule_name ?? r.rule_id!,
        severity: (r.severity ?? "info") as EventSeverity,
        ticker: r.ticker ?? null,
        payload: (typeof r.payload === "object" && r.payload !== null)
          ? (r.payload as Record<string, unknown>)
          : {},
        triggeredAt: r.triggered_at ?? new Date().toISOString(),
        acknowledged: r.acknowledged ?? false
      }));
  } catch {
    return [];
  }
}

export async function acknowledgeEvent(eventId: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isDatabaseMode()) return { ok: false, reason: "memory_mode" };
  const db = getDb();
  if (!db) return { ok: false, reason: "db_unavailable" };

  try {
    await db.execute(
      drizzleSql`
        UPDATE iuf_events SET acknowledged = true WHERE id = ${eventId}
      `
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
