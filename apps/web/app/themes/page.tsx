import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getThemes } from "@/lib/api";

export const dynamic = "force-dynamic";

type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type LoadState =
  | { state: "LIVE"; data: ThemeRow[]; updatedAt: string; source: string }
  | { state: "EMPTY"; data: ThemeRow[]; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: ThemeRow[]; updatedAt: string; source: string; reason: string };

async function loadThemes(): Promise<LoadState> {
  const source = "GET /api/v1/themes";
  const updatedAt = new Date().toISOString();

  try {
    const envelope = await getThemes();
    const data = envelope.data;
    if (data.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt,
        source,
        reason: "Themes endpoint returned zero rows. No fallback ladder is rendered.",
      };
    }
    return { state: "LIVE", data, updatedAt, source };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: [],
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

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

function stateTone(state: LoadState["state"]) {
  if (state === "LIVE") return "up";
  if (state === "EMPTY") return "gold";
  return "down";
}

function marketTone(state: ThemeRow["marketState"]) {
  if (state === "Attack" || state === "Selective Attack") return "up";
  if (state === "Defense" || state === "Preservation") return "down";
  return "gold";
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

export default async function ThemesPage() {
  const result = await loadThemes();
  const themes = result.data.slice().sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const countsAvailable = result.state !== "BLOCKED";
  const attackCount = themes.filter((theme) => theme.marketState === "Attack" || theme.marketState === "Selective Attack").length;
  const defenseCount = themes.filter((theme) => theme.marketState === "Defense" || theme.marketState === "Preservation").length;
  const coreTotal = themes.reduce((sum, theme) => sum + theme.corePoolCount, 0);
  const observationTotal = themes.reduce((sum, theme) => sum + theme.observationPoolCount, 0);
  const priorityOneCount = themes.filter((theme) => theme.priority === 1).length;

  return (
    <PageFrame
      code="02"
      title="Themes"
      sub="Theme ladder"
      note="[02] THEMES reads production theme rows. Heat/pulse mock metrics are removed until backed by a real endpoint."
    >
      <MetricStrip
        cells={[
          { label: "STATE", value: result.state, tone: stateTone(result.state) },
          { label: "TOTAL", value: countsAvailable ? themes.length : "--" },
          { label: "ATTACK", value: countsAvailable ? attackCount : "--", tone: "up" },
          { label: "DEFENSE", value: countsAvailable ? defenseCount : "--", tone: "down" },
          { label: "CORE", value: countsAvailable ? coreTotal : "--", tone: coreTotal > 0 ? "gold" : "muted" },
          { label: "OBS", value: countsAvailable ? observationTotal : "--" },
          { label: "P1", value: countsAvailable ? priorityOneCount : "--", tone: "gold" },
        ]}
        columns={7}
      />

      <Panel
        code="THM-LDR"
        title={`${formatTime(result.updatedAt)} TPE`}
        sub="THEME MASTER / REAL API"
        right={result.state}
      >
        <SourceLine result={result} />
        <EmptyOrBlocked result={result} />
        {result.state === "LIVE" && (
          <>
            <div className="row theme-row table-head tg">
              <span>#</span><span>SLUG</span><span>THEME</span><span>STATE</span><span>LIFE</span><span>CORE</span><span>OBS</span><span>UPDATED</span>
            </div>
            {themes.map((theme) => (
              <Link href={`/themes/${theme.slug}`} className={`row theme-row ${theme.priority === 1 ? "theme-active" : ""}`} key={theme.id}>
                <span className="tg soft">{theme.priority}</span>
                <span className="tg" style={{ color: "var(--night-ink)", fontWeight: 700 }}>{theme.slug}</span>
                <span>
                  <strong className="tc" style={{ color: "var(--night-ink)", fontSize: 16 }}>{theme.name}</strong>
                  <span className="tg soft" style={{ display: "block", marginTop: 3 }}>{theme.thesis}</span>
                </span>
                <span className={`tg ${marketTone(theme.marketState)}`}>{theme.marketState}</span>
                <span className="tg muted">{theme.lifecycle}</span>
                <span className="num">{theme.corePoolCount}</span>
                <span className="num">{theme.observationPoolCount}</span>
                <span className="tg soft">{formatDate(theme.updatedAt)}</span>
              </Link>
            ))}
          </>
        )}
      </Panel>
    </PageFrame>
  );
}
