#!/usr/bin/env node
/**
 * fetch_refdata.mjs — build refdata.json for the 2026-07-23 three-sleeve SIM go-live.
 *
 * For the 44 distinct V5-1 symbols (C1 ∪ C3): fetch FinMind TaiwanStockPrice
 * (last ~120 calendar days), take last close + mean Trading_money over the most
 * recent 60 trading rows (adv60_twd).
 * For the 10 V3-4 symbols: the basket CSV already carries wm60_twd + last_close
 * (Lab-computed) — used verbatim, no network.
 *
 * Honesty rules: missing values are null, never invented. n_days records how many
 * trading rows actually backed the adv60 mean (<60 rows → still averaged over what
 * exists, but n_days exposes it; 0 rows → nulls).
 *
 * Throttle: >= 500 ms between FinMind calls, single-threaded (7/13 lesson: parallel
 * jobs triggered FinMind 403 IP ban). Max 2 retries per symbol. HTTP 402/403 →
 * abort the whole run immediately.
 *
 * Usage:  FINMIND_API_TOKEN=... node fetch_refdata.mjs
 * Output: refdata.json (same directory)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8"));

const TOKEN = process.env.FINMIND_API_TOKEN ?? "";
if (!TOKEN) {
  console.error("FATAL: FINMIND_API_TOKEN not set in env");
  process.exit(1);
}

const THROTTLE_MS = 500;
const MAX_RETRIES = 2; // retries after the first attempt
const LOOKBACK_DAYS = 120; // calendar days; >= 60 trading days with margin
const ADV_WINDOW = 60;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

// ---------------------------------------------------------------------------
// Collect symbols
// ---------------------------------------------------------------------------
const v51Symbols = new Set();
const v34Rows = [];
for (const sleeve of config.sleeves) {
  const rows = parseCsv(join(HERE, sleeve.csv));
  if (sleeve.csv_schema === "v51") {
    for (const r of rows) v51Symbols.add(r.stock_id);
  } else if (sleeve.csv_schema === "v34") {
    v34Rows.push(...rows);
  }
}

const symbols = {};

// V3-4: CSV self-carried refdata (Lab-computed wm60 + last close)
for (const r of v34Rows) {
  const lastClose = Number(r.last_close);
  const wm60 = Number(r.wm60_twd);
  symbols[r.stock_id] = {
    last_close: Number.isFinite(lastClose) && lastClose > 0 ? lastClose : null,
    last_close_date: r.signal_date ?? null,
    adv60_twd: Number.isFinite(wm60) && wm60 > 0 ? wm60 : null,
    n_days: null, // Lab-computed upstream; window definition in v34 basket doc
    source: "v34_csv_wm60",
  };
}

// ---------------------------------------------------------------------------
// V5-1: FinMind TaiwanStockPrice
// ---------------------------------------------------------------------------
const startDate = new Date(Date.now() - LOOKBACK_DAYS * 86400_000)
  .toISOString()
  .slice(0, 10);

async function fetchOne(stockId) {
  const url =
    "https://api.finmindtrade.com/api/v4/data" +
    `?dataset=TaiwanStockPrice&data_id=${encodeURIComponent(stockId)}` +
    `&start_date=${startDate}&token=${encodeURIComponent(TOKEN)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (res.status === 402 || res.status === 403) {
    const body = await res.text().catch(() => "");
    const err = new Error(`FinMind quota/ban HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.fatal = true;
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.data)) throw new Error(`unexpected body: ${JSON.stringify(json).slice(0, 200)}`);
  return json.data;
}

const sorted = [...v51Symbols].sort();
console.log(`V5-1 distinct symbols: ${sorted.length}; V3-4 csv symbols: ${v34Rows.length}`);
console.log(`FinMind start_date=${startDate}, throttle ${THROTTLE_MS}ms, single-threaded`);

let fatalAbort = null;
for (let i = 0; i < sorted.length; i++) {
  const sym = sorted[i];
  let rows = null;
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      rows = await fetchOne(sym);
      break;
    } catch (e) {
      lastErr = e;
      if (e.fatal) {
        fatalAbort = e;
        break;
      }
      if (attempt < MAX_RETRIES) await sleep(1000);
    }
  }
  if (fatalAbort) break;

  if (rows === null) {
    console.warn(`[${i + 1}/${sorted.length}] ${sym} FAILED: ${lastErr?.message}`);
    symbols[sym] = {
      last_close: null,
      last_close_date: null,
      adv60_twd: null,
      n_days: 0,
      source: "finmind_taiwanstockprice",
      error: String(lastErr?.message ?? "unknown"),
    };
  } else {
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    const win = rows.slice(-ADV_WINDOW);
    const n = win.length;
    const last = rows[rows.length - 1] ?? null;
    const money = win.map((r) => Number(r.Trading_money)).filter((v) => Number.isFinite(v));
    const adv = money.length > 0 ? money.reduce((a, b) => a + b, 0) / money.length : null;
    const lastClose = last && Number.isFinite(Number(last.close)) && Number(last.close) > 0 ? Number(last.close) : null;
    symbols[sym] = {
      last_close: lastClose,
      last_close_date: last?.date ?? null,
      adv60_twd: adv,
      n_days: n,
      source: "finmind_taiwanstockprice",
    };
    console.log(
      `[${i + 1}/${sorted.length}] ${sym} close=${lastClose} (${last?.date}) adv60=${adv === null ? "null" : Math.round(adv).toLocaleString()} n=${n}`
    );
  }
  await sleep(THROTTLE_MS);
}

if (fatalAbort) {
  console.error(`FATAL ABORT (FinMind quota/ban): ${fatalAbort.message}`);
  console.error("Partial refdata NOT written. Re-run after quota window resets.");
  process.exit(2);
}

const out = {
  generated_at_utc: new Date().toISOString(),
  purpose: "sizing refdata for 2026-07-23 three-sleeve SIM go-live",
  finmind_start_date: startDate,
  adv_window_trading_days: ADV_WINDOW,
  symbols,
};
writeFileSync(join(HERE, "refdata.json"), JSON.stringify(out, null, 2) + "\n", "utf8");

const total = Object.keys(symbols).length;
const priced = Object.values(symbols).filter((s) => s.last_close !== null).length;
const withAdv = Object.values(symbols).filter((s) => s.adv60_twd !== null).length;
console.log(`\nrefdata.json written: ${total} symbols, ${priced} with last_close, ${withAdv} with adv60_twd`);
