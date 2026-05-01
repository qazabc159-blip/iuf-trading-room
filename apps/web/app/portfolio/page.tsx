import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { OrderTicketForm } from "@/components/portfolio/OrderTicket";
import { KillSwitch } from "@/components/portfolio/KillSwitch";
import type { KillMode } from "@/components/portfolio/KillSwitch";
import { PositionRiskBadge } from "@/components/portfolio/PositionRiskBadge";
import { RiskSurface } from "@/components/portfolio/RiskSurface";
import type { RiskSurfaceState } from "@/components/portfolio/RiskSurface";
import {
  getExecutionEvents,
  getKillSwitch,
  getRiskPortfolioOverview,
  getRiskLimit,
  getTradingBalance,
  getTradingOrders,
  getTradingPositions,
  listStrategyRiskLimits,
  listSymbolRiskLimits,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

export const dynamic = "force-dynamic";

const ACCOUNT_ID = "paper-default";

type BalanceRow = Awaited<ReturnType<typeof getTradingBalance>>["data"];
type PositionRow = Awaited<ReturnType<typeof getTradingPositions>>["data"][number];
type OrderRow = Awaited<ReturnType<typeof getTradingOrders>>["data"][number];
type EventRow = Awaited<ReturnType<typeof getExecutionEvents>>["data"][number];
type RiskRow = Awaited<ReturnType<typeof getRiskLimit>>["data"];
type StrategyLimitRow = Awaited<ReturnType<typeof listStrategyRiskLimits>>["data"][number];
type SymbolLimitRow = Awaited<ReturnType<typeof listSymbolRiskLimits>>["data"][number];
type KillState = Awaited<ReturnType<typeof getKillSwitch>>["data"];
type PortfolioData = {
  balance: BalanceRow;
  positions: PositionRow[];
  orders: OrderRow[];
  events: EventRow[];
  risk: RiskRow;
  strategyLimits: StrategyLimitRow[];
  symbolLimits: SymbolLimitRow[];
  kill: KillState;
};
type LoadState =
  | { state: "LIVE"; data: PortfolioData | null; updatedAt: string; source: string }
  | { state: "EMPTY"; data: PortfolioData | null; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: PortfolioData | null; updatedAt: string; source: string; reason: string };

function friendlyError(error: unknown) {
  return friendlyDataError(error, "交易室資料暫時無法讀取。");
}

function displayState(state: LoadState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

async function loadPortfolio(): Promise<LoadState> {
  const source = `GET trading/risk endpoints for accountId=${ACCOUNT_ID}`;
  const updatedAt = new Date().toISOString();

  try {
    const [balance, positions, orders, events, risk, strategyLimits, symbolLimits, kill] = await Promise.all([
      getTradingBalance(ACCOUNT_ID),
      getTradingPositions(ACCOUNT_ID),
      getTradingOrders({ accountId: ACCOUNT_ID }),
      getExecutionEvents({ accountId: ACCOUNT_ID, limit: 20 }),
      getRiskLimit(ACCOUNT_ID),
      listStrategyRiskLimits(ACCOUNT_ID),
      listSymbolRiskLimits(ACCOUNT_ID),
      getKillSwitch(ACCOUNT_ID),
    ]);
    const data: PortfolioData = {
      balance: balance.data,
      positions: positions.data,
      orders: orders.data,
      events: events.data,
      risk: risk.data,
      strategyLimits: strategyLimits.data,
      symbolLimits: symbolLimits.data,
      kill: kill.data,
    };
    if (data.positions.length === 0 && data.orders.length === 0 && data.events.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt: data.balance.updatedAt || updatedAt,
        source,
        reason: "目前沒有部位、委託或成交事件。",
      };
    }
    return {
      state: "LIVE",
      data,
      updatedAt: data.balance.updatedAt || updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: null,
      updatedAt,
      source,
      reason: friendlyError(error),
    };
  }
}

async function loadRiskSurface(): Promise<RiskSurfaceState> {
  const source = "GET /api/v1/risk/portfolio-overview";
  const updatedAt = new Date().toISOString();

  try {
    const overview = await getRiskPortfolioOverview();
    return {
      state: "LIVE",
      data: overview.data,
      updatedAt: overview.data.generatedAt || updatedAt,
      source,
    };
  } catch (error) {
    return {
      state: "BLOCKED",
      updatedAt,
      source,
      reason: friendlyError(error),
    };
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function money(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

function pct(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function tone(value: number | null | undefined) {
  if (typeof value !== "number") return "muted";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

function stateTone(state: LoadState["state"]) {
  if (state === "LIVE") return "up";
  if (state === "EMPTY") return "gold";
  return "down";
}

function mapKillMode(kill: KillState | null): KillMode {
  if (!kill) return "FROZEN";
  if (kill.mode === "halted") return "FROZEN";
  if (kill.mode === "liquidate_only") return "SAFE";
  if (kill.mode === "paper_only") return "PEEK";
  return kill.engaged ? "FROZEN" : "ARMED";
}

function killModeLabel(mode: string | null | undefined) {
  if (mode === "trading") return "可交易";
  if (mode === "paper_only") return "模擬模式";
  if (mode === "liquidate_only") return "只減倉";
  if (mode === "halted") return "全鎖定";
  return "保守鎖定";
}

function accountLabel(value: string | null | undefined) {
  if (!value) return "模擬帳戶";
  if (value === ACCOUNT_ID) return "模擬帳戶";
  return value;
}

function durationLabel(ms: number | null | undefined) {
  if (typeof ms !== "number") return "--";
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000} 秒`;
  return `${ms} ms`;
}

function statusTone(status: OrderRow["status"]) {
  if (status === "filled" || status === "acknowledged") return "up";
  if (status === "rejected" || status === "expired") return "down";
  if (status === "pending" || status === "submitted" || status === "partial") return "gold";
  return "muted";
}

function orderStatusLabel(status: OrderRow["status"]) {
  if (status === "filled") return "已成交";
  if (status === "acknowledged") return "已回報";
  if (status === "rejected") return "已拒絕";
  if (status === "expired") return "已逾時";
  if (status === "pending") return "待處理";
  if (status === "submitted") return "已送出";
  if (status === "partial") return "部分成交";
  return status;
}

function sideLabel(side: string) {
  if (side.toLowerCase() === "buy") return "買進";
  if (side.toLowerCase() === "sell") return "賣出";
  return side;
}

function eventTypeLabel(type: string) {
  if (type === "order_submitted") return "委託送出";
  if (type === "order_acknowledged") return "委託回報";
  if (type === "order_rejected") return "委託拒絕";
  if (type === "order_filled") return "成交";
  if (type === "order_cancelled") return "撤單";
  if (type === "fill") return "成交";
  return type;
}

function eventStatusLabel(status: string) {
  if (status === "filled") return "已成交";
  if (status === "acknowledged") return "已回報";
  if (status === "rejected") return "已拒絕";
  if (status === "cancelled") return "已撤單";
  if (status === "submitted") return "已送出";
  if (status === "pending") return "待處理";
  return status;
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="tg soft" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0 12px" }}>
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{displayState(result.state)}</span>
      <span>模擬交易資料</span>
      <span>更新 {formatTime(result.updatedAt)}</span>
      {result.state !== "LIVE" && <span>{result.reason}</span>}
    </div>
  );
}

function EmptyOrBlocked({ result }: { result: LoadState }) {
  if (result.state === "LIVE") return null;
  return (
    <div className="terminal-note">
      <span className={`tg ${stateTone(result.state)}`}>{displayState(result.state)}</span>{" "}
      {result.reason}
    </div>
  );
}

export default async function PortfolioPage() {
  const [result, riskSurface] = await Promise.all([loadPortfolio(), loadRiskSurface()]);
  const data = result.data;
  const killMode = mapKillMode(data?.kill ?? null);
  const riskAttributionBySymbol = new Map(
    riskSurface.state === "LIVE"
      ? riskSurface.data.positionAttribution.map((row) => [row.symbol, row])
      : []
  );

  return (
    <PageFrame
      code="06-PORT"
      title="交易室"
      sub="部位 / 委託 / 風控"
      exec
      note="交易室目前使用模擬委託與真實後端資料；正式券商送單等待凱基 libCGCrypt.so 後再接上。"
    >
      <div className="quote-strip">
        {[
          ["狀態", displayState(result.state), stateTone(result.state)],
          ["權益", money(data?.balance.equity), tone(data?.balance.unrealizedPnl)],
          ["現金", money(data?.balance.cash), "muted"],
          ["可用資金", money(data?.balance.availableCash), "gold"],
          ["市值", money(data?.balance.marketValue), "muted"],
          ["未實現損益", money(data?.balance.unrealizedPnl), tone(data?.balance.unrealizedPnl)],
          ["交易模式", data?.kill.mode ? "模擬" : "保守鎖定", data?.kill.engaged || !data?.kill ? "down" : "gold"],
        ].map(([label, value, cls]) => (
          <div className="quote-card" key={String(label)}>
            <div className="tg quote-symbol">{label}</div>
            <div className={`quote-last num ${cls}`}>{value}</div>
          </div>
        ))}
      </div>

      <Panel code="RSK-SFC" title="風控總覽" sub="帳戶 / 策略 / 個股 / 盤中" right={riskSurface.state === "LIVE" ? "即時" : "待啟用"}>
        <RiskSurface result={riskSurface} />
      </Panel>

      <div className="exec-grid" style={{ marginTop: 20 }}>
        <div>
          <div id="order-ticket">
            <Panel code="ORD-TKT" title={`${formatTime(result.updatedAt)} 台北`} sub="模擬委託單" right={displayState(result.state)}>
              <SourceLine result={result} />
              <EmptyOrBlocked result={result} />
              <OrderTicketForm killMode={killMode} />
            </Panel>
          </div>

          <Panel code="POS-OPN" title="模擬部位" sub="目前持倉" right={data ? `${data.positions.length} 筆` : "暫停"}>
            {!data && <div className="terminal-note"><span className="tg down">暫停</span> 暫時無法取得模擬部位。</div>}
            {data?.positions.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有模擬部位。</div>}
            {data && data.positions.length > 0 && (
              <div className="row position-row table-head tg" style={positionRiskRowStyle}>
                <span>股票</span><span>市場</span><span>股數</span><span>均價</span><span>損益</span><span>%</span><span>風控</span>
              </div>
            )}
            {data?.positions.map((position) => (
              <div className="row position-row" key={`${position.accountId}-${position.symbol}`} style={positionRiskRowStyle}>
                <Link className="tg gold" href={`/companies/${position.symbol}`}>{position.symbol}</Link>
                <span className="tg muted">{position.market}</span>
                <span className="num">{position.quantity.toLocaleString()}</span>
                <span className="num">{money(position.avgPrice)}</span>
                <span className={`num ${tone(position.unrealizedPnl)}`}>{money(position.unrealizedPnl)}</span>
                <span className={`tg ${tone(position.unrealizedPnlPct)}`}>{pct(position.unrealizedPnlPct)}</span>
                <PositionRiskBadge
                  blockedReason={riskSurface.state === "BLOCKED" ? riskSurface.reason : undefined}
                  layers={riskSurface.state === "LIVE" ? riskSurface.data.layers : null}
                  overviewState={riskSurface.state}
                  row={riskAttributionBySymbol.get(position.symbol) ?? null}
                />
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="KIL-SW" title="交易模式" sub="後端控管 / 前端唯讀" right={killModeLabel(data?.kill.mode)}>
            <KillSwitch mode={killMode} />
            {!data?.kill && (
              <div className="terminal-note" style={{ marginTop: 12 }}>
                未取得可信交易模式，委託區採保守鎖定。
              </div>
            )}
            {data?.kill && (
              <div className="tg soft" style={{ display: "grid", gap: 6, marginTop: 12 }}>
                <span>帳戶：{accountLabel(data.kill.accountId)}</span>
                <span>鎖定：{data.kill.engaged ? "是" : "否"} / 原因：{data.kill.reason || "--"}</span>
                <span>更新：{formatTime(data.kill.updatedAt)}</span>
              </div>
            )}
          </Panel>

          <Panel code="RISK-BASE" title="帳戶風控限制" sub="模擬交易限制" right={accountLabel(ACCOUNT_ID)}>
            {!data && <div className="terminal-note"><span className="tg down">暫停</span> 暫時無法取得風控限制。</div>}
            {data && [
              ["單筆上限", `${data.risk.maxPerTradePct}%`],
              ["單日虧損", `${data.risk.maxDailyLossPct}%`],
              ["個股上限", `${data.risk.maxSinglePositionPct}%`],
              ["主題曝險", `${data.risk.maxThemeCorrelatedPct}%`],
              ["總曝險", `${data.risk.maxGrossExposurePct}%`],
              ["開放委託", String(data.risk.maxOpenOrders)],
              ["每分鐘委託", String(data.risk.maxOrdersPerMinute)],
              ["報價過期", durationLabel(data.risk.staleQuoteMs)],
            ].map(([label, value]) => (
              <div className="row limit-row" key={label}>
                <span className="tg gold">{label}</span>
                <span className="tg" style={{ gridColumn: "span 2", textAlign: "right" }}>{value}</span>
              </div>
            ))}
          </Panel>

          <Panel code="RISK-OVR" title="策略 / 個股限制" sub="唯讀" right={data ? `${data.strategyLimits.length + data.symbolLimits.length} 筆` : "暫停"}>
            {!data && <div className="terminal-note"><span className="tg down">暫停</span> 暫時無法取得策略與個股限制。</div>}
            {data?.strategyLimits.slice(0, 3).map((limit) => (
              <div className="row limit-row" key={limit.id}>
                <span className="tg gold">策略</span>
                <span className="tg" style={{ gridColumn: "span 2", textAlign: "right" }}>{limit.strategyId} / {limit.enabled ? "啟用" : "停用"}</span>
              </div>
            ))}
            {data?.symbolLimits.slice(0, 5).map((limit) => (
              <div className="row limit-row" key={limit.id}>
                <span className="tg gold">個股</span>
                <span className="tg" style={{ gridColumn: "span 2", textAlign: "right" }}>{limit.symbol} / {limit.enabled ? "啟用" : "停用"}</span>
              </div>
            ))}
            {data && data.strategyLimits.length === 0 && data.symbolLimits.length === 0 && (
              <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有策略或個股覆寫限制。</div>
            )}
          </Panel>
        </div>

        <div>
          <Panel code="ORD-LDG" title="模擬委託" sub="委託紀錄" right={data ? `${data.orders.length} 筆` : "暫停"}>
            {!data && <div className="terminal-note"><span className="tg down">暫停</span> 暫時無法取得模擬委託紀錄。</div>}
            {data?.orders.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有模擬委託。</div>}
            {data?.orders.slice(0, 10).map((order) => (
              <div className="row timeline-row" key={order.id}>
                <span className="tg soft">{formatTime(order.updatedAt)}</span>
                <span className={`tg ${statusTone(order.status)}`}>{orderStatusLabel(order.status)}</span>
                <span className="tg">{order.symbol} / {sideLabel(order.side)} / {order.quantity.toLocaleString()} @ {order.price ?? "市價"}</span>
                <span className="tg muted">{order.broker}</span>
              </div>
            ))}
          </Panel>

          <Panel code="EXC-TML" title="成交事件" sub="模擬交易事件" right={data ? `${data.events.length} 筆` : "暫停"}>
            {!data && <div className="terminal-note"><span className="tg down">暫停</span> 暫時無法取得成交事件。</div>}
            {data?.events.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有成交事件。</div>}
            {data?.events.slice(0, 12).map((event) => (
              <div className="row timeline-row" key={`${event.orderId}-${event.timestamp}-${event.type}`}>
                <span className="tg soft">{formatTime(event.timestamp)}</span>
                <span className={`tg ${statusTone(event.status)}`}>{eventTypeLabel(event.type)}</span>
                <span className="tg">{event.clientOrderId} / {eventStatusLabel(event.status)}</span>
                <span className="tg muted">{event.message ?? "--"}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}

const positionRiskRowStyle: React.CSSProperties = {
  gridTemplateColumns: "48px minmax(54px, 1fr) 62px 62px 78px 54px 76px",
};
