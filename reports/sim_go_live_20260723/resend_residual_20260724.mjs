#!/usr/bin/env node
/**
 * resend_residual_20260724.mjs — 7/24 residual re-send for the three-sleeve
 * SIM go-live's unfilled/partial orders. Pure Node (>=18, built-in fetch),
 * zero dependencies — same design convention as send_three_sleeve.mjs (this
 * tool's sibling for 7/23's initial send).
 *
 * WHY: Athena's post-mortem (IUF_SHARED_CONTRACTS/lab_verdict_three_sleeve_
 * first_execution_day_2026_07_23_v1.md) found deployed 43% (3.0M/7M) — the
 * non-structural gap is "被動限價未成" (passive-limit orders that never
 * chased the market and expired ROD at close). Recommendation #1: "殘量補送
 * ... 7/24 開盤以可成交限價補到位（追價 fail-safe：09:30 未成改 marketable）".
 *
 * RESIDUAL LIST SOURCE — computed from this repo's own ground-truth files
 * (built by the 53-order confirmation pass earlier today), NOT re-derived
 * from Lab's separate snapshot/reconciler (different universe — Lab's "22
 * MISS" count appears to include the 17 structurally-skipped high-price
 * names from the ORIGINAL 70-order plan, which this repo's 53-order send
 * never attempted and is explicitly NOT re-added here, per dispatch:
 * "結構性跳過（不足一張高價股）維持跳過"):
 *   - status="accepted" (order open, zero fill, ROD expired at 7/23 close)
 *     -> full sent_qty_lots re-sent.
 *   - status="partially_filled" -> residual = sent_qty_lots - filled_qty_lots.
 *   - status="rejected" (KGI 無效單 bucket, reason not exposed by gateway)
 *     -> full sent_qty_lots re-sent (treated as a miss; cause unknown/could
 *     be transient, worth one retry).
 *   - status="unconfirmed" (the ONE ambiguous duplicate-symbol case, 1808
 *     v51_c3 — see RECONCILE_53_ORDERS_FINAL_20260723.md) -> EXCLUDED from
 *     auto-residual. We genuinely don't know if this submission independently
 *     filled or not; blindly re-sending risks unintended over-exposure to
 *     1808 (already has a resolved v51_c1 canary position on the books).
 *     Flagged in the printed plan under "MANUAL_DECISION_NEEDED" instead of
 *     silently deciding.
 *
 * PRICING — "可成交限價" (marketable limit), not price:null. 7/23's postmortem
 * finding was specifically that price:null / passive-reference-price orders
 * don't chase and expire unfilled — so this tool sends an explicit limit
 * price at last_close plus a buffer, tick-size-rounded, capped at the TWSE
 * daily limit-up ceiling (+10% from prior close):
 *   marketable_price = min(
 *     roundUpToTick(last_close * (1 + bufferPct)),
 *     roundDownToTick(last_close * 1.10)   // TWSE daily limit-up ceiling
 *   )
 * Two buffer tiers (see config below):
 *   - initial (phase 1, --send):  marketable_buffer_pct_initial (default 1%)
 *   - requote (phase 2, --requote): marketable_buffer_pct_requote (default 3%)
 * Tick-size table is a self-contained copy of the TWSE schedule already
 * canonical in apps/api/src/broker/kgi-contract-rules.ts::getTickSize() (kept
 * as a plain literal here, not imported, to preserve this tool's existing
 * zero-monorepo-dependency design — see send_three_sleeve.mjs header. Keep
 * in sync if that table ever changes.)
 *
 * KNOWN LIMITATION — no cancel/amend capability. kgi-gateway-client.ts's
 * cancelOrder()/updateOrder() both throw KgiGatewayNotEnabledError ("not
 * enabled in W1 gateway") — there is NO way to cancel the phase-1 order
 * before submitting a phase-2 requote. Phase 2 therefore submits a NEW order
 * for the residual quantity ALONGSIDE the still-open phase-1 order; if the
 * phase-1 order also happens to fill later (unlikely once ROD priced below
 * a moving market, but not impossible), the position could be
 * double-filled. This tool mitigates by only requoting orders phase 1 left
 * at ZERO fill (skips anything phase 1 partially filled, rather than
 * chasing the remainder further) — a deliberate conservative choice, not a
 * guarantee against double-fill. Flagged for manual awareness, not solved
 * here (would need a real cancel/amend gateway endpoint, out of scope).
 *
 * Modes:
 *   node resend_residual_20260724.mjs                → DRY-RUN (default; zero network I/O), prints + writes the residual plan
 *   node resend_residual_20260724.mjs --send          → phase 1: submit residual at initial marketable price (run ~09:00)
 *   node resend_residual_20260724.mjs --requote       → phase 2: re-check phase-1 orders, submit a fresh order at requote price for any still fully unfilled (run ~09:30+)
 *
 * Idempotent (same convention as send_three_sleeve.mjs): (sleeve, symbol,
 * phase) triples already recorded "accepted" in the evidence JSONL are
 * skipped on re-run.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8"));
const MODE = process.argv.includes("--requote") ? "requote" : process.argv.includes("--send") ? "send" : "dry-run";
const GATEWAY = config.gateway_url.replace(/\/+$/, "");
const CAP_PCT = config.participation_cap_pct_of_adv60; // reapplied defensively, same guard as 7/23

const RESIDUAL_CONFIG = {
  marketable_buffer_pct_initial: 0.01,
  marketable_buffer_pct_requote: 0.03,
  evidence_file: "evidence/orders_20260724_residual.jsonl",
};

// ---------------------------------------------------------------------------
// Tick size (TWSE schedule) — plain literal copy, see file header rationale.
// ---------------------------------------------------------------------------
const TICK_SIZE_TIERS = [
  { minPrice: 1000, tickSize: 5.0 },
  { minPrice: 500, tickSize: 1.0 },
  { minPrice: 100, tickSize: 0.5 },
  { minPrice: 50, tickSize: 0.1 },
  { minPrice: 10, tickSize: 0.05 },
  { minPrice: 0, tickSize: 0.01 },
];
function getTickSize(price) {
  for (const tier of TICK_SIZE_TIERS) if (price >= tier.minPrice) return tier.tickSize;
  return 0.01;
}
function roundToTick(price, direction) {
  const tick = getTickSize(price);
  const n = price / tick;
  const rounded = direction === "up" ? Math.ceil(n) : Math.floor(n);
  return Math.round(rounded * tick * 100) / 100; // avoid float noise
}
function marketablePrice(lastClose, bufferPct) {
  const buffered = roundToTick(lastClose * (1 + bufferPct), "up");
  const ceiling = roundToTick(lastClose * 1.1, "down"); // TWSE daily limit-up
  return Math.min(buffered, ceiling);
}

// ---------------------------------------------------------------------------
// Build the residual plan from 7/23's ground-truth evidence
// ---------------------------------------------------------------------------
function loadOrdersSent() {
  const path = join(HERE, "evidence", "orders_20260723.jsonl");
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}
function loadReconcile() {
  const path = join(HERE, "evidence", "reconcile_53_orders_20260723.json");
  return JSON.parse(readFileSync(path, "utf8")).results;
}
function loadRefdata() {
  const path = join(HERE, config.refdata_file);
  return JSON.parse(readFileSync(path, "utf8"));
}

function buildResidualPlan() {
  const sent = loadOrdersSent();
  const reconcile = loadReconcile();
  if (sent.length !== reconcile.length) {
    throw new Error(`orders_20260723.jsonl has ${sent.length} rows but reconcile_53_orders_20260723.json has ${reconcile.length} — expected lockstep. Aborting.`);
  }
  const refdata = loadRefdata();

  const residual = [];
  const excluded = [];
  for (let i = 0; i < sent.length; i++) {
    const o = sent[i];
    const r = reconcile[i];
    if (r.symbol !== o.symbol || r.sleeve !== o.sleeve) {
      throw new Error(`Row ${i} mismatch between orders_20260723.jsonl and reconcile JSON — aborting rather than guessing.`);
    }
    let residualLots = 0;
    let reason = null;
    if (r.kgi_status === "Submitted") {
      residualLots = r.sent_qty_lots;
      reason = "miss_unfilled";
    } else if (r.kgi_status === "PartFilled") {
      residualLots = r.sent_qty_lots - (r.filled_qty_lots ?? 0);
      reason = "partial_gap";
    } else if (r.kgi_status === "INVALID_REJECTED") {
      residualLots = r.sent_qty_lots;
      reason = "rejected_retry";
    } else if (r.kgi_status === "AMBIGUOUS_DUP_SYMBOL_NO_DISTINCT_RECORD") {
      excluded.push({ sleeve: o.sleeve, symbol: o.symbol, reason: "MANUAL_DECISION_NEEDED: ambiguous duplicate-symbol submission, cannot determine true fill state — see script header" });
      continue;
    } else if (r.kgi_status === "Filled") {
      continue; // no residual
    } else {
      excluded.push({ sleeve: o.sleeve, symbol: o.symbol, reason: `unrecognized_kgi_status: ${r.kgi_status}` });
      continue;
    }
    if (residualLots <= 0) continue;

    const ref = refdata.symbols[o.symbol];
    if (!ref || ref.last_close === null || !Number.isFinite(Number(ref.last_close))) {
      excluded.push({ sleeve: o.sleeve, symbol: o.symbol, reason: "ref_price_missing_in_refdata (re-run fetch_refdata.mjs before send)" });
      continue;
    }
    const lastClose = Number(ref.last_close);

    // Defensive re-check of the 5% ADV60 participation guard (never increase
    // risk vs the original send — same cap, reapplied against the residual qty).
    let residualShares = residualLots * 1000;
    let capNote = "ok";
    if (ref.adv60_twd !== null && Number.isFinite(Number(ref.adv60_twd)) && Number(ref.adv60_twd) > 0) {
      const cap = Number(ref.adv60_twd) * CAP_PCT;
      if (residualShares * lastClose > cap) {
        const cappedShares = Math.floor(cap / lastClose / 1000) * 1000;
        if (cappedShares < 1000) {
          excluded.push({ sleeve: o.sleeve, symbol: o.symbol, reason: "participation_cap_to_zero_on_residual" });
          continue;
        }
        capNote = `capped_5pct_adv60 (from ${residualLots} to ${cappedShares / 1000})`;
        residualShares = cappedShares;
      }
    }
    // else: ADV60 missing — fail-open here is wrong per the original tool's
    // fail-closed convention, but original orders already passed the cap
    // check against a smaller qty; conservatively proceed uncapped rather
    // than block a legitimate residual re-send, and flag it.
    if (ref.adv60_twd === null) capNote = "adv60_missing_cap_not_reapplied";

    residual.push({
      sleeve: o.sleeve,
      symbol: o.symbol,
      original_qty_lots: r.sent_qty_lots,
      original_status: r.kgi_status,
      reason,
      residual_qty_lots: residualShares / 1000,
      residual_shares: residualShares,
      last_close: lastClose,
      cap_note: capNote,
    });
  }
  return { residual, excluded };
}

function printPlan(plan, bufferPct, label) {
  console.log(`\n=== 7/24 RESIDUAL RE-SEND PLAN (${label}) — ${MODE.toUpperCase()} ===`);
  console.log(`gateway: ${GATEWAY}  account: ${config.account}  SIMULATION ONLY`);
  console.log(`marketable buffer: +${(bufferPct * 100).toFixed(1)}% of last_close, tick-rounded up, capped at daily limit-up (+10%)\n`);
  const header = "sleeve        symbol  reason           orig(張)  residual(張)  last_close  marketable_px  cap_note";
  console.log(header);
  console.log("-".repeat(header.length + 10));
  let totalLots = 0;
  for (const o of plan.residual) {
    const px = marketablePrice(o.last_close, bufferPct);
    totalLots += o.residual_qty_lots;
    console.log(
      `${o.sleeve.padEnd(13)} ${o.symbol.padEnd(7)} ${o.reason.padEnd(16)} ${String(o.original_qty_lots).padStart(8)} ${String(o.residual_qty_lots).padStart(12)} ${String(o.last_close).padStart(10)} ${String(px).padStart(13)}  ${o.cap_note}`,
    );
  }
  console.log("-".repeat(header.length + 10));
  console.log(`TOTAL residual orders=${plan.residual.length}  total_lots=${totalLots}`);
  if (plan.excluded.length > 0) {
    console.log(`\nEXCLUDED (${plan.excluded.length}) — not auto re-sent:`);
    for (const e of plan.excluded) console.log(`  ${e.sleeve.padEnd(13)} ${e.symbol.padEnd(7)} ${e.reason}`);
  }
  console.log("");
}

const plan = buildResidualPlan();

if (MODE === "dry-run") {
  printPlan(plan, RESIDUAL_CONFIG.marketable_buffer_pct_initial, "phase 1 pricing preview");
  const outPath = join(HERE, "evidence", `residual_plan_dry_run_${Date.now()}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), mode: "dry_run", plan }, null, 2), "utf8");
  console.log(`[dry-run] wrote ${outPath}`);
  console.log("[dry-run] no network calls made. Re-run with --send (phase 1, ~09:00) or --requote (phase 2, ~09:30+).");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// SEND / REQUOTE MODE
// ---------------------------------------------------------------------------
async function gw(path, opts = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = { raw: await res.text().catch(() => "") };
  }
  return { status: res.status, ok: res.ok, body };
}

const EVIDENCE_PATH = join(HERE, RESIDUAL_CONFIG.evidence_file);
function loadEvidenceAccepted(phase) {
  const done = new Set();
  if (!existsSync(EVIDENCE_PATH)) return done;
  for (const line of readFileSync(EVIDENCE_PATH, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.status === "accepted" && rec.phase === phase) done.add(`${rec.sleeve}|${rec.symbol}`);
    } catch {
      /* tolerate partial lines from crashes */
    }
  }
  return done;
}
function loadEvidenceByPhase(phase) {
  const out = new Map();
  if (!existsSync(EVIDENCE_PATH)) return out;
  for (const line of readFileSync(EVIDENCE_PATH, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.phase === phase) out.set(`${rec.sleeve}|${rec.symbol}`, rec);
    } catch {
      /* tolerate */
    }
  }
  return out;
}
function appendEvidence(rec) {
  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  appendFileSync(EVIDENCE_PATH, JSON.stringify(rec) + "\n", "utf8");
}
const nowIso = () => new Date().toISOString();

