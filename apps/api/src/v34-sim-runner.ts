/**
 * v34-sim-runner.ts — V3-4 Lab→TR SIM shakedown execution basket → KGI SIM order submit
 *
 * Contract: IUF_SHARED_CONTRACTS/lab_to_tr_v34_sim_shakedown_contract_2026_07_14_v1.md
 * Elva sign-off: 2026-07-14. Yang order: "這週就能跑能上線的策略" (2026-07-14 chat).
 *
 * What this is:
 *   - A ONE-TIME Lab-produced execution shakedown basket (9 names, equal
 *     weight, 10,000,000 TWD notional, market/open order at next trading day
 *     open) — the second parallel SIM execution track alongside V5-1
 *     (v51-sim-basket-runner.ts). NOT a monthly schedule; V3-4's real forward
 *     formation track (v34m) starts 2026-08-03 separately per contract.
 *   - SIM ONLY. label SIM_EXECUTION_SAMPLE_NOT_VALIDATED must pass through
 *     verbatim to every audit record and result JSON — never softened.
 *   - ⚠️ L9 note (per contract): V3-4 is an L9 P2-degraded candidate (post-hoc
 *     significance vs 0050 did not survive correction). This basket is a pure
 *     execution-chain shakedown — it does NOT start V3-4's forward gate clock
 *     and does NOT consume a forward trial. It must never be described as
 *     "validated" or "approved" anywhere downstream.
 *   - Basket schema is DIFFERENT from V5-1's (9 columns incl. gh/days_since_high/
 *     wm60_twd/last_close, vs V5-1's 6 columns) — this module has its own
 *     independent parser/validator, not a reuse of parseV51BasketCsv.
 *   - Unlike V5-1, per-row `signal_date` in this basket is NOT uniform (fresh
 *     oos_prices window 2026-07-09..2026-07-14 per contract §1) — some names
 *     were re-scored later in the window than others. The basket's entry
 *     event date is therefore derived from the CSV **file name** (the
 *     shakedown "as-of" date), not from an aggregate over row signal_dates.
 *   - Order execution reuses the same direct KGI SIM gateway mechanics as
 *     V5-1 (KgiGatewayClient login/setAccount/createOrder/retry/reconcile) —
 *     see v51-sim-basket-runner.ts submitV51BasketOrders() for the precedent
 *     this module's submit loop mirrors. This module writes its own audit
 *     action/entityType ("v34_sim.order_submit" / "v34_sim") and never
 *     touches the F-AUTO ledger, unified-order-store, or trading-service.ts —
 *     the same "separate execution rail, not the F-AUTO order flow" isolation
 *     V5-1 already relies on (no symbol-based filtering needed; isolation is
 *     structural, by strategy/batch tag = a completely distinct audit/report
 *     namespace, not shared tables).
 *
 * Hard lines:
 *   - Basket file absent, or schema not exactly matching v1 (9 columns, exact
 *     header order) → fail-closed. Never substitute alternate data.
 *   - label column must equal V34_LABEL verbatim on every row, else fail-closed.
 *   - planned_entry column must equal V34_PLANNED_ENTRY verbatim on every row.
 *   - KGI subscription cap (40, shared account-wide resource): this basket's
 *     9 names + the 31 slots already reserved by V5-1 (30 names + 0050) must
 *     not exceed the cap → fail-closed if it would (contract-confirmed
 *     arithmetic: 9 + 31 = 40, zero overlap verified at Elva sign-off).
 *   - SIM only. Does not touch trading-service.ts / kgi-sim-env.ts /
 *     execution-mode.ts / risk-engine.ts (real-money lock files).
 *   - TR does not modify basket generation logic (Lab-side
 *     v34_sim_shakedown_basket_v1.py commit is authoritative).
 *
 * Not implemented here (tracked as follow-up, see contract "加分項"):
 *   - Fill-report round-trip back to Lab.
 *   - Auto close-out scheduling at the 60-trading-day holding mark (TODO
 *     below — this module only covers the entry leg, as instructed).
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq } from "drizzle-orm";
import { auditLogs, getDb, isDatabaseMode, workspaces } from "@iuf-trading-room/db";
import { getLastCloses } from "./quote-last-close-store.js";
import {
  extractKgiTradeId,
  reconcileKgiOrder,
  reconcileUnconfirmedAuditOrders,
  type KgiOrderLifecycleStatus,
} from "./broker/kgi-order-reconciliation.js";
import { toKgiOrderQty } from "./broker/kgi-contract-rules.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Mandatory label per contract — must appear verbatim on every basket row. */
export const V34_LABEL = "SIM_EXECUTION_SAMPLE_NOT_VALIDATED" as const;

/** Mandatory planned_entry value per contract. */
export const V34_PLANNED_ENTRY = "next_trading_day_open" as const;

/** Schema v1 — exact column order, no variance accepted (fail-closed otherwise). */
export const V34_EXPECTED_HEADERS = [
  "stock_id",
  "signal_date",
  "gh",
  "days_since_high",
  "wm60_twd",
  "last_close",
  "label",
  "weight",
  "planned_entry",
] as const;

export const V34_CAPITAL_TWD = 10_000_000;

