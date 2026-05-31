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

function firstPositiveNumber(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const match = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function taipeiDateString(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export default async function TradingRoomKlineFramePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const symbol = safeTicker(params?.symbol);
  const planLevels = {
    entry: firstPositiveNumber(params?.entry),
    stop: firstPositiveNumber(params?.stop),
    target: firstPositiveNumber(params?.tp),
  };
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

  const from = new Date();
  from.setFullYear(from.getFullYear() - 3);
  let ohlcvError: string | null = null;
  let kbarError: string | null = null;
  const requestedKbarDate = taipeiDateString();
  const [ohlcvResult, kbarResult] = await Promise.allSettled([
    getCompanyOhlcv(company.id, {
      interval: "1d",
      from: from.toISOString().slice(0, 10),
    }),
    getCompanyKBar(company.id, requestedKbarDate, { days: 5 }),
  ]);

  const bars: OhlcvBar[] = ohlcvResult.status === "fulfilled" ? ohlcvResult.value : [];
  if (ohlcvResult.status === "rejected") ohlcvError = friendlyError(ohlcvResult.reason);

  const kbarEnvelope = kbarResult.status === "fulfilled" ? kbarResult.value : null;
  if (kbarResult.status === "rejected") kbarError = friendlyError(kbarResult.reason);

  const officialBars = bars.filter((bar) => bar.source !== "mock");
  const sourceState = ohlcvError ? "BLOCKED" : officialBars.length > 0 ? "LIVE" : "EMPTY";
  const sourceReason = ohlcvError
    ? `日線資料讀取失敗：${ohlcvError}`
    : officialBars.length > 0
      ? "交易室已接公司頁正式 OHLCV 圖表核心。"
      : "公司頁資料源沒有回傳可驗證日線，交易室不會補假圖。";

  const kbarView: FinMindKBarView | null = kbarEnvelope?.data ?? null;
  const kbarDate = kbarView?.date ?? officialBars.at(-1)?.dt ?? requestedKbarDate;
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
          planLevels={planLevels}
          compactTradingRoom
        />
      </div>
    </main>
  );
}

const frameCss = `
  html,
  body {
    margin: 0;
    height: 100%;
    min-height: 100%;
    background: #080b10;
    color: #d7dde8;
    overflow: hidden;
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
    box-sizing: border-box;
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    min-height: 0;
    background: #080b10;
    padding: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .kline-frame-note {
    display: none;
    box-sizing: border-box;
    width: 100%;
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
    box-sizing: border-box;
    width: 100% !important;
    max-width: none !important;
    margin: 0;
    border-top-left-radius: 0;
    border-top-right-radius: 0;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .trading-room-kline-host {
    box-sizing: border-box;
    width: 100% !important;
    max-width: none !important;
    align-self: stretch;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  .trading-room-kline-host .panel-head {
    order: 1;
    display: none;
  }

  .trading-room-kline-host .kline-chart-shell,
  .trading-room-kline-host .terminal-note,
  .trading-room-kline-host .kline-insufficient {
    order: 6;
  }

  .trading-room-kline-host .kline-chart-shell {
    box-sizing: border-box;
    width: calc(100% - 20px) !important;
    max-width: none !important;
    flex: 1 1 auto;
    min-height: 0;
    margin: 0 10px 10px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .trading-room-kline-host .kline-readout-ribbon {
    display: none;
  }

  .trading-room-kline-host .kline-chart-canvas {
    box-sizing: border-box;
    width: 100% !important;
    max-width: none !important;
    order: 1;
    flex: 1 1 auto;
    min-height: 0 !important;
    height: auto !important;
  }

  .trading-room-kline-host ._ind-toggle-bar {
    order: 3;
    flex: 0 0 auto;
    padding: 4px 10px !important;
    gap: 4px !important;
    flex-wrap: nowrap !important;
    overflow: hidden !important;
  }

  .trading-room-kline-host ._ind-toggle-bar-label,
  .trading-room-kline-host .kline-toolbar-label {
    font-size: 10px;
    white-space: nowrap;
  }

  .trading-room-kline-host ._ind-ma-expand {
    flex-wrap: nowrap;
    gap: 4px;
  }

  .trading-room-kline-host ._ind-toggle-btn,
  .trading-room-kline-host .kline-tab {
    min-height: 24px;
    padding: 4px 7px;
    font-size: 10px;
  }

  .trading-room-kline-host ._ind-level-readout {
    order: 5;
    display: none;
  }

  .trading-room-kline-host .kline-toolbar {
    order: 2;
    flex: 0 0 auto;
    margin: 0 !important;
    padding: 4px 10px !important;
    display: flex !important;
    align-items: center;
    gap: 5px !important;
    flex-wrap: nowrap !important;
    overflow: hidden !important;
  }

  .trading-room-kline-host .kline-control-group {
    display: flex !important;
    align-items: center;
    gap: 3px !important;
    min-width: 0;
    width: auto !important;
    flex: 0 0 auto !important;
    flex-wrap: nowrap !important;
    overflow: hidden !important;
    min-height: 24px !important;
    padding: 1px !important;
  }

  .trading-room-kline-host .kline-signal-strip {
    order: 7;
    flex: 0 0 auto;
    margin: 0 10px 5px;
    padding: 4px;
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .trading-room-kline-host .kline-signal-chip {
    padding: 4px 6px;
  }

  .trading-room-kline-host .kline-signal-chip small {
    display: none;
  }

  .trading-room-kline-host .kline-pending-line {
    order: 6;
    display: none;
  }

  .trading-room-kline-host .kline-meta-line {
    order: 7;
    display: none;
  }

  .trading-room-kline-host .kline-snapshot-strip {
    order: 8;
    display: none;
  }

  .trading-room-kline-host .kline-density-strip {
    order: 9;
    display: none;
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
