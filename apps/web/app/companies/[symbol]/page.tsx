import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame, Panel } from "@/components/PageFrame";
import { api } from "@/lib/radar-api";

function tone(value: number) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

function signed(value: number, digits = 2) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function MiniKLine({ seed = 0 }: { seed?: number }) {
  const candles = Array.from({ length: 32 }, (_, i) => {
    const base = 36 + Math.sin((i + seed) / 2.2) * 14 + Math.cos((i + seed) / 4.4) * 8;
    const high = base + 8 + (i % 3) * 2;
    const low = base - 8 - (i % 4);
    const up = i % 5 !== 1;
    return { x: 10 + i * 13, base, high, low, up };
  });

  return (
    <div style={{ position: "relative" }}>
      <div className="tg session-pill" style={{ position: "absolute", right: 8, top: 8, zIndex: 1 }}>
        SIMULATED K-LINE
      </div>
      <svg viewBox="0 0 440 138" style={{ width: "100%", height: 180 }} aria-hidden>
        {candles.map((c, i) => (
          <g key={i}>
            <line x1={c.x} x2={c.x} y1={c.low} y2={c.high} stroke="var(--night-soft)" strokeWidth="1" />
            <rect
              x={c.x - 4}
              y={Math.min(c.base, c.base + (c.up ? -11 : 11))}
              width="8"
              height="22"
              fill={c.up ? "var(--tw-up-bright)" : "var(--tw-dn-bright)"}
              opacity="0.78"
            />
          </g>
        ))}
        <polyline
          points={candles.map((c) => `${c.x},${c.base}`).join(" ")}
          fill="none"
          stroke="var(--gold-bright)"
          strokeWidth="1.4"
          opacity="0.7"
        />
      </svg>
    </div>
  );
}

function Radar({ score, dHeat }: { score: number; dHeat: number }) {
  const values = [score * 100, 82 + dHeat, 72, 66 + dHeat, 76, 58 + score * 25];
  const labels = ["ABILITY", "FIT", "COVER", "EVENT", "MOMO", "SCALE"];
  const points = values.map((value, i) => {
    const angle = -Math.PI / 2 + (i / values.length) * Math.PI * 2;
    const r = Math.max(18, Math.min(92, value)) / 100 * 82;
    return `${110 + Math.cos(angle) * r},${110 + Math.sin(angle) * r}`;
  });

  return (
    <svg viewBox="0 0 220 220" style={{ width: "100%", maxWidth: 260 }} aria-hidden>
      {[32, 58, 82].map((r) => (
        <circle key={r} cx="110" cy="110" r={r} fill="none" stroke="var(--night-rule-strong)" />
      ))}
      {labels.map((label, i) => {
        const angle = -Math.PI / 2 + (i / labels.length) * Math.PI * 2;
        const x = 110 + Math.cos(angle) * 96;
        const y = 110 + Math.sin(angle) * 96;
        return (
          <g key={label}>
            <line x1="110" y1="110" x2={x} y2={y} stroke="var(--night-rule)" />
            <text x={x} y={y} fill="var(--night-mid)" fontSize="7" fontFamily="var(--mono)" textAnchor="middle">{label}</text>
          </g>
        );
      })}
      <polygon points={points.join(" ")} fill="var(--tw-up-faint)" stroke="var(--tw-up-bright)" strokeWidth="1.5" />
    </svg>
  );
}

export async function generateStaticParams() {
  const companies = await api.companies();
  return companies.map((company) => ({ symbol: company.symbol }));
}

