import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getCompanies, getSignals, getThemes } from "@/lib/api";

export const dynamic = "force-dynamic";

type SignalRow = Awaited<ReturnType<typeof getSignals>>["data"][number];
type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type CompanyRow = Awaited<ReturnType<typeof getCompanies>>["data"][number];
type SignalData = {
  signals: SignalRow[];
  themes: ThemeRow[];
  companies: CompanyRow[];
};
type LoadState =
  | { state: "LIVE"; data: SignalData; updatedAt: string; source: string }
  | { state: "EMPTY"; data: SignalData; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: SignalData; updatedAt: string; source: string; reason: string };

const emptyData: SignalData = {
  signals: [],
  themes: [],
  companies: [],
};

async function loadSignals(): Promise<LoadState> {
  const source = "GET /api/v1/signals + /api/v1/themes + /api/v1/companies";
  const updatedAt = new Date().toISOString();

  try {
    const [signalsEnvelope, themesEnvelope, companiesEnvelope] = await Promise.all([
      getSignals(),
      getThemes(),
      getCompanies(),
    ]);
    const data = {
      signals: signalsEnvelope.data,
      themes: themesEnvelope.data,
      companies: companiesEnvelope.data,
    };
    if (data.signals.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt,
        source,
        reason: "Signals endpoint returned zero rows. No fallback tape is rendered.",
      };
    }
    return { state: "LIVE", data, updatedAt, source };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyData,
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

function stateTone(state: LoadState["state"]) {
  if (state === "LIVE") return "up";
  if (state === "EMPTY") return "gold";
  return "down";
}

function directionTone(direction: SignalRow["direction"]) {
  if (direction === "bullish") return "up";
  if (direction === "bearish") return "down";
  return "muted";
}

function confidenceTone(confidence: number) {
  if (confidence >= 4) return "gold";
  if (confidence <= 2) return "down";
  return "muted";
}

function firstTheme(signal: SignalRow, themes: ThemeRow[]) {
  const themeId = signal.themeIds[0];
  return themeId ? themes.find((theme) => theme.id === themeId) ?? null : null;
}

function firstCompany(signal: SignalRow, companies: CompanyRow[]) {
  const companyId = signal.companyIds[0];
  return companyId ? companies.find((company) => company.id === companyId) ?? null : null;
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

export default async function SignalsPage() {
  const result = await loadSignals();
  const signals = result.data.signals.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const categories = new Set(signals.map((signal) => signal.category));

  return (
    <PageFrame
      code="07"
      title="Signals"
      sub="Signal tape"
      note="[07] SIGNALS reads production signal rows and maps attached theme/company ids. No synthetic tape is rendered."
    >
      <MetricStrip
        cells={[
          { label: "STATE", value: result.state, tone: stateTone(result.state) },
          { label: "TOTAL", value: signals.length },
          { label: "BULL", value: signals.filter((signal) => signal.direction === "bullish").length, tone: "up" },
          { label: "BEAR", value: signals.filter((signal) => signal.direction === "bearish").length, tone: "down" },
          { label: "NEUT", value: signals.filter((signal) => signal.direction === "neutral").length, tone: "muted" },
          { label: "CAT", value: categories.size },
          { label: "HIGH CONF", value: signals.filter((signal) => signal.confidence >= 4).length, tone: "gold" },
        ]}
        columns={7}
      />

      <Panel
        code="SIG-TAPE"
        title={`${formatTime(result.updatedAt)} TPE`}
        sub="CHRONOLOGICAL SIGNAL RAIL / REAL API"
        right={result.state}
      >
        <SourceLine result={result} />
        <EmptyOrBlocked result={result} />
        {result.state === "LIVE" && (
          <>
            <div className="row telex-row table-head tg" style={{ gridTemplateColumns: "76px 82px 76px 110px 1fr 74px" }}>
              <span>TIME</span><span>CATEGORY</span><span>DIR</span><span>ATTACH</span><span>TITLE</span><span>CONF</span>
            </div>
            {signals.map((signal) => {
              const company = firstCompany(signal, result.data.companies);
              const theme = firstTheme(signal, result.data.themes);
              return (
                <div className="row telex-row" style={{ gridTemplateColumns: "76px 82px 76px 110px 1fr 74px" }} key={signal.id}>
                  <span className="tg soft">{formatTime(signal.createdAt)}</span>
                  <span className="tg gold">{signal.category}</span>
                  <span className={`tg ${directionTone(signal.direction)}`}>{signal.direction}</span>
                  {company ? (
                    <Link href={`/companies/${company.ticker}`} className="tg">{company.ticker}</Link>
                  ) : theme ? (
                    <Link href={`/themes/${theme.slug}`} className="tg">{theme.slug}</Link>
                  ) : (
                    <span className="tg muted">UNMAPPED</span>
                  )}
                  <span className="tc soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {signal.title} / {signal.summary || "no summary"}
                  </span>
                  <span className={`tg ${confidenceTone(signal.confidence)}`}>C{signal.confidence}</span>
                </div>
              );
            })}
          </>
        )}
      </Panel>
    </PageFrame>
  );
}
