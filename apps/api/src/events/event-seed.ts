/**
 * event-seed.ts — EventLog real event seed (Job #3).
 *
 * Called once at server boot (after DB is available).
 * Seeds real operational events from existing tables so that
 * GET /api/v1/event-streams always returns at least 1 stream.
 *
 * Seeds:
 *   1. system.startup  → stream type="system" id="server"
 *   2. Recent audit_logs rows → stream type="system" id="audit" (up to 5)
 *   3. Recent paper_orders rows → stream type="order" id="{symbol}" (up to 5 distinct symbols)
 *
 * Design constraints:
 *   - Fully fail-open: any error is logged, never thrown.
 *   - Idempotent: appendEvent uses ON CONFLICT DO UPDATE so re-seeds are harmless
 *     (the UNIQUE constraint on (stream_id, seq) prevents duplicate seq; each boot
 *     writes a fresh startup event with a new seq — acceptable for observability).
 *   - Only runs in DB mode (isDatabaseMode() === true).
 */

import { appendEvent } from "./event-log-store.js";
import { isDatabaseMode, getDb, auditLogs, paperOrders } from "@iuf-trading-room/db";
import { desc } from "drizzle-orm";

// ── types ─────────────────────────────────────────────────────────────────────

type SeedResult = {
  startupEventId: string | null;
  auditEventsSeeded: number;
  orderEventsSeeded: number;
  errors: string[];
};

// ── main ──────────────────────────────────────────────────────────────────────

/**
 * Seed real events into el_event_streams / el_events.
 * workspaceId must be the canonical workspace UUID from the DB.
 */
export async function seedEventLog(workspaceId: string): Promise<SeedResult> {
  const result: SeedResult = {
    startupEventId: null,
    auditEventsSeeded: 0,
    orderEventsSeeded: 0,
    errors: [],
  };

  if (!isDatabaseMode()) {
    result.errors.push("DB not available — skipping event seed");
    return result;
  }

  const db = getDb();
  if (!db) {
    result.errors.push("getDb() returned null — skipping event seed");
    return result;
  }

  // 1. system.startup event ──────────────────────────────────────────────────
  try {
    const startupResult = await appendEvent({
      workspaceId,
      streamType: "system",
      streamId: "server",
      eventType: "system.startup",
      payload: {
        version: process.env.npm_package_version ?? "unknown",
        nodeEnv: process.env.NODE_ENV ?? "production",
        seededAt: new Date().toISOString(),
      },
      actorId: null,
    });
    result.startupEventId = startupResult.id;
  } catch (e) {
    result.errors.push(`startup event failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Recent audit_logs → system::audit stream ──────────────────────────────
  try {
    const recentAudit = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        payload: auditLogs.payload,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(5);

    for (const row of recentAudit) {
      try {
        await appendEvent({
          workspaceId,
          streamType: "system",
          streamId: "audit",
          eventType: `audit.${row.action}`,
          payload: {
            auditLogId: row.id,
            action: row.action,
            entityType: row.entityType,
            entityId: row.entityId,
            detail: row.payload,
          },
          occurredAt: row.createdAt,
          actorId: null,
        });
        result.auditEventsSeeded++;
      } catch (e) {
        result.errors.push(`audit event ${row.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    result.errors.push(`audit query failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Recent paper_orders → order::{symbol} stream ─────────────────────────
  try {
    const recentOrders = await db
      .select({
        id: paperOrders.id,
        symbol: paperOrders.symbol,
        side: paperOrders.side,
        orderType: paperOrders.orderType,
        qty: paperOrders.qty,
        status: paperOrders.status,
        createdAt: paperOrders.createdAt,
      })
      .from(paperOrders)
      .orderBy(desc(paperOrders.createdAt))
      .limit(5);

    for (const row of recentOrders) {
      try {
        await appendEvent({
          workspaceId,
          streamType: "order",
          streamId: row.symbol,
          eventType: "order.created",
          payload: {
            orderId: row.id,
            symbol: row.symbol,
            side: row.side,
            orderType: row.orderType,
            qty: row.qty,
            status: row.status,
          },
          occurredAt: row.createdAt,
          actorId: null,
        });
        result.orderEventsSeeded++;
      } catch (e) {
        result.errors.push(`order event ${row.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    result.errors.push(`paper_orders query failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log(
    `[event-seed] startup=${result.startupEventId ? "ok" : "fail"} audit=${result.auditEventsSeeded} orders=${result.orderEventsSeeded} errors=${result.errors.length}`
  );
  return result;
}