export default async function CompanyPage({ params }: { params: { symbol: string } }) {
  const [company, companies, themes, ideas, signals, quotes] = await Promise.all([
    api.company(params.symbol),
    api.companies(),
    api.themes(),
    api.ideas(),
    api.signals(),
    api.quotes(),
  ]);
  if (!company) notFound();

  const quote = quotes.find((q) => q.symbol === company.symbol);
  const displayLast = quote?.last ?? Math.round((40 + company.score * 320) * 10) / 10;
  const displayChangePct = quote?.changePct ?? company.intradayChgPct;
  const companyIdeas = ideas.filter((idea) => idea.symbol === company.symbol);
  const companySignals = signals.filter((signal) => signal.symbol === company.symbol || company.themes.includes(signal.themeCode ?? ""));
  const peerRows = companies.filter((item) => item.symbol !== company.symbol).slice(0, 6);
  const companyThemes = themes.filter((theme) => company.themes.includes(theme.code));

  return (
    <PageFrame
      code={`03-${company.symbol}`}
      title={company.symbol}
      sub={`${company.name} - ${company.listing}`}
      note={`[03B] COMPANIES / ${company.symbol} - RADAR VISUAL SHELL - quote and K-line are simulated until the market-data bridge is wired`}
    >
      <div className="quote-strip" style={{ gridTemplateColumns: "repeat(6, minmax(130px, 1fr))" }}>
        {[
          ["LAST", displayLast, displayChangePct],
          ["SCORE", company.score * 100, company.score - 0.5],
          ["FII-5D", company.fiiNetBn5d, company.fiiNetBn5d],
          ["CAP-BN", company.marketCapBn, company.marketCapBn],
          ["THEMES", company.themes.length, company.themes.length],
          ["MOM", company.momentum, company.intradayChgPct],
        ].map(([label, value, delta]) => (
          <div className="quote-card" key={String(label)}>
            <div className="tg quote-symbol">{label}</div>
            <div className={`quote-last num ${typeof delta === "number" ? tone(delta) : ""}`}>
              {typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : value}
            </div>
            <div className={`tg ${typeof delta === "number" ? tone(delta) : "muted"}`}>
              {typeof delta === "number" ? `${signed(delta, Math.abs(delta) > 10 ? 0 : 2)}${String(label).includes("LAST") ? "%" : ""}` : "STATE"}
            </div>
          </div>
        ))}
      </div>

      <div className="company-grid">
        <div>
          <Panel code="PX-SIM" title="14:32:08 TPE - SIM" sub="K-LINE SIMULATION - awaiting /api/v1/market-data/bars" right="NO LIVE SOURCE">
            <div className="ticket" style={{ padding: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                <div>
                  <div className="tg gold">PRIMARY NODE - {company.symbol}</div>
                  <h2 className="tc" style={{ margin: "8px 0 2px", fontSize: 28 }}>{company.name}</h2>
                  <div className="tg soft">{company.themes.join(" - ")} - CAP {company.marketCapBn.toFixed(0)}B</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="tg soft">INTRADAY %</div>
                  <div className={`num ${tone(company.intradayChgPct)}`} style={{ fontSize: 34, fontWeight: 700 }}>
                    {signed(company.intradayChgPct, 2)}%
                  </div>
                </div>
              </div>
              <MiniKLine seed={Number(company.symbol.slice(-2))} />
            </div>
          </Panel>

          <Panel code="IDEA-ATT" title="attached ideas" sub="idea drawer - symbol scoped" right={`${companyIdeas.length} OPEN`}>
            {(companyIdeas.length ? companyIdeas : ideas.slice(0, 3)).map((idea) => (
              <div className="row idea-row" key={idea.id}>
                <span className="tg soft">{idea.id}</span>
                <span className={`tg ${idea.side === "LONG" ? "up" : "down"}`}>{idea.side}</span>
                <span className="tg">Q-{idea.quality}</span>
                <span className="tg gold">{idea.themeCode}</span>
                <span className="tc soft">{idea.rationale}</span>
                <Link className="mini-button" href="/portfolio">ORDER -&gt;</Link>
              </div>
            ))}
          </Panel>

          <Panel code="PEERS" title="theme-linked peers" sub="same radar route, any symbol" right="DYNAMIC">
            {peerRows.map((peer) => (
              <Link className="row position-row" key={peer.symbol} href={`/companies/${peer.symbol}`}>
                <span className="tg" style={{ fontWeight: 700 }}>{peer.symbol}</span>
                <span className="tc">{peer.name}</span>
                <span className="num">{(peer.score * 100).toFixed(0)}</span>
                <span className={`tg ${tone(peer.intradayChgPct)}`}>{signed(peer.intradayChgPct, 2)}%</span>
                <span className={`tg ${tone(peer.fiiNetBn5d)}`}>{signed(peer.fiiNetBn5d, 2)}BN</span>
                <span className="tg muted">{peer.momentum}</span>
              </Link>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="NODE-MAP" title="theme radar" sub="ABILITY / FIT / COVER / EVENT / MOMO / SCALE" right={company.momentum}>
            <div className="ticket" style={{ display: "grid", placeItems: "center", minHeight: 290 }}>
              <Radar score={company.score} dHeat={companyThemes[0]?.dHeat ?? 0} />
            </div>
          </Panel>

          <Panel code="KW-CLU" title="keyword cluster" sub="company / theme / flow" right={`${company.themes.length} THEMES`}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 0" }}>
              {[company.symbol, company.name, company.listing, ...company.themes, company.momentum, "FII", "MOMO", "SIM"].map((tag) => (
                <span className="session-pill tg" key={tag}>{tag}</span>
              ))}
            </div>
          </Panel>

          <Panel code="SIG-LIVE" title="signal tape" sub="symbol + theme attached stream" right={`${companySignals.length} EVENTS`}>
            {companySignals.slice(0, 8).map((signal) => (
              <div className="row telex-row" key={signal.id}>
                <span className="tg soft">{new Date(signal.emittedAt).toLocaleTimeString("zh-TW", { hour12: false })}</span>
                <span className="tg gold">{signal.channel}</span>
                <span className="tg">{signal.code} - {signal.trigger}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
