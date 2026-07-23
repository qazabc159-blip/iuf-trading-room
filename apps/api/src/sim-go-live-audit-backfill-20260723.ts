/**
 * sim-go-live-audit-backfill-20260723.ts — backfill `audit_logs` for the
 * 2026-07-23 three-sleeve go-live's 53 orders.
 *
 * WHY THIS EXISTS: those 53 orders were sent via
 * reports/sim_go_live_20260723/send_three_sleeve.mjs — a standalone RUNBOOK
 * tool that POSTs directly to the KGI gateway and only appends to a local
 * evidence JSONL file. It never wrote `audit_logs` (grep confirms zero
 * db/drizzle/audit_logs references in it). The #1345 5-min reconciliation
 * cron (SIM-ORDER-RECONCILE-CRON) only UPDATEs *existing* audit_logs rows —
 * with no row for this batch, it had nothing to reconcile. See
 * reports/sim_go_live_20260723/RECONCILE_53_ORDERS_FINAL_20260723.md for the
 * full writeup. This script constructs the audit_logs row(s) the real
 * v51-sim-basket-runner.ts / v34-sim-runner.ts pipelines WOULD have written
 * (and #1345's cron would have reconciled), from the evidence already
 * committed in this repo.
 *
 * Usage (lives beside s1-sim-runner.ts/v51-sim-basket-runner.ts/v34-sim-runner.ts
 * so it can import apps/api's own drizzle-orm dependency directly — NOT under
 * /scripts/, which is root-level and doesn't have drizzle-orm resolvable):
 *   node --import tsx ./apps/api/src/sim-go-live-audit-backfill-20260723.ts
 *     -> DRY RUN (default). Makes ZERO network/DB calls. Reads the already-
 *        committed evidence files and writes the audit_logs row(s) it WOULD
 *        insert to
 *        reports/sim_go_live_20260723/evidence/audit_backfill_dry_run_<ts>.json.
 *
 *   APPLY=true node --import tsx ./apps/api/src/sim-go-live-audit-backfill-20260723.ts
 *     -> APPLY. Connects to DATABASE_URL, re-checks idempotency for real
 *        (same (workspaceId, action, entityType, entityId) key the runners
 *        themselves guard on), and INSERTs (never UPDATEs/overwrites — if a
 *        row already exists at that key, that row is left untouched and
 *        skipped). DO NOT RUN without Elva's explicit go-ahead — this repo's
 *        `pg` Railway service currently has no public TCP proxy configured
 *        (no DATABASE_PUBLIC_URL), so APPLY can only run from a context that
 *        can actually reach DATABASE_URL (e.g. inside Railway itself, or
 *        after that gap is closed).
 *
 * STATUS SOURCE — reads reconcile_53_orders_20260723.json (produced by the
 * earlier confirmation-collection pass, RECONCILE_53_ORDERS_FINAL_20260723.md)
 * rather than re-deriving status via kgi-order-reconciliation.ts's
 * reconcileKgiOrder(). This was a deliberate correction after actually trying
 * the generic matcher first: with the ad-hoc tool's own tradeId not
 * recognized by KGI's evidence (see KNOWN ISSUE #2 below), reconcileKgiOrder()
 * falls back to its fuzzy symbol+qty (sameRequest) matching path, which for
 * THIS data shape systematically misclassifies partial fills as full fills —
 * because a partial-fill deal's own "quantity" field is the FILL amount, not
 * the order's total requested amount, so sameRequest's qty-equality check
 * silently drops it, while a separate flattened row (the KGI order echo
 * inside trades.json, which always carries the TOTAL requested qty) still
 * matches and lets other real deal evidence attach on top, systematically
 * over-crediting fills. A test run of this exact scenario produced 40
 * "filled" vs the ground-truth 31 Filled + 7 PartFilled = 38 (and lost the
 * partial/open distinction entirely — 0 "partially_filled", 0 "unconfirmed").
 * reconcile_53_orders_20260723.json's per-KGI-order-id-bucket matching (built
 * by directly reading each order_status.deals array under its own Y00xx key)
 * does not have this failure mode and is used here as ground truth instead.
 *
 * KNOWN ISSUES / judgment calls flagged for Elva before --apply (not resolved
 * in this script):
 *
 *   1. V51's real schema keys ONE row per basketSignalDate (see
 *      v51-sim-basket-runner.ts hasAlreadySubmitted()/writeAuditRecord()).
 *      Both the v51_c1 (baskets/v51_sim_basket_2026-07-13.csv) and v51_c3
 *      (baskets/v51_c3_sim_basket_2026-07-13_backfill.csv) source CSVs carry
 *      signal_date=2026-07-13 — i.e. they collide on the same entityId under
 *      the real runner's own schema. This script MERGES them into one row
 *      (45 orders total) and adds a non-breaking additive `sleeve` field per
 *      result item (not part of the original V51OrderResult TS type, but the
 *      column is jsonb so this is safe) so C1 vs C3 provenance is not lost.
 *      This is a judgment call, not an obviously-correct answer.
 *
 *   2. Ad-hoc trade_id mismatch (open question, NOT confirmed as a
 *      production bug — flagging, not claiming): send_three_sleeve.mjs's
 *      captured "trade_id" values (e.g. "1784766165423387001", 19 digits)
 *      don't match KGI's own nid format seen in trades.json (e.g.
 *      "00005829", 8-digit zero-padded). services/kgi-gateway/app.py's
 *      /order/create handler (read-only checked, not modified) DOES try to
 *      extract a real "nid"-first identifier from the KGI SDK response, so
 *      it's unclear whether this is SIM-env-specific to the ad-hoc tool's
 *      calling pattern or would also affect genuine runner submissions —
 *      not root-caused here, flagged as worth a follow-up look given it
 *      would affect the safety-critical idMatches path in
 *      reconcileKgiOrder() for the real pipelines too if it recurs there.
 *
 *   3. The 3 REJECTED orders (1271, 5267, 6808) — ground-truth status
 *      "rejected" comes from reconcile_53_orders_20260723.json's
 *      INVALID_REJECTED classification (KGI's 無效單 bucket, quantity/price
 *      forced to 0, no order_status wrapper).
 *
 *   4. Symbol 1808 was sent twice (v51_c1 canary @08:35 + v51_c3 batch
 *      @09:24, both qty_lots=3) but the final KGI order book shows only ONE
 *      matching order record (Y001R, PartFilled 1/3) — ground truth could
 *      not disambiguate which submission it belongs to.
 *      reconcile_53_orders_20260723.json marks the SECOND (v51_c3) entry
 *      AMBIGUOUS_DUP_SYMBOL_NO_DISTINCT_RECORD; this script maps that to
 *      status="unconfirmed" with an explanatory error string rather than
 *      guessing filled/unfilled.
 *
 *   5. IMPORTANT — this backfill does NOT durably fix what
 *      /api/v1/kgi/sim/orders or /v34-orders *display*. Both endpoints
 *      ALWAYS live-reconcile against the gateway on every read (they only
 *      use the stored row's tradeId/shares to build the query, not its
 *      status) and only fall back to the stored `status` field if the live
 *      gateway call THROWS (KgiGatewayUnreachableError/AuthError) — not if
 *      it just returns empty evidence, which is what happens on a clean
 *      "gateway is closed" read (each of the 3 calls is individually
 *      try/caught to {ok:false, value:null/[]} inside the route handler, so
 *      the outer catch never fires). Since gateway trades/deals/events are
 *      transient in-memory state wiped on every gateway restart (confirmed
 *      2026-07-23), tomorrow's 08:20 restart wipes today's evidence for
 *      good — after that, these two endpoints will show "unconfirmed" for
 *      all of today's orders again NO MATTER WHAT this script writes. The
 *      backfilled row is still a valid, durable audit-trail record (that IS
 *      audit_logs's purpose) and matches what S1's own reconcile cron
 *      already persists permanently into ITS row (S1's result shape
 *      includes filled_shares/avg_fill_price/settlement_confirmed/etc., all
 *      written back in place — V51/V34's reconcile wrappers only ever write
 *      back `status`+`error`, an existing asymmetry this script mirrors, not
 *      introduces). Making the two display endpoints durably show today's
 *      outcome would need a separate change to their fallback order
 *      (stored-status-first instead of live-first) — out of scope here,
 *      flagged for Elva to decide whether it's worth a follow-up.
 *
 * Inputs (all already committed in this repo, read-only):
 *   reports/sim_go_live_20260723/evidence/orders_20260723.jsonl              (53 lines, sent-order record)
 *   reports/sim_go_live_20260723/evidence/reconcile_53_orders_20260723.json  (ground-truth per-order status, same order/count as above)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { auditLogs, getDb, isDatabaseMode, workspaces } from "@iuf-trading-room/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const EVIDENCE_DIR = path.join(REPO_ROOT, "reports/sim_go_live_20260723/evidence");
const ORDERS_JSONL = path.join(EVIDENCE_DIR, "orders_20260723.jsonl");
const RECONCILE_JSON = path.join(EVIDENCE_DIR, "reconcile_53_orders_20260723.json");

const APPLY = process.env.APPLY === "true";

type SentOrder = {
  ts: string;
  sleeve: "v51_c1" | "v51_c3" | "v34_c3_proxy";
  symbol: string;
  qty_lots: number;
  shares: number;
  ref_price: number;
  order_notional_twd: number;
  status: string;
  trade_id: string | null;
  http_status: number;
  error: string | null;
  manual_canary?: boolean;
};

type ReconcileRow = {
  sleeve: string;
  symbol: string;
  sent_qty_lots: number;
  kgi_order_id: string | null;
  kgi_status: "Filled" | "PartFilled" | "Submitted" | "INVALID_REJECTED" | "AMBIGUOUS_DUP_SYMBOL_NO_DISTINCT_RECORD";
  filled_qty_lots: number | null;
};

type V51ResultBackfill = {
  stockId: string;
  shares: number;
  status: string;
  tradeId: string | null;
  error: string | null;
  /** Additive, non-breaking (payload is jsonb) — see KNOWN ISSUE #1. */
  sleeve: "v51_c1" | "v51_c3";
  /** Additive, non-breaking — kept for traceability back to the KGI order book. */
  kgiOrderId: string | null;
};

