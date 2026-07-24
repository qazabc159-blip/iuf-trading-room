/**
 * sim-go-live-audit-backfill-round2-20260724.ts — Round 2 of the sim-go-live
 * audit_logs backfill: fixes the v51 entityId collision Round 1 hit at APPLY
 * time, and extends coverage to the 2026-07-24 residual re-send batch.
 *
 * BACKGROUND (see reports/sim_go_live_20260723/evidence/AUDIT_BACKFILL_APPLY_20260723.md
 * for the full incident record):
 *   - Round 1 (sim-go-live-audit-backfill-20260723.ts, PR #1351, APPLY'd
 *     2026-07-23 ~23:4x by Elva) tried entityId="2026-07-13" for the merged
 *     v51_c1+v51_c3 45-order batch. At APPLY time this collided with a REAL
 *     row (`a851467f-...`) the actual v51-sim-basket-runner.ts cron had
 *     already written 2026-07-14T00:26Z for the same basketSignalDate. The
 *     insert-only design (never UPDATE/overwrite an existing row) correctly
 *     protected that row and SKIPped — but it also left the 45 orders with
 *     zero audit_logs coverage. v34's entityId="2026-07-21" did NOT collide
 *     and was inserted successfully (`9df694a1-...`) — no Round 2 action
 *     needed for that row.
 *   - Separately, 2026-07-24's residual/gap-fill re-send (28 orders across 2
 *     phases, via reports/sim_go_live_20260723/resend_residual_20260724.mjs
 *     — a standalone tool with the same "never writes audit_logs" property
 *     as the original send_three_sleeve.mjs) also has zero audit_logs
 *     coverage.
 *
 * WHY DISTINCT entityId (Elva's directive, not an UPDATE/merge of existing
 * rows):
 *   - Distinct entityId strings below (":adhoc-..." suffix) can NEVER
 *     collide with a real runner's own entityId, because both
 *     v51-sim-basket-runner.ts's hasAlreadySubmitted()/writeAuditRecord()
 *     and v34-sim-runner.ts's equivalents key strictly on the bare
 *     basketSignalDate/basketAsOfDate string, and V51's CSV ingestion
 *     (parseV51BasketCsv) fail-closes any signal_date that doesn't match
 *     `/^\d{4}-\d{2}-\d{2}$/` — a colon-suffixed string is structurally
 *     impossible as a real entityId.
 *   - Both readLatestV51OrderSubmitAuditRow() (v51-sim-basket-runner.ts) and
 *     readLatestV34OrderSubmitAuditRow() (v34-sim-runner.ts) — the #1345
 *     reconciliation cron's read path — SELECT ... WHERE workspaceId=?
 *     AND action=? AND entityType=? ORDER BY createdAt DESC LIMIT 1. Neither
 *     filters on entityId. So inserting these newer rows (createdAt =
 *     `auditLogs.createdAt`'s DB-level `defaultNow()`, guaranteed later than
 *     any historical row since neither this script nor Round 1 sets
 *     createdAt explicitly) makes the cron naturally start watching them
 *     instead of the stale 7/14 runner row or Round 1's uncovered gap — no
 *     code change to the runner files needed. See
 *     apps/api/src/sim-go-live-audit-backfill-round2-20260724.test.ts's
 *     "cron consumption path" section for how this is verified given this
 *     repo has no local/CI Postgres test fixture (see that file's header for
 *     the honest limitation this implies).
 *   - payload.failsafeNotes documents provenance (adhoc backfill tool, not a
 *     real runner submission) on every row, per Elva's requirement that
 *     consumers be able to tell these apart from genuine runner rows.
 *
 * BATCH A — 2026-07-23 v51 45 orders, entityId="2026-07-13:adhoc-20260723":
 *   Re-derives the IDENTICAL ground truth and merge logic as Round 1
 *   (orders_20260723.jsonl + reconcile_53_orders_20260723.json, C1+C3
 *   merged into one row per the real one-row-per-basketSignalDate schema,
 *   same 5 KNOWN ISSUES documented in Round 1's file header) — reimplemented
 *   here rather than imported from Round 1's script, because that script is
 *   a frozen, already-APPLY'd historical artifact tied to a specific past
 *   execution and should not be depended on by later scripts (matches this
 *   repo's existing convention of dated, self-contained one-off backfill
 *   scripts, not a shared library). Verified byte-for-byte equivalent status
 *   breakdown to Round 1's actual APPLY'd payload in the test file.
 *
 * BATCH B — 2026-07-24 residual re-send, 28 orders across 2 phases, entityId
 *   ="2026-07-24:adhoc-resend" for BOTH the v51_sim row (24 orders) and the
 *   v34_sim row (4 orders) — safe to reuse the same entityId string across
 *   the two because the composite lookup key also includes
 *   action/entityType, so identical entityId under two different
 *   entityTypes is not a collision (same pattern Round 1 already relied on:
 *   v51_sim entityId="2026-07-13" and v34_sim entityId="2026-07-21" are
 *   different strings AND different entityTypes, doubly non-colliding).
 *
 *   GROUND TRUTH SOURCE: reports/sim_go_live_20260723/evidence/trades_manual_0724.json
 *   (overridable via RESIDUAL_TRADES_FILE env var — see "RE-RUNNING WITH A
 *   FRESH EOD FILE" below), NOT deals_manual_0724.json. trades_manual_0724.json
 *   gives one bucket PER KGI order_id (order.symbol/order.price/order.quantity
 *   requested + order_status.status + order_status.deals[].quantity filled),
 *   which correctly keeps the phase1 and phase2 attempts for a retried
 *   symbol as two distinct buckets. deals_manual_0724.json instead groups by
 *   symbol only and — for the 3 symbols that only filled on their phase2
 *   requote (4113/2465/8059) — shows just ONE combined entry, which would
 *   silently lose the phase1 attempt's (unfilled, still-open) audit trail.
 *   This mirrors Round 1's own stated preference for per-KGI-order-id-bucket
 *   matching over any fuzzy/summarized matching (see Round 1's file header,
 *   "STATUS SOURCE" section).
 *
 *   JOIN KEY: (symbol, price rounded to 2dp). orders_20260724_residual.jsonl's
 *   own `trade_id` field is the ad-hoc tool's locally-generated id
 *   (19-digit), which does not match KGI's order_id/nid namespace — same
 *   open question as Round 1's KNOWN ISSUE #2, still unresolved here. But
 *   (symbol, price) is a safe join key for this batch specifically because
 *   the marketable-limit requote logic in resend_residual_20260724.mjs
 *   ALWAYS uses a strictly higher price on phase2 than phase1 (+3% vs +1%
 *   buffer per RUNBOOK_ADDENDUM_20260724.md) for every one of the 6 symbols
 *   retried, and no two orders in this 28-row batch share both the same
 *   symbol AND the same price. Verified exhaustively against ALL 28 rows in
 *   the test file (not just spot-checked).
 *
 * PHASE1/PHASE2 SAME-SYMBOL HANDLING (explicit judgment call — task asked
 * this be documented, not resolved by silent merging): 6 symbols
 * (1271/4113/2465/8059/5267/6808) plus 6505 = 7 symbols appear in BOTH
 * phase1 and phase2 (phase2 = requote/retry of an unfilled-or-rejected
 * phase1 order; the gateway has no cancel/amend endpoint, so phase2 is
 * always a brand-new stacked order, never a replacement of phase1's). This
 * script does NOT merge them into one result entry per symbol — both stay
 * as separate result entries, distinguished by an additive `phase` field
 * (mirrors Round 1's additive `sleeve` field pattern — non-breaking, jsonb
 * payload), because:
 *   (a) both are real, distinct order submissions with their own KGI
 *       order_id/nid (except the 4 that were rejected, order_id="0000"
 *       both times) and their own independent fate — merging would
 *       silently discard one attempt's audit trail;
 *   (b) for the 3 that only filled on phase2 (4113/2465/8059), the phase1
 *       leg genuinely is still open ("accepted"/Submitted, unfilled,
 *       un-cancelled, since no cancel endpoint exists) — collapsing to a
 *       single "filled" entry would misrepresent that two live orders
 *       briefly coexisted at different limit prices;
 *   (c) for the 4 rejected symbols (1271/5267/6808/6505 — order_id="0000"
 *       both phases, confirmed via trades_manual_0724.json's invalid-order
 *       bucket, "|MAT0015"/"|MAT0024" KGI error codes), both phase1 and
 *       phase2 independently failed — there is nothing to merge, they are
 *       two separate rejections of the same symbol.
 *
 * RE-RUNNING WITH A FRESH EOD FILE: the task instruction says a 13:55 TST
 * EOD-refreshed evidence file may land after this script is first written.
 * loadResidualGroundTruth() reads its input path from the
 * RESIDUAL_TRADES_FILE env var (default: trades_manual_0724.json in this
 * evidence dir) and loadResidualOrders() from RESIDUAL_ORDERS_FILE (default:
 * orders_20260724_residual.jsonl) — re-run DRY_RUN with either env var
 * pointed at a newer file (whatever it ends up being named) to pick up EOD
 * ground truth without editing this script. The (symbol, price) join logic
 * is unchanged by which snapshot is used; only which orders resolve to
 * "filled" vs "accepted" (still-open) can change (rejections and partial
 * fills are already terminal by market-hour dynamics — a limit order that
 * was rejected or partially filled earlier in the session doesn't un-reject
 * or gain fill by EOD without a further explicit fill/cancel event).
 *
 * Usage — same DRY_RUN/APPLY contract as Round 1:
 *   node --import tsx ./apps/api/src/sim-go-live-audit-backfill-round2-20260724.ts
 *     -> DRY RUN (default). Zero network/DB calls. Writes the 3 rows it
 *        would insert to
 *        reports/sim_go_live_20260723/evidence/audit_backfill_round2_dry_run_<ts>.json.
 *
 *   APPLY=true node --import tsx ./apps/api/src/sim-go-live-audit-backfill-round2-20260724.ts
 *     -> APPLY. Connects to DATABASE_URL, re-checks idempotency for real
 *        (same (workspaceId, action, entityType, entityId) composite key
 *        the runners themselves guard on — no DB-level unique constraint
 *        exists on audit_logs, this is an application-level check only,
 *        same limitation Round 1 carried), and INSERTs (never UPDATEs — an
 *        existing row at that key is left untouched and skipped). Requires
 *        a context that can reach DATABASE_URL (this repo's `pg` Railway
 *        service has no public TCP proxy — APPLY must run from inside
 *        Railway, e.g. `ssh railway-api`, same as Round 1's execution
 *        environment). DO NOT RUN without Elva's explicit go-ahead.
 *
 * Inputs (all already committed in this repo, read-only unless overridden
 * via the env vars above):
 *   reports/sim_go_live_20260723/evidence/orders_20260723.jsonl              (Batch A, 53 lines — 45 v51 + 8 v34, only v51 used here)
 *   reports/sim_go_live_20260723/evidence/reconcile_53_orders_20260723.json  (Batch A ground truth)
 *   reports/sim_go_live_20260723/evidence/orders_20260724_residual.jsonl     (Batch B, 28 lines)
 *   reports/sim_go_live_20260723/evidence/trades_manual_0724.json            (Batch B ground truth)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import { auditLogs, getDb, isDatabaseMode, workspaces } from "@iuf-trading-room/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const EVIDENCE_DIR = path.join(REPO_ROOT, "reports/sim_go_live_20260723/evidence");

const BATCH_A_ORDERS_JSONL = path.join(EVIDENCE_DIR, "orders_20260723.jsonl");
const BATCH_A_RECONCILE_JSON = path.join(EVIDENCE_DIR, "reconcile_53_orders_20260723.json");
const BATCH_B_ORDERS_JSONL = process.env.RESIDUAL_ORDERS_FILE ?? path.join(EVIDENCE_DIR, "orders_20260724_residual.jsonl");
const BATCH_B_TRADES_JSON = process.env.RESIDUAL_TRADES_FILE ?? path.join(EVIDENCE_DIR, "trades_manual_0724.json");

const BATCH_A_ENTITY_ID = "2026-07-13:adhoc-20260723";
const BATCH_B_ENTITY_ID = "2026-07-24:adhoc-resend";

const APPLY = process.env.APPLY === "true";

// ---------------------------------------------------------------------------
// Batch A — 2026-07-23 v51 45-order re-derivation (identical logic to
// Round 1's sim-go-live-audit-backfill-20260723.ts; only the entityId used
// for the row it produces differs).
// ---------------------------------------------------------------------------

type BatchASentOrder = {
  ts: string;
  sleeve: "v51_c1" | "v51_c3" | "v34_c3_proxy";
  symbol: string;
  shares: number;
  trade_id: string | null;
  error: string | null;
};

type BatchAReconcileRow = {
  sleeve: string;
  symbol: string;
  kgi_order_id: string | null;
  kgi_status: "Filled" | "PartFilled" | "Submitted" | "INVALID_REJECTED" | "AMBIGUOUS_DUP_SYMBOL_NO_DISTINCT_RECORD";
};

export type V51ResultBackfill = {
  stockId: string;
  shares: number;
  status: string;
  tradeId: string | null;
  error: string | null;
  /** Additive, non-breaking (payload is jsonb) — provenance, see Round 1. */
  sleeve: "v51_c1" | "v51_c3";
  kgiOrderId: string | null;
};

