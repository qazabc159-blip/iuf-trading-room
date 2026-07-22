#!/usr/bin/env node
/**
 * send_three_sleeve.mjs — 2026-07-23 three-sleeve SIM go-live order sender.
 * Pure Node (>=18, built-in fetch), zero dependencies. SIM ONLY.
 *
 * Sleeves (config.json): v51_c1 3M / v51_c3 3M / v34_c3_proxy 1M (TWD notional,
 * equal weight within each basket). C1/C3 overlap names are sent as separate
 * orders per sleeve (intentional — exercises the multi-order flow).
 *
 * Sizing:   shares = floor(notional × weight ÷ ref_price ÷ 1000) × 1000
 *           (< 1 board lot → skipped + recorded, no odd-lot fallback)
 * Guard:    order notional > 5% × ADV60 → trimmed down to cap (whole lots);
 *           ADV60 missing → fail-closed skip + recorded.
 *
 * ── QTY UNIT (verified 2026-07-22) ─────────────────────────────────────────
 * The gateway (services/kgi-gateway/app.py L1329-1338) passes `qty` VERBATIM to
 * kgisuperpy Order.create_order. The SDK docstring says:
 *     qty : int — 委託張數 or 股數      (張數 when odd_lot=False 整股,
 *                                        股數 when odd_lot=True 零股)
 * Evidence: KGI_SUPERPY_VERIFY/evidence_2026-04-23/step4_account_probe_v2.log
 * L140-155 (Big5) + brokerport_golden_2026-04-23.md L74.
 * → This tool sends qty in LOTS (張) = shares / 1000, with odd_lot=false.
 * NOTE: existing runners (s1-sim-runner.ts L869, v51-sim-basket-runner.ts L656)
 * send SHARE counts on this same path — per the SDK docstring that is a 1000×
 * oversize; those orders were only ever transport-accepted (zero confirmed
 * fills), so tomorrow's fills are also the first live check of this unit
 * conclusion. Compare /deals fill volume against BOTH interpretations.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Modes:
 *   node send_three_sleeve.mjs             → DRY-RUN (default; zero network I/O)
 *   node send_three_sleeve.mjs --send      → real SIM submission via gateway
 *
 * --send behaviour:
 *   1. GET /health. If kgi_logged_in=false → POST /session/login (simulation:true)
 *      then POST /session/set-account. If logged in but account_set=false →
 *      set-account only. (Gateway session is a singleton — never re-login when
 *      /health already shows logged in.)
 *   2. Submit orders one by one, ≥300 ms apart. 5 consecutive failures → hard stop.
 *   3. Idempotent: (sleeve, symbol) pairs already recorded as accepted in the
 *      evidence JSONL are skipped, so an interrupted run can be resumed safely.
 *   4. Every attempt is appended to evidence/orders_20260723.jsonl (ts, sleeve,
 *      symbol, qty_lots, shares, status, trade_id, error).
 *   5. After the loop: GET /trades?full=false and GET /deals snapshots are saved
 *      under evidence/.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8"));
const SEND = process.argv.includes("--send");
const GATEWAY = config.gateway_url.replace(/\/+$/, "");
const EVIDENCE_PATH = join(HERE, config.evidence_file);
const CAP_PCT = config.participation_cap_pct_of_adv60; // 0.05

function parseCsv(path) {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((ln) => {
    const cells = ln.split(",");
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i]));
    return row;
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Load refdata + build the order plan (shared by dry-run and send)
// ---------------------------------------------------------------------------
const refdataPath = join(HERE, config.refdata_file);
if (!existsSync(refdataPath)) {
  console.error(`FATAL: ${config.refdata_file} not found — run fetch_refdata.mjs first.`);
  process.exit(1);
}
const refdata = JSON.parse(readFileSync(refdataPath, "utf8"));

const plan = []; // sendable orders
const skipped = []; // skipped rows with reasons

for (const sleeve of config.sleeves) {
  const rows = parseCsv(join(HERE, sleeve.csv));
  for (const r of rows) {
    const symbol = r.stock_id;
    const weight = Number(r.weight);
    const ref = refdata.symbols[symbol];
    const base = { sleeve: sleeve.sleeve, symbol, weight };

    if (!Number.isFinite(weight) || weight <= 0) {
      skipped.push({ ...base, reason: "bad_weight" });
      continue;
    }
    if (!ref || ref.last_close === null || !Number.isFinite(Number(ref.last_close))) {
      skipped.push({ ...base, reason: "ref_price_missing" });
      continue;
    }
    const price = Number(ref.last_close);
    const targetNotional = sleeve.notional_twd * weight;
    let shares = Math.floor(targetNotional / price / 1000) * 1000;
    let note = "ok";

    if (shares < 1000) {
      skipped.push({ ...base, reason: "below_one_lot", ref_price: price, target_notional: Math.round(targetNotional) });
      continue;
    }

    // Participation guard: 5% of ADV60, fail-closed on missing ADV
    if (ref.adv60_twd === null || !Number.isFinite(Number(ref.adv60_twd)) || Number(ref.adv60_twd) <= 0) {
      skipped.push({ ...base, reason: "adv_missing_fail_closed", ref_price: price });
      continue;
    }
    const adv = Number(ref.adv60_twd);
    const cap = adv * CAP_PCT;
    if (shares * price > cap) {
      const cappedShares = Math.floor(cap / price / 1000) * 1000;
      if (cappedShares < 1000) {
        skipped.push({
          ...base,
          reason: "participation_cap_to_zero",
          ref_price: price,
          adv60_twd: Math.round(adv),
          cap_twd: Math.round(cap),
        });
        continue;
      }
      note = `capped_5pct_adv60 (from ${shares})`;
      shares = cappedShares;
    }

    if (shares % 1000 !== 0) {
      // defensive — should be impossible
      skipped.push({ ...base, reason: "internal_not_board_lot" });
      continue;
    }

    plan.push({
      sleeve: sleeve.sleeve,
      symbol,
      weight,
      ref_price: price,
      ref_price_date: ref.last_close_date,
      target_notional_twd: Math.round(targetNotional),
      shares,
      qty_lots: shares / 1000, // ← unit sent to gateway (see header)
      order_notional_twd: Math.round(shares * price),
      adv60_twd: Math.round(Number(ref.adv60_twd)),
      sizing_note: note,
    });
  }
}

// ---------------------------------------------------------------------------
// Report the plan
// ---------------------------------------------------------------------------
function printPlan() {
  console.log(`\n=== THREE-SLEEVE SIM ORDER PLAN — ${SEND ? "SEND MODE" : "DRY-RUN (no network)"} ===`);
  console.log(`gateway: ${GATEWAY}  account: ${config.account}  SIMULATION ONLY`);
  console.log(`qty unit sent: LOT (張) — see header comment for evidence\n`);
  const header =
    "sleeve        symbol  ref_px    weight  tgt_notional   shares  qty(張)  ord_notional  note";
  console.log(header);
  console.log("-".repeat(header.length + 10));
  let grand = 0;
  const bySleeve = {};
  for (const o of plan) {
    grand += o.order_notional_twd;
    bySleeve[o.sleeve] = (bySleeve[o.sleeve] ?? { n: 0, notional: 0 });
    bySleeve[o.sleeve].n += 1;
    bySleeve[o.sleeve].notional += o.order_notional_twd;
    console.log(
      `${o.sleeve.padEnd(13)} ${o.symbol.padEnd(7)} ${String(o.ref_price).padStart(7)} ${o.weight.toFixed(6).padStart(9)} ${o.target_notional_twd.toLocaleString().padStart(13)} ${String(o.shares).padStart(8)} ${String(o.qty_lots).padStart(7)} ${o.order_notional_twd.toLocaleString().padStart(13)}  ${o.sizing_note}`
    );
  }
  console.log("-".repeat(header.length + 10));
  for (const [s, agg] of Object.entries(bySleeve)) {
    console.log(`${s.padEnd(13)} orders=${String(agg.n).padStart(3)}  notional=${agg.notional.toLocaleString()} TWD`);
  }
  console.log(`TOTAL         orders=${String(plan.length).padStart(3)}  notional=${grand.toLocaleString()} TWD`);
  if (skipped.length > 0) {
    console.log(`\nSKIPPED (${skipped.length}):`);
    for (const s of skipped) {
      console.log(
        `  ${s.sleeve.padEnd(13)} ${s.symbol.padEnd(7)} ${s.reason}` +
          (s.ref_price !== undefined ? ` (ref_px=${s.ref_price}${s.target_notional !== undefined ? ` tgt=${s.target_notional.toLocaleString()}` : ""})` : "")
      );
    }
  }
  console.log("");
}

printPlan();

if (!SEND) {
  console.log("DRY-RUN complete. Re-run with --send to submit (SIM, market-hours only).");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// SEND MODE
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

function loadEvidenceAccepted() {
  const done = new Set();
  if (!existsSync(EVIDENCE_PATH)) return done;
  for (const line of readFileSync(EVIDENCE_PATH, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.status === "accepted") done.add(`${rec.sleeve}|${rec.symbol}`);
    } catch {
      /* tolerate partial lines from crashes */
    }
  }
  return done;
}