type V34ResultBackfill = {
  stockId: string;
  shares: number;
  isOddLot: boolean;
  executedNotionalTwd: number | null;
  status: string;
  tradeId: string | null;
  error: string | null;
  kgiOrderId: string | null;
};

/** Ground-truth kgi_status -> KgiOrderLifecycleStatus (kgi-order-reconciliation.ts's enum). */
function mapStatus(kgiStatus: ReconcileRow["kgi_status"]): { status: string; error: string | null } {
  switch (kgiStatus) {
    case "Filled":
      return { status: "filled", error: null };
    case "PartFilled":
      return { status: "partially_filled", error: null };
    case "Submitted":
      return { status: "accepted", error: null };
    case "INVALID_REJECTED":
      return {
        status: "rejected",
        error: "kgi_invalid_order_bucket (reason code not exposed by gateway response; raw entry in trades snapshot's 無效單 bucket)",
      };
    case "AMBIGUOUS_DUP_SYMBOL_NO_DISTINCT_RECORD":
      return {
        status: "unconfirmed",
        error: "ambiguous_duplicate_symbol_submission: same symbol+qty sent twice same day (canary + batch), final KGI order book shows only one matching order record — cannot determine which submission it resolves to",
      };
    default:
      return { status: "unconfirmed", error: `unrecognized_kgi_status: ${String(kgiStatus)}` };
  }
}

