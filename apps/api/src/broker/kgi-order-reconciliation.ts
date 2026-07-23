import { fromKgiOrderQty } from "./kgi-contract-rules.js";

export type KgiOrderLifecycleStatus =
  | "accepted"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "rejected"
  | "unconfirmed";

export type SubmittedKgiOrder = {
  tradeId?: string | null;
  symbol: string;
  side: "buy" | "sell";
  /** ALWAYS in SHARES (never lots), regardless of wireQtyUnit below. */
  requestedQty: number;
  submittedAt?: string | null;
  /**
   * Unit of the QUANTITY FIELDS INSIDE MATCHED BROKER EVIDENCE (deal/order-
   * event/trade-report rows) for this order — NOT the unit of requestedQty
   * above, which is always shares. Board-lot orders echo quantity back in
   * 張 (lots) in every broker report (NewOrder ack, Deal, /trades query);
   * odd-lot orders echo shares. Defaults to "shares" (no conversion) to
   * preserve exact prior behavior for any caller that doesn't set this —
   * only callers that KNOW their order was placed as a board-lot order
   * (S1/V34/V51's own audit-derived orders) should pass "lots". See
   * kgi-contract-rules.ts::fromKgiOrderQty() doc (2026-07-23 Round 2 fix,
   * Pete review PR #1345) for the full symmetric-bug rationale.
   */
  wireQtyUnit?: "lots" | "shares";
};

export type ReconciledKgiOrder = {
  tradeId: string | null;
  symbol: string;
  side: "buy" | "sell";
  requestedQty: number;
  filledQty: number;
  remainingQty: number;
  avgFillPrice: number | null;
  status: KgiOrderLifecycleStatus;
  brokerReportConfirmed: boolean;
  settlementConfirmed: boolean;
  settlementSource: "deal" | "order_event" | "trade_report" | "submission_only";
  confirmedAt: string | null;
  matchStrategy: "trade_id" | "exact_request" | "none";
};

export type KgiReconciliationEvidenceSummary = {
  orderEventRows: number;
  tradeReportRows: number;
  dealRows: number;
  rowsWithTradeId: number;
  rowsWithSymbol: number;
};

type NormalizedEvidence = {
  tradeId: string | null;
  symbol: string | null;
  side: "buy" | "sell" | null;
  requestedQty: number | null;
  filledQty: number | null;
  remainingQty: number | null;
  avgFillPrice: number | null;
  status: KgiOrderLifecycleStatus;
  occurredAt: string | null;
  source: ReconciledKgiOrder["settlementSource"];
};

const TRADE_ID_KEYS = ["trade_id", "tradeId", "nid", "order_id", "orderId", "ord_no", "seqno"];
const SYMBOL_KEYS = ["symbol", "stock_id", "stockId", "code", "stock_no", "stockNo"];
const SIDE_KEYS = ["side", "action", "buy_sell", "bs", "order_action"];
const QTY_KEYS = ["requested_qty", "order_qty", "qty", "quantity", "shares", "total_qty"];
const FILLED_QTY_KEYS = ["filled_qty", "deal_qty", "matched_qty", "qty_deal", "cumulative_qty", "qty_filled"];
const REMAINING_QTY_KEYS = ["remaining_qty", "leaves_qty", "qty_remain", "unfilled_qty"];
const PRICE_KEYS = ["avg_fill_price", "deal_price", "filled_price", "avg_price", "price"];
const STATUS_KEYS = ["status", "order_status", "state", "type", "message"];
const TIME_KEYS = ["confirmed_at", "deal_time", "trade_time", "updated_at", "timestamp", "datetime", "time"];

