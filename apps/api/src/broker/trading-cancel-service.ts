/**
 * trading-cancel-service.ts — UTA-C1 統一撤單路徑 (2026-07-04)
 *
 * Cancels a `unified_orders` row by id, dispatching to the owning channel
 * adapter (paper / kgi) and writing the result back to the unified state
 * machine. Deliberately kept separate from trading-service.ts (locked file,
 * harness-hook protected) — this module never imports it.
 *
 * Design: reports/fubon_adapter/FUBON_ADAPTER_INTERFACE_FREEZE_v1.md §附錄 UTA-C1
 *         reports/epic_trading_desk_20260702/S1_UNIFIED_ORDER_FLOW_DESIGN_v1.md D3
 *
 * State machine (per D3): a row can only move to "cancelled" from a
 * non-terminal status (pending/submitted/partial_fill). filled/rejected are
 * terminal and never become cancelled. An already-cancelled row is
 * idempotent — repeat calls return "already_cancelled", not an error.
 *
 * KGI honesty rule: the KGI SIM gateway has no /order/cancel endpoint
 * (confirmed by FUBON_ADAPTER_INTERFACE_FREEZE_v1.md §2 read-back against
 * services/kgi-gateway/app.py). We do not fake success — cancelOrder() on
 * the KGI channel throws KgiGatewayNotEnabledError, which this module maps
 * to a structured "cancel_not_supported_kgi_sim" outcome. The unified_orders
 * row is left untouched (no cancelledAt write) when this happens.
 *
 * unified-order-store is imported lazily (dynamic import inside functions,
 * mirroring trading-service.ts's own recordUnifiedOrder/markUnifiedOrder*
 * helpers) rather than as a static top-level import. This matters: every
 * other consumer of that store (trading-service.ts, server.ts's /uta/orders
 * routes) reaches it via a lazy `await import(...)`, and tests read it via a
 * dynamic import too — mixing a static top-level import in here with those
 * dynamic call sites has been observed to produce two separate module
 * instances (and therefore two separate in-memory stores) under this
 * environment's tsx/Node ESM loader. Keep the import style consistent.
 */

import type { AppSession } from "@iuf-trading-room/contracts";

import { cancelPaperOrder, listPaperAccounts } from "./paper-broker.js";
import type { UnifiedOrderRecord } from "./unified-order-store.js";

export type CancelUnifiedOrderOutcome =
  | "cancelled"
  | "already_cancelled"
  | "not_cancellable"
  | "cancel_not_supported_kgi_sim"
  | "not_found";

export type CancelUnifiedOrderResult =
  | { outcome: "not_found" }
  | { outcome: "already_cancelled"; order: UnifiedOrderRecord }
  | { outcome: "not_cancellable"; order: UnifiedOrderRecord; reason: string }
  | { outcome: "cancel_not_supported_kgi_sim"; order: UnifiedOrderRecord }
  | { outcome: "cancelled"; order: UnifiedOrderRecord };

// Terminal statuses that can never transition to cancelled.
const TERMINAL_NON_CANCELLABLE = new Set(["filled", "rejected"]);

/**
 * The unified_orders row's `adapterResponse` blob shape differs by which
 * code path wrote it (trading-service.ts's dual-write stores the full paper
 * Order; the raw /uta/orders route stores only {externalOrderId, status}).
 * Prefer the full Order's real `id`/`accountId` when present; otherwise fall
 * back to externalOrderId, which the /uta/orders path already sets to the
 * real paper Order id.
 */
function resolvePaperOrderRef(record: UnifiedOrderRecord): {
  orderId: string;
  accountId: string | null;
} {
  const resp = record.adapterResponse as Record<string, unknown> | null;
  const respId = resp && typeof resp["id"] === "string" ? (resp["id"] as string) : null;
  const respAccountId =
    resp && typeof resp["accountId"] === "string" ? (resp["accountId"] as string) : null;
  return {
    orderId: respId ?? record.externalOrderId ?? "",
    accountId: respAccountId
  };
}

async function cancelPaperChannel(
  session: AppSession,
  record: UnifiedOrderRecord
): Promise<CancelUnifiedOrderResult> {
  const { updateUnifiedOrderCancelled } = await import("./unified-order-store.js");
  const { orderId, accountId } = resolvePaperOrderRef(record);
  const resolvedAccountId =
    accountId ?? (await listPaperAccounts(session))[0]?.id ?? "paper-default";

  const result = await cancelPaperOrder({
    session,
    accountId: resolvedAccountId,
    payload: { orderId, reason: "uta_cancel" }
  });

  if (!result) return { outcome: "not_found" };
  if (result.status !== "canceled") {
    return { outcome: "not_cancellable", order: record, reason: result.status };
  }

  const updated = await updateUnifiedOrderCancelled(record.id);
  return { outcome: "cancelled", order: updated ?? record };
}

async function cancelKgiChannel(record: UnifiedOrderRecord): Promise<CancelUnifiedOrderResult> {
  const { updateUnifiedOrderCancelled } = await import("./unified-order-store.js");
  const { KgiBrokerAdapter } = await import("./kgi-broker-adapter.js");
  const { KgiGatewayNotEnabledError } = await import("./kgi-gateway-client.js");

  const adapter = new KgiBrokerAdapter({
    gatewayBaseUrl: process.env["KGI_GATEWAY_URL"] ?? "http://127.0.0.1:8787"
  });

  try {
    await adapter.cancelOrder(record.externalOrderId ?? "");
  } catch (err) {
    if (err instanceof KgiGatewayNotEnabledError) {
      // Honest refusal — the gateway genuinely has no cancel path today.
      // Do NOT write cancelledAt; the row stays in its current status.
      return { outcome: "cancel_not_supported_kgi_sim", order: record };
    }
    throw err;
  }

  const updated = await updateUnifiedOrderCancelled(record.id);
  return { outcome: "cancelled", order: updated ?? record };
}

export async function cancelUnifiedOrder(input: {
  session: AppSession;
  workspaceId: string;
  orderId: string;
}): Promise<CancelUnifiedOrderResult> {
  const { getUnifiedOrderById } = await import("./unified-order-store.js");
  const record = await getUnifiedOrderById(input.workspaceId, input.orderId);
  if (!record) return { outcome: "not_found" };

  if (record.status === "cancelled") {
    return { outcome: "already_cancelled", order: record };
  }
  if (TERMINAL_NON_CANCELLABLE.has(record.status)) {
    return { outcome: "not_cancellable", order: record, reason: record.status };
  }

  if (record.adapterKey === "kgi") {
    return cancelKgiChannel(record);
  }
  if (record.adapterKey === "paper") {
    return cancelPaperChannel(input.session, record);
  }

  // Unknown/未來 adapter (e.g. fubon before its channel wires up) — refuse
  // honestly rather than silently no-op.
  return { outcome: "not_cancellable", order: record, reason: `unsupported_adapter:${record.adapterKey}` };
}
