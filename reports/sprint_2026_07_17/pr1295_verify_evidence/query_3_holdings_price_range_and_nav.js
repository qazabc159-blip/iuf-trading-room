const postgres = require('/app/node_modules/postgres');
const sql = postgres(process.env.DATABASE_URL, { ssl: false });

async function main() {
  const out = {};

  // Max entry price ever seen for each S1/F-AUTO held symbol -- if all are
  // well under 1000, the comma-truncation bug is structurally impossible to
  // have fired for this universe (the bug only manifests when the true price
  // formats with a thousands-comma, i.e. >= 1000).
  out.holdings_price_range = await sql`
    SELECT symbol, count(*)::int AS n, min(entry_price_twd) AS min_entry, max(entry_price_twd) AS max_entry,
           max(exit_price_twd) AS max_exit
    FROM sim_ledger_holdings
    GROUP BY symbol
    ORDER BY max(entry_price_twd) DESC
    LIMIT 10`;

  out.holdings_overall_max = await sql`
    SELECT max(entry_price_twd) AS overall_max_entry, max(exit_price_twd) AS overall_max_exit
    FROM sim_ledger_holdings`;

  // Any sim_ledger_holdings row itself (not quote_last_close) with an
  // implausibly tiny exit/entry price that might itself be corrupted at
  // source (separate from the quote_last_close question, but worth a
  // sanity glance since it's the same runner).
  out.holdings_tiny_prices = await sql`
    SELECT symbol, basket_date, entry_price_twd, exit_price_twd, entry_source, exit_source
    FROM sim_ledger_holdings
    WHERE entry_price_twd < 5 OR exit_price_twd < 5
    ORDER BY symbol, basket_date`;

  // NAV history full (for sanity on the "10,306,750 looks fine" question)
  out.nav_all = await sql`SELECT nav_date, equity_twd, return_pct, week_num, source FROM sim_ledger_nav ORDER BY nav_date`;

  console.log(JSON.stringify(out, (k,v) => typeof v === 'bigint' ? v.toString() : v, 2));
  await sql.end();
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