/** Ground-truth kgi_status -> KgiOrderLifecycleStatus (kgi-order-reconciliation.ts's enum). Identical to Round 1's mapStatus(). */
function mapBatchAStatus(kgiStatus: BatchAReconcileRow["kgi_status"]): { status: string; error: string | null } {
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

export async function buildBatchAV51Report(
  ordersFile = BATCH_A_ORDERS_JSONL,
  reconcileFile = BATCH_A_RECONCILE_JSON,
) {
  const [ordersText, reconcileRaw] = await Promise.all([
    fs.readFile(ordersFile, "utf8"),
    fs.readFile(reconcileFile, "utf8"),
  ]);
  const orders: BatchASentOrder[] = ordersText
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const reconcile: BatchAReconcileRow[] = (JSON.parse(reconcileRaw) as { results: BatchAReconcileRow[] }).results;

  if (orders.length !== reconcile.length) {
    throw new Error(`orders_20260723.jsonl has ${orders.length} rows but reconcile_53_orders_20260723.json has ${reconcile.length} — expected same count/order. Aborting.`);
  }

  const v51Results: V51ResultBackfill[] = [];
  const submittedTimestamps: string[] = [];
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const r = reconcile[i];
    if (r.symbol !== o.symbol || r.sleeve !== o.sleeve) {
      throw new Error(`Row ${i} mismatch: orders has sleeve=${o.sleeve} symbol=${o.symbol} but reconcile has sleeve=${r.sleeve} symbol=${r.symbol}. Aborting.`);
    }
    if (o.sleeve === "v34_c3_proxy") continue; // Batch A row here is v51-only; v34's 2026-07-21 row already inserted successfully in Round 1, no action needed.
    const { status, error } = mapBatchAStatus(r.kgi_status);
    submittedTimestamps.push(o.ts);
    v51Results.push({
      stockId: o.symbol,
      shares: o.shares,
      status,
      tradeId: o.trade_id,
      error: error ?? o.error ?? null,
      sleeve: o.sleeve,
      kgiOrderId: r.kgi_order_id,
    });
  }

  const c1Count = v51Results.filter((r) => r.sleeve === "v51_c1").length;
  const c3Count = v51Results.filter((r) => r.sleeve === "v51_c3").length;

  return {
    schema: "v51_order_submit_v1" as const,
    label: "SIM_EXECUTION_SAMPLE_NOT_VALIDATED" as const,
    basketSignalDate: "2026-07-13",
    entryDateTst: "2026-07-23",
    submittedAtTst: submittedTimestamps.sort()[0] ?? null,
    capitalTwd: 6_000_000,
    results: v51Results,
    failsafeNotes: [
      `round2_distinct_entityid_backfill: this row uses entityId="${BATCH_A_ENTITY_ID}" (NOT the bare basketSignalDate "2026-07-13") because that entityId is already permanently occupied by a REAL v51-sim-basket-runner.ts submission row (2026-07-14T00:26Z) — see reports/sim_go_live_20260723/evidence/AUDIT_BACKFILL_APPLY_20260723.md for the full incident. This row is an ad-hoc backfill of orders originally sent via reports/sim_go_live_20260723/send_three_sleeve.mjs, constructed by apps/api/src/sim-go-live-audit-backfill-round2-20260724.ts at ${new Date().toISOString()} from evidence/orders_20260723.jsonl + evidence/reconcile_53_orders_20260723.json.`,
      `merged_two_sleeves: v51_c1 (${c1Count} orders) + v51_c3 (${c3Count} orders), both source CSVs carry signal_date=2026-07-13 — merged into one row, same judgment call as Round 1 (see that script's KNOWN ISSUE #1).`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Batch B — 2026-07-24 residual re-send (28 orders, 2 phases).
// ---------------------------------------------------------------------------

type ResidualSentOrder = {
  ts: string;
  phase: "phase1" | "phase2";
  sleeve: "v51_c1" | "v51_c3" | "v34_c3_proxy";
  symbol: string;
  shares: number;
  price: number;
  trade_id: string | null;
};

type TradesManualBucketEntry = {
  order: { order_id: string; symbol: string; quantity: number; price: number };
  order_status: { status: "Filled" | "PartFilled" | "Submitted" | null; deals: Array<{ quantity: number | null }> };
};

const INVALID_BUCKET_KEY = "無效單";

function priceKey(symbol: string, price: number): string {
  return `${symbol}|${price.toFixed(2)}`;
}

async function loadResidualOrders(file = BATCH_B_ORDERS_JSONL): Promise<ResidualSentOrder[]> {
  const text = await fs.readFile(file, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

type ResidualGroundTruth = {
  rejected: Set<string>;
  byKey: Map<string, { status: "Filled" | "PartFilled" | "Submitted"; filledQtyLots: number; kgiOrderId: string }>;
};

export async function loadResidualGroundTruth(file = BATCH_B_TRADES_JSON): Promise<ResidualGroundTruth> {
  const raw = JSON.parse(await fs.readFile(file, "utf8")) as { trades: Record<string, TradesManualBucketEntry | TradesManualBucketEntry[]> };
  const rejected = new Set<string>();
  const byKey: ResidualGroundTruth["byKey"] = new Map();
  for (const [bucketKey, bucket] of Object.entries(raw.trades)) {
    if (bucketKey === INVALID_BUCKET_KEY) {
      const list = Array.isArray(bucket) ? bucket : [bucket];
      for (const item of list) rejected.add(priceKey(item.order.symbol, item.order.price));
      continue;
    }
    const entry = Array.isArray(bucket) ? bucket[0] : bucket;
    if (!entry?.order_status.status) continue;
    const filledQtyLots = (entry.order_status.deals ?? []).reduce((sum, d) => sum + (d.quantity ?? 0), 0);
    byKey.set(priceKey(entry.order.symbol, entry.order.price), {
      status: entry.order_status.status,
      filledQtyLots,
      kgiOrderId: entry.order.order_id,
    });
  }
  return { rejected, byKey };
}

export function resolveResidualStatus(
  order: Pick<ResidualSentOrder, "symbol" | "price">,
  gt: ResidualGroundTruth,
): { status: string; error: string | null; kgiOrderId: string | null } {
  const key = priceKey(order.symbol, order.price);
  if (gt.rejected.has(key)) {
    return {
      status: "rejected",
      error: "kgi_invalid_order_bucket (無效單, order_id=0000) — same INVALID_REJECTED classification convention as Round 1's 7/23 batch, see trades_manual_0724.json",
      kgiOrderId: null,
    };
  }
  const match = gt.byKey.get(key);
  if (!match) {
    return {
      status: "unconfirmed",
      error: `no_matching_order_id_bucket_for_symbol_price: no Filled/PartFilled/Submitted bucket and no invalid-bucket entry at symbol=${order.symbol} price=${order.price} in the ground-truth trades file`,
      kgiOrderId: null,
    };
  }
  if (match.status === "Filled") return { status: "filled", error: null, kgiOrderId: match.kgiOrderId };
  if (match.status === "PartFilled") return { status: "partially_filled", error: null, kgiOrderId: match.kgiOrderId };
  // "Submitted" — order accepted at gateway, unfilled, un-cancelled (no cancel/amend endpoint exists).
  return { status: "accepted", error: null, kgiOrderId: match.kgiOrderId };
}

type ResidualResultBackfill = {
  stockId: string;
  shares: number;
  status: string;
  tradeId: string | null;
  error: string | null;
  sleeve: "v51_c1" | "v51_c3" | "v34_c3_proxy";
  /** Additive, non-breaking — see PHASE1/PHASE2 SAME-SYMBOL HANDLING above. */
  phase: "phase1" | "phase2";
  kgiOrderId: string | null;
};

export async function buildResidualResults(
  ordersFile = BATCH_B_ORDERS_JSONL,
  tradesFile = BATCH_B_TRADES_JSON,
): Promise<{ orders: ResidualSentOrder[]; results: ResidualResultBackfill[] }> {
  const [orders, gt] = await Promise.all([loadResidualOrders(ordersFile), loadResidualGroundTruth(tradesFile)]);
  const results: ResidualResultBackfill[] = orders.map((o) => {
    const { status, error, kgiOrderId } = resolveResidualStatus(o, gt);
    return {
      stockId: o.symbol,
      shares: o.shares,
      status,
      tradeId: o.trade_id,
      error,
      sleeve: o.sleeve,
      phase: o.phase,
      kgiOrderId,
    };
  });
  return { orders, results };
}

function buildResidualV51Report(orders: ResidualSentOrder[], results: ResidualResultBackfill[]) {
  const v51Results = results.filter((r) => r.sleeve !== "v34_c3_proxy");
  const v51Orders = orders.filter((o) => o.sleeve !== "v34_c3_proxy");
  return {
    schema: "v51_order_submit_v1" as const,
    label: "SIM_EXECUTION_SAMPLE_NOT_VALIDATED" as const,
    basketSignalDate: "2026-07-13",
    entryDateTst: "2026-07-24",
    submittedAtTst: v51Orders.map((o) => o.ts).sort()[0] ?? null,
    capitalTwd: 6_000_000,
    results: v51Results,
    failsafeNotes: [
      `backfilled_from_ad_hoc_tool: orders originally submitted via reports/sim_go_live_20260723/resend_residual_20260724.mjs (standalone RUNBOOK tool, does not write audit_logs); this row constructed by apps/api/src/sim-go-live-audit-backfill-round2-20260724.ts at ${new Date().toISOString()} from evidence/orders_20260724_residual.jsonl + evidence/trades_manual_0724.json (see script header for the (symbol, price) join-key methodology).`,
      `capitalTwd_is_the_sleeve_constant_not_this_batchs_notional: this row covers only the ${v51Results.length} v51 residual (gap-fill/retry) order attempts from 2026-07-24's re-send — a SUBSET of the original 2026-07-23 v51 45-order submission, not a fresh full 6,000,000 TWD allocation.`,
      `phase1_phase2_kept_as_separate_result_entries: symbols retried in phase2 (marketable-limit requote; no cancel/amend endpoint exists so phase2 is always a new stacked order, not a replacement) appear as TWO result entries distinguished by the additive phase field — see script header "PHASE1/PHASE2 SAME-SYMBOL HANDLING".`,
    ],
  };
}

function buildResidualV34Report(orders: ResidualSentOrder[], results: ResidualResultBackfill[]) {
  const v34Results = results.filter((r) => r.sleeve === "v34_c3_proxy");
  const v34Orders = orders.filter((o) => o.sleeve === "v34_c3_proxy");
  return {
    schema: "v34_order_submit_v1" as const,
    label: "SIM_EXECUTION_SAMPLE_NOT_VALIDATED" as const,
    basketAsOfDate: "2026-07-21",
    entryDateTst: "2026-07-24",
    submittedAtTst: v34Orders.map((o) => o.ts).sort()[0] ?? null,
    capitalTwd: 1_000_000,
    results: v34Results.map((r) => ({
      stockId: r.stockId,
      shares: r.shares,
      isOddLot: false,
      executedNotionalTwd: null, // avg fill price not available in ground-truth file for this batch; same "null when unfilled/unknown" convention as Round 1.
      status: r.status,
      tradeId: r.tradeId,
      error: r.error,
      phase: r.phase,
      kgiOrderId: r.kgiOrderId,
    })),
    failsafeNotes: [
      `backfilled_from_ad_hoc_tool: orders originally submitted via reports/sim_go_live_20260723/resend_residual_20260724.mjs (standalone RUNBOOK tool, does not write audit_logs); this row constructed by apps/api/src/sim-go-live-audit-backfill-round2-20260724.ts at ${new Date().toISOString()} from evidence/orders_20260724_residual.jsonl + evidence/trades_manual_0724.json.`,
      `capitalTwd_is_the_sleeve_constant_not_this_batchs_notional: this row covers only the ${v34Results.length} v34 residual order attempts from 2026-07-24's re-send.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// APPLY — insert-only, per-row idempotency re-check. Identical pattern to
// Round 1 (no DB-level unique constraint on audit_logs exists — this is an
// application-level check only, same pre-existing limitation Round 1 had).
// ---------------------------------------------------------------------------

/** Minimal interface so the insert-with-idempotency-check logic is unit-testable without a real Postgres connection (see test file). */
export interface AuditRowInsertClient {
  selectExisting(key: { workspaceId: string; action: string; entityType: string; entityId: string }): Promise<Array<{ id: string }>>;
  insertRow(row: { workspaceId: string; action: string; entityType: string; entityId: string; payload: unknown }): Promise<Array<{ id: string }>>;
}

export async function insertRowIfAbsent(
  client: AuditRowInsertClient,
  row: { workspaceId: string; action: string; entityType: string; entityId: string; payload: unknown },
): Promise<{ inserted: boolean; id: string | null }> {
  const existing = await client.selectExisting(row);
  if (existing.length > 0) {
    console.log(`[apply] SKIP (row already exists, never overwriting): action=${row.action} entityId=${row.entityId} id=${existing[0].id}`);
    return { inserted: false, id: existing[0].id };
  }
  const inserted = await client.insertRow(row);
  console.log(`[apply] INSERTED action=${row.action} entityId=${row.entityId} id=${inserted[0]?.id}`);
  return { inserted: true, id: inserted[0]?.id ?? null };
}

async function main() {
  const [batchAV51Report, { orders: residualOrders, results: residualResults }] = await Promise.all([
    buildBatchAV51Report(),
    buildResidualResults(),
  ]);
  const residualV51Report = buildResidualV51Report(residualOrders, residualResults);
  const residualV34Report = buildResidualV34Report(residualOrders, residualResults);

  const statusBreakdown = (results: Array<{ status: string }>) => {
    const out: Record<string, number> = {};
    for (const r of results) out[r.status] = (out[r.status] ?? 0) + 1;
    return out;
  };

  console.log(`[backfill-r2] Batch A (7/23 v51): ${batchAV51Report.results.length} results, ${JSON.stringify(statusBreakdown(batchAV51Report.results))}`);
  console.log(`[backfill-r2] Batch B v51 (7/24 residual): ${residualV51Report.results.length} results, ${JSON.stringify(statusBreakdown(residualV51Report.results))}`);
  console.log(`[backfill-r2] Batch B v34 (7/24 residual): ${residualV34Report.results.length} results, ${JSON.stringify(statusBreakdown(residualV34Report.results))}`);

  const rows = [
    { action: "v51_sim.order_submit", entityType: "v51_sim", entityId: BATCH_A_ENTITY_ID, payload: batchAV51Report },
    { action: "v51_sim.order_submit", entityType: "v51_sim", entityId: BATCH_B_ENTITY_ID, payload: residualV51Report },
    { action: "v34_sim.order_submit", entityType: "v34_sim", entityId: BATCH_B_ENTITY_ID, payload: residualV34Report },
  ];

  if (!APPLY) {
    const outFile = path.join(EVIDENCE_DIR, `audit_backfill_round2_dry_run_${Date.now()}.json`);
    await fs.writeFile(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), mode: "dry_run", rows }, null, 2));
    console.log(`[dry-run] wrote ${outFile}`);
    console.log(`[dry-run] would insert ${rows.length} audit_logs row(s):`);
    for (const r of rows) {
      console.log(`[dry-run]   action=${r.action} entityType=${r.entityType} entityId=${r.entityId} results=${(r.payload as { results: unknown[] }).results.length}`);
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

  const client: AuditRowInsertClient = {
    async selectExisting(key) {
      return db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(and(eq(auditLogs.workspaceId, key.workspaceId), eq(auditLogs.action, key.action), eq(auditLogs.entityType, key.entityType), eq(auditLogs.entityId, key.entityId)))
        .limit(1);
    },
    async insertRow(row) {
      return db
        .insert(auditLogs)
        .values({ workspaceId: row.workspaceId, actorId: null, action: row.action, entityType: row.entityType, entityId: row.entityId, payload: row.payload as Record<string, unknown> })
        .returning({ id: auditLogs.id });
    },
  };

  for (const r of rows) {
    await insertRowIfAbsent(client, { workspaceId, action: r.action, entityType: r.entityType, entityId: r.entityId, payload: r.payload });
  }
}

// Only run main() when executed directly (not when imported for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("[backfill-r2] fatal error:", e instanceof Error ? e.stack ?? e.message : String(e));
    process.exitCode = 1;
  });
}
