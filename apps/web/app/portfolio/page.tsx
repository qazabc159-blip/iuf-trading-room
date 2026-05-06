import Link from "next/link";

import {
  getPaperPortfolio,
  listPaperFills,
  type PaperFillLedgerRow,
  type PaperPortfolioPosition,
} from "@/lib/paper-orders-api";
import { friendlyDataError } from "@/lib/friendly-error";

export const dynamic = "force-dynamic";

const PAPER_CAPITAL_TWD = 20_000;

type PortfolioState =
  | {
      state: "LIVE";
      positions: PaperPortfolioPosition[];
      updatedAt: string;
      source: string;
    }
  | {
      state: "EMPTY";
      positions: PaperPortfolioPosition[];
      updatedAt: string;
      source: string;
      reason: string;
    }
  | {
      state: "BLOCKED";
      positions: PaperPortfolioPosition[];
      updatedAt: string;
      source: string;
      reason: string;
    };

type FillsState =
  | {
      state: "LIVE";
      fills: PaperFillLedgerRow[];
      updatedAt: string;
      source: string;
    }
  | {
      state: "EMPTY";
      fills: PaperFillLedgerRow[];
      updatedAt: string;
      source: string;
      reason: string;
    }
  | {
      state: "BLOCKED";
      fills: PaperFillLedgerRow[];
      updatedAt: string;
      source: string;
      reason: string;
    };

async function loadPaperPortfolio(): Promise<PortfolioState> {
  const updatedAt = new Date().toISOString();
  const source = "GET /api/v1/paper/portfolio";

  try {
    const positions = await getPaperPortfolio();
    if (positions.length === 0) {
      return {
        state: "EMPTY",
        positions,
        updatedAt,
        source,
        reason: "目前沒有已成交的模擬委託，因此沒有紙上部位。這不是錯誤，也沒有補假資料。",
      };
    }

    return {
      state: "LIVE",
      positions,
      updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      positions: [],
      updatedAt,
      source,
      reason: friendlyDataError(error, "紙上投資組合 API 目前無法讀取。"),
    };
  }
}

async function loadPaperFills(): Promise<FillsState> {
  const updatedAt = new Date().toISOString();
  const source = "GET /api/v1/paper/fills";

  try {
    const fills = await listPaperFills();
    if (fills.length === 0) {
      return {
        state: "EMPTY",
        fills,
        updatedAt,
        source,
        reason: "目前沒有已成交的模擬成交明細；這不是錯誤，也不補假成交。",
      };
    }

    return {
      state: "LIVE",
      fills,
      updatedAt: latestFillTime(fills) ?? updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      fills: [],
      updatedAt,
      source,
      reason: friendlyDataError(error, "紙上成交明細 API 目前無法讀取。"),
    };
  }
}

function stateLabel(state: PortfolioState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無部位";
  return "暫停";
}

function stateClass(state: PortfolioState["state"]) {
  if (state === "LIVE") return "status-ok";
  if (state === "EMPTY") return "gold";
  return "status-bad";
}

function sideLabel(side: PaperFillLedgerRow["side"]) {
  return side === "buy" ? "買進" : "賣出";
}

