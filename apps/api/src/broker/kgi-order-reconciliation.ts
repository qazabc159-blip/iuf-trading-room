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
  requestedQty: number;
  submittedAt?: string | null;
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

function numberValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
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

function sameRequest(order: SubmittedKgiOrder, evidence: NormalizedEvidence): boolean {
  if (evidence.symbol && evidence.symbol !== order.symbol) return false;
  if (evidence.side && evidence.side !== order.side) return false;
  if (evidence.requestedQty !== null && evidence.requestedQty !== order.requestedQty) return false;
  return evidence.symbol === order.symbol && (evidence.side !== null || evidence.requestedQty !== null);
}

export function reconcileKgiOrder(params: {
  order: SubmittedKgiOrder;
  trades?: unknown;
  deals?: unknown;
  events?: unknown;
}): ReconciledKgiOrder {
  const tradeId = params.order.tradeId ?? null;
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
    ? dealRows.reduce((sum, row) => sum + Math.max(0, row.filledQty ?? row.requestedQty ?? 0), 0)
    : eventDealRows.length > 0
      ? Math.max(...eventDealRows.map((row) => row.filledQty ?? row.requestedQty ?? 0))
      : Math.max(0, ...safeMatched.map((row) => row.filledQty ?? 0));
  const weightedDeals = dealRows.filter((row) => (row.avgFillPrice ?? 0) > 0);
  const avgFillPrice = weightedDeals.length > 0
    ? weightedDeals.reduce((sum, row) => sum + (row.avgFillPrice ?? 0) * Math.max(1, row.filledQty ?? row.requestedQty ?? 1), 0)
      / weightedDeals.reduce((sum, row) => sum + Math.max(1, row.filledQty ?? row.requestedQty ?? 1), 0)
    : safeMatched.find((row) => row.avgFillPrice !== null)?.avgFillPrice ?? null;
  const explicitRemaining = safeMatched.find((row) => row.remainingQty !== null)?.remainingQty;
  const remainingQty = Math.max(0, explicitRemaining ?? params.order.requestedQty - filledQty);

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