async function loadOrders(): Promise<SentOrder[]> {
  const text = await fs.readFile(ORDERS_JSONL, "utf8");
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as SentOrder);
}

async function loadReconcile(): Promise<ReconcileRow[]> {
  const raw = JSON.parse(await fs.readFile(RECONCILE_JSON, "utf8")) as { results: ReconcileRow[] };
  return raw.results;
}

type Merged = SentOrder & { finalStatus: string; finalError: string | null; kgiOrderId: string | null; filledQtyLots: number | null };

function mergeOrdersWithReconcile(orders: SentOrder[], reconcile: ReconcileRow[]): Merged[] {
  if (orders.length !== reconcile.length) {
    throw new Error(
      `orders_20260723.jsonl has ${orders.length} rows but reconcile_53_orders_20260723.json has ${reconcile.length} — expected same count/order (both were built by iterating the same 53-row array). Aborting rather than guessing a mismatched pairing.`,
    );
  }
  return orders.map((o, i) => {
    const r = reconcile[i];
    if (r.symbol !== o.symbol || r.sleeve !== o.sleeve) {
      throw new Error(
        `Row ${i} mismatch: orders_20260723.jsonl has sleeve=${o.sleeve} symbol=${o.symbol} but reconcile_53_orders_20260723.json has sleeve=${r.sleeve} symbol=${r.symbol} — the two files are expected to be in lockstep order. Aborting.`,
      );
    }
    const { status, error } = mapStatus(r.kgi_status);
    return { ...o, finalStatus: status, finalError: error, kgiOrderId: r.kgi_order_id, filledQtyLots: r.filled_qty_lots };
  });
}