/** KGI 新星 subscription cap, shared account-wide resource (2 conn x 20). */
export const V34_KGI_SUBSCRIPTION_CAP = 40;

/**
 * Slots already reserved by the V5-1 basket track (30 names + 0050 benchmark
 * = 31), per contract-confirmed cap arithmetic at Elva sign-off (2026-07-14):
 * "V5-1 30＋0050＋v34 9＝40 整". Verified zero symbol overlap between the two
 * baskets at sign-off. This is a static accounting constant, not a live
 * cross-module symbol union — if V5-1's basket composition changes, both
 * sides have separately committed (per contract) to re-verify the cap before
 * adding further symbols on either track.
 */
export const V34_RESERVED_SLOTS_OTHER_TRACKERS = 31;

const V34_AUDIT_ACTION = "v34_sim.order_submit";
const V34_AUDIT_ENTITY_TYPE = "v34_sim";

/**
 * In-memory in-flight guard for runV34OrderSubmitTick(), set synchronously
 * before any `await` — mirrors v51-sim-basket-runner.ts's
 * `_v51OrderSubmitLastFiredDate` pattern (closes the overlapping-setInterval-
 * tick double-submission race documented in PR #1247 review, blocker 1). The
 * `audit_logs` idempotency check remains the guard that survives a redeploy;
 * this in-memory guard resets to "" on process restart.
 */
let _v34OrderSubmitLastFiredDate = "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface V34BasketRow {
  stockId: string;
  signalDate: string;
  gh: number;
  daysSinceHigh: number;
  wm60Twd: number;
  lastClose: number;
  label: string;
  weight: number;
  plannedEntry: string;
}

export interface V34Basket {
  schema: "v34_sim_shakedown_basket_v1";
  sourceFile: string;
  /** As-of date parsed from the CSV file name (entry-event anchor). */
  asOfDate: string;
  rows: V34BasketRow[];
}

export type V34ParseResult =
  | { ok: true; basket: V34Basket }
  | { ok: false; error: string };

export interface V34CapCheckResult {
  ok: boolean;
  count: number;
  symbols: string[];
  error?: string;
}

export interface V34SizedEntry {
  stockId: string;
  targetNotionalTwd: number;
  lastClosePrice: number | null;
  targetShares: number;
  /** True when targetShares is a Taiwan odd-lot (零股, 1-999 shares) order —
   * i.e. the per-name budget could not afford a single 1000-share board lot.
   * See computeV34OrderSizing doc (Pete review, PR #1268) for why this exists. */
  isOddLot: boolean;
  sizingNote: string;
}

export interface V34OrderResult {
  stockId: string;
  shares: number;
  /** True when `shares` was placed as a Taiwan odd-lot (零股) order. */
  isOddLot: boolean;
  /** shares * lastClosePrice at sizing time — actual notional committed for
   * this name, so the audit/report can reconcile back to the 10M contracted
   * notional even when a name entered as an odd lot below the equal-weight
   * target (Pete review, PR #1268). */
  executedNotionalTwd: number | null;
  status: KgiOrderLifecycleStatus | "skipped";
  tradeId: string | null;
  error: string | null;
}

export interface V34OrderSubmitReport {
  schema: "v34_order_submit_v1";
  label: typeof V34_LABEL;
  basketAsOfDate: string;
  entryDateTst: string;
  submittedAtTst: string;
  capitalTwd: number;
  results: V34OrderResult[];
  failsafeNotes: string[];
}

// ---------------------------------------------------------------------------
// CSV parse + schema validation (fail-closed)
// ---------------------------------------------------------------------------

/**
 * Parse and strictly validate a V3-4 shakedown basket CSV. Fail-closed on any
 * deviation from schema v1 — this is the ingestion gate that guards the
 * entire pipeline. Unlike V5-1's parser, this does NOT require a uniform
 * signal_date across rows (see module doc — fresh oos_prices window spans
 * 2026-07-09..2026-07-14 by design).
 */