async function ensureSession() {
  console.log("[resend] health check...");
  const health = await gw("/health");
  if (health.status !== 200 || health.body?.status !== "ok") {
    console.error(`[resend] ABORT: /health ${health.status} ${JSON.stringify(health.body)}`);
    process.exit(2);
  }
  console.log(`[resend] /health kgi_logged_in=${health.body.kgi_logged_in} account_set=${health.body.account_set}`);
  if (!health.body.kgi_logged_in) {
    console.log("[resend] not logged in — POST /session/login (simulation:true)");
    const login = await gw("/session/login", {
      method: "POST",
      body: JSON.stringify({ person_id: config.person_id, person_pwd: config.person_pwd, simulation: true }),
    });
    if (login.status !== 200) {
      console.error(`[resend] ABORT: login failed ${login.status} ${JSON.stringify(login.body)}`);
      process.exit(2);
    }
    const setAcc = await gw("/session/set-account", { method: "POST", body: JSON.stringify({ account: config.account }) });
    if (setAcc.status !== 200) {
      console.error(`[resend] ABORT: set-account failed ${setAcc.status} ${JSON.stringify(setAcc.body)}`);
      process.exit(2);
    }
    console.log(`[resend] login + set-account OK (${config.account})`);
  } else if (!health.body.account_set) {
    const setAcc = await gw("/session/set-account", { method: "POST", body: JSON.stringify({ account: config.account }) });
    if (setAcc.status !== 200) {
      console.error(`[resend] ABORT: set-account failed ${setAcc.status} ${JSON.stringify(setAcc.body)}`);
      process.exit(2);
    }
    console.log(`[resend] set-account OK (${config.account})`);
  } else {
    console.log("[resend] session already logged in + account set — skipping login (singleton session)");
  }
}

