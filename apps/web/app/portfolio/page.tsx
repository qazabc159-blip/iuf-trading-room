import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { OrderTicketForm } from "@/components/portfolio/OrderTicket";
import { KillSwitch } from "@/components/portfolio/KillSwitch";
import {
  getExecutionEvents,
  getKillSwitch,
  getRiskLimit,
  getTradingBalance,
  getTradingOrders,
  getTradingPositions,
  listStrategyRiskLimits,
  listSymbolRiskLimits,
} from "@/lib/api";
import type { KillMode } from "@/lib/radar-types";

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
        reason: "Trading endpoints returned no positions, orders, or execution events.",
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
      reason: error instanceof Error ? error.message : String(error),
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
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
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
  if (!kill) return "PEEK";
  if (kill.mode === "halted") return "FROZEN";
  if (kill.mode === "liquidate_only") return "SAFE";
  if (kill.mode === "paper_only") return "PEEK";
  return kill.engaged ? "FROZEN" : "ARMED";
}

function statusTone(status: OrderRow["status"]) {
  if (status === "filled" || status === "acknowledged") return "up";
  if (status === "rejected" || status === "expired") return "down";
  if (status === "pending" || status === "submitted" || status === "partial") return "gold";
  return "muted";
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="tg soft" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0 12px" }}>
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{result.state}</span>
      <span>{result.source}</span>
      <span>updated {formatTime(result.updatedAt)}</span>
      {result.state !== "LIVE" && <span>{result.reason}</span>}
    </div>
  );
}

function EmptyOrBlocked({ result }: { result: LoadState }) {
  if (result.state === "LIVE") return null;
  return (
    <div className="terminal-note">
      <span className={`tg ${stateTone(result.state)}`}>{result.state}</span>{" "}
      {result.reason}
    </div>
  );
}

