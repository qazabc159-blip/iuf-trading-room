import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
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
  const posState = portfolio.state === "LIVE" ? "ok" : portfolio.state === "EMPTY" ? "warn" : "bad";
  const fillState = fillsResult.state === "LIVE" ? "ok" : fillsResult.state === "EMPTY" ? "warn" : "bad";

  return (
    <PageFrame code="06" title="模擬交易室" sub="紙上委託、成交回顧與部位風控" exec
      note="這裡只處理 paper preview、paper submit、fills 與 portfolio；不連真實券商下單。">
      <div className="parity-kpi-bar">
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">模擬交易</span>
          <span className={`parity-kpi-value ${health?.previewReady ? "ok" : "warn"}`}>{gateLabel(health)}</span>
          <span className="parity-kpi-sub">Paper 模式</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">風控閘門</span>
          <span className={`parity-kpi-value ${health?.gate.gateOpen ? "ok" : "warn"}`}>{health?.gate.gateOpen ? "開啟" : "守門"}</span>
          <span className="parity-kpi-sub">Gate 狀態</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">部位檔數</span>
          <span className={`parity-kpi-value ${portfolio.positions.length ? "warn" : "dim"}`}>{portfolio.positions.length}</span>
          <span className="parity-kpi-sub">模擬持倉</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">成交筆數</span>
          <span className={`parity-kpi-value ${fillsResult.fills.length ? "ok" : "dim"}`}>{fillsResult.fills.length}</span>
          <span className="parity-kpi-sub">已成交</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">紙上資金</span>
          <span className="parity-kpi-value">{formatTwd(PAPER_CAPITAL_TWD)}</span>
          <span className="parity-kpi-sub">模擬本金</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">已投入</span>
          <span className={`parity-kpi-value ${paperCost > 0 ? "warn" : "dim"}`}>{formatTwd(paperCost)}</span>
          <span className="parity-kpi-sub">持倉估算</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">可用資金</span>
          <span className="parity-kpi-value ok">{formatTwd(availableCapital)}</span>
          <span className="parity-kpi-sub">尚未投入</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">最近成交</span>
          <span className="parity-kpi-value" style={{ fontSize: 14 }}>{formatTime(latestFillTime(fillsResult.fills))}</span>
          <span className="parity-kpi-sub">成交時間</span>
        </div>
      </div>

      <div className="parity-hero">
        <div className="parity-hero-eyebrow">IUF / PAPER PORTFOLIO / 模擬交易室</div>
        <h2>紙上交易先走預覽與風控，不送真實委託。</h2>
        <p>部位與成交直接讀 paper ledger，價格研究仍回到公司頁與 FinMind。台股單位：1 張 = 1,000 股；整股與零股都以股數統一回算。</p>
      </div>

      {healthResult.state === "BLOCKED" && (
        <div className="terminal-note">
          <span className="tg status-bad">需處理</span>{" "}
          模擬交易狀態尚未讀取成功：{healthResult.reason}
        </div>
      )}

      <section className="parity-section">
        <div className="parity-section-head">
          <h3>持倉</h3>
          <span className="spacer" />
          <span className={`parity-badge ${posState}`}>{stateLabel(portfolio.state)}</span>
          <span className="tg muted" style={{ fontSize: 10 }}>只呈現 FILLED 後形成的紙上部位</span>
        </div>
        <div className="parity-section-body">
          {portfolio.state !== "LIVE" && (
            <div className="terminal-note compact">
              <span className={`tg ${"reason" in portfolio ? (portfolio.state === "EMPTY" ? "gold" : "status-bad") : "muted"}`}>{stateLabel(portfolio.state)}</span>{" "}
              {"reason" in portfolio ? portfolio.reason : ""}
            </div>
          )}
          {portfolio.positions.length > 0 ? (
            <table className="parity-table">
              <thead>
                <tr>
                  <th>代號</th><th>公司</th><th className="num-cell">淨股數</th>
                  <th className="num-cell">平均成本</th><th className="num-cell">估算市值</th><th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.positions.map((pos) => (
                  <tr key={pos.companyId}>
                    <td>
                      <Link href={`/companies/${encodeURIComponent(pos.symbol ?? pos.companyId)}`} className="tg gold">
                        {pos.symbol ?? pos.companyId.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{pos.companyName}</td>
                    <td className="num-cell">{formatShares(pos.netQtyShares)}</td>
                    <td className="num-cell">{avgCostLabel(pos)}</td>
                    <td className="num-cell">{notionalLabel(pos)}</td>
                    <td><span className="parity-badge warn">{noteLabel(pos.note)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : portfolio.state === "LIVE" ? (
            <div className="parity-empty" style={{ minHeight: 100 }}>
              <h3>目前沒有模擬持倉</h3>
              <p>先從公司頁開啟紙上交易預覽。</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="parity-section" style={{ marginTop: 20 }}>
        <div className="parity-section-head">
          <h3>成交紀錄</h3>
          <span className="spacer" />
          <span className={`parity-badge ${fillState}`}>{stateLabel(fillsResult.state)}</span>
          {fillsResult.fills.length > 0 && (
            <span className="tg muted" style={{ fontSize: 10 }}>共 {fillsResult.fills.length} 筆 / 成交總額 {formatTwd(fillNotionalTotal)}</span>
          )}
        </div>
        <div className="parity-section-body">
          {fillsResult.state !== "LIVE" && (
            <div className="terminal-note compact">
              <span className={`tg ${"reason" in fillsResult ? (fillsResult.state === "EMPTY" ? "gold" : "status-bad") : "muted"}`}>{stateLabel(fillsResult.state)}</span>{" "}
              {"reason" in fillsResult ? fillsResult.reason : ""}
            </div>
          )}
          {recentFills.length > 0 ? (
            <table className="parity-table">
              <thead>
                <tr>
                  <th>時間</th><th>代號</th><th>方向</th><th>數量</th>
                  <th className="num-cell">成交價</th><th className="num-cell">金額</th><th>委託類型</th>
                </tr>
              </thead>
              <tbody>
                {recentFills.map((fill) => (
                  <tr key={fill.orderId + (fill.fillTime ?? "")}>
                    <td>{formatTime(fill.fillTime)}</td>
                    <td className="tg gold">{fill.ticker ?? fill.orderId.slice(0, 6)}</td>
                    <td><span className={`parity-badge ${fill.side === "buy" ? "ok" : "bad"}`}>{sideLabel(fill.side)}</span></td>
                    <td>{fillUnitLabel(fill)}</td>
                    <td className="num-cell">{formatTwd(fill.fillPrice)}</td>
                    <td className="num-cell">{formatTwd(fillNotional(fill))}</td>
                    <td>{orderTypeLabel(fill.orderType)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : fillsResult.state === "LIVE" ? (
            <div className="parity-empty" style={{ minHeight: 100 }}>
              <h3>目前沒有成交紀錄</h3>
              <p>送出 paper 委託後會出現在這裡。</p>
            </div>
          ) : null}
        </div>
      </section>
    </PageFrame>
  );
}