function orderTypeLabel(orderType: PaperFillLedgerRow["orderType"]) {
  if (orderType === "market") return "市價";
  if (orderType === "limit") return "限價";
  if (orderType === "stop") return "停損";
  return "停損限價";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatTwd(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `NT$${value.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`;
}

function actualFillShares(fill: PaperFillLedgerRow) {
  return fill.quantity_unit === "LOT" ? fill.fillQty * 1000 : fill.fillQty;
}

function fillUnitLabel(fill: PaperFillLedgerRow) {
  if (fill.quantity_unit === "LOT") return `${fill.fillQty.toLocaleString("zh-TW")} 張`;
  return `${fill.fillQty.toLocaleString("zh-TW")} 股零股`;
}

function fillNotional(fill: PaperFillLedgerRow) {
  return actualFillShares(fill) * fill.fillPrice;
}

function totalFillNotional(fills: PaperFillLedgerRow[]) {
  return fills.reduce((sum, fill) => sum + fillNotional(fill), 0);
}

function latestFillTime(fills: PaperFillLedgerRow[]) {
  return fills
    .map((fill) => fill.fillTime)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

function shortOrderId(orderId: string) {
  if (orderId.length <= 10) return orderId;
  return `${orderId.slice(0, 6)}…${orderId.slice(-4)}`;
}

function formatShares(value: number) {
  return `${value.toLocaleString("zh-TW")} 股`;
}

function formatLotBreakdown(value: number) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const lots = Math.floor(abs / 1000);
  const oddLots = abs % 1000;
  if (lots === 0) return `${sign}${oddLots.toLocaleString("zh-TW")} 股零股`;
  if (oddLots === 0) return `${sign}${lots.toLocaleString("zh-TW")} 張`;
  return `${sign}${lots.toLocaleString("zh-TW")} 張 + ${oddLots.toLocaleString("zh-TW")} 股`;
}

function avgCostLabel(position: PaperPortfolioPosition) {
  if (position.avgCostPerShare === null) return "--";
  return `${formatTwd(position.avgCostPerShare)} / 股`;
}

function notionalLabel(position: PaperPortfolioPosition) {
  if (position.avgCostPerShare === null || position.netQtyShares <= 0) return "--";
  return formatTwd(position.avgCostPerShare * position.netQtyShares);
}

function noteLabel(note: string | null) {
  if (!note) return "持有中";
  if (note === "net_flat_or_short") return "淨部位非多方或已歸零";
  return note;
}

function totalShares(positions: PaperPortfolioPosition[]) {
  return positions.reduce((sum, position) => sum + Math.abs(position.netQtyShares), 0);
}

function estimatedCost(positions: PaperPortfolioPosition[]) {
  return positions.reduce((sum, position) => {
    if (position.avgCostPerShare === null || position.netQtyShares <= 0) return sum;
    return sum + position.avgCostPerShare * position.netQtyShares;
  }, 0);
}

function isAuthExpired(reason: string | undefined) {
  return Boolean(reason?.includes("登入狀態已失效"));
}

export default async function PortfolioPage() {
  const [result, fillsResult] = await Promise.all([loadPaperPortfolio(), loadPaperFills()]);
  const paperCost = estimatedCost(result.positions);
  const availableCapital = Math.max(PAPER_CAPITAL_TWD - paperCost, 0);
  const fillNotionalTotal = totalFillNotional(fillsResult.fills);
  const recentFills = fillsResult.fills.slice(0, 12);
  const authExpired =
    (result.state === "BLOCKED" && isAuthExpired(result.reason))
    || (fillsResult.state === "BLOCKED" && isAuthExpired(fillsResult.reason));

  return (
    <main className="page-frame portfolio-page">
      <header className="page-head portfolio-hero">
        <div className="page-title">
          <span className="tg page-code">06 / 紙上投資組合</span>
          <h1>紙上部位</h1>
          <span className="tc">模擬成交後的持倉與成本，不連接真實券商。</span>
        </div>
        <div className="tg meta-strip" suppressHydrationWarning>
          <span>
            狀態 / <b className={stateClass(result.state)}>{stateLabel(result.state)}</b>
          </span>
          <span>
            來源 / <b>{result.source}</b>
          </span>
          <span>
            更新 / <b>{formatTime(result.updatedAt)}</b>
          </span>
        </div>
        <div className="tg session-pill exec">PAPER / READ ONLY</div>
      </header>

      <section className="portfolio-truth-strip" aria-label="紙上交易邊界">
        <div>
          <span className="tg gold">紙上模式</span>
          <strong>這裡只讀取模擬部位，不建立委託。</strong>
        </div>
        <div>
          <span className="tg status-ok">安全邊界</span>
          <strong>不呼叫 KGI、不碰正式下單路由、不使用 FinMind 作為成交價。</strong>
        </div>
        <div>
          <span className="tg muted">台股單位</span>
          <strong>1 張 = 1,000 股；零股以實際股數顯示。</strong>
        </div>
      </section>

      {authExpired && (
        <section className="portfolio-auth-repair" aria-label="登入狀態修復">
          <div>
            <span className="tg status-bad">登入狀態失效</span>
            <h2>紙上交易資料需要重新登入後才能讀取。</h2>
            <p>
              這不是紙上交易資料被刪掉，也不是後端沒有接；目前是瀏覽器 session 過期，
              前端先鎖住讀取結果，避免把 401 誤顯示成真無資料。
            </p>
          </div>
          <Link className="terminal-button primary" href="/login">
            重新登入
          </Link>
        </section>
      )}

      <section className="quote-strip portfolio-account-strip" aria-label="紙上帳戶摘要">
        <div className="quote-card">
          <div className="tg quote-symbol">狀態</div>
          <div className={`quote-last ${stateClass(result.state)}`}>{stateLabel(result.state)}</div>
        </div>
        <div className="quote-card">
          <div className="tg quote-symbol">測試資金</div>
          <div className="quote-last num">{formatTwd(PAPER_CAPITAL_TWD)}</div>
        </div>
        <div className="quote-card">
          <div className="tg quote-symbol">估算占用</div>
          <div className="quote-last num gold">{formatTwd(paperCost)}</div>
        </div>
        <div className="quote-card">
          <div className="tg quote-symbol">剩餘基準</div>
          <div className="quote-last num">{formatTwd(availableCapital)}</div>
        </div>
        <div className="quote-card">
          <div className="tg quote-symbol">部位數</div>
          <div className="quote-last num">{result.positions.length.toLocaleString("zh-TW")}</div>
        </div>
        <div className="quote-card">
          <div className="tg quote-symbol">持股總量</div>
          <div className="quote-last num">{formatShares(totalShares(result.positions))}</div>
        </div>
        <div className="quote-card">
          <div className="tg quote-symbol">成交筆數</div>
          <div className="quote-last num">{fillsResult.fills.length.toLocaleString("zh-TW")}</div>
        </div>
        <div className="quote-card">
          <div className="tg quote-symbol">成交金額</div>
          <div className="quote-last num gold">{formatTwd(fillNotionalTotal)}</div>
        </div>
      </section>

      <section className="panel portfolio-readout">
        <div className="panel-head">
          <div>
            <span className="tg panel-code">PORT</span>
            <span className="tg muted"> / </span>
            <span className="tg gold">紙上部位清單</span>
            <div className="panel-sub">只統計後端回傳的 FILLED 紙上委託；沒有資料時不補假部位。</div>
          </div>
          <div className={`tg ${stateClass(result.state)}`}>{stateLabel(result.state)}</div>
        </div>

        {result.state !== "LIVE" && (
          <div className="terminal-note portfolio-empty-note">
            <span className={`tg ${stateClass(result.state)}`}>{stateLabel(result.state)}</span>
            <span>{result.reason}</span>
          </div>
        )}

        {result.positions.length > 0 && (
          <div className="portfolio-position-table" role="table" aria-label="紙上部位">
            <div className="portfolio-position-row portfolio-position-head" role="row">
              <span>股票</span>
              <span>實際股數</span>
              <span>張 / 零股</span>
              <span>均價</span>
              <span>估算成本</span>
              <span>成交筆數</span>
              <span>狀態</span>
            </div>
            {result.positions.map((position) => (
              <div className="portfolio-position-row" role="row" key={position.symbol}>
                <Link className="tg gold" href={`/companies/${position.symbol}`}>
                  {position.symbol}
                </Link>
                <span className="num">{formatShares(position.netQtyShares)}</span>
                <span>{formatLotBreakdown(position.netQtyShares)}</span>
                <span className="num">{avgCostLabel(position)}</span>
                <span className="num">{notionalLabel(position)}</span>
                <span className="num">{position.fillCount.toLocaleString("zh-TW")}</span>
                <span className={position.netQtyShares > 0 ? "status-ok" : "gold"}>{noteLabel(position.note)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel portfolio-readout portfolio-fill-readout">
        <div className="panel-head">
          <div>
            <span className="tg panel-code">FILL</span>
            <span className="tg muted"> / </span>
            <span className="tg gold">紙上成交明細</span>
            <div className="panel-sub">
              只讀取後端 FILLED 模擬成交；不顯示內部使用者欄位與去重鍵，不拿 FinMind 或 K 線當成交價。
            </div>
          </div>
          <div className={`tg ${stateClass(fillsResult.state)}`}>{stateLabel(fillsResult.state)}</div>
        </div>

        {fillsResult.state !== "LIVE" && (
          <div className="terminal-note portfolio-empty-note">
            <span className={`tg ${stateClass(fillsResult.state)}`}>{stateLabel(fillsResult.state)}</span>
            <span>{fillsResult.reason}</span>
          </div>
        )}

        <div className="portfolio-fill-source">
          <span>來源：{fillsResult.source}</span>
          <span>更新：{formatTime(fillsResult.updatedAt)}</span>
          <span>安全：只讀 / PAPER / no broker</span>
        </div>

        {recentFills.length > 0 && (
          <div className="portfolio-fill-table" role="table" aria-label="紙上成交明細">
            <div className="portfolio-fill-row portfolio-fill-head" role="row">
              <span>時間</span>
              <span>股票</span>
              <span>方向</span>
              <span>類型</span>
              <span>單位</span>
              <span>實際股數</span>
              <span>成交價</span>
              <span>成交金額</span>
              <span>訂單</span>
            </div>
            {recentFills.map((fill) => (
              <div className="portfolio-fill-row" role="row" key={`${fill.orderId}:${fill.fillTime}`}>
                <span>{formatDateTime(fill.fillTime)}</span>
                <Link className="tg gold" href={`/companies/${fill.symbol}`}>
                  {fill.symbol}
                </Link>
                <span className={fill.side === "buy" ? "status-ok" : "status-bad"}>{sideLabel(fill.side)}</span>
                <span>{orderTypeLabel(fill.orderType)}</span>
                <span>{fillUnitLabel(fill)}</span>
                <span className="num">{formatShares(actualFillShares(fill))}</span>
                <span className="num">{formatTwd(fill.fillPrice)} / 股</span>
                <span className="num gold">{formatTwd(fillNotional(fill))}</span>
                <span className="tg muted">{shortOrderId(fill.orderId)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="portfolio-next-actions" aria-label="下一步">
        <div className="panel portfolio-action-panel">
          <div className="panel-head">
            <div>
              <span className="tg panel-code">NEXT</span>
              <span className="tg muted"> / </span>
              <span className="tg gold">下一步 workflow</span>
              <div className="panel-sub">Portfolio 只負責讀取結果；建立模擬委託請從公司頁 preview 開始。</div>
            </div>
          </div>
          <div className="portfolio-action-grid">
            <Link className="terminal-button primary" href="/companies/2330#paper-order">
              從 2330 預覽開始
            </Link>
            <Link className="terminal-button" href="/companies">
              回公司列表
            </Link>
          </div>
        </div>

        <div className="panel portfolio-action-panel">
          <div className="panel-head">
            <div>
              <span className="tg panel-code">LOCK</span>
              <span className="tg muted"> / </span>
              <span className="tg gold">送單鎖定</span>
              <div className="panel-sub">本頁不提供 submit，也不讀真實券商帳戶。</div>
            </div>
          </div>
          <ul className="portfolio-proof-list">
            <li>讀取端點：{result.source}</li>
            <li>成交端點：{fillsResult.source}</li>
            <li>紙上基準資金：{formatTwd(PAPER_CAPITAL_TWD)}</li>
            <li>部位數：{result.positions.length.toLocaleString("zh-TW")}</li>
            <li>成交筆數：{fillsResult.fills.length.toLocaleString("zh-TW")}；UI 不顯示內部使用者欄位與去重鍵。</li>
            <li>台股單位：1 張 = 1,000 股；本頁永遠顯示實際股數。</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
