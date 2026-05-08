import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { friendlyDataError } from "@/lib/friendly-error";
import {
  getPaperHealth,
  getPaperPortfolio,
  listPaperFills,
  type PaperFillLedgerRow,
  type PaperHealthState,
  type PaperPortfolioPosition,
} from "@/lib/paper-orders-api";

export const dynamic = "force-dynamic";

const PAPER_CAPITAL_TWD = 20_000;

type PortfolioState =
  | { state: "LIVE"; positions: PaperPortfolioPosition[]; updatedAt: string }
  | { state: "EMPTY"; positions: PaperPortfolioPosition[]; updatedAt: string; reason: string }
  | { state: "BLOCKED"; positions: PaperPortfolioPosition[]; updatedAt: string; reason: string };

type FillsState =
  | { state: "LIVE"; fills: PaperFillLedgerRow[]; updatedAt: string }
  | { state: "EMPTY"; fills: PaperFillLedgerRow[]; updatedAt: string; reason: string }
  | { state: "BLOCKED"; fills: PaperFillLedgerRow[]; updatedAt: string; reason: string };

type HealthState =
  | { state: "LIVE"; health: PaperHealthState; updatedAt: string }
  | { state: "BLOCKED"; health: null; updatedAt: string; reason: string };

function nowIso() {
  return new Date().toISOString();
}

function userFacingReason(error: unknown, fallback: string) {
  return friendlyDataError(error, fallback)
    .replace(/token|secret|session|cookie|authorization|bearer|api[-_]?key|env|database|redis|root_cause/gi, "資料來源");
}

async function loadPaperPortfolio(): Promise<PortfolioState> {
  const updatedAt = nowIso();
  try {
    const positions = await getPaperPortfolio();
    if (positions.length === 0) {
      return {
        state: "EMPTY",
        positions,
        updatedAt,
        reason: "目前沒有模擬持倉；先從公司頁開啟紙上交易預覽。",
      };
    }
    return { state: "LIVE", positions, updatedAt };
  } catch (error) {
    return {
      state: "BLOCKED",
      positions: [],
      updatedAt,
      reason: userFacingReason(error, "模擬部位讀取失敗"),
    };
  }
}

async function loadPaperFills(): Promise<FillsState> {
  const updatedAt = nowIso();
  try {
    const fills = await listPaperFills();
    if (fills.length === 0) {
      return {
        state: "EMPTY",
        fills,
        updatedAt,
        reason: "目前沒有模擬成交紀錄；送出 paper 委託後會出現在這裡。",
      };
    }
    return {
      state: "LIVE",
      fills,
      updatedAt: latestFillTime(fills) ?? updatedAt,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      fills: [],
      updatedAt,
      reason: userFacingReason(error, "模擬成交讀取失敗"),
    };
  }
}

async function loadPaperHealth(): Promise<HealthState> {
  const updatedAt = nowIso();
  try {
    return { state: "LIVE", health: await getPaperHealth(), updatedAt };
  } catch (error) {
    return {
      state: "BLOCKED",
      health: null,
      updatedAt,
      reason: userFacingReason(error, "模擬交易狀態讀取失敗"),
    };
  }
}

function stateLabel(state: PortfolioState["state"] | FillsState["state"] | HealthState["state"]) {
  if (state === "LIVE") return "可用";
  if (state === "EMPTY") return "尚無紀錄";
  return "需處理";
}

