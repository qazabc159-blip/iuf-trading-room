import { OhlcvCandlestickChart } from "@/app/companies/[symbol]/OhlcvCandlestickChart";
import { getCompanyByTicker, getCompanyKBar, getCompanyOhlcv, type FinMindKBarView, type OhlcvBar } from "@/lib/api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeTicker(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return /^\d{4}[A-Z]?$/.test(text) ? text : "2330";
}

function friendlyError(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown_error";
}

export default async function TradingRoomKlineFramePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const symbol = safeTicker(params?.symbol);
  let companyError: string | null = null;
  const company = await getCompanyByTicker(symbol).catch((error) => {
    companyError = friendlyError(error);
    return null;
  });

  if (!company) {
    const title = companyError ? `${symbol} 公司資料暫不可用` : `查無 ${symbol}`;
    const message = companyError
      ? `公司主檔讀取失敗：${companyError}。交易室不會用假 K 線補圖，請確認登入狀態與資料服務。`
      : "公司主檔沒有回傳此股票，交易室不會用假 K 線補圖。";
    return (
      <main className="trading-room-real-kline-frame">
        <style>{frameCss}</style>
        <section className="kline-frame-empty">
          <b>{title}</b>
          <span>{message}</span>
        </section>
      </main>
    );
  }

  let ohlcvError: string | null = null;
  const from = new Date();
  from.setFullYear(from.getFullYear() - 3);
  const bars: OhlcvBar[] = await getCompanyOhlcv(company.id, {
    interval: "1d",
    from: from.toISOString().slice(0, 10),
  }).catch((error) => {
    ohlcvError = friendlyError(error);
    return [];
  });

  const officialBars = bars.filter((bar) => bar.source !== "mock");
  const sourceState = ohlcvError ? "BLOCKED" : officialBars.length > 0 ? "LIVE" : "EMPTY";
  const sourceReason = ohlcvError
    ? `日線資料讀取失敗：${ohlcvError}`
    : officialBars.length > 0
      ? "交易室已接公司頁正式 OHLCV 圖表核心。"
      : "公司頁資料源沒有回傳可驗證日線，交易室不會補假圖。";

  const kbarDate = officialBars.at(-1)?.dt ?? new Date().toISOString().slice(0, 10);
  let kbarError: string | null = null;
  const kbarEnvelope = await getCompanyKBar(company.id, kbarDate, { days: 20 }).catch((error) => {
    kbarError = friendlyError(error);
    return null;
  });
  const kbarView: FinMindKBarView | null = kbarEnvelope?.data ?? null;
  const kbarState = kbarError ? "BLOCKED" : kbarView?.state ?? "EMPTY";
  const kbarReason = kbarError
    ? `分K資料讀取失敗：${kbarError}`
    : kbarView?.reason ?? "分K資料源沒有回傳資料。";

  return (
    <main className="trading-room-real-kline-frame">
      <style>{frameCss}</style>
      <div className="kline-frame-note">
        <span>交易室 K 線已接公司頁正式圖表核心</span>
        <b>{company.ticker} {company.name}</b>
      </div>
      <div className="company-workbench-shell trading-room-kline-host">
        <OhlcvCandlestickChart
          bars={officialBars}
          kbarRows={kbarView?.rows ?? []}
          kbarState={kbarState}
          kbarReason={kbarReason}
          kbarDate={kbarView?.date ?? kbarDate}
          symbol={company.ticker}
          sourceState={sourceState}
          sourceReason={sourceReason}
        />
      </div>
    </main>
  );
}

const frameCss = `
  html,
  body {
    margin: 0;
    min-height: 100%;
    background: #080b10;
    color: #d7dde8;
  }

  body:has(.trading-room-real-kline-frame) .app-sidebar,
  body:has(.trading-room-real-kline-frame) .header-dock,
  body:has(.trading-room-real-kline-frame) .header-dock-scrim,
  body:has(.trading-room-real-kline-frame) .header-dock-drawer,
  body:has(.trading-room-real-kline-frame) .source-badge {
    display: none !important;
  }

  body:has(.trading-room-real-kline-frame) .app-main-shell {
    margin: 0 !important;
    padding: 0 !important;
    max-width: none !important;
    min-height: 100vh !important;
  }

  body:has(.trading-room-real-kline-frame) {
    overflow: hidden;
  }

  .trading-room-real-kline-frame {
    min-height: 100%;
    background: #080b10;
    padding: 0;
  }

  .kline-frame-note {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 12px;
    border: 1px solid rgba(216, 166, 74, 0.22);
    border-radius: 6px 6px 0 0;
    background: rgba(216, 166, 74, 0.07);
    color: #9aa7ba;
    font: 800 11px/1.4 var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }

  .kline-frame-note b {
    color: #f0bd62;
    font-size: 12px;
  }

  .trading-room-kline-host .kline-panel {
    margin: 0;
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }

  .trading-room-kline-host .kline-chart-canvas {
    min-height: 390px;
  }

  .kline-frame-empty {
    display: grid;
    gap: 8px;
    padding: 34px;
    border: 1px solid rgba(216, 166, 74, 0.28);
    border-radius: 6px;
    background: rgba(216, 166, 74, 0.06);
    color: #9aa7ba;
  }

  .kline-frame-empty b {
    color: #f0bd62;
  }
`;
