/**
 * v51-sim-basket-runner.ts — V5-1 Lab→TR SIM execution basket → KGI SIM order submit
 *
 * Contract: IUF_SHARED_CONTRACTS/lab_to_tr_v51_sim_basket_contract_2026_07_12_v1.md
 * Elva sign-off: 2026-07-13. Yang order: "週一掛 SIM 開跑" (2026-07-12 chat).
 *
 * What this is:
 *   - Monthly Lab-produced execution sample basket (30 names, equal weight,
 *     10,000,000 TWD notional, market/open order at next trading day open).
 *   - SIM ONLY. label SIM_EXECUTION_SAMPLE_NOT_VALIDATED must pass through
 *     verbatim to every audit record and result JSON — never softened.
 *   - This is a distinct data track from S1 (s1-sim-runner.ts): S1 computes
 *     its own cont_liq signal weekly from live DB market data; V5-1 instead
 *     *consumes* a Lab-produced CSV that lives on the operator's local disk
 *     (IUF_QUANT_LAB has no git remote — see DESIGN_v1.md §1). Transmission
 *     reuses the existing "embed Lab file into TR repo, deploy" rail already
 *     used for lab-strategy-consumer.ts / lab-three-strategy-consumer.ts.
 *   - Order execution reuses the existing S1 KGI SIM gateway mechanics
 *     (KgiGatewayClient login/setAccount/createOrder/retry/reconcile) —
 *     see s1-sim-runner.ts runS1OrderSubmitTick() for the precedent this
 *     module's submit loop mirrors.
 *
 * Hard lines:
 *   - Basket file absent, or schema not exactly matching v1 (6 columns,
 *     exact header order) → fail-closed. Never substitute alternate data.
 *   - label column must equal V51_LABEL verbatim on every row, else fail-closed.
 *   - KGI subscription cap (40, shared account-wide resource): basket symbols
 *     + reserved 0050 slot must not exceed cap → fail-closed if it would.
 *   - SIM only. Does not touch trading-service.ts / kgi-sim-env.ts /
 *     execution-mode.ts / risk-engine.ts (real-money lock files).
 *   - TR does not modify basket generation logic (frozen at Lab prereg
 *     9d6a8817 chain per contract).
 *
 * Phase 2 (not implemented here, tracked in DESIGN_v1.md):
 *   - 20-trading-day auto SIM close-out.
 *   - Ledger/positions UI surfacing of the passed-through label.
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
export const V51_LABEL = "SIM_EXECUTION_SAMPLE_NOT_VALIDATED" as const;

/** Mandatory entry_rule value per contract. */
export const V51_ENTRY_RULE = "next_trading_day_open" as const;

/** Schema v1 — exact column order, no variance accepted (fail-closed otherwise). */
export const V51_EXPECTED_HEADERS = [
  "stock_id",
  "weight",
  "signal",
  "signal_date",
  "entry_rule",
  "label",
] as const;

export const V51_CAPITAL_TWD = 10_000_000;

/** KGI 新星 subscription cap, shared account-wide resource (2 conn x 20). */
export const V51_KGI_SUBSCRIPTION_CAP = 40;

/** Benchmark symbol reserved in the cap count per Elva sign-off §2 (籃30＋0050=31). */
export const V51_BENCHMARK_RESERVED_SYMBOLS = ["0050"];

const V51_AUDIT_ACTION = "v51_sim.order_submit";
const V51_AUDIT_ENTITY_TYPE = "v51_sim";

/**
 * In-memory in-flight guard for runV51OrderSubmitTick(). Set synchronously,
 * before any `await`, so an overlapping poll tick (setInterval does not wait
 * for the previous async callback to resolve) cannot slip past the
 * async `hasAlreadySubmitted()` DB check before the first tick's
 * writeAuditRecord() has committed. Mirrors s1-sim-runner.ts's
 * `_orderSubmitLastFiredDate` pattern (see PR #1247 review, blocker 1).
 * The `audit_logs` check remains in place too — it is the only guard that
 * survives a redeploy; this in-memory guard resets to "" on process restart.
 */
let _v51OrderSubmitLastFiredDate = "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface V51BasketRow {
  stockId: string;
  weight: number;
  signal: string;
  signalDate: string;
  entryRule: string;
  label: string;
}

