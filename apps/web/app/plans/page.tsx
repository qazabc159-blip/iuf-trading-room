import Link from "next/link";
import { PageFrame, Panel } from "@/components/PageFrame";
import { api } from "@/lib/radar-api";
import { MetricStrip, signed, toneClass } from "@/components/RadarWidgets";

export default async function PlansPage() {
  const [brief, review, weekly, themes, ideas, risk, events] = await Promise.all([
    api.brief(),
    api.review(),
    api.weeklyPlan(),
    api.themes(),
    api.ideas(),
    api.riskLimits(),
    api.executionEvents(),
  ]);
  const topThemes = themes.filter((theme) => theme.lockState === "LOCKED" || theme.momentum === "ACCEL").slice(0, 6);
  const openIdeas = ideas.filter((idea) => Date.parse(idea.expiresAt) > Date.now()).slice(0, 7);
  const fills = events.filter((event) => event.kind === "order_filled");
  const netPnl = review.pnl.realized + review.pnl.unrealized;

  return (
    <PageFrame code="08" title="Plans" sub="計畫" note="[08] PLANS · brief / review / weekly plan in one radar board">
      <MetricStrip
        cells={[
          { label: "MARKET", value: brief.market.state, tone: "gold" },
          { label: "FUT·N", value: brief.market.futuresNight.last.toLocaleString(), delta: brief.market.futuresNight.chgPct },
          { label: "US", value: brief.market.usMarket.index, delta: brief.market.usMarket.chgPct },
          { label: "PNL", value: `${netPnl >= 0 ? "+" : ""}${(netPnl / 1000).toFixed(0)}K`, delta: netPnl },
          { label: "TRADES", value: weekly.summary.trades },
          { label: "BEST", value: weekly.summary.bestTheme, tone: "gold" },
        ]}
        columns={6}
      />

      <div className="main-grid">
        <div>
          <Panel code="BRF-THM" title={brief.date} sub="top themes · locked + accel" right={`${topThemes.length} THEMES`}>
            {topThemes.map((theme) => (
              <Link href={`/themes/${theme.short}`} className="row theme-row" key={theme.code}>
                <span className="tg soft">{String(theme.rank).padStart(2, "0")}</span>
                <span className="tg gold">{theme.code}</span>
                <span className="tc">{theme.name}</span>
                <span className={`tg ${theme.momentum === "ACCEL" ? "up" : "muted"}`}>{theme.momentum}</span>
                <span className="num">{theme.members}</span>
                <span className="num">{theme.heat}</span>
                <span className={`tg ${toneClass(theme.dHeat)}`}>{signed(theme.dHeat, 0)}</span>
                <span className="tg muted">{theme.lockState}</span>
              </Link>
            ))}
          </Panel>

          <Panel code="BRF-IDEA" title="open execution candidates" sub="today effective ideas" right={`${openIdeas.length} OPEN`}>
            {openIdeas.map((idea) => (
              <div className="row idea-row" key={idea.id}>
                <span className="tg soft">{idea.id}</span>
                <Link href={`/companies/${idea.symbol}`} className="tg gold">{idea.symbol}</Link>
                <span className={`tg ${idea.side === "LONG" ? "up" : "down"}`}>{idea.side}</span>
                <span className="tg">Q·{idea.quality}</span>
                <span className="tc soft">{idea.rationale}</span>
                <Link href="/portfolio" className="mini-button">下單台 →</Link>
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="REV-PNL" title={review.date} sub="review / fills / hit-rate" right={`${fills.length} FILLS`}>
            {[
              ["REALIZED", review.pnl.realized],
              ["UNREALIZED", review.pnl.unrealized],
              ["NAV START", review.pnl.navStart],
              ["NAV END", review.pnl.navEnd],
              ["HIT RATE", review.ideaHitRate.pct],
            ].map(([label, value]) => (
              <div className="row limit-row" key={String(label)}>
                <span className="tg gold">{label}</span>
                <span className={`num ${typeof value === "number" ? toneClass(value) : ""}`} style={{ gridColumn: "span 2", textAlign: "right" }}>
                  {typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value}
                </span>
              </div>
            ))}
          </Panel>

          <Panel code="RISK-TOD" title="today limits" sub="guardrail snapshot" right={`${risk.length} RULES`}>
            {risk.map((limit) => (
              <div className="row limit-row" key={limit.rule}>
                <span className="tg">{limit.rule}</span>
                <span className="num">{limit.limit} {limit.current}</span>
                <span className={`tg ${limit.result === "PASS" ? "up" : limit.result === "WARN" ? "gold" : "down"}`}>● {limit.result}</span>
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="WK-ROT" title={weekly.weekNo} sub="theme rotation" right="WEEKLY">
            {weekly.themeRotation.map((item) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "76px 1fr 62px" }} key={item.code}>
                <span className="tg gold">{item.code}</span>
                <span className="tg soft">{item.heatStart} → {item.heatEnd}</span>
                <span className={`tg ${toneClass(item.delta)}`}>{signed(item.delta, 0)}</span>
              </div>
            ))}
          </Panel>

          <Panel code="WK-TWK" title="strategy tweaks" sub="operator notes" right={`${weekly.strategyTweaks.length} CHG`}>
            {weekly.strategyTweaks.map((item) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "94px 1fr" }} key={`${item.strategyId}-${item.ts}`}>
                <span className="tg gold">{item.strategyId}</span>
                <span className="tc soft">{item.change}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
