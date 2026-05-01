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

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|failed to fetch|ECONNREFUSED|network/i.test(message)) return "前端暫時無法連到後端 API。";
  if (/401|unauthorized|unauthenticated/i.test(message)) return "登入狀態已失效，請重新登入。";
  if (/404|not found/i.test(message)) return "後端端點尚未提供。";
  return message;
}

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
      reason: friendlyError(error),
    };
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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

function categoryLabel(value: string | null | undefined) {
  if (!value) return "未分類";
  const key = value.toLowerCase();
  if (key === "earnings") return "財報";
  if (key === "revenue") return "營收";
  if (key === "news") return "新聞";
  if (key === "theme") return "主題";
  if (key === "technical") return "技術";
  if (key === "fundamental") return "基本面";
  if (key === "test" || key === "dryrun") return "內部測試";
  return value.replace(/[_-]/g, " ");
}

function hasBrokenText(value: string | null | undefined) {
  if (!value) return false;
  return /�|Ã|Â|undefined|null/i.test(value);
}

function isInternalTestSignal(signal: SignalRow) {
  const text = `${signal.title} ${signal.summary ?? ""} ${signal.category}`.toLowerCase();
  return /bruce|dryrun|smoke|test signal|verify/.test(text);
}

function signalTitle(signal: SignalRow) {
  const value = `${signal.title || "未命名訊號"}${signal.summary ? ` / ${signal.summary}` : ""}`;
  if (hasBrokenText(value)) return "訊號文字待整理；保留來源紀錄，不作交易解讀。";
  return value.replace(/^bruce-wave\d*-verify:\s*/i, "內部驗證：");
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
      <span>更新 {formatDateTime(result.updatedAt)}</span>
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
  const displaySignals = signals.filter((signal) => !isInternalTestSignal(signal));
  const hiddenInternalCount = signals.length - displaySignals.length;
  const countsAvailable = result.state !== "BLOCKED";
  const bullCount = displaySignals.filter((signal) => signal.direction === "bullish").length;
  const bearCount = displaySignals.filter((signal) => signal.direction === "bearish").length;
  const neutralCount = displaySignals.filter((signal) => signal.direction === "neutral").length;
  const highConfidenceCount = displaySignals.filter((signal) => signal.confidence >= 4).length;
  const categories = new Set(displaySignals.map((signal) => signal.category));

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
          { label: "總數", value: countsAvailable ? displaySignals.length : "--" },
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
        {hiddenInternalCount > 0 && (
          <div className="terminal-note compact">
            內部測試訊號 {hiddenInternalCount} 筆已收納，不放入正式訊號清單；正式清單只顯示可連結主題或公司的資料列。
          </div>
        )}
        <EmptyOrBlocked result={result} />
        {result.state === "LIVE" && (
          <>
            <div className="row signal-ledger-row table-head tg">
              <span>日期時間</span><span>分類</span><span>方向</span><span>連結</span><span>訊號內容</span><span>信心</span>
            </div>
            {displaySignals.map((signal) => {
              const company = firstCompany(signal, result.data.companies);
              const theme = firstTheme(signal, result.data.themes);
              return (
                <div className="row signal-ledger-row" key={signal.id}>
                  <span className="tg soft">{formatDateTime(signal.createdAt)}</span>
                  <span className="tg gold">{categoryLabel(signal.category)}</span>
                  <span className={`tg ${directionTone(signal.direction)}`}>{directionLabel(signal.direction)}</span>
                  {company ? (
                    <Link href={`/companies/${company.ticker}`} className="tg">{company.ticker}</Link>
                  ) : theme ? (
                    <Link href={`/themes/${theme.slug}`} className="tg">{theme.slug}</Link>
                  ) : (
                    <span className="tg muted">未連結</span>
                  )}
                  <span className="tc signal-title">{signalTitle(signal)}</span>
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
