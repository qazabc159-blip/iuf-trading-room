"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  ExecutionEvent,
  KillMode,
  Position,
  Quote,
  RiskLimit,
  StrategyRiskLimit,
  SymbolRiskLimit,
} from "@/lib/radar-types";
import { Panel } from "@/components/PageFrame";
import { OrderTicketForm } from "@/components/portfolio/OrderTicket";
import { KillSwitch } from "@/components/portfolio/KillSwitch";

function tone(value: number) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

function signed(value: number, digits = 2) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function QuoteStrip({ quotes, positions }: { quotes: Quote[]; positions: Position[] }) {
  // Show quotes for held positions + TWA index quote if present
  // VIX·TW hardcode removed — no live data source
  const cards = [
    ...quotes.filter((q) => positions.some((p) => p.symbol === q.symbol)).slice(0, 4),
    ...(quotes.find((q) => q.symbol === "TWA") ? [quotes.find((q) => q.symbol === "TWA") as Quote] : []),
  ];

  return (
    <div className="quote-strip">
      {cards.map((q) => {
        const pos = positions.find((p) => p.symbol === q.symbol);
        return (
          <div className="quote-card" key={q.symbol}>
            <div className="tg">
              <span className="quote-symbol">{q.symbol}</span>
              <span className={`quote-state ${q.state === "LIVE" ? "gold" : ""}`}>{q.state === "LIVE" ? "● LIVE" : q.state}</span>
            </div>
            <div className="tc soft" style={{ marginTop: 4 }}>{pos?.name ?? (q.symbol === "TWA" ? "TAIEX" : "波動率")}</div>
            <div className={`quote-last num ${tone(q.change)}`}>
              {q.last.toLocaleString("en-US", { maximumFractionDigits: q.last > 1000 ? 0 : 2 })}
            </div>
            <div className={`tg ${tone(q.change)}`}>
              ▲ {signed(q.change, q.last > 1000 ? 0 : 2)} <span style={{ marginLeft: 18 }}>{signed(q.changePct, 2)}%</span>
            </div>
            <div className="tg soft">T-02S</div>
          </div>
        );
      })}
    </div>
  );
}

function Status({ result }: { result: RiskLimit["result"] }) {
  const cls = result === "PASS" ? "up" : result === "WARN" ? "gold" : "down";
  return <span className={`tg ${cls}`}><span className="status-dot" />{result}</span>;
}

export function PortfolioClient({
  initialKill,
  positions,
  riskLimits,
  strategyLimits,
  symbolLimits,
  quotes,
  events,
}: {
  initialKill: KillMode;
  positions: Position[];
  riskLimits: RiskLimit[];
  strategyLimits: StrategyRiskLimit[];
  symbolLimits: SymbolRiskLimit[];
  quotes: Quote[];
  events: ExecutionEvent[];
}) {
  const [killMode, setKillMode] = useState<KillMode>(initialKill);
  const totalPnl = useMemo(() => positions.reduce((sum, p) => sum + p.pnlTwd, 0), [positions]);

  return (
    <>
      <QuoteStrip quotes={quotes} positions={positions} />

      <div className="exec-grid">
        <div>
          <Panel code="ORD-TKT" title="14:32:08 TPE · ● LIVE" sub="ORDER TICKET · EXECUTION DESK" right="KILL AWARE">
            <OrderTicketForm killMode={killMode} />
          </Panel>

          {/* SIZ-BRK removed — no live sizing data source; will be wired when position-sizer endpoint lands */}
        </div>

        <div>
          <Panel code="LMT-EFF" title="14:32:08 TPE" sub="風控有效值 · EFFECTIVE LIMITS" right="3 LAYERS ACTIVE">
            <div style={{ border: "1px solid var(--night-rule-strong)" }}>
              {riskLimits.map((limit) => (
                <div className="row limit-row" key={limit.rule}>
                  <span className="tg" style={{ fontWeight: 700 }}>{limit.rule}</span>
                  <span className="num" style={{ textAlign: "right" }}>{limit.limit} <span className="soft">{limit.current}</span></span>
                  <Status result={limit.result} />
                </div>
              ))}
            </div>
          </Panel>

          <Panel code="KIL-SW" title="14:32:08 TPE" sub="模式 · 4-MODE KILL SWITCH" right={`CURRENT · ${killMode}`}>
            {/* KillSwitch component — requires confirm dialog before mode change; api.killMode is mockOnly (hard line) */}
            <KillSwitch mode={killMode} onChange={setKillMode} />
          </Panel>

          <Panel code="OVR-PNL" title="14:32:08 TPE" sub="覆蓋面板 · ACCOUNT / STRAT / SYMBOL" right={totalPnl >= 0 ? "ACTIVE" : "WATCH"}>
            {strategyLimits.slice(0, 1).map((s) => (
              <div className="row limit-row" key={s.id}>
                <span className="tg">STRATEGY · {s.scopeKey}</span>
                <span className="num">{((s.themePosPct ?? 0) * 100).toFixed(1)}% thm</span>
                <span className="tg gold">OVR ACTIVE</span>
              </div>
            ))}
            {symbolLimits.slice(0, 2).map((s) => (
              <div className="row limit-row" key={s.id}>
                <span className="tg">SYMBOL · {s.scopeKey}</span>
                <span className="num">{((s.singlePosPct ?? 0) * 100).toFixed(1)}% sym</span>
                <span className="tg soft">DEFAULT</span>
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="EXC-TML" title="14:32:08 TPE · ● LIVE" sub="即時執行 · EXECUTION TIMELINE" right="SSE · LIVE">
            {events.slice(0, 9).map((event) => {
              const time = new Date(event.ts).toLocaleTimeString("zh-TW", { hour12: false });
              const fill = event.kind === "order_filled";
              const blocked = event.kind === "risk_blocked" || event.kind === "order_rejected";
              return (
                <div className="row timeline-row" key={event.id}>
                  <span className="tg soft">{time}</span>
                  <span className={`tg ${fill ? "up" : blocked ? "gold" : "muted"}`}>
                    <span className="status-dot" />{event.kind.replace("order_", "").replace("_", "-").toUpperCase()}
                  </span>
                  <span className="tg">{event.symbol} · {event.qty?.toLocaleString() ?? "-"} @ {event.price ?? "-"}</span>
                  <span className="tg muted">—</span>
                </div>
              );
            })}
          </Panel>

          <Panel code="POS-OPN" title="14:32:08 TPE" sub="持倉 · OPEN POSITIONS" right={`${positions.length} 持倉`}>
            <div className="row position-row table-head tg">
              <span>SYM</span><span>名稱</span><span>LAST</span><span>CHG</span><span>P&L</span><span>%NAV</span>
            </div>
            {positions.map((p) => (
              <div className="row position-row" key={p.symbol}>
                <Link className="tg" href={`/companies/${p.symbol}`} style={{ fontWeight: 700 }}>{p.symbol}</Link>
                <span className="tc">{p.name}</span>
                <span className="num">{p.lastPx.toLocaleString()}</span>
                <span className={`tg ${tone(p.changePct)}`}>▲ {signed(p.changePct, 2)}%</span>
                <span className={`num ${tone(p.pnlTwd)}`}>{p.pnlTwd >= 0 ? "+" : ""}{p.pnlTwd.toLocaleString()}</span>
                <span className="num muted">{p.pctNav.toFixed(1)}%</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </>
  );
}