export function parseV34BasketCsv(csvText: string, sourceFile: string, asOfDate: string): V34ParseResult {
  // Strip UTF-8 BOM defensively (Lab csv writers have emitted utf-8-sig before).
  const normalized = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { ok: false, error: "empty_or_header_only_csv" };
  }

  const header = lines[0].split(",").map((h) => h.trim());
  const headerMatches =
    header.length === V34_EXPECTED_HEADERS.length &&
    V34_EXPECTED_HEADERS.every((expected, i) => header[i] === expected);
  if (!headerMatches) {
    return {
      ok: false,
      error: `schema_mismatch: expected [${V34_EXPECTED_HEADERS.join(",")}] got [${header.join(",")}]`,
    };
  }

  const rows: V34BasketRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length !== V34_EXPECTED_HEADERS.length) {
      return {
        ok: false,
        error: `row_${i}_column_count_mismatch: expected ${V34_EXPECTED_HEADERS.length} got ${cols.length}`,
      };
    }
    const [stockId, signalDate, ghStr, daysSinceHighStr, wm60Str, lastCloseStr, label, weightStr, plannedEntry] =
      cols.map((c) => c.trim());

    if (!stockId) {
      return { ok: false, error: `row_${i}_missing_stock_id` };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(signalDate)) {
      return { ok: false, error: `row_${i}_invalid_signal_date: "${signalDate}"` };
    }
    const gh = Number(ghStr);
    if (!Number.isFinite(gh)) {
      return { ok: false, error: `row_${i}_invalid_gh: "${ghStr}"` };
    }
    const daysSinceHigh = Number(daysSinceHighStr);
    if (!Number.isInteger(daysSinceHigh) || daysSinceHigh < 0) {
      return { ok: false, error: `row_${i}_invalid_days_since_high: "${daysSinceHighStr}"` };
    }
    const wm60Twd = Number(wm60Str);
    if (!Number.isFinite(wm60Twd) || wm60Twd <= 0) {
      return { ok: false, error: `row_${i}_invalid_wm60_twd: "${wm60Str}"` };
    }
    const lastClose = Number(lastCloseStr);
    if (!Number.isFinite(lastClose) || lastClose <= 0) {
      return { ok: false, error: `row_${i}_invalid_last_close: "${lastCloseStr}"` };
    }
    if (label !== V34_LABEL) {
      return { ok: false, error: `row_${i}_label_mismatch: expected "${V34_LABEL}" got "${label}"` };
    }
    const weight = Number(weightStr);
    if (!Number.isFinite(weight) || weight <= 0) {
      return { ok: false, error: `row_${i}_invalid_weight: "${weightStr}"` };
    }
    if (plannedEntry !== V34_PLANNED_ENTRY) {
      return { ok: false, error: `row_${i}_unexpected_planned_entry: "${plannedEntry}"` };
    }

    rows.push({
      stockId,
      signalDate,
      gh,
      daysSinceHigh,
      wm60Twd,
      lastClose,
      label,
      weight,
      plannedEntry,
    });
  }

  if (rows.length === 0) {
    return { ok: false, error: "no_data_rows" };
  }

  return {
    ok: true,
    basket: { schema: "v34_sim_shakedown_basket_v1", sourceFile, asOfDate, rows },
  };
}

// ---------------------------------------------------------------------------
// File resolution — mirrors v51-sim-basket-runner.ts dual-path pattern
// ---------------------------------------------------------------------------

const _fileDir = fileURLToPath(new URL(".", import.meta.url));

/** apps/api/src → ../../.. → monorepo root */
function monorepoRoot(): string {
  return join(_fileDir, "..", "..", "..");
}

/** Embedded copy directory (prod / Railway — CSV committed into TR repo). */
function embeddedBasketDir(): string {
  return join(monorepoRoot(), "data", "lab", "sim_baskets");
}

/** Dev sibling directory — direct read from Lab repo local disk. */
function labSiblingBasketDir(): string {
  return join(monorepoRoot(), "..", "IUF_QUANT_LAB", "research", "forward_track", "sim_baskets");
}

function basketFileName(asOfDate: string): string {
  return `v34_sim_shakedown_basket_${asOfDate}.csv`;
}

/**
 * Read + validate the shakedown basket for a given as-of date. Tries the
 * embedded (deploy-bundled) path first, then the local dev sibling-repo path.
 * Never fabricates data on read failure — always returns an explicit error.
 */