function scalar(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

/**
 * 2026-07-23 P0 fix: `Number("")` evaluates to `0` in JS (not NaN) — so this
 * function used to silently turn "key absent" (scalar() returns null for a
 * missing key) into a real `0` instead of null. That 0 then defeated the
 * `row.filledQty ?? row.requestedQty ?? 0` fallback chain in
 * reconcileKgiOrder() below wherever real KGI evidence lacks an explicit
 * filled_qty/deal_qty field — which real /deals payloads always do (KGI uses
 * "quantity", not "filled_qty"; see FILLED_QTY_KEYS above). Net effect: every
 * real deal's filledQty silently computed as 0, so status could never
 * advance past "accepted" and settlementConfirmed stayed false forever —
 * caught by reconcileUnconfirmedAuditOrders' fixture test using real
 * 2026-07-23 go-live /deals evidence (reports/sim_go_live_20260723/).
 */
function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSide(value: unknown): "buy" | "sell" | null {
  const normalized = String(value ?? "").toLowerCase();
  if (/sell|short|賣/.test(normalized)) return "sell";
  if (/buy|long|買/.test(normalized)) return "buy";
  return null;
}

function normalizeStatus(value: unknown, source: NormalizedEvidence["source"]): KgiOrderLifecycleStatus {
  const normalized = String(value ?? "").toLowerCase();
  if (source === "deal" || /4011|filled|deal|成交/.test(normalized)) return "filled";
  if (/partial|部分/.test(normalized)) return "partially_filled";
  if (/cancel|取消|刪單/.test(normalized)) return "cancelled";
  if (/reject|fail|error|拒/.test(normalized)) return "rejected";
  if (/4010|6002|accept|neworder|pending|submitted|委託|受理/.test(normalized)) return "accepted";
  return "unconfirmed";
}

function looksLikeEvidence(record: Record<string, unknown>): boolean {
  return Boolean(
    scalar(record, TRADE_ID_KEYS)
    || scalar(record, SYMBOL_KEYS)
    || scalar(record, STATUS_KEYS)
    || scalar(record, FILLED_QTY_KEYS),
  );
}

function flattenEvidence(input: unknown, source: NormalizedEvidence["source"]): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const visit = (value: unknown, inheritedId?: string) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = { ...(value as Record<string, unknown>) };
    if (inheritedId && !scalar(record, TRADE_ID_KEYS)) record["order_id"] = inheritedId;
    if (looksLikeEvidence(record)) rows.push(record);
    for (const [key, child] of Object.entries(record)) {
      if (child && typeof child === "object") visit(child, key);
    }
  };
  visit(input);
  return rows.map((row) => ({ ...row, __source: source }));
}