function appendEvidence(rec) {
  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  appendFileSync(EVIDENCE_PATH, JSON.stringify(rec) + "\n", "utf8");
}

const nowIso = () => new Date().toISOString();

console.log("[send] health check...");
const health = await gw("/health");
if (health.status !== 200 || health.body?.status !== "ok") {
  console.error(`[send] ABORT: /health ${health.status} ${JSON.stringify(health.body)}`);
  process.exit(2);
}
console.log(`[send] /health kgi_logged_in=${health.body.kgi_logged_in} account_set=${health.body.account_set}`);

if (!health.body.kgi_logged_in) {
  console.log("[send] not logged in — POST /session/login (simulation:true)");
  const login = await gw("/session/login", {
    method: "POST",
    body: JSON.stringify({
      person_id: config.person_id,
      person_pwd: config.person_pwd,
      simulation: true, // HARD LINE: SIM only
    }),
  });
  if (login.status !== 200) {
    console.error(`[send] ABORT: login failed ${login.status} ${JSON.stringify(login.body)}`);
    process.exit(2);
  }
  console.log("[send] login OK");
  const setAcc = await gw("/session/set-account", {
    method: "POST",
    body: JSON.stringify({ account: config.account }),
  });
  if (setAcc.status !== 200) {
    console.error(`[send] ABORT: set-account failed ${setAcc.status} ${JSON.stringify(setAcc.body)}`);
    process.exit(2);
  }
  console.log(`[send] set-account OK (${config.account})`);
} else if (!health.body.account_set) {
  console.log("[send] logged in but account not set — POST /session/set-account");
  const setAcc = await gw("/session/set-account", {
    method: "POST",
    body: JSON.stringify({ account: config.account }),
  });
  if (setAcc.status !== 200) {
    console.error(`[send] ABORT: set-account failed ${setAcc.status} ${JSON.stringify(setAcc.body)}`);
    process.exit(2);
  }
  console.log(`[send] set-account OK (${config.account})`);
} else {
  console.log("[send] session already logged in + account set — skipping login (singleton session)");
}