export async function readV34BasketForDate(asOfDate: string): Promise<V34ParseResult> {
  const candidates = [
    join(embeddedBasketDir(), basketFileName(asOfDate)),
    join(labSiblingBasketDir(), basketFileName(asOfDate)),
  ];
  for (const path of candidates) {
    try {
      const raw = await fs.readFile(path, "utf-8");
      return parseV34BasketCsv(raw, path, asOfDate);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      return { ok: false, error: `read_error:${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return { ok: false, error: "basket_file_not_found" };
}

/** List as-of dates for all shakedown basket CSVs present in the embedded directory. */
export async function listEmbeddedV34BasketAsOfDates(): Promise<string[]> {
  try {
    const files = await fs.readdir(embeddedBasketDir());
    return files
      .filter((f) => /^v34_sim_shakedown_basket_\d{4}-\d{2}-\d{2}\.csv$/.test(f))
      .map((f) => f.replace(/^v34_sim_shakedown_basket_/, "").replace(/\.csv$/, ""));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// KGI subscription cap check (fail-closed)
// ---------------------------------------------------------------------------

/**
 * Cap check for the shared KGI 新星 subscription resource (40 total,
 * account-wide), accounting for the 31 slots already reserved by the
 * parallel V5-1 basket track (see V34_RESERVED_SLOTS_OTHER_TRACKERS doc).
 * Fail-closed if the count would exceed the cap — this module never
 * silently truncates a basket to fit under cap.
 */
export function checkV34KgiSubscriptionCap(basket: V34Basket): V34CapCheckResult {
  const symbols = Array.from(new Set(basket.rows.map((r) => r.stockId)));
  const totalWithReserved = symbols.length + V34_RESERVED_SLOTS_OTHER_TRACKERS;
  if (totalWithReserved > V34_KGI_SUBSCRIPTION_CAP) {
    return {
      ok: false,
      count: totalWithReserved,
      symbols,
      error: `subscription_cap_exceeded: ${symbols.length} + ${V34_RESERVED_SLOTS_OTHER_TRACKERS} reserved = ${totalWithReserved} > ${V34_KGI_SUBSCRIPTION_CAP}`,
    };
  }
  return { ok: true, count: totalWithReserved, symbols };
}

// ---------------------------------------------------------------------------
// Order sizing — equal weight, 10M notional, board-lot preferred / odd-lot fallback
// ---------------------------------------------------------------------------

/** Round down to nearest 1000-share board lot (mirrors v51-sim-basket-runner.ts convention). */
function roundDownBoardLot(shares: number): number {
  return Math.floor(shares / 1000) * 1000;
}

/** Taiwan odd-lot (零股) orders allow 1-999 shares — never a full board lot. */
const ODD_LOT_MAX_SHARES = 999;

/**
 * Compute per-name target notional (equal weight over the whole basket) and
 * target shares from DB last-close prices (fresher than the CSV's own
 * last_close snapshot column, which is only used for schema
 * validation/reference above).
 *
 * Board-lot preferred, odd-lot (零股) fallback (2026-07-14, Pete review PR
 * #1268 finding + Elva ruling): with 9 names at equal ~1.111M TWD each, 4 of
 * the 9 real basket prices (2330 @2415, 8046 @1215, 6223 @7080, 6488 @1350)
 * cannot afford a single 1000-share board lot — the OLD floor-to-nearest-
 * 1000 logic silently rounded these to 0 shares, meaning only 5/9 names and
 * ~49.5% of the contracted notional would actually enter tomorrow (violates
 * the contract's "9 檔等權" intent, silently). Fix: when the raw share count
 * is below one board lot, place the maximum affordable ODD-lot order
 * (1-999 shares, `isOddLot: true`) instead of rounding to 0 — every name
 * still enters, each at close to its equal-weight target notional. Symbols
 * whose budget affords >= 1000 shares are unaffected (still floor-to-
 * nearest-1000, isOddLot: false), matching V5-1's original convention.
 *
 * Symbols with no available DB last close are sized to 0 shares with an
 * explicit skip note — never silently treated as a valid zero-cost fill.
 */
export function computeV34OrderSizing(
  basket: V34Basket,
  lastCloses: Map<string, { closePrice: number }>,
  capitalTwd: number = V34_CAPITAL_TWD
): V34SizedEntry[] {
  const perNameTargetTwd = capitalTwd / basket.rows.length;
  return basket.rows.map((row) => {
    const close = lastCloses.get(row.stockId);
    if (!close || !Number.isFinite(close.closePrice) || close.closePrice <= 0) {
      return {
        stockId: row.stockId,
        targetNotionalTwd: perNameTargetTwd,
        lastClosePrice: null,
        targetShares: 0,
        isOddLot: false,
        sizingNote: "skipped_missing_last_close",
      };
    }
    const rawShares = perNameTargetTwd / close.closePrice;
    if (rawShares >= 1000) {
      const targetShares = roundDownBoardLot(rawShares);
      return {
        stockId: row.stockId,
        targetNotionalTwd: perNameTargetTwd,
        lastClosePrice: close.closePrice,
        targetShares,
        isOddLot: false,
        sizingNote: "ok",
      };
    }
    // Budget can't afford a full board lot — fall back to the maximum
    // affordable odd-lot order rather than silently rounding to 0 shares.
    const oddShares = Math.min(ODD_LOT_MAX_SHARES, Math.floor(rawShares));
    return {
      stockId: row.stockId,
      targetNotionalTwd: perNameTargetTwd,
      lastClosePrice: close.closePrice,
      targetShares: oddShares,
      isOddLot: true,
      sizingNote: oddShares > 0 ? "ok_odd_lot" : "sub_odd_lot_rounds_to_zero",
    };
  });
}

// ---------------------------------------------------------------------------
// Entry-date + window helpers
// ---------------------------------------------------------------------------

/** Next weekday (Mon-Fri) after a given ISO date, UTC-safe (no TW holiday calendar
 *  dependency — matches existing v51-sim-basket-runner.ts window convention). */
export function nextWeekdayIso(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

function taipeiDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function taipeiHHMM(): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return parseInt(fmt.replace(":", ""), 10);
}

/** Weekday 08:20-08:40 TST — same window as V5-1, right after the KGI EC2 gateway opens. */
export function isV34OrderSubmitWindow(): boolean {
  const hhmm = taipeiHHMM();
  const taipeiMs = Date.now() + 8 * 3600 * 1000;
  const day = new Date(taipeiMs).getUTCDay();
  return day >= 1 && day <= 5 && hhmm >= 820 && hhmm < 840;
}

/** Railway volume-mount path for persistent reports (mirrors v51-sim-basket-runner.ts). */
function reportsBase(): string {
  const mount = process.env["RAILWAY_VOLUME_MOUNT_PATH"] ?? process.env["DATA_DIR"] ?? "runtime-data";
  return join(mount, "trading_room");
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Best-effort persistence of the human-readable report JSON. This runs after
 * orders have already been submitted to KGI SIM, so a failure here must never
 * propagate — if it did, the caller's catch block would release the
 * in-memory order-submit guard with no audit_logs row written, and the next
 * tick would re-submit the entire already-filled basket (same residual gap
 * V5-1 fixed per PR #1247 review). The failure is recorded in
 * `failsafeNotes` (same array reference used to build the report that's
 * about to be audit-logged) so it's still visible. Exported for direct
 * testing of this failure-tolerance contract.
 */
export async function _v34WriteReportJsonBestEffort(
  path: string,
  data: unknown,
  failsafeNotes: string[]
): Promise<void> {
  try {
    await writeJson(path, data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[v34-sim] report JSON write failed for ${path} (non-fatal — audit record is still written): ${msg}`);
    failsafeNotes.push(`report_json_write_failed: ${msg}`);
  }
}

async function resolveWorkspaceId(): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .limit(1)
    .catch(() => [] as Array<{ id: string }>);
  return rows[0]?.id ?? null;
}

