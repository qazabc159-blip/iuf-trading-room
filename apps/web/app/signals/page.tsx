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
  const source = "訊號資料庫";
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
        reason: "訊號資料庫目前回傳 0 筆，不顯示假訊號流。",
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

function stateLabel(state: LoadState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function directionLabel(direction: SignalRow["direction"]) {
  if (direction === "bullish") return "偏多";
  if (direction === "bearish") return "偏空";
  return "中性";
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
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{stateLabel(result.state)}</span>
      <span>來源：{result.source}</span>
      <span>更新 {formatTime(result.updatedAt)}</span>
      {result.state !== "LIVE" && <span>{result.reason}</span>}
    </div>
  );
}

function EmptyOrBlocked({ result }: { result: LoadState }) {
  if (result.state === "LIVE") return null;
  return (
    <div className="terminal-note">
      <span className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</span>{" "}
      {result.reason}
    </div>
  );
}

export default async function SignalsPage() {
  const result = await loadSignals();
  const signals = result.data.signals.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const countsAvailable = result.state !== "BLOCKED";
  const bullCount = signals.filter((signal) => signal.direction === "bullish").length;
  const bearCount = signals.filter((signal) => signal.direction === "bearish").length;
  const neutralCount = signals.filter((signal) => signal.direction === "neutral").length;
  const highConfidenceCount = signals.filter((signal) => signal.confidence >= 4).length;
  const categories = new Set(signals.map((signal) => signal.category));

  return (
    <PageFrame
      code="07"
      title="訊號證據"
      sub="訊號流"
      note="訊號證據 / 正式訊號資料；連結主題與公司，不顯示假訊號。"
    >
      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "總數", value: countsAvailable ? signals.length : "--" },
          { label: "偏多", value: countsAvailable ? bullCount : "--", tone: "up" },
          { label: "偏空", value: countsAvailable ? bearCount : "--", tone: "down" },
          { label: "中性", value: countsAvailable ? neutralCount : "--", tone: "muted" },
          { label: "分類", value: countsAvailable ? categories.size : "--" },
          { label: "高信心", value: countsAvailable ? highConfidenceCount : "--", tone: "gold" },
        ]}
        columns={7}
      />

      <Panel
        code="SIG-TAPE"
        title={`${formatTime(result.updatedAt)} 台北`}
        sub="時間序訊號流 / 正式 API"
        right={stateLabel(result.state)}
      >
        <SourceLine result={result} />
        <EmptyOrBlocked result={result} />
        {result.state === "LIVE" && (
          <>
            <div className="row telex-row table-head tg" style={{ gridTemplateColumns: "76px 82px 76px 110px 1fr 74px" }}>
              <span>時間</span><span>分類</span><span>方向</span><span>連結</span><span>標題</span><span>信心</span>
            </div>
            {signals.map((signal) => {
              const company = firstCompany(signal, result.data.companies);
              const theme = firstTheme(signal, result.data.themes);
              return (
                <div className="row telex-row" style={{ gridTemplateColumns: "76px 82px 76px 110px 1fr 74px" }} key={signal.id}>
                  <span className="tg soft">{formatTime(signal.createdAt)}</span>
                  <span className="tg gold">{signal.category}</span>
                  <span className={`tg ${directionTone(signal.direction)}`}>{directionLabel(signal.direction)}</span>
                  {company ? (
                    <Link href={`/companies/${company.ticker}`} className="tg">{company.ticker}</Link>
                  ) : theme ? (
                    <Link href={`/themes/${theme.slug}`} className="tg">{theme.slug}</Link>
                  ) : (
                    <span className="tg muted">未連結</span>
                  )}
                  <span className="tc soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {signal.title} / {signal.summary || "無摘要"}
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
