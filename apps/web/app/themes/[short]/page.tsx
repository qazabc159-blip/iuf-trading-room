import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame, Panel } from "@/components/PageFrame";
import { api } from "@/lib/radar-api";
import { MetricStrip, Sparkline, signed, toneClass } from "@/components/RadarWidgets";

export async function generateStaticParams() {
  const themes = await api.themes();
  return themes.map((theme) => ({ short: theme.short }));
}

export default async function ThemeDetailPage({ params }: { params: { short: string } }) {
  const [themes, companies, ideas, signals] = await Promise.all([
    api.themes(),
    api.companies(),
    api.ideas(),
    api.signals(),
  ]);
  const theme = themes.find((item) => item.short === params.short);
  if (!theme) notFound();

  const members = companies.filter((company) => company.themes.includes(theme.code));
  const themeIdeas = ideas.filter((idea) => idea.themeCode === theme.code);
  const themeSignals = signals.filter((signal) => signal.themeCode === theme.code);

  return (
    <PageFrame code={`02-${theme.rank}`} title={theme.code} sub={theme.name} note={`[02B] THEME DETAIL · ${theme.code} · members / ideas / signals`}>
      <MetricStrip
        cells={[
          { label: "HEAT", value: theme.heat },
          { label: "Δ7", value: signed(theme.dHeat, 0), delta: theme.dHeat },
          { label: "MEMBERS", value: members.length },
          { label: "MOM", value: theme.momentum, tone: theme.momentum === "ACCEL" ? "up" : theme.momentum === "DECEL" ? "down" : "muted" },
          { label: "STATE", value: theme.lockState, tone: theme.lockState === "LOCKED" ? "gold" : "muted" },
          { label: "IDEAS", value: themeIdeas.length, tone: "gold" },
        ]}
        columns={6}
      />

      <div className="company-grid">
        <div>
          <Panel code="THM-PUL" title="pulse channel" sub="d7 sparkline · rank memory" right={theme.momentum}>
            <div className="ticket" style={{ minHeight: 168 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div className="tg gold">PRIMARY THEME · {theme.code}</div>
                  <div className="tc" style={{ fontSize: 30, marginTop: 8 }}>{theme.name}</div>
                  <div className="tg soft" style={{ marginTop: 8 }}>{theme.short.toUpperCase()} · {theme.members} CO · {theme.lockState}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="num" style={{ fontSize: 52, fontWeight: 700 }}>{theme.heat}</div>
                  <div className={`tg ${toneClass(theme.dHeat)}`}>{signed(theme.dHeat, 0)} D7</div>
                </div>
              </div>
              <div style={{ marginTop: 18 }}><Sparkline values={theme.pulse} /></div>
            </div>
          </Panel>

          <Panel code="MEM-LST" title="member companies" sub="dynamic links · all symbols" right={`${members.length} CO`}>
            <div className="row position-row table-head tg">
              <span>SYM</span><span>名稱</span><span>SCORE</span><span>Δ%</span><span>FII</span><span>MOM</span>
            </div>
            {members.map((company) => (
              <Link className="row position-row" href={`/companies/${company.symbol}`} key={company.symbol}>
                <span className="tg gold">{company.symbol}</span>
                <span className="tc">{company.name}</span>
                <span className="num">{(company.score * 100).toFixed(0)}</span>
                <span className={`tg ${toneClass(company.intradayChgPct)}`}>{signed(company.intradayChgPct, 2)}%</span>
                <span className={`tg ${toneClass(company.fiiNetBn5d)}`}>{signed(company.fiiNetBn5d, 2)}BN</span>
                <span className="tg muted">{company.momentum}</span>
              </Link>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="IDEA-ATT" title="attached ideas" sub="theme-scoped ideas" right={`${themeIdeas.length} OPEN`}>
            {themeIdeas.slice(0, 6).map((idea) => (
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

          <Panel code="SIG-TAPE" title="theme signal tape" sub="THM / MOM / FII attachments" right={`${themeSignals.length} EVENTS`}>
            {themeSignals.slice(0, 8).map((signal) => (
              <div className="row telex-row" key={signal.id}>
                <span className="tg soft">{new Date(signal.emittedAt).toLocaleTimeString("zh-TW", { hour12: false })}</span>
                <span className="tg gold">{signal.channel}</span>
                <span className="tg">{signal.code} · {signal.trigger}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
