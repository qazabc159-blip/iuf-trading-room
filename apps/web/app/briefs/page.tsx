import Link from "next/link";
import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip, signed, toneClass } from "@/components/RadarWidgets";
import { mockBrief } from "@/lib/radar-uncovered";

export default function BriefsPage() {
  const brief = mockBrief;

  return (
    <PageFrame
      code="BRF"
      title="每日簡報"
      sub="今日盤前簡報"
      note="[BRF] 每日盤前簡報 · OpenAlice 產出 · 操作員覆核"
    >
      <MetricStrip
        columns={6}
        cells={[
          { label: "市場", value: brief.market.state, tone: "gold" },
          { label: "夜盤期", value: brief.market.futuresNight.last.toLocaleString(), delta: brief.market.futuresNight.chgPct },
          { label: "美股", value: brief.market.usMarket.last.toLocaleString(), delta: brief.market.usMarket.chgPct },
          { label: "美元台幣", value: brief.market.usdTwd.toFixed(2), tone: "muted" },
          { label: "波動率", value: brief.market.vix.toFixed(2), tone: "muted" },
          { label: "簡報信心", value: brief.market.confidence.toFixed(2), tone: "gold" },
        ]}
      />

      <div className="company-grid">
        <div>
          <Panel code="BRF-MKT" title="市場概況" sub={brief.date}>
            {brief.overview.map((line, index) => (
              <div className="row telex-row" key={line}>
                <span className="tg soft">{String(index + 1).padStart(2, "0")}</span>
                <span className="tg gold">市場</span>
                <span className="tc">{line}</span>
              </div>
            ))}
          </Panel>

          <Panel code="BRF-THM" title="重點主題" right={`${brief.themes.length} 個主題`}>
            {brief.themes.map((theme) => (
              <Link
                className="row"
                href={`/themes/${theme.short}`}
                key={theme.code}
                style={{ gridTemplateColumns: "76px 1fr 56px 54px 72px", gap: 12, padding: "12px 0", color: "inherit", textDecoration: "none" }}
              >
                <span className="tg gold">{theme.code}</span>
                <span className="tc">{theme.name}</span>
                <span className="num">{theme.heat}</span>
                <span className={`tg ${toneClass(theme.dHeat)}`}>{signed(theme.dHeat, 0)}</span>
                <span className="tg gold">{theme.state === "LOCKED" ? "鎖定" : theme.state === "TRACK" ? "追蹤" : "觀察"}</span>
              </Link>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="BRF-IDEA" title="開盤候選" right={`${brief.ideas.length} 筆候選`}>
            {brief.ideas.map((idea) => (
              <div className="row idea-row" key={idea.id}>
                <span className="tg soft">{idea.id}</span>
                <span className={`tg ${idea.side === "TRIM" ? "down" : "up"}`}>{idea.side === "LONG" ? "做多" : idea.side === "TRIM" ? "減碼" : "退出"}</span>
                <span className="tg gold">{idea.themeCode}</span>
                <span className="tg">{idea.confidence.toFixed(2)}</span>
                <Link href={`/companies/${idea.symbol}`} style={{ color: "var(--night-ink)", textDecoration: "none" }}>
                  {idea.symbol} · {idea.name}
                </Link>
                <Link className="mini-button" href="/portfolio">下單台</Link>
              </div>
            ))}
          </Panel>

          <Panel code="BRF-NOTE" title="操作員註記">
            <p className="tc" style={{ color: "var(--night-ink)", lineHeight: 1.9, margin: "14px 0 4px" }}>{brief.note}</p>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