export function extractKgiTradeId(input: unknown): string | null {
  if (input && typeof input === "object") {
    const direct = text(scalar(input as Record<string, unknown>, TRADE_ID_KEYS));
    if (direct) return direct;
  }
  const raw = typeof input === "string" ? input : JSON.stringify(input ?? "");
  const match = /(?:nid|trade_id|tradeId|order_id|orderId|ord_no|seqno)\s*[:=]\s*['"]?([A-Za-z0-9_-]+)/i.exec(raw);
  return match?.[1] ?? null;
}

function normalizeEvidence(record: Record<string, unknown>, source: NormalizedEvidence["source"]): NormalizedEvidence {
  const rawData = record["data"];
  const merged = rawData && typeof rawData === "object"
    ? { ...record, ...(rawData as Record<string, unknown>) }
    : record;
  const statusValue = scalar(merged, STATUS_KEYS) ?? record["code"];
  return {
    tradeId: extractKgiTradeId(merged),
    symbol: text(scalar(merged, SYMBOL_KEYS)),
    side: normalizeSide(scalar(merged, SIDE_KEYS)),
    requestedQty: numberValue(scalar(merged, QTY_KEYS)),
    filledQty: numberValue(scalar(merged, FILLED_QTY_KEYS)),
    remainingQty: numberValue(scalar(merged, REMAINING_QTY_KEYS)),
    avgFillPrice: numberValue(scalar(merged, PRICE_KEYS)),
    status: normalizeStatus(statusValue, source),
    occurredAt: text(scalar(merged, TIME_KEYS)) ?? text(record["received_at"]),
    source,
  };
}

/**
 * Convert a wire-unit quantity extracted from broker evidence (lots for
 * board-lot orders, shares for odd-lot orders — see SubmittedKgiOrder.
 * wireQtyUnit doc) into a real share count. `null` in, `null` out — callers
 * fall back to sensible defaults (0/undefined) same as before this existed.
 *
 * 2026-07-23 Round 2 fix (Pete review PR #1345): every quantity field read
 * off matched evidence rows (filledQty/requestedQty/remainingQty) is in
 * this wire unit and MUST be converted before being compared against or
 * summed with order.requestedQty (always shares) — this was the symmetric
 * gap left after the submit-side qty fix (kgi-contract-rules.ts::
 * toKgiOrderQty()) landed without a matching parse-side fix.
 */
function wireQtyToShares(wireQtyUnit: SubmittedKgiOrder["wireQtyUnit"], qty: number | null): number | null {
  if (qty === null) return null;
  return fromKgiOrderQty(qty, (wireQtyUnit ?? "shares") === "shares");
}

function sameRequest(order: SubmittedKgiOrder, evidence: NormalizedEvidence): boolean {
  if (evidence.symbol && evidence.symbol !== order.symbol) return false;
  if (evidence.side && evidence.side !== order.side) return false;
  const evidenceRequestedQtyShares = wireQtyToShares(order.wireQtyUnit, evidence.requestedQty);
  if (evidenceRequestedQtyShares !== null && evidenceRequestedQtyShares !== order.requestedQty) return false;
  return evidence.symbol === order.symbol && (evidence.side !== null || evidenceRequestedQtyShares !== null);
}

export function reconcileKgiOrder(params: {
  order: SubmittedKgiOrder;
  trades?: unknown;
  deals?: unknown;
  events?: unknown;
}): ReconciledKgiOrder {
  const tradeId = params.order.tradeId ?? null;
  const wireQtyUnit = params.order.wireQtyUnit;
  const toShares = (qty: number | null) => wireQtyToShares(wireQtyUnit, qty);
  const evidence = [
    ...flattenEvidence(params.deals, "deal").map((row) => normalizeEvidence(row, "deal")),
    ...flattenEvidence(params.events, "order_event").map((row) => normalizeEvidence(row, "order_event")),
    ...flattenEvidence(params.trades, "trade_report").map((row) => normalizeEvidence(row, "trade_report")),
  ];
  const idMatches = tradeId ? evidence.filter((row) => row.tradeId === tradeId) : [];
  const evidenceHasTradeIds = evidence.some((row) => row.tradeId);
  const matched = idMatches.length > 0 ? idMatches : evidence.filter((row) => sameRequest(params.order, row));
  const safeMatched = tradeId && evidenceHasTradeIds && idMatches.length === 0 ? [] : matched;
  const matchStrategy: ReconciledKgiOrder["matchStrategy"] =
    idMatches.length > 0 ? "trade_id" : safeMatched.length > 0 ? "exact_request" : "none";

  const dealRows = safeMatched.filter((row) => row.source === "deal");
  const eventDealRows = safeMatched.filter((row) => row.source === "order_event" && row.status === "filled");
  const filledQty = dealRows.length > 0
    ? dealRows.reduce((sum, row) => sum + Math.max(0, toShares(row.filledQty ?? row.requestedQty) ?? 0), 0)
    : eventDealRows.length > 0
      ? Math.max(...eventDealRows.map((row) => toShares(row.filledQty ?? row.requestedQty) ?? 0))
      : Math.max(0, ...safeMatched.map((row) => toShares(row.filledQty) ?? 0));
  const weightedDeals = dealRows.filter((row) => (row.avgFillPrice ?? 0) > 0);
  const avgFillPrice = weightedDeals.length > 0
    ? weightedDeals.reduce((sum, row) => sum + (row.avgFillPrice ?? 0) * Math.max(1, toShares(row.filledQty ?? row.requestedQty) ?? 1), 0)
      / weightedDeals.reduce((sum, row) => sum + Math.max(1, toShares(row.filledQty ?? row.requestedQty) ?? 1), 0)
    : safeMatched.find((row) => row.avgFillPrice !== null)?.avgFillPrice ?? null;
  const explicitRemaining = safeMatched.find((row) => row.remainingQty !== null)?.remainingQty;
  const remainingQty = Math.max(0, toShares(explicitRemaining ?? null) ?? params.order.requestedQty - filledQty);

  let status: KgiOrderLifecycleStatus = safeMatched[0]?.status ?? "unconfirmed";
  if (safeMatched.some((row) => row.status === "rejected")) status = "rejected";
  else if (safeMatched.some((row) => row.status === "cancelled") && filledQty === 0) status = "cancelled";
  else if (filledQty >= params.order.requestedQty && params.order.requestedQty > 0) status = "filled";
  else if (filledQty > 0) status = "partially_filled";
  else if (safeMatched.length > 0) status = "accepted";

  const settlementSource = dealRows.length > 0
    ? "deal"
    : safeMatched[0]?.source ?? "submission_only";
  const confirmedAt = safeMatched.map((row) => row.occurredAt).find(Boolean) ?? null;

  return {
    tradeId: tradeId ?? safeMatched.map((row) => row.tradeId).find(Boolean) ?? null,
    symbol: params.order.symbol,
    side: params.order.side,
    requestedQty: params.order.requestedQty,
    filledQty: Math.min(params.order.requestedQty, filledQty),
    remainingQty,
    avgFillPrice,
    status,
    brokerReportConfirmed: safeMatched.length > 0,
    settlementConfirmed: ["filled", "partially_filled", "cancelled", "rejected"].includes(status),
    settlementSource,
    confirmedAt,
    matchStrategy,
  };
}

export function reconcileKgiOrders(params: {
  orders: SubmittedKgiOrder[];
  trades?: unknown;
  deals?: unknown;
  events?: unknown;
}): ReconciledKgiOrder[] {
  return params.orders.map((order) => reconcileKgiOrder({ ...params, order }));
}

// ── SIM audit_logs 補確認掃描 (2026-07-23) ──────────────────────────────────
//
// Root cause (2026-07-23 P0, reports/sim_go_live_20260723/): S1/V34/V51 SIM
// runners poll trades/deals/events for only 3x1.5s=4.5s immediately after
// order submission, then give up permanently and persist
// status="unconfirmed" into their own audit_logs row forever — even though
// real evidence the same day showed ExecReport/Deal confirmations landing
// 10-40s+ after submission (see VISIBILITY_DIAGNOSIS_20260723.md). 4.5s can
// never observe a real fill; this is why settlement_confirmed has been 0%
// for 8 straight weeks.
//
// This is the pure reconciliation-matching core of the fix: given a batch of
// orders an audit row recorded as still "unconfirmed" (plus a trade id), and
// a FRESH trades/deals/events snapshot from the gateway, report which ones
// can now be resolved. No I/O here — callers (one per pipeline, in
// s1-sim-runner.ts / v34-sim-runner.ts / v51-sim-basket-runner.ts) own
// reading the audit_logs row (with its `id`) and writing the updated
// payload back in place (same row, same field semantics — see each
// pipeline's own `reconcileUnconfirmed<X>Orders()` for the I/O wrapper).
//
// Idempotent by construction: re-running against the same audit row is safe
// — orders that are still unconfirmed are re-checked (no-op if nothing new
// arrived), orders already resolved are filtered out by the caller before
// even reaching this function (or simply produce the same reconciled result
// again), and the write-back is an UPDATE of the same row, never an INSERT
// — no duplicate audit rows are ever created by re-running this scan.
//
// This function intentionally does NOT reach back further than the orders
// it's given — gateway trades/deals/events are transient in-memory state
// that is wiped on every gateway process restart (confirmed 2026-07-23), so
// orders from a prior gateway session cannot be recovered here regardless of
// how far back the caller looks. Callers should scope their audit_logs scan
// to recent rows (same gateway uptime window) for this to have any chance of
// finding evidence.

/** One order from an audit_logs row's `results` array that is still unresolved. */
export type UnconfirmedAuditOrder = {
  /** Position in the caller's original results array — lets the caller splice
   *  the reconciliation result back into the exact same array slot. */
  index: number;
  tradeId: string | null;
  symbol: string;
  /** Requested share count (NOT lots — matches SubmittedKgiOrder.requestedQty). */
  shares: number;
  /**
   * Whether this order was placed as a Taiwan odd-lot (零股) order — REQUIRED,
   * not optional, because the caller MUST know this to correctly reconcile
   * (board-lot orders' broker evidence reports quantity in lots, not shares
   * — see SubmittedKgiOrder.wireQtyUnit doc). 2026-07-23 Round 2 fix (Pete
   * review PR #1345): omitting this silently produced a 1000x-wrong
   * filledQty for every board-lot order.
   */
  isOddLot: boolean;
};

export type UnconfirmedAuditOrderResolution = {
  index: number;
  reconciled: ReconciledKgiOrder;
};

/**
 * Re-check a batch of still-"unconfirmed" audit-log orders against a fresh
 * trades/deals/events snapshot. Returns only the ones that can now be
 * resolved (settlementConfirmed=true) — orders with no matching evidence yet
 * are omitted so callers can leave those audit fields untouched.
 *
 * Orders without a tradeId are skipped (nothing to match against — a
 * "skipped"/"rejected"-at-submission-time order was never really pending).
 */
export function reconcileUnconfirmedAuditOrders(
  orders: UnconfirmedAuditOrder[],
  evidence: { trades?: unknown; deals?: unknown; events?: unknown },
): UnconfirmedAuditOrderResolution[] {
  const resolutions: UnconfirmedAuditOrderResolution[] = [];
  for (const order of orders) {
    if (!order.tradeId) continue;
    const reconciled = reconcileKgiOrder({
      order: {
        tradeId: order.tradeId,
        symbol: order.symbol,
        side: "buy",
        requestedQty: order.shares,
        wireQtyUnit: order.isOddLot ? "shares" : "lots",
      },
      trades: evidence.trades,
      deals: evidence.deals,
      events: evidence.events,
    });
    if (reconciled.settlementConfirmed) {
      resolutions.push({ index: order.index, reconciled });
    }
  }
  return resolutions;
}

// ── UTA-C2 委託回報輪詢 (2026-07-04) ────────────────────────────────────────
//
// Polls the KGI SIM gateway's trades/deals/order-events and reconciles them
// against unified_orders rows still resting on the kgi channel
// (submitted/partial_fill), writing filled_qty/filled_price/status back.
// Also flags "stuck pending" rows — a unified_orders row that was written
// pending-first (D3) but never transitioned to submitted/rejected, meaning
// the channel call's post-submit update failed (half-order). Per D3 §6,
// stuck rows are NEVER auto-resubmitted; this only reports them.
//
// Design: reports/epic_trading_desk_20260702/S1_UNIFIED_ORDER_FLOW_DESIGN_v1.md D3
//         reports/fubon_adapter/FUBON_ADAPTER_INTERFACE_FREEZE_v1.md §附錄 UTA-C2

export type KgiUnifiedOrderSyncSummary = {
  checked: number;
  updated: number;
  stuckPending: Array<{ id: string; symbol: string; ageMs: number }>;
  skippedGatewayScheduledOff: boolean;
};

const DEFAULT_STUCK_PENDING_MS = 3 * 60 * 1000; // 3 minutes

function stuckPendingThresholdMs(): number {
  const raw = Number(process.env["UTA_C2_STUCK_PENDING_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STUCK_PENDING_MS;
}

/** Maps a reconciled KGI lifecycle status to the unified_orders status enum. null = no change (still resting). */
function mapReconciledStatusToUnified(
  status: KgiOrderLifecycleStatus
): "filled" | "partial_fill" | "cancelled" | "rejected" | null {
  switch (status) {
    case "filled":
      return "filled";
    case "partially_filled":
      return "partial_fill";
    case "cancelled":
      return "cancelled";
    case "rejected":
      return "rejected";
    case "accepted":
    case "unconfirmed":
    default:
      return null;
  }
}

export async function syncKgiUnifiedOrders(params: {
  workspaceId: string;
  gatewayBaseUrl?: string;
  /** TEST ONLY — bypass the gateway-hours window guard. */
  _ignoreScheduleWindow?: boolean;
}): Promise<KgiUnifiedOrderSyncSummary> {
  const summary: KgiUnifiedOrderSyncSummary = {
    checked: 0,
    updated: 0,
    stuckPending: [],
    skippedGatewayScheduledOff: false
  };

  if (!params._ignoreScheduleWindow) {
    const { isKgiGatewayScheduledOff } = await import("./kgi-gateway-schedule.js");
    if (isKgiGatewayScheduledOff()) {
      summary.skippedGatewayScheduledOff = true;
      return summary;
    }
  }

  const { listUnifiedOrders, updateUnifiedOrderFill } = await import("./unified-order-store.js");
  const rows = await listUnifiedOrders(params.workspaceId, 200);
  const kgiRows = rows.filter((r) => r.adapterKey === "kgi");

  // Stuck-pending scan — log only, never auto-resubmit (D3 半單協議).
  const stuckThreshold = stuckPendingThresholdMs();
  const now = Date.now();
  for (const row of kgiRows) {
    if (row.status !== "pending") continue;
    const ageMs = now - new Date(row.createdAt).getTime();
    if (ageMs >= stuckThreshold) {
      summary.stuckPending.push({ id: row.id, symbol: row.symbol, ageMs });
    }
  }
  if (summary.stuckPending.length > 0) {
    console.warn(
      `[uta-c2-sync] ${summary.stuckPending.length} kgi unified_orders row(s) stuck pending >= ${stuckThreshold}ms:`,
      summary.stuckPending.map((s) => `${s.id}(${s.symbol})`).join(", ")
    );
  }

  const syncable = kgiRows.filter(
    (r) => (r.status === "submitted" || r.status === "partial_fill") && r.externalOrderId
  );
  if (syncable.length === 0) return summary;

  const { KgiGatewayClient } = await import("./kgi-gateway-client.js");
  const client = new KgiGatewayClient({
    gatewayBaseUrl: params.gatewayBaseUrl ?? process.env["KGI_GATEWAY_URL"] ?? "http://127.0.0.1:8787",
    ignoreScheduleGuard: true
  });

  let trades: unknown = null;
  let deals: unknown = null;
  let events: unknown = null;
  try {
    [trades, deals, events] = await Promise.all([
      client.getTrades(true).catch(() => null),
      client.getDeals().catch(() => null),
      client.getRecentOrderEvents().catch(() => null)
    ]);
  } catch {
    // Gateway unreachable this tick — leave rows untouched, retry next tick.
    return summary;
  }

  for (const row of syncable) {
    summary.checked += 1;
    const reconciled = reconcileKgiOrder({
      order: {
        tradeId: row.externalOrderId,
        symbol: row.symbol,
        side: row.action === "Buy" ? "buy" : "sell",
        requestedQty: row.qty,
        submittedAt: row.submittedAt
      },
      trades,
      deals,
      events
    });

    const nextStatus = mapReconciledStatusToUnified(reconciled.status);
    if (!nextStatus || nextStatus === row.status) continue;

    const nowIso = new Date().toISOString();
    await updateUnifiedOrderFill(row.id, {
      status: nextStatus,
      filledQty: reconciled.filledQty,
      filledPrice: reconciled.avgFillPrice,
      filledAt: nextStatus === "filled" ? reconciled.confirmedAt ?? nowIso : null,
      cancelledAt: nextStatus === "cancelled" ? reconciled.confirmedAt ?? nowIso : null
    });
    summary.updated += 1;
  }

  return summary;
}

export function summarizeKgiReconciliationEvidence(params: {
  trades?: unknown;
  deals?: unknown;
  events?: unknown;
}): KgiReconciliationEvidenceSummary {
  const eventRows = flattenEvidence(params.events, "order_event").map((row) => normalizeEvidence(row, "order_event"));
  const tradeRows = flattenEvidence(params.trades, "trade_report").map((row) => normalizeEvidence(row, "trade_report"));
  const dealRows = flattenEvidence(params.deals, "deal").map((row) => normalizeEvidence(row, "deal"));
  const allRows = [...eventRows, ...tradeRows, ...dealRows];
  return {
    orderEventRows: eventRows.length,
    tradeReportRows: tradeRows.length,
    dealRows: dealRows.length,
    rowsWithTradeId: allRows.filter((row) => row.tradeId).length,
    rowsWithSymbol: allRows.filter((row) => row.symbol).length,
  };
}
