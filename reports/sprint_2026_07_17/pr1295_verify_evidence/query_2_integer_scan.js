const postgres = require('/app/node_modules/postgres');
const sql = postgres(process.env.DATABASE_URL, { ssl: false });

async function main() {
  const out = {};

  // Precise corruption signature: whole-number close_price in [1,9] (what a
  // truncated parseFloat("X,XXX.0000") -> X would leave behind), under the
  // EOD sources that could have been fed by the buggy paths.
  out.integer_1to9 = await sql`
    SELECT symbol, trade_date, close_price, source
    FROM quote_last_close
    WHERE source IN ('twse_eod','tpex_eod')
      AND close_price = trunc(close_price)
      AND close_price BETWEEN 1 AND 9
    ORDER BY symbol, trade_date`;

  // Same but widen to 1..99 (2-digit truncation, e.g. "12,470"->12) while
  // still requiring whole-number (real stock prices at that range almost
  // always carry a decimal from TWSE, e.g. 61.40, so an exact whole number
  // in this band is itself a mild anomaly signal).
  out.integer_1to99 = await sql`
    SELECT symbol, trade_date, close_price, source
    FROM quote_last_close
    WHERE source IN ('twse_eod','tpex_eod')
      AND close_price = trunc(close_price)
      AND close_price BETWEEN 1 AND 99
    ORDER BY symbol, trade_date
    LIMIT 300`;

  // TPEX persist block specifically (still using bare parseFloat as of
  // current deployed code -- NOT touched by PR #1295). Check for any
  // tpex_eod row that is a small whole number.
  out.tpex_specific_check = await sql`
    SELECT symbol, trade_date, close_price
    FROM quote_last_close
    WHERE source = 'tpex_eod'
      AND close_price = trunc(close_price)
      AND close_price BETWEEN 1 AND 20
    ORDER BY symbol, trade_date
    LIMIT 100`;

  console.log(JSON.stringify(out, (k,v) => typeof v === 'bigint' ? v.toString() : v, 2));
  await sql.end();
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