export interface V51Basket {
  schema: "v51_sim_basket_v1";
  sourceFile: string;
  signalDate: string;
  rows: V51BasketRow[];
}

export type V51ParseResult =
  | { ok: true; basket: V51Basket }
  | { ok: false; error: string };

export interface V51CapCheckResult {
  ok: boolean;
  count: number;
  symbols: string[];
  error?: string;
}

export interface V51SizedEntry {
  stockId: string;
  targetNotionalTwd: number;
  lastClosePrice: number | null;
  targetShares: number;
  sizingNote: string;
}

export interface V51OrderResult {
  stockId: string;
  shares: number;
  status: KgiOrderLifecycleStatus | "skipped";
  tradeId: string | null;
  error: string | null;
}

export interface V51OrderSubmitReport {
  schema: "v51_order_submit_v1";
  label: typeof V51_LABEL;
  basketSignalDate: string;
  entryDateTst: string;
  submittedAtTst: string;
  capitalTwd: number;
  results: V51OrderResult[];
  failsafeNotes: string[];
}

// ---------------------------------------------------------------------------
// CSV parse + schema validation (fail-closed)
// ---------------------------------------------------------------------------

/**
 * Parse and strictly validate a V5-1 basket CSV. Fail-closed on any deviation
 * from schema v1 — this is the ingestion gate that guards the entire pipeline.
 */
export function parseV51BasketCsv(csvText: string, sourceFile: string): V51ParseResult {
  // Strip UTF-8 BOM if present (Lab's csv writer emits utf-8-sig) — without this
  // the first header column would read as "﻿stock_id" and fail schema match.
  const normalized = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { ok: false, error: "empty_or_header_only_csv" };
  }

  const header = lines[0].split(",").map((h) => h.trim());
  const headerMatches =
    header.length === V51_EXPECTED_HEADERS.length &&
    V51_EXPECTED_HEADERS.every((expected, i) => header[i] === expected);
  if (!headerMatches) {
    return {
      ok: false,
      error: `schema_mismatch: expected [${V51_EXPECTED_HEADERS.join(",")}] got [${header.join(",")}]`,
    };
  }

  const rows: V51BasketRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length !== V51_EXPECTED_HEADERS.length) {
      return {
        ok: false,
        error: `row_${i}_column_count_mismatch: expected ${V51_EXPECTED_HEADERS.length} got ${cols.length}`,
      };
    }
    const [stockId, weightStr, signal, signalDate, entryRule, label] = cols.map((c) => c.trim());

    if (!stockId) {
      return { ok: false, error: `row_${i}_missing_stock_id` };
    }
    const weight = Number(weightStr);
    if (!Number.isFinite(weight) || weight <= 0) {
      return { ok: false, error: `row_${i}_invalid_weight: "${weightStr}"` };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(signalDate)) {
      return { ok: false, error: `row_${i}_invalid_signal_date: "${signalDate}"` };
    }
    if (entryRule !== V51_ENTRY_RULE) {
      return { ok: false, error: `row_${i}_unexpected_entry_rule: "${entryRule}"` };
    }
    if (label !== V51_LABEL) {
      return { ok: false, error: `row_${i}_label_mismatch: expected "${V51_LABEL}" got "${label}"` };
    }

    rows.push({ stockId, weight, signal, signalDate, entryRule, label });
  }

  if (rows.length === 0) {
    return { ok: false, error: "no_data_rows" };
  }

  const signalDate = rows[0].signalDate;
  if (!rows.every((r) => r.signalDate === signalDate)) {
    return { ok: false, error: "mixed_signal_dates_in_single_basket_file" };
  }

  return {
    ok: true,
    basket: { schema: "v51_sim_basket_v1", sourceFile, signalDate, rows },
  };
}

// ---------------------------------------------------------------------------
// File resolution — mirrors lab-strategy-consumer.ts dual-path pattern
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

/** Dev sibling directory — direct read from Lab repo local disk (matches contract path). */
function labSiblingBasketDir(): string {
  return join(monorepoRoot(), "..", "IUF_QUANT_LAB", "research", "forward_track", "sim_baskets");
}