const alreadyDone = loadEvidenceAccepted();
if (alreadyDone.size > 0) {
  console.log(`[send] idempotency: ${alreadyDone.size} (sleeve,symbol) already accepted in evidence — will skip`);
}

let consecutiveFailures = 0;
let sent = 0;
let skippedIdem = 0;
let failed = 0;

for (const o of plan) {
  const key = `${o.sleeve}|${o.symbol}`;
  if (alreadyDone.has(key)) {
    skippedIdem++;
    console.log(`[send] ${key} already accepted — skip (idempotent)`);
    continue;
  }

  const payload = {
    action: "Buy",
    symbol: o.symbol,
    qty: o.qty_lots, // LOTS (張) — see unit evidence in header
    price: null, // null → SDK market-order path (matches 7/21-proven shape price:undefined→null)
    time_in_force: "ROD",
    order_cond: "Cash",
    odd_lot: false,
    name: o.sleeve, // sleeve tag → visible in trade name for reconciliation
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
      console.log(`[send] ${key} qty=${o.qty_lots}張 (${o.shares}股) ACCEPTED trade_id=${tradeId}`);
    } else {
      errMsg = JSON.stringify(res.body).slice(0, 300);
      consecutiveFailures++;
      failed++;
      console.error(`[send] ${key} REJECTED http=${res.status} ${errMsg}`);
    }
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
    consecutiveFailures++;
    failed++;
    console.error(`[send] ${key} ERROR ${errMsg}`);
  }

  appendEvidence({
    ts: nowIso(),
    sleeve: o.sleeve,
    symbol: o.symbol,
    qty_lots: o.qty_lots,
    shares: o.shares,
    ref_price: o.ref_price,
    order_notional_twd: o.order_notional_twd,
    status,
    trade_id: tradeId,
    http_status: httpStatus,
    error: errMsg,
  });

  if (consecutiveFailures >= config.max_consecutive_failures) {
    console.error(
      `[send] HARD STOP: ${consecutiveFailures} consecutive failures. DO NOT force-resend — report to Elva/楊董 with the evidence file. Re-running after diagnosis is safe (idempotent skip).`
    );
    process.exit(3);
  }

  await sleep(config.throttle_ms);
}

console.log(`\n[send] done: accepted=${sent} failed=${failed} idempotent_skip=${skippedIdem} planned=${plan.length}`);

// Post-run snapshots for reconciliation
try {
  const trades = await gw("/trades?full=false");
  const tradesPath = join(HERE, "evidence", `trades_snapshot_${Date.now()}.json`);
  writeFileSync(tradesPath, JSON.stringify(trades.body, null, 2), "utf8");
  console.log(`[send] /trades snapshot → ${tradesPath}`);
} catch (e) {
  console.warn(`[send] /trades snapshot failed: ${e}`);
}
try {
  const deals = await gw("/deals");
  const dealsPath = join(HERE, "evidence", `deals_snapshot_${Date.now()}.json`);
  writeFileSync(dealsPath, JSON.stringify(deals.body, null, 2), "utf8");
  console.log(`[send] /deals snapshot → ${dealsPath}`);
} catch (e) {
  console.warn(`[send] /deals snapshot failed: ${e}`);
}
