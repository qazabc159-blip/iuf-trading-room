import Link from "next/link";

import {
  getPaperHealthDetail,
  getPaperPortfolio,
  listPaperFills,
  type PaperFillLedgerRow,
  type PaperHealthDetail,
  type PaperHealthDetailStage,
  type PaperHealthDetailStageState,
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

type PaperReadinessState =
  | {
      state: "LIVE";
      detail: PaperHealthDetail;
      updatedAt: string;
      source: string;
    }
  | {
      state: "BLOCKED";
      detail: null;
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

async function loadPaperReadiness(): Promise<PaperReadinessState> {
  const updatedAt = new Date().toISOString();
  const source = "GET /api/v1/paper/health/detail";

  try {
    const detail = await getPaperHealthDetail();
    return {
      state: "LIVE",
      detail,
      updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      detail: null,
      updatedAt,
      source,
      reason: friendlyDataError(error, "紙上交易健康檢查 API 目前無法讀取。"),
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

function readinessStateClass(state: PaperHealthDetailStageState | PaperReadinessState["state"]) {
  if (state === "READY" || state === "LIVE") return "status-ok";
  if (state === "DEGRADED") return "gold";
  return "status-bad";
}

function readinessStateLabel(state: PaperHealthDetailStageState | PaperReadinessState["state"]) {
  if (state === "READY" || state === "LIVE") return "可用";
  if (state === "DEGRADED") return "降級";
  if (state === "BLOCKED") return "阻擋";
  return "錯誤";
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

function formatNullableTime(value: string | null | undefined) {
  if (!value) return "尚無成交";
  return formatDateTime(value);
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

function readinessRows(detail: PaperHealthDetail) {
  return [
    {
      id: "preview",
      title: "風控預覽",
      description: "只做計算檢查，不建立委託。",
      stage: detail.preview,
    },
    {
      id: "ticket",
      title: "委託草稿",
      description: "公司頁建立 PAPER ticket，不碰 KGI。",
      stage: detail.orderTicket,
    },
    {
      id: "submit",
      title: "紙上送出",
      description: "僅送到 paper_orders；不是正式下單。",
      stage: detail.submit,
    },
    {
      id: "fill",
      title: "模擬成交",
      description: "讀取後端 FILLED 狀態，不用 K 線當成交價。",
      stage: detail.fill,
    },
    {
      id: "portfolio",
      title: "部位回寫",
      description: "FILLED 委託彙總成紙上部位。",
      stage: detail.portfolio,
    },
    {
      id: "audit",
      title: "稽核紀錄",
      description: "讀取今日 audit log 聚合狀態。",
      stage: detail.auditLog,
    },
  ];
}

function stageDetailLine(stage: PaperHealthDetailStage) {
  if (stage.blockReason) return stage.blockReason;
  if (stage.dbError) return `資料庫檢查：${stage.dbError}`;
  if (stage.endpoint === "/paper/fills") {
    return `今日成交 ${stage.todayCount ?? 0} 筆；最近成交 ${formatNullableTime(stage.lastFillTs)}`;
  }
  if (stage.endpoint === "/paper/portfolio") {
    return `已成交委託 ${stage.filledOrderCount ?? 0} 筆；彙總後才形成部位`;
  }
  if (stage.endpoint === "/audit-log") {
    return `今日稽核 ${stage.todayEntries ?? 0} 筆`;
  }
  if (stage.executionMode) return `模式：${stage.executionMode}`;
  return stage.note ?? "後端健康檢查已回覆。";
}

export default async function PortfolioPage() {
  const [result, fillsResult, readinessResult] = await Promise.all([
    loadPaperPortfolio(),
    loadPaperFills(),
    loadPaperReadiness(),
  ]);
  const paperCost = estimatedCost(result.positions);
  const availableCapital = Math.max(PAPER_CAPITAL_TWD - paperCost, 0);
  const fillNotionalTotal = totalFillNotional(fillsResult.fills);
  const recentFills = fillsResult.fills.slice(0, 12);

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

      <section className="panel portfolio-readiness-panel" aria-label="紙上交易流程健康軌">
        <div className="panel-head">
          <div>
            <span className="tg panel-code">FLOW</span>
            <span className="tg muted"> / </span>
            <span className="tg gold">紙上交易流程健康軌</span>
            <div className="panel-sub">
              從風控預覽到部位回寫逐段讀取後端健康檢查；本區只顯示狀態，不送出委託。
            </div>
          </div>
          <div className={`tg ${readinessStateClass(readinessResult.state)}`}>
            {readinessStateLabel(readinessResult.state)}
          </div>
        </div>

        <div className="portfolio-fill-source">
          <span>來源：{readinessResult.source}</span>
          <span>更新：{formatTime(readinessResult.updatedAt)}</span>
          <span>安全：read-only / no broker / no submit</span>
        </div>

        {readinessResult.state === "BLOCKED" ? (
          <div className="terminal-note portfolio-empty-note">
            <span className="tg status-bad">阻擋</span>
            <span>{readinessResult.reason}</span>
          </div>
        ) : (
          <div className="paper-readiness-rail">
            {readinessRows(readinessResult.detail).map((row, index) => (
              <article className="paper-readiness-card" key={row.id}>
                <div className="paper-readiness-index">{String(index + 1).padStart(2, "0")}</div>
                <div className="paper-readiness-body">
                  <div className="paper-readiness-title">
                    <strong>{row.title}</strong>
                    <span className={`tg ${readinessStateClass(row.stage.state)}`}>
                      {readinessStateLabel(row.stage.state)}
                    </span>
                  </div>
                  <p>{row.description}</p>
                  <div className="paper-readiness-meta">
                    <span>{row.stage.endpoint}</span>
                    <span>{stageDetailLine(row.stage)}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="paper-readiness-proof">
          <span>正式券商：未連接</span>
          <span>成交來源：paper_orders 後端狀態</span>
          <span>價格提醒：FinMind / K 線只作參考，不作 fill price</span>
        </div>
      </section>

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
            <Link className="terminal-button primary" href="/companies/2330">
              開啟 2330 公司頁
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