function stateClass(state: PortfolioState["state"] | FillsState["state"] | HealthState["state"]) {
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

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
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
  return `${fill.fillQty.toLocaleString("zh-TW")} 股`;
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
  if (lots === 0) return `${sign}${oddLots.toLocaleString("zh-TW")} 股`;
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
  if (!note) return "持倉中";
  if (note === "net_flat_or_short") return "已沖銷或淨空";
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

function gateLabel(health: PaperHealthState | null) {
  if (!health) return "需檢查";
  if (health.previewReady && health.gate.gateOpen) return "可預覽";
  if (health.previewReady) return "僅預覽";
  return "待開啟";
}

export default async function PortfolioPage() {
  const [portfolio, fillsResult, healthResult] = await Promise.all([
    loadPaperPortfolio(),
    loadPaperFills(),
    loadPaperHealth(),
  ]);
  const health = healthResult.state === "LIVE" ? healthResult.health : null;
  const paperCost = estimatedCost(portfolio.positions);
  const availableCapital = Math.max(PAPER_CAPITAL_TWD - paperCost, 0);
  const fillNotionalTotal = totalFillNotional(fillsResult.fills);
  const recentFills = fillsResult.fills.slice(0, 12);

  return (
    <PageFrame
      code="06"
      title="模擬交易室"
      sub="紙上委託、成交回顧與部位風控"
      exec
      note="這裡只處理 paper preview、paper submit、fills 與 portfolio；不連真實券商下單。"
    >
      <MetricStrip
        columns={4}
        cells={[
          { label: "模擬交易", value: gateLabel(health), tone: health?.previewReady ? "status-ok" : "gold" },
          { label: "風控閘門", value: health?.gate.gateOpen ? "開啟" : "守門", tone: health?.gate.gateOpen ? "status-ok" : "gold" },
          { label: "部位檔數", value: portfolio.positions.length, tone: portfolio.positions.length ? "gold" : "muted" },
          { label: "成交筆數", value: fillsResult.fills.length, tone: fillsResult.fills.length ? "status-ok" : "muted" },
          { label: "紙上資金", value: formatTwd(PAPER_CAPITAL_TWD) },
          { label: "已投入", value: formatTwd(paperCost), tone: paperCost > 0 ? "gold" : "muted" },
          { label: "可用資金", value: formatTwd(availableCapital), tone: "status-ok" },
          { label: "最近成交", value: formatTime(latestFillTime(fillsResult.fills)) },
        ]}
      />

      <section className="portfolio-truth-strip" aria-label="模擬交易原則">
        <div>
          <span className="tg gold">交易模式</span>
          <strong>紙上交易先走預覽與風控，不送真實委託。</strong>
        </div>
        <div>
          <span className="tg status-ok">資料來源</span>
          <strong>部位與成交直接讀 paper ledger，價格研究仍回到公司頁與 FinMind。</strong>
        </div>
        <div>
          <span className="tg muted">台股單位</span>
          <strong>1 張 = 1,000 股；整股與零股都以股數統一回算。</strong>
        </div>
      </section>

      {healthResult.state === "BLOCKED" && (
        <section className="portfolio-auth-repair" aria-label="模擬交易狀態">
          <div>
            <span className="tg status-bad">需處理</span>
            <h2>模擬交易狀態尚未讀取成功</h2>
            <p>{healthResult.reason}</p>
          </div>
          <Link className="terminal-button primary" href="/login">
            重新登入
          </Link>
        </section>
      )}

      <section className="portfolio-workbench-grid">
        <div>
          <Panel
            code="06-PORT"
            title="持倉"
            sub="只呈現 FILLED 後形成的紙上部位。"
            right={<span className={stateClass(portfolio.state)}>{stateLabel(portfolio.state)}</span>}
          >
            {portfolio.state !== "LIVE" && (
              <div className="terminal-note portfolio-empty-note">
                <span className={`tg ${stateClass(portfolio.state)}`}>{stateLabel(portfolio.state)}</span>
                <span>{portfolio.reason}</span>
              </div>
            )}

            {portfolio.positions.length > 0 && (
              <div className="portfolio-position-table" role="table" aria-label="紙上持倉">
                <div className="portfolio-position-row portfolio-position-head" role="row">
                  <span>代號</span>
                  <span>股數</span>
                  <span>張 / 股</span>
                  <span>均價</span>
                  <span>投入金額</span>
                  <span>成交</span>
                  <span>狀態</span>
                </div>
                {portfolio.positions.map((position) => (
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
          </Panel>

          <Panel
            code="FILL"
            title="成交回顧"
            sub="紙上成交明細，方便回看委託與資金使用。"
            right={<span className={stateClass(fillsResult.state)}>{stateLabel(fillsResult.state)}</span>}
          >
            {fillsResult.state !== "LIVE" && (
              <div className="terminal-note portfolio-empty-note">
                <span className={`tg ${stateClass(fillsResult.state)}`}>{stateLabel(fillsResult.state)}</span>
                <span>{fillsResult.reason}</span>
              </div>
            )}

            {recentFills.length > 0 && (
              <div className="portfolio-fill-table" role="table" aria-label="紙上成交紀錄">
                <div className="portfolio-fill-row portfolio-fill-head" role="row">
                  <span>時間</span>
                  <span>代號</span>
                  <span>方向</span>
                  <span>型態</span>
                  <span>單位</span>
                  <span>股數</span>
                  <span>成交價</span>
                  <span>金額</span>
                  <span>委託</span>
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
          </Panel>
        </div>

        <div>
          <Panel code="RISK" title="風控摘要" sub="確認能不能進下一步，而不是直接下單。" right={gateLabel(health)}>
            <div className="runs-truth-stack">
              <span>預覽：{health?.previewReady ? "可用" : "待開啟"}</span>
              <span>成交回顧：{health?.fillsReady ? "可用" : "待同步"}</span>
              <span>部位：{health?.portfolioReady ? "可用" : "待同步"}</span>
              <span>佇列：{health?.queueDepth ?? 0} 筆待處理</span>
            </div>
          </Panel>

          <Panel code="NEXT" title="下一步" sub="回公司頁做 paper preview，這裡看結果與部位。" right="Paper">
            <div className="portfolio-action-grid">
              <Link className="terminal-button primary" href="/companies/2330#paper-order">
                開啟 2330 紙上預覽
              </Link>
              <Link className="terminal-button" href="/companies">
                回公司池
              </Link>
            </div>
          </Panel>
        </div>

        <div>
          <Panel code="CAP" title="資金摘要" sub="用紙上資金估算占用，不當作實際券商餘額。" right={formatTwd(fillNotionalTotal)}>
            <ul className="portfolio-proof-list">
              <li>紙上資金：{formatTwd(PAPER_CAPITAL_TWD)}</li>
              <li>已投入：{formatTwd(paperCost)}</li>
              <li>可用資金：{formatTwd(availableCapital)}</li>
              <li>持倉股數：{formatShares(totalShares(portfolio.positions))}</li>
              <li>成交總額：{formatTwd(fillNotionalTotal)}</li>
            </ul>
          </Panel>
        </div>
      </section>
    </PageFrame>
  );
}
