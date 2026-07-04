/**
 * paper-order-sync.ts — paper channel 委託回報回讀 (2026-07-05)
 *
 * Self-reported gap at UTA-C2 delivery: the paper channel's unified_orders
 * dual-write (trading-service.ts D3, locked file) always calls
 * markUnifiedOrderSubmitted() once placePaperOrder() returns *without
 * throwing* — even when the returned paper Order already reached a terminal
 * state (filled immediately on a market order against a usable quote,
 * rejected for a stale/unsafe/missing quote) or is merely resting
 * (acknowledged limit). markUnifiedOrderSubmitted() hardcodes
 * status: "submitted", so the unified_orders row is left stuck at
 * "submitted" forever unless something reads the real paper_orders state
 * back and reconciles it. This is that reconciliation sweep — mirrors the
 * kgi-order-reconciliation.ts UTA-C2 sweep's shape/half-order protocol, but
 * reads back from the in-process/DB-backed paper broker store instead of an
 * external gateway.
 *
 * Cancellation already has its own direct path
 * (trading-cancel-service.ts UTA-C1, writes cancelled synchronously) — this
 * sweep does not duplicate that; it only picks up rows still resting at
 * submitted/partial_fill whose underlying paper Order has since moved on
 * (including via a cancel path that didn't go through UTA-C1).
 *
 * "Stuck pending" rows (unified_orders insert succeeded, but the
 * post-submit DB update itself failed — the half-order case) have no
 * externalOrderId to match a paper Order against and are only flagged,
 * never auto-resubmitted, per D3's half-order protocol.
 *
 * Design: reports/epic_trading_desk_20260702/S1_UNIFIED_ORDER_FLOW_DESIGN_v1.md D3
 *         apps/api/src/broker/kgi-order-reconciliation.ts (UTA-C2, sibling sweep)
 */

import type { AppSession } from "@iuf-trading-room/contracts";

// paper-broker.js is imported statically here — both trading-service.ts (the
// dual-write producer) and this test suite's call sites import it statically
// too. Mixing static + dynamic import of the same module has been observed to
// produce two separate module instances (and therefore two separate
// in-memory workspace maps) under this environment's tsx/Node ESM loader
// (see trading-cancel-service.ts's header comment for the same lesson
// applied to unified-order-store.js). Keep the import style consistent with
// paper-broker.ts's other call sites.
import { listPaperOrders } from "./paper-broker.js";

export type PaperUnifiedOrderSyncSummary = {
  checked: number;
  updated: number;
  stuckPending: Array<{ id: string; symbol: string; ageMs: number }>;
};

const DEFAULT_STUCK_PENDING_MS = 3 * 60 * 1000; // 3 minutes — same default as the kgi UTA-C2 sweep

function stuckPendingThresholdMs(): number {
  const raw = Number(process.env["UTA_C2_STUCK_PENDING_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STUCK_PENDING_MS;
}

/** Maps a paper Order's lifecycle status to the unified_orders status enum. null = still resting, no change. */
function mapPaperOrderStatusToUnified(
  status: string
): "filled" | "partial_fill" | "cancelled" | "rejected" | null {
  switch (status) {
    case "filled":
      return "filled";
    case "partial":
      return "partial_fill";
    case "canceled":
      return "cancelled";
    case "rejected":
      return "rejected";
    case "pending":
    case "submitted":
    case "acknowledged":
    case "expired":
    default:
      return null;
  }
}

/**
 * syncPaperUnifiedOrders — reads back the workspace's live paper_orders state
 * and reconciles it onto any unified_orders rows on the paper adapter still
 * resting at submitted/partial_fill.
 *
 * Takes a full AppSession (not just a workspaceId, unlike the kgi sweep)
 * because the paper broker's in-memory account map is keyed by
 * session.workspace.slug, not id — listPaperOrders needs both.
 */
export async function syncPaperUnifiedOrders(params: {
  session: AppSession;
}): Promise<PaperUnifiedOrderSyncSummary> {
  const summary: PaperUnifiedOrderSyncSummary = { checked: 0, updated: 0, stuckPending: [] };
  const workspaceId = params.session.workspace.id;

  const { listUnifiedOrders, updateUnifiedOrderFill } = await import("./unified-order-store.js");
  const rows = await listUnifiedOrders(workspaceId, 200);
  const paperRows = rows.filter((r) => r.adapterKey === "paper");

  // Stuck-pending scan — log only, never auto-resubmit (D3 半單協議).
  const stuckThreshold = stuckPendingThresholdMs();
  const now = Date.now();
  for (const row of paperRows) {
    if (row.status !== "pending") continue;
    const ageMs = now - new Date(row.createdAt).getTime();
    if (ageMs >= stuckThreshold) {
      summary.stuckPending.push({ id: row.id, symbol: row.symbol, ageMs });
    }
  }
  if (summary.stuckPending.length > 0) {
    console.warn(
      `[paper-order-sync] ${summary.stuckPending.length} paper unified_orders row(s) stuck pending >= ${stuckThreshold}ms:`,
      summary.stuckPending.map((s) => `${s.id}(${s.symbol})`).join(", ")
    );
  }

  const syncable = paperRows.filter(
    (r) => (r.status === "submitted" || r.status === "partial_fill") && r.externalOrderId
  );
  if (syncable.length === 0) return summary;

  const paperOrders = await listPaperOrders(params.session);
  const byBrokerOrderId = new Map(paperOrders.map((o) => [o.brokerOrderId, o]));

  for (const row of syncable) {
    summary.checked += 1;
    const paperOrder = row.externalOrderId ? byBrokerOrderId.get(row.externalOrderId) : undefined;
    if (!paperOrder) continue;

    const nextStatus = mapPaperOrderStatusToUnified(paperOrder.status);
    if (!nextStatus || nextStatus === row.status) continue;

    const nowIso = new Date().toISOString();
    await updateUnifiedOrderFill(row.id, {
      status: nextStatus,
      filledQty: paperOrder.filledQuantity,
      filledPrice: paperOrder.avgFillPrice,
      filledAt: nextStatus === "filled" ? paperOrder.filledAt ?? nowIso : null,
      cancelledAt: nextStatus === "cancelled" ? paperOrder.canceledAt ?? nowIso : null
    });
    summary.updated += 1;
  }

  return summary;
}
