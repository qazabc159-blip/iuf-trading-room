import Link from "next/link";
import { PageFrame, Panel } from "@/components/PageFrame";
import { api } from "@/lib/radar-api";
import type { Theme } from "@/lib/radar-types";

export const dynamic = "force-dynamic";

function signedTone(value: number) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

function signed(value: number, digits = 0) {
  const text = digits > 0 ? value.toFixed(digits) : String(value);
  return `${value > 0 ? "+" : ""}${text}`;
}

function Momentum({ value }: { value: Theme["momentum"] }) {
  if (value === "ACCEL") return <span className="up">▲ ACL</span>;
  if (value === "DECEL") return <span className="down">▼ DCL</span>;
  return <span className="muted">● STD</span>;
}

function Spark({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const points = values
    .map((v, i) => {
      const x = 4 + i * 13;
      const y = 20 - ((v - min) / span) * 17;
      return `${x},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="spark" viewBox="0 0 96 24" aria-hidden>
      <polyline points={points} fill="none" stroke="var(--night-mid)" strokeWidth="1.2" />
    </svg>
  );
}

function MarketStrip({
  quotes,
  heat,
}: {
  quotes: Awaited<ReturnType<typeof api.quotes>>;
  heat: number;
}) {
  const twa = quotes.find((q) => q.symbol === "TWA");
  const cards = [
    { sym: "TAIEX", name: "TAIEX", last: twa?.last ?? 21486.4, change: twa?.change ?? 184.22, pct: twa?.changePct ?? 0.86, state: "CLOSE" },
    { sym: "TPEX", name: "TPEx", last: 264.18, change: 1.94, pct: 0.74, state: "CLOSE" },
    { sym: "TURNOVER·BN", name: "成交", last: 402.6, change: 38.2, pct: 10.5, state: "CLOSE" },
    { sym: "BREADTH·A/D", name: "廣度", last: 812, extra: "/586", change: 0, pct: 0, state: "CLOSE" },
    { sym: "FOREIGN·NETBN", name: "外資", last: 12.8, change: 12.8, pct: 0, state: "CLOSE" },
    { sym: "IUF·HEAT·IDX", name: "heat", last: heat, change: 4.1, pct: 5.6, state: "● LIVE" },
    { sym: "RISK·BUDGET", name: "risk", last: 58, extra: ".0%", change: 6, pct: 0, state: "● LIVE" },
  ];

  return (
    <div className="quote-strip">
      {cards.map((card) => (
        <div className="quote-card" key={card.sym}>
          <div className="tg">
            <span className="quote-symbol">{card.sym}</span>
            <span className="quote-state">{card.state}</span>
          </div>
          <div className="quote-last num">
            {card.last.toLocaleString("en-US", { maximumFractionDigits: card.last < 1000 ? 2 : 1 })}
            {card.extra}
          </div>
          <div className={`tg ${signedTone(card.change)}`}>
            {card.change === 0 ? "-" : signed(card.change, card.sym.includes("HEAT") ? 1 : card.last < 1000 ? 2 : 1)}
            {card.pct ? <span style={{ marginLeft: 18 }}>{signed(card.pct,  card.pct < 2 ? 2 : 1)}{card.sym === "RISK·BUDGET" ? "PT" : ""}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function HeatMap({ themes }: { themes: Theme[] }) {
  const points = [
    { code: "AI-PWR", x: 54, y: 18, locked: false },
    { code: "HBM-TW", x: 70, y: 29, locked: false },
    { code: "ROBOT", x: 66, y: 48, locked: true },
    { code: "SLCN-PV", x: 75, y: 66, locked: false },
    { code: "DDR5", x: 36, y: 74, locked: false },
    { code: "CYBR", x: 29, y: 52, locked: false },
    { code: "DEFENSE", x: 25, y: 65, locked: false },
    { code: "AUTO-EV", x: 18, y: 78, locked: false },
  ];
  const byCode = new Map(themes.map((t) => [t.code, t]));

  return (
    <div className="heat-map">
      {points.map((p) => (
        <div
          className={`map-point ${p.locked ? "locked" : ""}`}
          key={p.code}
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
          title={byCode.get(p.code)?.name ?? p.code}
        />
      ))}
      <div className="tg soft" style={{ position: "absolute", left: 18, top: 18 }}>POLAR</div>
      <div className="tg gold" style={{ position: "absolute", right: 18, top: 98 }}>ROBOT</div>
      <div className="tg soft" style={{ position: "absolute", left: 18, bottom: 18 }}>HEAT MAP</div>
    </div>
  );
}

export default async function DashboardPage() {
  const [session, themes, ideas, runs, signals, quotes] = await Promise.all([
    api.session(),
    api.themes(),
    api.ideas(),
    api.runs(),
    api.signals(),
    api.quotes(),
  ]);
  const activeRun = runs.find((r) => r.state === "ACTIVE") ?? runs[0] ?? null;
  const openIdeas = ideas.slice(0, 5);
  const tape = signals.slice(0, 7);

  return (
    <PageFrame
      code="01"
      title="Trading Room"
      sub="戰情台"
      note="[01] DASHBOARD · 主題驅動投資戰情台 · POST-CLOSE EDITION · 2026-04-25"
    >
      <MarketStrip quotes={quotes} heat={72.4} />

      <div className="main-grid">
        <div>
          <Panel code="THM-SCOPE" title="14:32:08 TPE · ● LIVE" sub="THEMES · BY HEAT · LIVE SWEEP" right="D7 MOMENTUM">
            <div className="row theme-row table-head tg">
              <span>#</span><span>CODE</span><span>主題 · THEME</span><span>MOM</span><span>MEM</span><span>HEAT</span><span>Δ D7 PULSE</span><span>STATE</span>
            </div>
            {themes.map((theme) => (
              <Link
                href={`/themes/${theme.short}`}
                key={theme.code}
                className={`row theme-row ${theme.rank === 3 ? "theme-active" : ""}`}
              >
                <span className="tg soft">{String(theme.rank).padStart(2, "0")}</span>
                <span className="tg" style={{ color: "var(--night-ink)", fontWeight: 700 }}>{theme.code}</span>
                <span>
                  <strong className="tc" style={{ color: "var(--night-ink)", fontSize: 16 }}>{theme.name}</strong>
                  <span className="tg soft" style={{ display: "block", marginTop: 3 }}>{theme.short.toUpperCase()} · {theme.members} CO</span>
                </span>
                <span className="tg"><Momentum value={theme.momentum} /></span>
                <span className="num">{theme.members}</span>
                <strong className="num" style={{ fontSize: 20 }}>{theme.heat}</strong>
                <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span className={`tg ${signedTone(theme.dHeat)}`}>{signed(theme.dHeat)}</span>
                  <Spark values={theme.pulse} />
                </span>
                <span className={`tg ${theme.lockState === "LOCKED" ? "gold" : "muted"}`}>
                  {theme.lockState === "LOCKED" ? "● " : ""}{theme.lockState}
                </span>
              </Link>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="TELEX-LIVE" title="14:32:08 TPE · ● LIVE" sub="LIVE TAPE · 30S CYCLE" right="AUTO">
            {tape.map((signal) => {
              const time = new Date(signal.emittedAt).toLocaleTimeString("zh-TW", { hour12: false });
              return (
                <div className="row telex-row" key={signal.id}>
                  <span className="tg soft">{time}</span>
                  <span className="tg gold">{signal.channel}</span>
                  <span className="tg" style={{ color: signal.state === "MUTED" ? "var(--night-soft)" : "var(--night-ink)" }}>
                    <b>{signal.symbol ?? signal.themeCode ?? "-"}</b> · {signal.trigger}
                  </span>
                </div>
              );
            })}
          </Panel>

          <Panel code="IDEA-OPN" title="14:32:08 TPE" sub="EMITTED IDEAS · 5 OPEN" right="QUALITY > MED">
            {openIdeas.map((idea) => (
              <div className="row idea-row" key={idea.id}>
                <span className="tg soft">{idea.id}</span>
                <Link className="tg" href={`/companies/${idea.symbol}`} style={{ color: "var(--night-ink)", fontWeight: 700 }}>
                  {idea.symbol}
                </Link>
                <span className={`tg ${idea.side === "TRIM" || idea.side === "EXIT" || idea.side === "SHORT" ? "down" : "up"}`}>{idea.side}</span>
                <span className="tg">Q·{idea.quality}</span>
                <span className="tc soft">{idea.rationale}</span>
                <Link href="/portfolio" className="mini-button">下單台 →</Link>
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="OPS-HLT" title="14:32:08 TPE" sub="HEALTH PROBES" right="6 SERV">
            {[
              ["RECON", "GREEN", "T-12s", 14.2],
              ["INGEST", "GREEN", "T-06s", 22.1],
              ["RANKER", "GREEN", "T-18s", 6.0],
              ["EMITTER", "GREEN", "T-02m", 0.4],
              ["BROKER", "AMBER", "T-04m", 0.8],
              ["AUDIT", "GREEN", "T-00s", 38.4],
            ].map(([name, state, lag, val]) => (
              <div className="row health-row" key={String(name)}>
                <span className="tg" style={{ color: state === "AMBER" ? "var(--gold)" : "var(--night-ink)", fontWeight: 700 }}>{name}</span>
                <span className={`tg ${state === "AMBER" ? "gold" : "muted"}`}><span className="status-dot" />{state}</span>
                <span className="tg soft">{lag}</span>
                <span className="num soft">{String(val)}</span>
              </div>
            ))}
          </Panel>

          <Panel code="MAP-THM" title="14:32:08 TPE" sub="HEAT MAP · POLAR" right="AI">
            <HeatMap themes={themes} />
          </Panel>

          <Panel code="EOD-NXT" title="14:32:08 TPE" sub="NEXT ACTIONS" right={activeRun?.id ?? "—"}>
            {["EOD-SNAP · T+18m · queued", "BROKER-REC · T+24m · queued", "WEEKLY-BRF · DUE SUN", "RUN-219 · MON 08:55"].map((line) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "1fr" }} key={line}>
                <span className="tg">{line}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
