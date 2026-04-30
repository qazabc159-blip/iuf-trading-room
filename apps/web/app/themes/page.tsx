import Link from "next/link";
import { PageFrame, Panel } from "@/components/PageFrame";
import { api } from "@/lib/radar-api";
import { MetricStrip, Sparkline, signed, toneClass } from "@/components/RadarWidgets";

export default async function ThemesPage() {
  const themes = await api.themes();
  const locked = themes.filter((t) => t.lockState === "LOCKED").length;
  const accel = themes.filter((t) => t.momentum === "ACCEL").length;
  const avgHeat = themes.length ? themes.reduce((sum, t) => sum + t.heat, 0) / themes.length : 0;
  const dHeat = themes.reduce((sum, t) => sum + t.dHeat, 0);

  return (
    <PageFrame code="02" title="Themes" sub="主題板" note="[02] THEMES · RADAR LADDER · heat / pulse / lock-state">
      <MetricStrip
        cells={[
          { label: "TOTAL", value: themes.length },
          { label: "LOCKED", value: locked, tone: "gold" },
          { label: "ACCEL", value: accel, tone: "up" },
          { label: "AVG·HEAT", value: avgHeat.toFixed(1) },
          { label: "D7·NET", value: signed(dHeat, 0), delta: dHeat },
          { label: "STALE", value: themes.filter((t) => t.lockState === "STALE").length, tone: "muted" },
        ]}
        columns={6}
      />

      <Panel code="THM-LDR" title="14:32:08 TPE · ● LIVE" sub="theme ladder · full scope" right="SORT · HEAT">
        <div className="row theme-row table-head tg">
          <span>#</span><span>CODE</span><span>主題 · THEME</span><span>MOM</span><span>MEM</span><span>HEAT</span><span>Δ D7 PULSE</span><span>STATE</span>
        </div>
        {themes.map((theme) => (
          <Link href={`/themes/${theme.short}`} className={`row theme-row ${theme.lockState === "LOCKED" ? "theme-active" : ""}`} key={theme.code}>
            <span className="tg soft">{String(theme.rank).padStart(2, "0")}</span>
            <span className="tg" style={{ color: "var(--night-ink)", fontWeight: 700 }}>{theme.code}</span>
            <span>
              <strong className="tc" style={{ color: "var(--night-ink)", fontSize: 16 }}>{theme.name}</strong>
              <span className="tg soft" style={{ display: "block", marginTop: 3 }}>{theme.short.toUpperCase()} · {theme.members} CO</span>
            </span>
            <span className={`tg ${theme.momentum === "ACCEL" ? "up" : theme.momentum === "DECEL" ? "down" : "muted"}`}>
              {theme.momentum === "ACCEL" ? "▲ ACL" : theme.momentum === "DECEL" ? "▼ DCL" : "● STD"}
            </span>
            <span className="num">{theme.members}</span>
            <strong className="num" style={{ fontSize: 20 }}>{theme.heat}</strong>
            <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span className={`tg ${toneClass(theme.dHeat)}`}>{signed(theme.dHeat, 0)}</span>
              <Sparkline values={theme.pulse} />
            </span>
            <span className={`tg ${theme.lockState === "LOCKED" ? "gold" : "muted"}`}>{theme.lockState}</span>
          </Link>
        ))}
      </Panel>
    </PageFrame>
  );
}