/**
 * Synchronous, awaits-free claim of today's order-submit slot. Returns true
 * (and marks the date as fired) if the caller may proceed; false if another
 * tick already claimed the same date. This is the first thing
 * runV34OrderSubmitTick() does, before any `await` — closing the same race
 * window V5-1 closed in PR #1247 review (blocker 1), where two overlapping
 * ticks could both pass the async `hasAlreadySubmitted()` DB check before
 * either finishes writing its audit record. Exported for direct testing.
 */
export function _v34ClaimOrderSubmitTickForDate(todayTst: string): boolean {
  if (_v34OrderSubmitLastFiredDate === todayTst) return false;
  _v34OrderSubmitLastFiredDate = todayTst;
  return true;
}

/**
 * Releases the in-memory guard, allowing a later tick within the same day to
 * retry. Used for known-transient failure paths (credentials not yet set,
 * gateway not yet reachable at the very start of the 08:20 window) — mirrors
 * v51-sim-basket-runner.ts's reset convention. Exported for test cleanup
 * between guard test cases.
 */
export function _v34ReleaseOrderSubmitGuard(): void {
  _v34OrderSubmitLastFiredDate = "";
}

/** Idempotency guard: has this basket's orders already been submitted? */
async function hasAlreadySubmitted(basketAsOfDate: string): Promise<boolean> {
  if (!isDatabaseMode()) return false;
  const db = getDb();
  if (!db) return false;
  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) return false;
  try {
    const rows = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.workspaceId, workspaceId),
          eq(auditLogs.action, V34_AUDIT_ACTION),
          eq(auditLogs.entityType, V34_AUDIT_ENTITY_TYPE),
          eq(auditLogs.entityId, basketAsOfDate)
        )
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    console.warn("[v34-sim] idempotency check failed (assuming not-yet-submitted):", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function writeAuditRecord(params: {
  basketAsOfDate: string;
  report: V34OrderSubmitReport;
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;
  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) return;
  try {
    await db.insert(auditLogs).values({
      workspaceId,
      actorId: null,
      action: V34_AUDIT_ACTION,
      entityType: V34_AUDIT_ENTITY_TYPE,
      entityId: params.basketAsOfDate,
      payload: params.report as unknown as Record<string, unknown>,
    });
  } catch (err) {
    console.warn("[v34-sim] audit write failed:", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Order submission — mirrors v51-sim-basket-runner.ts submitV51BasketOrders() mechanics
// ---------------------------------------------------------------------------

/** KGI gateway base URL (same env resolution as s1-sim-runner.ts / v51-sim-basket-runner.ts). */
function kgiGatewayUrl(): string {
  return (
    process.env["KGI_GATEWAY_URL"] ??
    process.env["KGI_GATEWAY_BASE_URL"] ??
    "http://127.0.0.1:8787"
  );
}

/**
 * Submit SIM orders for one shakedown basket (identified by its as-of date).
 * Fail-closed at every gate: basket missing/invalid, cap exceeded, or
 * credentials missing all abort with no partial/fabricated submission.
 */
export async function submitV34BasketOrders(asOfDate: string): Promise<V34OrderSubmitReport> {
  const entryDateTst = nextWeekdayIso(asOfDate);
  const submittedAtTst = new Date().toISOString();
  const failsafeNotes: string[] = [];

  const parsed = await readV34BasketForDate(asOfDate);
  if (!parsed.ok) {
    const report: V34OrderSubmitReport = {
      schema: "v34_order_submit_v1",
      label: V34_LABEL,
      basketAsOfDate: asOfDate,
      entryDateTst,
      submittedAtTst,
      capitalTwd: V34_CAPITAL_TWD,
      results: [],
      failsafeNotes: [`fail_closed_basket_read: ${parsed.error}`],
    };
    console.error(`[v34-sim] fail-closed — basket read failed for ${asOfDate}: ${parsed.error}`);
    return report;
  }
  const basket = parsed.basket;

  const capCheck = checkV34KgiSubscriptionCap(basket);
  if (!capCheck.ok) {
    const report: V34OrderSubmitReport = {
      schema: "v34_order_submit_v1",
      label: V34_LABEL,
      basketAsOfDate: asOfDate,
      entryDateTst,
      submittedAtTst,
      capitalTwd: V34_CAPITAL_TWD,
      results: [],
      failsafeNotes: [`fail_closed_subscription_cap: ${capCheck.error}`],
    };
    console.error(`[v34-sim] fail-closed — subscription cap: ${capCheck.error}`);
    return report;
  }

  const personId = process.env["KGI_PERSON_ID"] ?? "";
  const personPwd = process.env["KGI_PERSON_PWD"] ?? "";
  const accountId = process.env["KGI_ACCOUNT"] ?? "0012826";
  if (!personId || !personPwd) {
    failsafeNotes.push("credentials_missing: KGI_PERSON_ID or KGI_PERSON_PWD not set in env");
    console.warn("[v34-sim] KGI credentials missing — skipping submit (retry next tick)");
    return {
      schema: "v34_order_submit_v1",
      label: V34_LABEL,
      basketAsOfDate: asOfDate,
      entryDateTst,
      submittedAtTst,
      capitalTwd: V34_CAPITAL_TWD,
      results: [],
      failsafeNotes,
    };
  }

  // Last-close prices for sizing (DB source of truth — see computeV34OrderSizing doc).
  // Missing prices are skipped per-symbol, not fail-closed for the whole basket.
  let lastCloses = new Map<string, { closePrice: number }>();
  const db = getDb();
  if (db) {
    try {
      const rows = await getLastCloses(db, basket.rows.map((r) => r.stockId));
      lastCloses = new Map(Array.from(rows.entries()).map(([k, v]) => [k, { closePrice: v.closePrice }]));
    } catch (err) {
      failsafeNotes.push(`last_close_fetch_failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const sized = computeV34OrderSizing(basket, lastCloses);

  const { KgiGatewayClient, KgiGatewayUnreachableError } = await import("./broker/kgi-gateway-client.js");
  const client = new KgiGatewayClient({ gatewayBaseUrl: kgiGatewayUrl(), connectTimeoutMs: 10_000 });

  try {
    await client.login({ personId, personPwd, simulation: true });
    console.log("[v34-sim] KGI SIM login OK");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failsafeNotes.push(`login_failed: ${msg}`);
    console.error("[v34-sim] login failed:", msg);
    return {
      schema: "v34_order_submit_v1",
      label: V34_LABEL,
      basketAsOfDate: asOfDate,
      entryDateTst,
      submittedAtTst,
      capitalTwd: V34_CAPITAL_TWD,
      results: [],
      failsafeNotes,
    };
  }

  try {
    await client.setAccount(accountId);
  } catch (e) {
    failsafeNotes.push(`set_account_failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const results: V34OrderResult[] = [];
  for (const entry of sized) {
    if (entry.targetShares <= 0) {
      results.push({
        stockId: entry.stockId,
        shares: 0,
        isOddLot: entry.isOddLot,
        executedNotionalTwd: null,
        status: "skipped",
        tradeId: null,
        error: entry.sizingNote,
      });
      continue;
    }

    try {
      await client.subscribeTick(entry.stockId);
    } catch (e) {
      // Non-fatal: subscription failure doesn't block order submission (matches
      // V5-1/S1's tolerance of subscribe-side gateway hiccups); recorded for visibility.
      failsafeNotes.push(`subscribe_failed_${entry.stockId}: ${e instanceof Error ? e.message : String(e)}`);
    }

    let accepted = false;
    let tradeId: string | null = null;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const tradeRaw = await client.createOrder({
          action: "Buy",
          symbol: entry.stockId,
          // 2026-07-23 P0 fix: SDK qty is 張 (lots) for board-lot orders and
          // SHARES for odd-lot orders. targetShares is always a board-lot
          // multiple when isOddLot=false (see roundDownBoardLot in
          // computeV34OrderSizing) — convert to lots in that case; odd-lot
          // orders keep the raw share count. Passing raw shares for the
          // board-lot branch was a 1000x oversized order.
          qty: toKgiOrderQty(entry.targetShares, entry.isOddLot),
          price: undefined, // MARKET order — approximates next_trading_day_open
          timeInForce: "ROD",
          orderCond: "Cash",
          // 2026-07-14 (Pete review, PR #1268): odd-lot fallback so a name whose
          // equal-weight budget can't afford a full 1000-share board lot still
          // enters (see computeV34OrderSizing doc) instead of being silently
          // rounded to 0 shares.
          oddLot: entry.isOddLot,
          name: "V34_SIM_AUTO",
        });
        const tradeRecord = tradeRaw as Record<string, unknown>;
        tradeId =
          extractKgiTradeId(tradeRecord["trade_id"]) ??
          extractKgiTradeId(tradeRecord["broker_order_id"]) ??
          extractKgiTradeId(tradeRecord["kgi_response_repr"]) ??
          extractKgiTradeId(tradeRecord);
        accepted = true;
        // 2026-07-23 Round 2 (Pete review PR #1345): log both units explicitly —
        // shares=targetShares (audit_logs unit) vs wireQty actually sent to KGI
        // (lots for board-lot, shares for odd-lot), to avoid misleading future
        // debugging.
        console.log(`[v34-sim] ${entry.stockId} shares=${entry.targetShares} wireQty=${toKgiOrderQty(entry.targetShares, entry.isOddLot)}${entry.isOddLot ? " (odd lot, shares)" : " (lots)"} accepted tradeId=${tradeId ?? "null"}`);
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (e instanceof KgiGatewayUnreachableError && attempt < 3) {
          await new Promise((r) => setTimeout(r, 200 * attempt));
        } else {
          console.error(`[v34-sim] ${entry.stockId} REJECTED after ${attempt} attempt(s): ${lastError}`);
          break;
        }
      }
    }

    let status: V34OrderResult["status"] = accepted ? "accepted" : "rejected";
    if (accepted) {
      try {
        const [events, trades, deals] = await Promise.all([
          client.getRecentOrderEvents(100).catch(() => []),
          client.getTrades(false).catch(() => null),
          client.getDeals().catch(() => null),
        ]);
        const reconciled = reconcileKgiOrder({
          // Board-lot entries (isOddLot=false) report broker evidence quantity
          // in lots, not shares; odd-lot entries report shares. 2026-07-23
          // Round 2 fix (Pete review PR #1345).
          order: { tradeId, symbol: entry.stockId, side: "buy", requestedQty: entry.targetShares, wireQtyUnit: entry.isOddLot ? "shares" : "lots" },
          events,
          trades,
          deals,
        });
        status = reconciled.status as V34OrderResult["status"];
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    results.push({
      // NOTE: `shares` is always SHARES (not lots) — audit_logs / notional
      // semantics unchanged by the 2026-07-23 qty-unit fix. Only the wire
      // `qty` sent to createOrder() (above) is lot-denominated for
      // non-odd-lot orders.
      stockId: entry.stockId,
      shares: entry.targetShares,
      isOddLot: entry.isOddLot,
      executedNotionalTwd: entry.lastClosePrice !== null ? entry.targetShares * entry.lastClosePrice : null,
      status,
      tradeId,
      error: accepted ? (status === "unconfirmed" ? lastError : null) : lastError,
    });
  }

  const report: V34OrderSubmitReport = {
    schema: "v34_order_submit_v1",
    label: V34_LABEL,
    basketAsOfDate: asOfDate,
    entryDateTst,
    submittedAtTst,
    capitalTwd: V34_CAPITAL_TWD,
    results,
    failsafeNotes,
  };

  // Report JSON write is best-effort (see _v34WriteReportJsonBestEffort JSDoc) —
  // its failure must not prevent the audit record below from being written,
  // since orders may already have been submitted to KGI SIM by this point.
  await _v34WriteReportJsonBestEffort(
    join(reportsBase(), "v34_sim_order_submit", `${asOfDate}.json`),
    report,
    failsafeNotes
  );
  await writeAuditRecord({ basketAsOfDate: asOfDate, report });

  console.log(
    `[v34-sim] DONE asOfDate=${asOfDate} entryDate=${entryDateTst} accepted=${results.filter((r) => r.status !== "rejected" && r.status !== "skipped").length}/${results.length}`
  );

  return report;
}

// ---------------------------------------------------------------------------
// Unconfirmed-order reconciliation cron (2026-07-23 P0 fix) — mirrors
// s1-sim-runner.ts's reconcileUnconfirmedS1Orders(). See that function's
// doc for the full rationale (4.5s poll can't observe 10-40s+ real fill
// latency). Only the latest order_submit audit row is checked — gateway
// trades/deals/events are transient in-memory state wiped on restart.
// ---------------------------------------------------------------------------

export interface V34ReconcileSummary {
  auditRowFound: boolean;
  ordersUnconfirmed: number;
  ordersNewlyConfirmed: number;
  gatewayUnreachable: boolean;
  skippedGatewayScheduledOff: boolean;
}

async function readLatestV34OrderSubmitAuditRow(
  workspaceId: string,
): Promise<{ id: string; payload: Record<string, unknown>; report: V34OrderSubmitReport } | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select({ id: auditLogs.id, payload: auditLogs.payload })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.workspaceId, workspaceId),
        eq(auditLogs.action, V34_AUDIT_ACTION),
        eq(auditLogs.entityType, V34_AUDIT_ENTITY_TYPE),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(1)
    .catch(() => [] as Array<{ id: string; payload: unknown }>);

  const row = rows[0];
  if (!row?.id) return null;
  const payload = row.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return { id: row.id, payload: payload as Record<string, unknown>, report: payload as unknown as V34OrderSubmitReport };
}

/**
 * Re-check the latest v34_sim.order_submit audit row's still-unconfirmed
 * orders against a fresh gateway snapshot, updating the same row in place
 * for any that resolved. Cheap no-op if nothing is unconfirmed.
 */
export async function reconcileUnconfirmedV34Orders(gatewayBaseUrl?: string): Promise<V34ReconcileSummary> {
  const summary: V34ReconcileSummary = {
    auditRowFound: false,
    ordersUnconfirmed: 0,
    ordersNewlyConfirmed: 0,
    gatewayUnreachable: false,
    skippedGatewayScheduledOff: false,
  };
  if (!isDatabaseMode()) return summary;
  const db = getDb();
  if (!db) return summary;

  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) return summary;

  const row = await readLatestV34OrderSubmitAuditRow(workspaceId);
  if (!row) return summary;
  summary.auditRowFound = true;

  const unconfirmedOrders = row.report.results
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => r.status === "unconfirmed" && r.tradeId);
  summary.ordersUnconfirmed = unconfirmedOrders.length;
  if (unconfirmedOrders.length === 0) return summary;

  const { isKgiGatewayScheduledOff } = await import("./broker/kgi-gateway-schedule.js");
  if (isKgiGatewayScheduledOff()) {
    summary.skippedGatewayScheduledOff = true;
    return summary;
  }

  const { KgiGatewayClient } = await import("./broker/kgi-gateway-client.js");
  const client = new KgiGatewayClient({ gatewayBaseUrl: gatewayBaseUrl ?? kgiGatewayUrl(), connectTimeoutMs: 10_000, ignoreScheduleGuard: true });

  let trades: unknown = null;
  let deals: unknown = null;
  let events: unknown = null;
  try {
    [trades, deals, events] = await Promise.all([
      client.getTrades(true).catch(() => null),
      client.getDeals().catch(() => null),
      client.getRecentOrderEvents(200).catch(() => null),
    ]);
  } catch {
    summary.gatewayUnreachable = true;
    return summary;
  }

  const resolutions = reconcileUnconfirmedAuditOrders(
    // V34's own audit_logs row already carries isOddLot per entry (stored at
    // submit time) — thread it through, do not assume board-lot like S1/V51.
    unconfirmedOrders.map(({ r, index }) => ({ index, tradeId: r.tradeId, symbol: r.stockId, shares: r.shares, isOddLot: r.isOddLot })),
    { trades, deals, events },
  );
  if (resolutions.length === 0) return summary;

  const updatedResults = [...row.report.results];
  for (const { index, reconciled } of resolutions) {
    updatedResults[index] = { ...updatedResults[index], status: reconciled.status as V34OrderResult["status"], error: null };
  }
  summary.ordersNewlyConfirmed = resolutions.length;

  try {
    await db
      .update(auditLogs)
      .set({ payload: { ...row.payload, results: updatedResults, reconciledAt: new Date().toISOString() } })
      .where(eq(auditLogs.id, row.id));
    console.log(`[v34-reconcile] updated ${resolutions.length} order(s) on audit row ${row.id}`);
  } catch (e) {
    console.warn("[v34-reconcile] failed to write reconciled payload:", e instanceof Error ? e.message : String(e));
  }

  return summary;
}

/**
 * Scheduler entry point (wired in server.ts, same style as V51-SIM-BASKET-PIPELINE).
 * Scans embedded basket CSVs for any whose computed entry date is today and
 * that have not yet been submitted, then submits them. Idempotent via two
 * layered guards: a synchronous in-memory "claimed today" guard (set before
 * any `await`, closing the overlapping-tick double-submission race) plus the
 * pre-existing `audit_logs` DB check (survives redeploy, where the in-memory
 * guard resets).
 *
 * TODO (not implemented, per task scope — entry leg only): 60-trading-day
 * auto SIM close-out scheduling. Tracked as a follow-up; needs its own
 * scheduler + audit action before this basket's holding period ends.
 */
export async function runV34OrderSubmitTick(): Promise<void> {
  const todayTst = taipeiDateStr();

  if (!_v34ClaimOrderSubmitTickForDate(todayTst)) {
    console.log("[v34-order-cron] already fired today, skipping (in-memory guard)");
    return;
  }

  const asOfDates = await listEmbeddedV34BasketAsOfDates();
  for (const asOfDate of asOfDates) {
    const entryDate = nextWeekdayIso(asOfDate);
    if (entryDate !== todayTst) continue;
    if (await hasAlreadySubmitted(asOfDate)) continue;
    try {
      const report = await submitV34BasketOrders(asOfDate);
      const isRetryableFailure =
        report.results.length === 0 &&
        report.failsafeNotes.some((n) => n.startsWith("credentials_missing") || n.startsWith("login_failed"));
      if (isRetryableFailure) {
        // Gateway may not be reachable yet at the very start of the 08:20
        // window (EC2 gateway opens on the same schedule) — release the
        // guard so the next poll tick within the window can retry.
        console.warn(`[v34-order-cron] retryable failure for asOfDate=${asOfDate}, releasing guard for retry`);
        _v34ReleaseOrderSubmitGuard();
      }
    } catch (e) {
      // With the report-JSON write now wrapped in _v34WriteReportJsonBestEffort
      // and writeAuditRecord() already internally swallowing its own errors,
      // submitV34BasketOrders() cannot throw once it has started submitting
      // orders — an audit_logs row is always attempted before this function
      // returns. So this catch (and its unconditional guard release) is only
      // reachable by a pre-submission throw (e.g. an unexpected error before
      // any KGI order call was made), where no orders were placed and it is
      // safe to retry the whole basket from scratch on the next tick.
      console.error(`[v34-order-cron] submit failed for asOfDate=${asOfDate}:`, e instanceof Error ? e.message : String(e));
      _v34ReleaseOrderSubmitGuard();
    }
  }
}