export default async function PortfolioPage() {
  const result = await loadPortfolio();
  const data = result.data;
  const killMode = mapKillMode(data?.kill ?? null);

  return (
    <PageFrame
      code="06-PORT"
      title="Portfolio"
      sub="Paper execution desk"
      exec
      note="[06] PORTFOLIO reads production paper trading, risk, and kill-switch endpoints. Live broker submit remains outside this surface."
    >
      <div className="quote-strip">
        {[
          ["STATE", result.state, stateTone(result.state)],
          ["EQUITY", money(data?.balance.equity), tone(data?.balance.unrealizedPnl)],
          ["CASH", money(data?.balance.cash), "muted"],
          ["AVAILABLE", money(data?.balance.availableCash), "gold"],
          ["MKT VALUE", money(data?.balance.marketValue), "muted"],
          ["UNREAL PNL", money(data?.balance.unrealizedPnl), tone(data?.balance.unrealizedPnl)],
          ["KILL", data?.kill.mode ?? "--", data?.kill.engaged ? "down" : "gold"],
        ].map(([label, value, cls]) => (
          <div className="quote-card" key={String(label)}>
            <div className="tg quote-symbol">{label}</div>
            <div className={`quote-last num ${cls}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="exec-grid">
        <div>
          <Panel code="ORD-TKT" title={`${formatTime(result.updatedAt)} TPE`} sub="PAPER ORDER TICKET / CONTRACT 1" right={result.state}>
            <SourceLine result={result} />
            <EmptyOrBlocked result={result} />
            <OrderTicketForm killMode={killMode} />
          </Panel>

          <Panel code="POS-OPN" title="PAPER POSITIONS" sub="real trading positions endpoint" right={`${data?.positions.length ?? 0} ROWS`}>
            {data?.positions.length === 0 && <div className="terminal-note"><span className="tg gold">EMPTY</span> No open paper positions.</div>}
            {data && data.positions.length > 0 && (
              <div className="row position-row table-head tg">
                <span>SYM</span><span>MKT</span><span>QTY</span><span>AVG</span><span>P&L</span><span>%</span>
              </div>
            )}
            {data?.positions.map((position) => (
              <div className="row position-row" key={`${position.accountId}-${position.symbol}`}>
                <Link className="tg gold" href={`/companies/${position.symbol}`}>{position.symbol}</Link>
                <span className="tg muted">{position.market}</span>
                <span className="num">{position.quantity.toLocaleString()}</span>
                <span className="num">{money(position.avgPrice)}</span>
                <span className={`num ${tone(position.unrealizedPnl)}`}>{money(position.unrealizedPnl)}</span>
                <span className={`tg ${tone(position.unrealizedPnlPct)}`}>{pct(position.unrealizedPnlPct)}</span>
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="KIL-SW" title="KILL SWITCH" sub="real state / frontend write disabled" right={data?.kill.mode ?? "BLOCKED"}>
            <KillSwitch mode={killMode} />
            {data?.kill && (
              <div className="tg soft" style={{ display: "grid", gap: 6, marginTop: 12 }}>
                <span>account: {data.kill.accountId}</span>
                <span>engaged: {String(data.kill.engaged)} / reason: {data.kill.reason || "--"}</span>
                <span>updated: {formatTime(data.kill.updatedAt)}</span>
              </div>
            )}
          </Panel>

          <Panel code="RISK-BASE" title="ACCOUNT RISK LIMITS" sub="real risk limit endpoint" right={ACCOUNT_ID}>
            {data && [
              ["MAX/TRADE", `${data.risk.maxPerTradePct}%`],
              ["MAX DAILY LOSS", `${data.risk.maxDailyLossPct}%`],
              ["MAX SYMBOL", `${data.risk.maxSinglePositionPct}%`],
              ["MAX THEME", `${data.risk.maxThemeCorrelatedPct}%`],
              ["MAX GROSS", `${data.risk.maxGrossExposurePct}%`],
              ["OPEN ORDERS", String(data.risk.maxOpenOrders)],
              ["ORD/MIN", String(data.risk.maxOrdersPerMinute)],
              ["STALE QUOTE", `${data.risk.staleQuoteMs}ms`],
            ].map(([label, value]) => (
              <div className="row limit-row" key={label}>
                <span className="tg gold">{label}</span>
                <span className="tg" style={{ gridColumn: "span 2", textAlign: "right" }}>{value}</span>
              </div>
            ))}
          </Panel>

          <Panel code="RISK-OVR" title="STRATEGY / SYMBOL OVERRIDES" sub="read only" right={`${(data?.strategyLimits.length ?? 0) + (data?.symbolLimits.length ?? 0)} ROWS`}>
            {data?.strategyLimits.slice(0, 3).map((limit) => (
              <div className="row limit-row" key={limit.id}>
                <span className="tg gold">STRAT</span>
                <span className="tg" style={{ gridColumn: "span 2", textAlign: "right" }}>{limit.strategyId} / {limit.enabled ? "ON" : "OFF"}</span>
              </div>
            ))}
            {data?.symbolLimits.slice(0, 5).map((limit) => (
              <div className="row limit-row" key={limit.id}>
                <span className="tg gold">SYMBOL</span>
                <span className="tg" style={{ gridColumn: "span 2", textAlign: "right" }}>{limit.symbol} / {limit.enabled ? "ON" : "OFF"}</span>
              </div>
            ))}
            {data && data.strategyLimits.length === 0 && data.symbolLimits.length === 0 && (
              <div className="terminal-note"><span className="tg gold">EMPTY</span> No strategy or symbol overrides.</div>
            )}
          </Panel>
        </div>

        <div>
          <Panel code="ORD-LDG" title="PAPER ORDERS" sub="real order ledger endpoint" right={`${data?.orders.length ?? 0} ROWS`}>
            {data?.orders.length === 0 && <div className="terminal-note"><span className="tg gold">EMPTY</span> No paper orders returned.</div>}
            {data?.orders.slice(0, 10).map((order) => (
              <div className="row timeline-row" key={order.id}>
                <span className="tg soft">{formatTime(order.updatedAt)}</span>
                <span className={`tg ${statusTone(order.status)}`}>{order.status}</span>
                <span className="tg">{order.symbol} / {order.side} / {order.quantity.toLocaleString()} @ {order.price ?? "MKT"}</span>
                <span className="tg muted">{order.broker}</span>
              </div>
            ))}
          </Panel>

          <Panel code="EXC-TML" title="EXECUTION EVENTS" sub="real trading events endpoint" right={`${data?.events.length ?? 0} ROWS`}>
            {data?.events.length === 0 && <div className="terminal-note"><span className="tg gold">EMPTY</span> No execution events returned.</div>}
            {data?.events.slice(0, 12).map((event) => (
              <div className="row timeline-row" key={`${event.orderId}-${event.timestamp}-${event.type}`}>
                <span className="tg soft">{formatTime(event.timestamp)}</span>
                <span className={`tg ${statusTone(event.status)}`}>{event.type}</span>
                <span className="tg">{event.clientOrderId} / {event.status}</span>
                <span className="tg muted">{event.message ?? "--"}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
