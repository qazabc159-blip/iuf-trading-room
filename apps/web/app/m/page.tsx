import Link from "next/link";
import { api } from "@/lib/radar-api";
import { signed, toneClass } from "@/components/RadarWidgets";

export const dynamic = "force-dynamic";

export default async function MobileBrief() {
  const [brief, themes, ideas, session] = await Promise.all([
    api.brief(),
    api.themes(),
    api.ideas(),
    api.session(),
  ]);

  const topThemes = themes
    .filter((theme) => theme.lockState === "LOCKED" || theme.momentum === "ACCEL")
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 5);
  const now = Date.now();
  const openIdeas = ideas
    .filter((idea) => Date.parse(idea.expiresAt) > now)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const market = brief.market;
  const minutes = Math.floor(market.countdownSec / 60);
  const seconds = String(market.countdownSec % 60).padStart(2, "0");

  return (
    <main>
      <header className="mobile-head">
        <div>
          <div className="tg soft">IUF TR / MOBILE BRIEF</div>
          <h1>Brief</h1>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="tg gold">OPEN IN</div>
          <div className="digits">{minutes}M {seconds}S</div>
        </div>
      </header>

      <MobileSection code="MKT" title="market state" right={market.state}>
        <MobileMetric label="KILL" value={session.killMode} tone={session.killMode === "ARMED" ? "gold" : "up"} />
        <MobileMetric label="FUT NIGHT" value={market.futuresNight.last.toLocaleString()} sub={`${signed(Number(market.futuresNight.chgPct))}%`} tone={toneClass(Number(market.futuresNight.chgPct))} />
        <MobileMetric label={market.usMarket.index} value={market.usMarket.last.toLocaleString()} sub={`${signed(Number(market.usMarket.chgPct))}%`} tone={toneClass(Number(market.usMarket.chgPct))} />
      </MobileSection>

      <MobileSection code="EVT" title="event queue" right={`${market.events.length} LIVE`}>
        {market.events.map((event) => (
          <div className="mobile-row" key={`${event.ts}-${event.label}`}>
            <div>
              <div className="tg soft">{new Date(event.ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false })}</div>
              <div className="tc">{event.label}</div>
            </div>
            <span className={`tg ${event.weight === "HIGH" ? "gold" : "muted"}`}>{event.weight}</span>
          </div>
        ))}
      </MobileSection>

      <MobileSection code="THM" title="theme sweep" right="HEAT / D7">
        {topThemes.map((theme) => (
          <Link className="mobile-card" href={`/themes/${theme.code}`} key={theme.code}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="tg gold">{String(theme.rank).padStart(2, "0")} / {theme.code}</span>
              <span className="hero-num">{theme.heat}</span>
            </div>
            <div className="tc" style={{ fontSize: 18, marginTop: 5 }}>{theme.name}</div>
            <div className="tg soft" style={{ marginTop: 7 }}>
              <span className={toneClass(theme.dHeat)}>{signed(theme.dHeat)}</span>
              <span> / {theme.members} CO / {theme.momentum} / {theme.lockState}</span>
            </div>
          </Link>
        ))}
      </MobileSection>

      <MobileSection code="IDA" title="open ideas" right={`${openIdeas.length} OPEN`}>
        {openIdeas.map((idea) => (
          <Link className="mobile-card" href={`/companies/${idea.symbol}`} key={idea.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="tg gold">{idea.id} / {idea.symbol}</span>
              <span className="tg session-pill gold">{idea.side}</span>
            </div>
            <div className="tc" style={{ marginTop: 8 }}>{idea.rationale}</div>
            <div className="tg soft" style={{ marginTop: 7 }}>Q-{idea.quality} / {idea.themeCode} / SCORE {idea.score.toFixed(2)}</div>
          </Link>
        ))}
      </MobileSection>

      <MobileSection code="WAT" title="watchlist" right={`${brief.watchlist.length} SYM`}>
        {brief.watchlist.map((item) => (
          <Link className="mobile-row" href={`/companies/${item.symbol}`} key={item.symbol}>
            <span className="tg gold">{item.symbol}</span>
            <div>
              <div className="tc">{item.name}</div>
              {item.note && <div className="tg soft" style={{ marginTop: 3 }}>{item.note}</div>}
            </div>
          </Link>
        ))}
      </MobileSection>
    </main>
  );
}

function MobileSection({ code, title, right, children }: { code: string; title: string; right: string; children: React.ReactNode }) {
  return (
    <section className="mobile-section">
      <div className="mobile-section-head">
        <span className="tg gold">{code} / {title}</span>
        <span className="tg soft">{right}</span>
      </div>
      {children}
    </section>
  );
}

function MobileMetric({ label, value, sub, tone = "muted" }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="mobile-row">
      <span className="tg soft">{label}</span>
      <span className={`tg ${tone}`} style={{ fontSize: 17 }}>{value}</span>
      {sub && <span className={`tg ${tone}`}>{sub}</span>}
    </div>
  );
}