function basketFileName(date: string): string {
  return `v51_sim_basket_${date}.csv`;
}

/**
 * Read + validate the basket for a given signal date. Tries the embedded
 * (deploy-bundled) path first, then the local dev sibling-repo path.
 * Never fabricates data on read failure — always returns an explicit error.
 */
export async function readV51BasketForDate(date: string): Promise<V51ParseResult> {
  const candidates = [
    join(embeddedBasketDir(), basketFileName(date)),
    join(labSiblingBasketDir(), basketFileName(date)),
  ];
  for (const path of candidates) {
    try {
      const raw = await fs.readFile(path, "utf-8");
      return parseV51BasketCsv(raw, path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      return { ok: false, error: `read_error:${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return { ok: false, error: "basket_file_not_found" };
}

/** List signal dates for all basket CSVs present in the embedded directory. */
export async function listEmbeddedV51BasketSignalDates(): Promise<string[]> {
  try {
    const files = await fs.readdir(embeddedBasketDir());
    return files
      .filter((f) => /^v51_sim_basket_\d{4}-\d{2}-\d{2}\.csv$/.test(f))
      .map((f) => f.replace(/^v51_sim_basket_/, "").replace(/\.csv$/, ""));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// KGI subscription cap check (fail-closed)
// ---------------------------------------------------------------------------

/**
 * Cap check for the shared KGI 新星 subscription resource (40 total, account-wide).
 * Counts unique basket symbols + reserved benchmark slots. Fail-closed if the
 * count would exceed the cap — this module never silently truncates a basket
 * to fit under cap.
 */
export function checkKgiSubscriptionCap(basket: V51Basket): V51CapCheckResult {
  const symbols = Array.from(
    new Set([...basket.rows.map((r) => r.stockId), ...V51_BENCHMARK_RESERVED_SYMBOLS])
  );
  if (symbols.length > V51_KGI_SUBSCRIPTION_CAP) {
    return {
      ok: false,
      count: symbols.length,
      symbols,
      error: `subscription_cap_exceeded: ${symbols.length} > ${V51_KGI_SUBSCRIPTION_CAP}`,
    };
  }
  return { ok: true, count: symbols.length, symbols };
}

// ---------------------------------------------------------------------------
// Order sizing — equal weight, 10M notional, board-lot rounded
// ---------------------------------------------------------------------------

/** Round down to nearest 1000-share board lot (mirrors s1-sim-runner.ts convention). */
function roundDownBoardLot(shares: number): number {
  return Math.floor(shares / 1000) * 1000;
}

/**
 * Compute per-name target notional (equal weight over the whole basket) and
 * board-lot-rounded target shares from last-close prices. Symbols with no
 * available last close are sized to 0 shares with an explicit skip note —
 * never silently treated as a valid zero-cost fill.
 */
export function computeV51OrderSizing(
  basket: V51Basket,
  lastCloses: Map<string, { closePrice: number }>,
  capitalTwd: number = V51_CAPITAL_TWD
): V51SizedEntry[] {
  const perNameTargetTwd = capitalTwd / basket.rows.length;
  return basket.rows.map((row) => {
    const close = lastCloses.get(row.stockId);
    if (!close || !Number.isFinite(close.closePrice) || close.closePrice <= 0) {
      return {
        stockId: row.stockId,
        targetNotionalTwd: perNameTargetTwd,
        lastClosePrice: null,
        targetShares: 0,
        sizingNote: "skipped_missing_last_close",
      };
    }
    const targetShares = roundDownBoardLot(perNameTargetTwd / close.closePrice);
    return {
      stockId: row.stockId,
      targetNotionalTwd: perNameTargetTwd,
      lastClosePrice: close.closePrice,
      targetShares,
      sizingNote: targetShares > 0 ? "ok" : "sub_board_lot_rounds_to_zero",
    };
  });
}

// ---------------------------------------------------------------------------
// Entry-date + window helpers
// ---------------------------------------------------------------------------

/** Next weekday (Mon-Fri) after a given ISO date, UTC-safe (no TW holiday calendar
 *  dependency — matches existing s1-sim-runner.ts window convention). */
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

/** Weekday 08:20-08:40 TST — right after the KGI EC2 gateway open window. */
export function isV51OrderSubmitWindow(): boolean {
  const hhmm = taipeiHHMM();
  const taipeiMs = Date.now() + 8 * 3600 * 1000;
  const day = new Date(taipeiMs).getUTCDay();
  return day >= 1 && day <= 5 && hhmm >= 820 && hhmm < 840;
}

/** Railway volume-mount path for persistent reports (mirrors s1-sim-runner.ts). */
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
 * orders have already been submitted to KGI SIM, so a failure here (e.g. a
 * container fs issue) must never propagate — if it did, the caller's catch
 * block would release the in-memory order-submit guard with no audit_logs
 * row written, and the next tick would re-submit the entire already-filled
 * basket (see PR #1247 review, residual gap flagged after blocker 1's fix).
 * The failure is recorded in `failsafeNotes` (same array reference used to
 * build the report that's about to be audit-logged) so it's still visible.
 * Exported for direct testing of this failure-tolerance contract.
 */
export async function _v51WriteReportJsonBestEffort(
  path: string,
  data: unknown,
  failsafeNotes: string[]
): Promise<void> {
  try {
    await writeJson(path, data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[v51-sim] report JSON write failed for ${path} (non-fatal — audit record is still written): ${msg}`);
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
 * runV51OrderSubmitTick() does, before any `await` — closing the race window
 * where two overlapping ticks could both pass the async `hasAlreadySubmitted()`
 * DB check before either finishes writing its audit record.
 * Exported for direct testing of the guard mechanics (see PR #1247 review).
 */
export function _v51ClaimOrderSubmitTickForDate(todayTst: string): boolean {
  if (_v51OrderSubmitLastFiredDate === todayTst) return false;
  _v51OrderSubmitLastFiredDate = todayTst;
  return true;
}

/**
 * Releases the in-memory guard, allowing a later tick within the same day to
 * retry. Used for known-transient failure paths (credentials not yet set,
 * gateway not yet reachable at the very start of the 08:20 window) — mirrors
 * s1-sim-runner.ts's `_orderSubmitLastFiredDate = ""` reset convention.
 * Exported for test cleanup between guard test cases.
 */
export function _v51ReleaseOrderSubmitGuard(): void {
  _v51OrderSubmitLastFiredDate = "";
}

/** Idempotency guard: has this basket's orders already been submitted? */
async function hasAlreadySubmitted(basketSignalDate: string): Promise<boolean> {
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
          eq(auditLogs.action, V51_AUDIT_ACTION),
          eq(auditLogs.entityType, V51_AUDIT_ENTITY_TYPE),
          eq(auditLogs.entityId, basketSignalDate)
        )
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    console.warn("[v51-sim] idempotency check failed (assuming not-yet-submitted):", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function writeAuditRecord(params: {
  basketSignalDate: string;
  report: V51OrderSubmitReport;
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
      action: V51_AUDIT_ACTION,
      entityType: V51_AUDIT_ENTITY_TYPE,
      entityId: params.basketSignalDate,
      payload: params.report as unknown as Record<string, unknown>,
    });
  } catch (err) {
    console.warn("[v51-sim] audit write failed:", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Order submission — mirrors s1-sim-runner.ts runS1OrderSubmitTick() mechanics
// ---------------------------------------------------------------------------

/** KGI gateway base URL (same env resolution as s1-sim-runner.ts). */
function kgiGatewayUrl(): string {
  return (
    process.env["KGI_GATEWAY_URL"] ??
    process.env["KGI_GATEWAY_BASE_URL"] ??
    "http://127.0.0.1:8787"
  );
}

/**
 * Submit SIM orders for one basket (identified by its signal date). Fail-closed
 * at every gate: basket missing/invalid, cap exceeded, or credentials missing
 * all abort with no partial/fabricated submission.
 */
export async function submitV51BasketOrders(signalDate: string): Promise<V51OrderSubmitReport> {
  const entryDateTst = nextWeekdayIso(signalDate);
  const submittedAtTst = new Date().toISOString();
  const failsafeNotes: string[] = [];

  const parsed = await readV51BasketForDate(signalDate);
  if (!parsed.ok) {
    const report: V51OrderSubmitReport = {
      schema: "v51_order_submit_v1",
      label: V51_LABEL,
      basketSignalDate: signalDate,
      entryDateTst,
      submittedAtTst,
      capitalTwd: V51_CAPITAL_TWD,
      results: [],
      failsafeNotes: [`fail_closed_basket_read: ${parsed.error}`],
    };
    console.error(`[v51-sim] fail-closed — basket read failed for ${signalDate}: ${parsed.error}`);
    return report;
  }
  const basket = parsed.basket;

  const capCheck = checkKgiSubscriptionCap(basket);
  if (!capCheck.ok) {
    const report: V51OrderSubmitReport = {
      schema: "v51_order_submit_v1",
      label: V51_LABEL,
      basketSignalDate: signalDate,
      entryDateTst,
      submittedAtTst,
      capitalTwd: V51_CAPITAL_TWD,
      results: [],
      failsafeNotes: [`fail_closed_subscription_cap: ${capCheck.error}`],
    };
    console.error(`[v51-sim] fail-closed — subscription cap: ${capCheck.error}`);
    return report;
  }

  const personId = process.env["KGI_PERSON_ID"] ?? "";
  const personPwd = process.env["KGI_PERSON_PWD"] ?? "";
  const accountId = process.env["KGI_ACCOUNT"] ?? "0012826";
  if (!personId || !personPwd) {
    failsafeNotes.push("credentials_missing: KGI_PERSON_ID or KGI_PERSON_PWD not set in env");
    console.warn("[v51-sim] KGI credentials missing — skipping submit (retry next tick)");
    return {
      schema: "v51_order_submit_v1",
      label: V51_LABEL,
      basketSignalDate: signalDate,
      entryDateTst,
      submittedAtTst,
      capitalTwd: V51_CAPITAL_TWD,
      results: [],
      failsafeNotes,
    };
  }

  // Last-close prices for sizing. Missing prices are skipped per-symbol, not
  // fail-closed for the whole basket (matches S1's "truncate on missing data"
  // convention — a Lab-produced 30-name basket may include thinly-covered
  // names that other F-AUTO paths never touch).
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
  const sized = computeV51OrderSizing(basket, lastCloses);

  const { KgiGatewayClient, KgiGatewayUnreachableError } = await import("./broker/kgi-gateway-client.js");
  const client = new KgiGatewayClient({ gatewayBaseUrl: kgiGatewayUrl(), connectTimeoutMs: 10_000 });

  try {
    await client.login({ personId, personPwd, simulation: true });
    console.log("[v51-sim] KGI SIM login OK");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    failsafeNotes.push(`login_failed: ${msg}`);
    console.error("[v51-sim] login failed:", msg);
    return {
      schema: "v51_order_submit_v1",
      label: V51_LABEL,
      basketSignalDate: signalDate,
      entryDateTst,
      submittedAtTst,
      capitalTwd: V51_CAPITAL_TWD,
      results: [],
      failsafeNotes,
    };
  }

  try {
    await client.setAccount(accountId);
  } catch (e) {
    failsafeNotes.push(`set_account_failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const results: V51OrderResult[] = [];
  for (const entry of sized) {
    if (entry.targetShares <= 0) {
      results.push({ stockId: entry.stockId, shares: 0, status: "skipped", tradeId: null, error: entry.sizingNote });
      continue;
    }

    try {
      await client.subscribeTick(entry.stockId);
    } catch (e) {
      // Non-fatal: subscription failure doesn't block order submission (matches
      // S1's tolerance of subscribe-side gateway hiccups); recorded for visibility.
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
          // 2026-07-23 P0 fix: SDK qty is 張 (lots) for board-lot (oddLot=false)
          // orders — targetShares is always a board-lot multiple (see
          // roundDownBoardLot in computeV51OrderSizing), so convert shares ->
          // lots here. Passing raw shares was a 1000x oversized order.
          qty: toKgiOrderQty(entry.targetShares, false),
          price: undefined, // MARKET order — approximates next_trading_day_open
          timeInForce: "ROD",
          orderCond: "Cash",
          oddLot: false,
          name: "V51_SIM_AUTO",
        });
        const tradeRecord = tradeRaw as Record<string, unknown>;
        tradeId =
          extractKgiTradeId(tradeRecord["trade_id"]) ??
          extractKgiTradeId(tradeRecord["broker_order_id"]) ??
          extractKgiTradeId(tradeRecord["kgi_response_repr"]) ??
          extractKgiTradeId(tradeRecord);
        accepted = true;
        // 2026-07-23 Round 2 (Pete review PR #1345): log both units explicitly —
        // shares=targetShares (audit_logs unit) vs wireQty=lots actually sent to
        // KGI, to avoid misleading future debugging.
        console.log(`[v51-sim] ${entry.stockId} shares=${entry.targetShares} wireQtyLots=${toKgiOrderQty(entry.targetShares, false)} accepted tradeId=${tradeId ?? "null"}`);
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (e instanceof KgiGatewayUnreachableError && attempt < 3) {
          await new Promise((r) => setTimeout(r, 200 * attempt));
        } else {
          console.error(`[v51-sim] ${entry.stockId} REJECTED after ${attempt} attempt(s): ${lastError}`);
          break;
        }
      }
    }

    let status: V51OrderResult["status"] = accepted ? "accepted" : "rejected";
    if (accepted) {
      try {
        const [events, trades, deals] = await Promise.all([
          client.getRecentOrderEvents(100).catch(() => []),
          client.getTrades(false).catch(() => null),
          client.getDeals().catch(() => null),
        ]);
        const reconciled = reconcileKgiOrder({
          // V51 always submits board-lot orders (oddLot hardcoded false
          // above) — broker evidence quantity is in lots, not shares.
          // 2026-07-23 Round 2 fix (Pete review PR #1345).
          order: { tradeId, symbol: entry.stockId, side: "buy", requestedQty: entry.targetShares, wireQtyUnit: "lots" },
          events,
          trades,
          deals,
        });
        status = reconciled.status as V51OrderResult["status"];
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    results.push({
      // NOTE: `shares` is always SHARES (not lots) — audit_logs / notional
      // semantics unchanged by the 2026-07-23 qty-unit fix. Only the wire
      // `qty` sent to createOrder() (above) is lot-denominated.
      stockId: entry.stockId,
      shares: entry.targetShares,
      status,
      tradeId,
      error: accepted ? (status === "unconfirmed" ? lastError : null) : lastError,
    });
  }

  const report: V51OrderSubmitReport = {
    schema: "v51_order_submit_v1",
    label: V51_LABEL,
    basketSignalDate: signalDate,
    entryDateTst,
    submittedAtTst,
    capitalTwd: V51_CAPITAL_TWD,
    results,
    failsafeNotes,
  };

  // Report JSON write is best-effort (see _v51WriteReportJsonBestEffort JSDoc) —
  // its failure must not prevent the audit record below from being written,
  // since orders may already have been submitted to KGI SIM by this point.
  await _v51WriteReportJsonBestEffort(
    join(reportsBase(), "v51_sim_order_submit", `${signalDate}.json`),
    report,
    failsafeNotes
  );
  await writeAuditRecord({ basketSignalDate: signalDate, report });

  console.log(
    `[v51-sim] DONE signalDate=${signalDate} entryDate=${entryDateTst} accepted=${results.filter((r) => r.status !== "rejected" && r.status !== "skipped").length}/${results.length}`
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

export interface V51ReconcileSummary {
  auditRowFound: boolean;
  ordersUnconfirmed: number;
  ordersNewlyConfirmed: number;
  gatewayUnreachable: boolean;
  skippedGatewayScheduledOff: boolean;
}

async function readLatestV51OrderSubmitAuditRow(
  workspaceId: string,
): Promise<{ id: string; payload: Record<string, unknown>; report: V51OrderSubmitReport } | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select({ id: auditLogs.id, payload: auditLogs.payload })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.workspaceId, workspaceId),
        eq(auditLogs.action, V51_AUDIT_ACTION),
        eq(auditLogs.entityType, V51_AUDIT_ENTITY_TYPE),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(1)
    .catch(() => [] as Array<{ id: string; payload: unknown }>);

  const row = rows[0];
  if (!row?.id) return null;
  const payload = row.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return { id: row.id, payload: payload as Record<string, unknown>, report: payload as unknown as V51OrderSubmitReport };
}

/**
 * Re-check the latest v51_sim.order_submit audit row's still-unconfirmed
 * orders against a fresh gateway snapshot, updating the same row in place
 * for any that resolved. Cheap no-op if nothing is unconfirmed.
 */
export async function reconcileUnconfirmedV51Orders(gatewayBaseUrl?: string): Promise<V51ReconcileSummary> {
  const summary: V51ReconcileSummary = {
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

  const row = await readLatestV51OrderSubmitAuditRow(workspaceId);
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
    // V51 always submits board-lot orders (oddLot hardcoded false at submit
    // time) — isOddLot:false is correct for every V51 order, not a default.
    unconfirmedOrders.map(({ r, index }) => ({ index, tradeId: r.tradeId, symbol: r.stockId, shares: r.shares, isOddLot: false })),
    { trades, deals, events },
  );
  if (resolutions.length === 0) return summary;

  const updatedResults = [...row.report.results];
  for (const { index, reconciled } of resolutions) {
    updatedResults[index] = { ...updatedResults[index], status: reconciled.status as V51OrderResult["status"], error: null };
  }
  summary.ordersNewlyConfirmed = resolutions.length;

  try {
    await db
      .update(auditLogs)
      .set({ payload: { ...row.payload, results: updatedResults, reconciledAt: new Date().toISOString() } })
      .where(eq(auditLogs.id, row.id));
    console.log(`[v51-reconcile] updated ${resolutions.length} order(s) on audit row ${row.id}`);
  } catch (e) {
    console.warn("[v51-reconcile] failed to write reconciled payload:", e instanceof Error ? e.message : String(e));
  }

  return summary;
}

/**
 * Scheduler entry point (wired in server.ts, same style as S1-SIM-PIPELINE).
 * Scans embedded basket CSVs for any whose computed entry date is today and
 * that have not yet been submitted, then submits them. Idempotent via two
 * layered guards: a synchronous in-memory "claimed today" guard (set before
 * any `await`, closing the overlapping-tick double-submission race — see
 * PR #1247 review blocker 1) plus the pre-existing `audit_logs` DB check
 * (survives redeploy, where the in-memory guard resets).
 */
export async function runV51OrderSubmitTick(): Promise<void> {
  const todayTst = taipeiDateStr();

  if (!_v51ClaimOrderSubmitTickForDate(todayTst)) {
    console.log("[v51-order-cron] already fired today, skipping (in-memory guard)");
    return;
  }

  const signalDates = await listEmbeddedV51BasketSignalDates();
  for (const signalDate of signalDates) {
    const entryDate = nextWeekdayIso(signalDate);
    if (entryDate !== todayTst) continue;
    if (await hasAlreadySubmitted(signalDate)) continue;
    try {
      const report = await submitV51BasketOrders(signalDate);
      const isRetryableFailure =
        report.results.length === 0 &&
        report.failsafeNotes.some((n) => n.startsWith("credentials_missing") || n.startsWith("login_failed"));
      if (isRetryableFailure) {
        // Gateway may not be reachable yet at the very start of the 08:20
        // window (EC2 gateway opens on the same schedule) — release the
        // guard so the next poll tick within the window can retry.
        console.warn(`[v51-order-cron] retryable failure for signalDate=${signalDate}, releasing guard for retry`);
        _v51ReleaseOrderSubmitGuard();
      }
    } catch (e) {
      // With the report-JSON write now wrapped in _v51WriteReportJsonBestEffort
      // and writeAuditRecord() already internally swallowing its own errors,
      // submitV51BasketOrders() cannot throw once it has started submitting
      // orders — an audit_logs row is always attempted before this function
      // returns. So this catch (and its unconditional guard release) is only
      // reachable by a pre-submission throw (e.g. an unexpected error before
      // any KGI order call was made), where no orders were placed and it is
      // safe to retry the whole basket from scratch on the next tick.
      console.error(`[v51-order-cron] submit failed for signalDate=${signalDate}:`, e instanceof Error ? e.message : String(e));
      _v51ReleaseOrderSubmitGuard();
    }
  }
}
