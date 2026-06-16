export type TwseMisQuoteSnapshot = {
  symbol: string;
  exchange: "tse" | "otc";
  lastPrice: number;
  previousClose: number | null;
  changePct: number | null;
  volume: number | null;
  tradeDate: string;
  tradeTime: string;
  marketState: "LIVE" | "CLOSE";
  source: "twse_mis";
};

type MisPayload = {
  rtcode?: string;
  msgArray?: Array<Record<string, string>>;
};

function parsePositiveNumber(value?: string): number | null {
  if (!value || value === "-") return null;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isTwseSessionNow(now = new Date()): boolean {
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = taipei.getUTCDay();
  const hhmm = taipei.getUTCHours() * 100 + taipei.getUTCMinutes();
  return day >= 1 && day <= 5 && hhmm >= 900 && hhmm <= 1335;
}

async function fetchExchangeSnapshot(
  symbol: string,
  exchange: "tse" | "otc",
  fetchImpl: typeof fetch,
): Promise<TwseMisQuoteSnapshot | null> {
  const exCh = `${exchange}_${symbol}.tw`;
  const response = await fetchImpl(
    `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4_000),
    },
  );
  if (!response.ok) return null;

  const payload = await response.json() as MisPayload;
  const row = payload.rtcode === "0000" ? payload.msgArray?.[0] : null;
  if (!row) return null;

  const bid = parsePositiveNumber(row["b"]?.split("_").find(Boolean));
  const ask = parsePositiveNumber(row["a"]?.split("_").find(Boolean));
  const lastPrice = parsePositiveNumber(row["z"]) ?? bid ?? ask;
  if (lastPrice === null) return null;

  const previousClose = parsePositiveNumber(row["y"]);
  const changePct = previousClose
    ? Math.round(((lastPrice - previousClose) / previousClose) * 10_000) / 100
    : null;

  return {
    symbol,
    exchange,
    lastPrice,
    previousClose,
    changePct,
    volume: parsePositiveNumber(row["v"]),
    tradeDate: row["d"] ?? "",
    tradeTime: row["t"] ?? row["%"] ?? "",
    marketState: isTwseSessionNow() ? "LIVE" : "CLOSE",
    source: "twse_mis",
  };
}

/**
 * Fetches the product's official quote source. The KGI SIM account may not
 * include the optional market-data entitlement, but that must not make the
 * trading product blind while TWSE MIS remains healthy.
 */
export async function getTwseMisQuoteSnapshot(
  symbol: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TwseMisQuoteSnapshot | null> {
  const normalized = symbol.trim();
  if (!/^\d{4,6}$/.test(normalized)) return null;

  try {
    return (
      await fetchExchangeSnapshot(normalized, "tse", fetchImpl)
      ?? await fetchExchangeSnapshot(normalized, "otc", fetchImpl)
    );
  } catch {
    return null;
  }
}
