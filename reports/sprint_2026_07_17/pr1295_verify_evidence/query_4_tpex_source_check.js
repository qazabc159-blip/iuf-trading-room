const postgres = require('/app/node_modules/postgres');
const sql = postgres(process.env.DATABASE_URL, { ssl: false });

async function main() {
  const out = {};
  out.tpex_eod_max = await sql`SELECT max(close_price) AS maxp FROM quote_last_close WHERE source='tpex_eod'`;
  out.tpex_eod_over_500 = await sql`
    SELECT symbol, trade_date, close_price FROM quote_last_close
    WHERE source='tpex_eod' AND close_price > 500
    ORDER BY close_price DESC LIMIT 20`;
  console.log(JSON.stringify(out, (k,v) => typeof v === 'bigint' ? v.toString() : v, 2));
  await sql.end();
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