function buildV51Report(orders: Merged[]) {
  const results: V51ResultBackfill[] = orders.map((o) => ({
    stockId: o.symbol,
    shares: o.shares,
    status: o.finalStatus,
    tradeId: o.trade_id,
    error: o.finalError ?? o.error ?? null,
    sleeve: o.sleeve as "v51_c1" | "v51_c3",
    kgiOrderId: o.kgiOrderId,
  }));
  const submittedAtTst = orders.map((o) => o.ts).sort()[0] ?? null;
  const c1Count = orders.filter((o) => o.sleeve === "v51_c1").length;
  const c3Count = orders.filter((o) => o.sleeve === "v51_c3").length;
  return {
    schema: "v51_order_submit_v1" as const,
    label: "SIM_EXECUTION_SAMPLE_NOT_VALIDATED" as const,
    basketSignalDate: "2026-07-13",
    entryDateTst: "2026-07-23",
    submittedAtTst,
    capitalTwd: 6_000_000,
    results,
    failsafeNotes: [
      `backfilled_from_ad_hoc_tool: orders originally submitted via reports/sim_go_live_20260723/send_three_sleeve.mjs (standalone RUNBOOK tool, does not write audit_logs); this row constructed post-hoc by apps/api/src/sim-go-live-audit-backfill-20260723.ts at ${new Date().toISOString()} from evidence/orders_20260723.jsonl + evidence/reconcile_53_orders_20260723.json (ground truth built by direct per-KGI-order-id-bucket matching, see RECONCILE_53_ORDERS_FINAL_20260723.md).`,
      `merged_two_sleeves: v51_c1 (${c1Count} orders / 3,000,000 TWD) + v51_c3 (${c3Count} orders / 3,000,000 TWD) both source CSVs carry signal_date=2026-07-13 — merged into one row per the real schema's one-row-per-basketSignalDate design (see hasAlreadySubmitted()/writeAuditRecord() in v51-sim-basket-runner.ts); per-result sleeve field preserves C1 vs C3 provenance. Confirm this merge decision before --apply — see KNOWN ISSUE #1 in this script's file header.`,
    ],
  };
}

function buildV34Report(orders: Merged[]) {
  const results: V34ResultBackfill[] = orders.map((o) => ({
    stockId: o.symbol,
    shares: o.shares,
    isOddLot: false,
    // Sizing-time reference price x filled lots (converted to shares) — same
    // concept as V34OrderResult.executedNotionalTwd's doc ("shares *
    // lastClosePrice at sizing time"), not the true avg fill price (not
    // available in the ground-truth reconcile JSON). null when unfilled.
    executedNotionalTwd:
      o.filledQtyLots && o.filledQtyLots > 0 ? o.filledQtyLots * 1000 * o.ref_price : null,
    status: o.finalStatus,
    tradeId: o.trade_id,
    error: o.finalError ?? o.error ?? null,
    kgiOrderId: o.kgiOrderId,
  }));
  const submittedAtTst = orders.map((o) => o.ts).sort()[0] ?? null;
  return {
    schema: "v34_order_submit_v1" as const,
    label: "SIM_EXECUTION_SAMPLE_NOT_VALIDATED" as const,
    basketAsOfDate: "2026-07-21",
    entryDateTst: "2026-07-23",
    submittedAtTst,
    capitalTwd: 1_000_000,
    results,
    failsafeNotes: [
      `backfilled_from_ad_hoc_tool: orders originally submitted via reports/sim_go_live_20260723/send_three_sleeve.mjs (standalone RUNBOOK tool, does not write audit_logs); this row constructed post-hoc by apps/api/src/sim-go-live-audit-backfill-20260723.ts at ${new Date().toISOString()} from evidence/orders_20260723.jsonl + evidence/reconcile_53_orders_20260723.json (ground truth built by direct per-KGI-order-id-bucket matching, see RECONCILE_53_ORDERS_FINAL_20260723.md).`,
    ],
  };
}

