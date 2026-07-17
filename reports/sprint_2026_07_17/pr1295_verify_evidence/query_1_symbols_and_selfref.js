const postgres = require('/app/node_modules/postgres');
const sql = postgres(process.env.DATABASE_URL, { ssl: false });

async function main() {
  const out = {};

  out.qlc_total = await sql`SELECT count(*)::int AS n, min(trade_date) AS min_d, max(trade_date) AS max_d FROM quote_last_close`;
  out.qlc_by_source = await sql`SELECT source, count(*)::int AS n, min(trade_date) AS min_d, max(trade_date) AS max_d FROM quote_last_close GROUP BY source ORDER BY source`;

  out.five_symbols = await sql`
    SELECT symbol, trade_date, close_price, source, updated_at
    FROM quote_last_close
    WHERE symbol IN ('2330','2454','2308','3008','6669')
    ORDER BY symbol, trade_date`;

  // Self-referential corruption signature: same symbol has a row >=1000 (proven high-price)
  // and another row <15 under twse_eod/tpex_eod source (impossible legit price move).
  out.self_ref_corruption = await sql`
    WITH per_symbol AS (
      SELECT symbol, MAX(close_price) AS maxp
      FROM quote_last_close
      WHERE source IN ('twse_eod','tpex_eod')
      GROUP BY symbol
    )
    SELECT q.symbol, q.trade_date, q.close_price, q.source, p.maxp AS symbol_max_price_seen
    FROM quote_last_close q
    JOIN per_symbol p ON p.symbol = q.symbol
    WHERE p.maxp >= 1000 AND q.close_price < 15 AND q.source IN ('twse_eod','tpex_eod')
    ORDER BY q.symbol, q.trade_date`;

  // sim_ledger_holdings universe (F-AUTO / S1 actual held symbols)
  out.holdings_symbols = await sql`SELECT DISTINCT symbol FROM sim_ledger_holdings ORDER BY symbol`;

  // Cross-check: holdings entry price vs quote_last_close close_price implausibly low
  out.holdings_vs_qlc_anomaly = await sql`
    SELECT h.symbol, h.basket_date, h.week_num, h.entry_price_twd, h.exit_price_twd, h.exit_date,
           q.trade_date AS qlc_trade_date, q.close_price AS qlc_close_price, q.source AS qlc_source
    FROM sim_ledger_holdings h
    JOIN quote_last_close q ON q.symbol = h.symbol AND q.source IN ('twse_eod','tpex_eod')
    WHERE q.close_price < (h.entry_price_twd * 0.15)
    ORDER BY h.symbol, q.trade_date`;

  // Does the holdings universe overlap the 5 known corrupted symbols?
  out.holdings_overlap_5 = await sql`
    SELECT DISTINCT symbol FROM sim_ledger_holdings WHERE symbol IN ('2330','2454','2308','3008','6669')`;

  // NAV history sanity (recent rows)
  out.nav_recent = await sql`SELECT nav_date, equity_twd, return_pct, week_num, source FROM sim_ledger_nav ORDER BY nav_date DESC LIMIT 15`;

  // Any quote_last_close row with close_price < 15 at all under twse_eod/tpex_eod (broad scan, not just symbols proven >=1000 elsewhere -- some corrupted symbols might have ONLY ever gotten one bad row, never a good one, so self-ref check above would miss them)
  out.broad_small_values = await sql`
    SELECT symbol, trade_date, close_price, source
    FROM quote_last_close
    WHERE source IN ('twse_eod','tpex_eod') AND close_price < 15
    ORDER BY symbol, trade_date
    LIMIT 200`;

  console.log(JSON.stringify(out, (k,v) => typeof v === 'bigint' ? v.toString() : v, 2));
  await sql.end();
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