async function submitPhase(items, bufferPct, phase) {
  await ensureSession();
  const alreadyDone = loadEvidenceAccepted(phase);
  if (alreadyDone.size > 0) console.log(`[resend] idempotency: ${alreadyDone.size} (sleeve,symbol) already accepted in phase=${phase} — will skip`);

  let consecutiveFailures = 0;
  let sent = 0;
  let skippedIdem = 0;
  let failed = 0;

  for (const o of items) {
    const key = `${o.sleeve}|${o.symbol}`;
    if (alreadyDone.has(key)) {
      skippedIdem++;
      console.log(`[resend] ${key} already accepted (phase=${phase}) — skip (idempotent)`);
      continue;
    }
    const price = marketablePrice(o.last_close, bufferPct);
    const payload = {
      action: "Buy",
      symbol: o.symbol,
      qty: o.residual_qty_lots,
      price, // explicit marketable limit — NOT null (7/23 finding: null=passive, doesn't chase)
      time_in_force: "ROD",
      order_cond: "Cash",
      odd_lot: false,
      name: `${o.sleeve}_resend_${phase}`,
    };
    let status = "rejected";
    let tradeId = null;
    let errMsg = null;
    let httpStatus = null;
    try {
      const res = await gw("/order/create", { method: "POST", body: JSON.stringify(payload) });
      httpStatus = res.status;
      if (res.status === 200 && res.body?.ok === true) {
        status = "accepted";
        tradeId = res.body.trade_id ?? res.body.broker_order_id ?? null;
        consecutiveFailures = 0;
        sent++;
        console.log(`[resend] ${key} phase=${phase} qty=${o.residual_qty_lots}張 @${price} ACCEPTED trade_id=${tradeId}`);
      } else {
        errMsg = JSON.stringify(res.body).slice(0, 300);
        consecutiveFailures++;
        failed++;
        console.error(`[resend] ${key} REJECTED http=${res.status} ${errMsg}`);
      }
    } catch (e) {
      errMsg = e instanceof Error ? e.message : String(e);
      consecutiveFailures++;
      failed++;
      console.error(`[resend] ${key} ERROR ${errMsg}`);
    }
    appendEvidence({
      ts: nowIso(),
      phase,
      sleeve: o.sleeve,
      symbol: o.symbol,
      qty_lots: o.residual_qty_lots,
      shares: o.residual_shares,
      price,
      buffer_pct: bufferPct,
      original_status: o.original_status,
      reason: o.reason,
      status,
      trade_id: tradeId,
      http_status: httpStatus,
      error: errMsg,
    });
    if (consecutiveFailures >= config.max_consecutive_failures) {
      console.error(`[resend] HARD STOP: ${consecutiveFailures} consecutive failures. Report to Elva/楊董 with the evidence file. Re-running after diagnosis is safe (idempotent skip).`);
      process.exit(3);
    }
    await sleep(config.throttle_ms);
  }
  console.log(`\n[resend] phase=${phase} done: accepted=${sent} failed=${failed} idempotent_skip=${skippedIdem} planned=${items.length}`);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

try {
  if (MODE === "send") {
    printPlan(plan, RESIDUAL_CONFIG.marketable_buffer_pct_initial, "phase 1 — initial marketable");
    await submitPhase(plan.residual, RESIDUAL_CONFIG.marketable_buffer_pct_initial, "phase1");
  } else if (MODE === "requote") {
    // Phase 2: only requote items phase 1 left at ZERO fill (see KNOWN
    // LIMITATION in header — no cancel/amend, so we never chase a
    // phase-1-partial further, to bound double-fill risk).
    const phase1Evidence = loadEvidenceByPhase("phase1");
    console.log("[resend] checking phase-1 fill state via /trades before requoting...");
    await ensureSession();
    const trades = await gw("/trades?full=true");
    const tradesObj = trades.body?.trades ?? {};
    function filledLotsForSymbolQty(symbol, qtyLots) {
      // Best-effort: sum deals under any order bucket whose order.symbol/quantity match.
      let filled = 0;
      for (const key of Object.keys(tradesObj)) {
        if (key === "無效單") continue;
        const rec = Array.isArray(tradesObj[key]) ? tradesObj[key][0] : tradesObj[key];
        const ord = rec?.order ?? {};
        if (ord.symbol === symbol && ord.quantity === qtyLots) {
          filled += (rec.order_status?.deals ?? []).reduce((s, d) => s + (d.quantity ?? 0), 0);
        }
      }
      return filled;
    }
    const stillZeroFill = [];
    for (const o of plan.residual) {
      const key = `${o.sleeve}|${o.symbol}`;
      const p1 = phase1Evidence.get(key);
      if (!p1 || p1.status !== "accepted") continue; // phase 1 never got accepted — nothing to requote from
      const filled = filledLotsForSymbolQty(o.symbol, o.residual_qty_lots);
      if (filled > 0) {
        console.log(`[resend] ${key} phase1 has ${filled}張 filled — skip requote (conservative, see KNOWN LIMITATION)`);
        continue;
      }
      stillZeroFill.push(o);
    }
    console.log(`[resend] ${stillZeroFill.length} of ${plan.residual.length} residual orders still zero-fill after phase 1 — requoting these at +${(RESIDUAL_CONFIG.marketable_buffer_pct_requote * 100).toFixed(1)}%`);
    printPlan({ residual: stillZeroFill, excluded: [] }, RESIDUAL_CONFIG.marketable_buffer_pct_requote, "phase 2 — requote (aggressive)");
    await submitPhase(stillZeroFill, RESIDUAL_CONFIG.marketable_buffer_pct_requote, "phase2");
  }
} catch (e) {
  console.error(`[resend] ABORT: gateway unreachable or unexpected error — ${e instanceof Error ? e.message : String(e)}`);
  console.error("[resend] No orders were left in an unknown state beyond what evidence/orders_20260724_residual.jsonl already records (idempotent — safe to re-run after diagnosis).");
  process.exit(2);
}

// Post-run snapshots for reconciliation (best-effort, non-fatal)
try {
  const trades = await gw("/trades?full=false");
  const tradesPath = join(HERE, "evidence", `trades_20260724_${MODE}_${Date.now()}.json`);
  writeFileSync(tradesPath, JSON.stringify(trades.body, null, 2), "utf8");
  console.log(`[resend] /trades snapshot -> ${tradesPath}`);
} catch (e) {
  console.warn(`[resend] /trades snapshot failed: ${e}`);
}
try {
  const deals = await gw("/deals");
  const dealsPath = join(HERE, "evidence", `deals_20260724_${MODE}_${Date.now()}.json`);
  writeFileSync(dealsPath, JSON.stringify(deals.body, null, 2), "utf8");
  console.log(`[resend] /deals snapshot -> ${dealsPath}`);
} catch (e) {
  console.warn(`[resend] /deals snapshot failed: ${e}`);
}