function statusBreakdown(orders: Merged[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of orders) out[o.finalStatus] = (out[o.finalStatus] ?? 0) + 1;
  return out;
}

async function main() {
  const [orders, reconcile] = await Promise.all([loadOrders(), loadReconcile()]);
  const merged = mergeOrdersWithReconcile(orders, reconcile);

  const v51Orders = merged.filter((o) => o.sleeve === "v51_c1" || o.sleeve === "v51_c3");
  const v34Orders = merged.filter((o) => o.sleeve === "v34_c3_proxy");

  console.log(`[backfill] loaded ${orders.length} sent orders, ${reconcile.length} reconcile rows (v51: ${v51Orders.length}, v34: ${v34Orders.length})`);
  console.log(`[backfill] v51 status breakdown: ${JSON.stringify(statusBreakdown(v51Orders))}`);
  console.log(`[backfill] v34 status breakdown: ${JSON.stringify(statusBreakdown(v34Orders))}`);

  const rows = [
    {
      action: "v51_sim.order_submit",
      entityType: "v51_sim",
      entityId: "2026-07-13",
      payload: buildV51Report(v51Orders),
    },
    {
      action: "v34_sim.order_submit",
      entityType: "v34_sim",
      entityId: "2026-07-21",
      payload: buildV34Report(v34Orders),
    },
  ];

  if (!APPLY) {
    const outFile = path.join(EVIDENCE_DIR, `audit_backfill_dry_run_${Date.now()}.json`);
    await fs.writeFile(
      outFile,
      JSON.stringify({ generatedAt: new Date().toISOString(), mode: "dry_run", rows }, null, 2),
    );
    console.log(`[dry-run] wrote ${outFile}`);
    console.log(`[dry-run] would insert ${rows.length} audit_logs row(s):`);
    for (const r of rows) {
      console.log(
        `[dry-run]   action=${r.action} entityType=${r.entityType} entityId=${r.entityId} results=${r.payload.results.length} notes=${r.payload.failsafeNotes.length}`,
      );
    }
    console.log("[dry-run] no DB/network calls made. Re-run with APPLY=true (and a reachable DATABASE_URL) to insert.");
    return;
  }

  console.log("[apply] APPLY=true — connecting to DB...");
  if (!isDatabaseMode()) {
    console.error("[apply] ABORT: DATABASE_URL not set / not in database mode. No writes made.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  if (!db) {
    console.error("[apply] ABORT: getDb() returned null. No writes made.");
    process.exitCode = 1;
    return;
  }
  const wsRows = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
  const workspaceId = wsRows[0]?.id;
  if (!workspaceId) {
    console.error("[apply] ABORT: no workspace row found. No writes made.");
    process.exitCode = 1;
    return;
  }
  console.log(`[apply] resolved workspaceId=${workspaceId}`);

  for (const r of rows) {
    const existing = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.workspaceId, workspaceId),
          eq(auditLogs.action, r.action),
          eq(auditLogs.entityType, r.entityType),
          eq(auditLogs.entityId, r.entityId),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      console.log(`[apply] SKIP (row already exists, never overwriting): action=${r.action} entityId=${r.entityId} id=${existing[0].id}`);
      continue;
    }
    const inserted = await db
      .insert(auditLogs)
      .values({
        workspaceId,
        actorId: null,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        payload: r.payload,
      })
      .returning({ id: auditLogs.id });
    console.log(`[apply] INSERTED action=${r.action} entityId=${r.entityId} id=${inserted[0]?.id}`);
  }
}

main().catch((e) => {
  console.error("[backfill] fatal error:", e instanceof Error ? e.stack ?? e.message : String(e));
  process.exitCode = 1;
});
