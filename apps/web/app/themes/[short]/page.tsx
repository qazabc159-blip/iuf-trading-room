import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getCompanies, getSignals, getStrategyIdeas, getThemes } from "@/lib/api";

export const dynamic = "force-dynamic";

type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type CompanyRow = Awaited<ReturnType<typeof getCompanies>>["data"][number];
type SignalRow = Awaited<ReturnType<typeof getSignals>>["data"][number];
type IdeasView = Awaited<ReturnType<typeof getStrategyIdeas>>["data"];
type IdeaRow = IdeasView["items"][number];
type DetailData = {
  theme: ThemeRow | null;
  companies: CompanyRow[];
  signals: SignalRow[];
  ideas: IdeaRow[];
};
type LoadState =
  | { state: "LIVE"; data: DetailData; updatedAt: string; source: string }
  | { state: "EMPTY"; data: DetailData; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: DetailData; updatedAt: string; source: string; reason: string };

const emptyData: DetailData = {
  theme: null,
  companies: [],
  signals: [],
  ideas: [],
};

async function loadThemeDetail(slug: string): Promise<LoadState> {
  const source = `GET /api/v1/themes -> slug ${slug}; GET /api/v1/companies; GET /api/v1/signals; GET /api/v1/strategy/ideas?themeId=...`;
  const updatedAt = new Date().toISOString();

  try {
    const themesEnvelope = await getThemes();
    const theme = themesEnvelope.data.find((item) => item.slug === slug) ?? null;
    if (!theme) {
      return {
        state: "EMPTY",
        data: emptyData,
        updatedAt,
        source,
        reason: `找不到主題代碼 ${slug}。`,
      };
    }

    const [companiesEnvelope, signalsEnvelope, ideasEnvelope] = await Promise.all([
      getCompanies(),
      getSignals({ themeId: theme.id }),
      getStrategyIdeas({
        themeId: theme.id,
        decisionMode: "paper",
        includeBlocked: true,
        limit: 20,
        sort: "score",
      }),
    ]);
    return {
      state: "LIVE",
      data: {
        theme,
        companies: companiesEnvelope.data.filter((company) => company.themeIds.includes(theme.id)),
        signals: signalsEnvelope.data,
        ideas: ideasEnvelope.data.items,
      },
      updatedAt: theme.updatedAt || updatedAt,
      source,
    };
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

function stateLabel(state: LoadState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function marketStateLabel(state: ThemeRow["marketState"] | string | null | undefined) {
  if (state === "Attack") return "進攻";
  if (state === "Selective Attack") return "選擇性進攻";
  if (state === "Defense") return "防守";
  if (state === "Preservation") return "保全";
  return state ?? "--";
}

function lifecycleLabel(value: string | null | undefined) {
  if (value === "active") return "啟用";
  if (value === "watch") return "觀察";
  if (value === "paused") return "暫停";
  if (value === "retired") return "退場";
  return value ?? "--";
}

function marketTone(state: ThemeRow["marketState"]) {
  if (state === "Attack" || state === "Selective Attack") return "up";
  if (state === "Defense" || state === "Preservation") return "down";
  return "gold";
}

function directionTone(direction: IdeaRow["direction"] | SignalRow["direction"]) {
  if (direction === "bullish") return "up";
  if (direction === "bearish") return "down";
  return "muted";
}

function directionLabel(direction: IdeaRow["direction"] | SignalRow["direction"]) {
  if (direction === "bullish") return "偏多";
  if (direction === "bearish") return "偏空";
  return "中性";
}

function decisionTone(decision: IdeaRow["marketData"]["decision"]) {
  if (decision === "allow") return "up";
  if (decision === "review") return "gold";
  return "down";
}

function decisionLabel(decision: IdeaRow["marketData"]["decision"]) {
  if (decision === "allow") return "可觀察";
  if (decision === "review") return "待審";
  return "阻擋";
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="tg soft" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0 12px" }}>
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{stateLabel(result.state)}</span>
      <span>主題資料 / 公司 / 訊號 / 策略想法</span>
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

export default async function ThemeDetailPage({ params }: { params: Promise<{ short: string }> }) {
  const { short } = await params;
  const result = await loadThemeDetail(short);
  const theme = result.data.theme;
  const detailLive = result.state === "LIVE";
  const dependentState = result.state === "EMPTY" ? "EMPTY" : "BLOCKED";
  const dependentTone = result.state === "EMPTY" ? "gold" : "down";
  const dependentReason =
    result.state === "EMPTY"
      ? "找不到主題主檔，因此不顯示相關公司、訊號與策略想法。"
      : "主題明細資料暫停，相關公司、訊號與策略想法先隱藏。";
  const coreCount = detailLive && theme ? theme.corePoolCount : null;
  const observationCount = detailLive && theme ? theme.observationPoolCount : null;
  const memberCount = detailLive ? result.data.companies.length : null;
  const ideaCount = detailLive ? result.data.ideas.length : null;
  const signalCount = detailLive ? result.data.signals.length : null;

  return (
    <PageFrame
      code={theme ? `02-${theme.priority}` : "02-D"}
      title={theme?.name ?? short}
      sub={theme ? `${theme.slug} / ${marketStateLabel(theme.marketState)}` : "主題明細暫停"}
      note="此頁讀取正式主題、公司、訊號與策略想法；沒有後端契約的熱度、脈衝與下單動作不顯示。"
    >
      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "優先", value: theme?.priority ?? "--", tone: theme?.priority === 1 ? "gold" : "muted" },
          { label: "核心", value: coreCount ?? "--", tone: (coreCount ?? 0) > 0 ? "gold" : "muted" },
          { label: "觀察", value: observationCount ?? "--" },
          { label: "成員", value: memberCount ?? "--" },
          { label: "想法", value: ideaCount ?? "--", tone: (ideaCount ?? 0) > 0 ? "up" : "muted" },
          { label: "訊號", value: signalCount ?? "--" },
        ]}
        columns={7}
      />

      <div className="company-grid">
        <div>
          <Panel code="THM-SRC" title="資料來源" sub="投資命題 / 現在性" right={stateLabel(result.state)}>
            <SourceLine result={result} />
            <EmptyOrBlocked result={result} />
            {theme && (
              <div className="ticket" style={{ minHeight: 168 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className={`tg ${marketTone(theme.marketState)}`}>{marketStateLabel(theme.marketState)} / {lifecycleLabel(theme.lifecycle)}</div>
                    <div className="tc" style={{ fontSize: 30, marginTop: 8 }}>{theme.name}</div>
                    <div className="tg soft" style={{ marginTop: 8 }}>{theme.slug.toUpperCase()} / 更新 {formatDate(theme.updatedAt)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="num" style={{ fontSize: 42, fontWeight: 700 }}>{theme.priority}</div>
                    <div className="tg gold">優先序</div>
                  </div>
                </div>
                <div className="tc soft" style={{ marginTop: 16, lineHeight: 1.7 }}>{theme.thesis}</div>
                <div className="tg soft" style={{ marginTop: 10 }}>現在性：{theme.whyNow}</div>
                <div className="tg soft" style={{ marginTop: 6 }}>瓶頸：{theme.bottleneck}</div>
              </div>
            )}
          </Panel>

          <Panel code="MEM-LST" title="成員公司" sub="正式公司主檔連結" right={detailLive ? `${result.data.companies.length} 檔` : stateLabel(dependentState)}>
            {!detailLive && <div className="terminal-note"><span className={`tg ${dependentTone}`}>{stateLabel(dependentState)}</span> {dependentReason}</div>}
            {detailLive && result.data.companies.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有公司掛在此主題。</div>}
            {detailLive && result.data.companies.length > 0 && (
              <div className="row position-row table-head tg">
                <span>代號</span><span>公司</span><span>層級</span><span>市場</span><span>位置</span><span>更新</span>
              </div>
            )}
            {detailLive && result.data.companies.map((company) => (
              <Link className="row position-row" href={`/companies/${company.ticker}`} key={company.id}>
                <span className="tg gold">{company.ticker}</span>
                <span className="tc">{company.name}</span>
                <span className="tg">{company.beneficiaryTier}</span>
                <span className="tg muted">{company.market}</span>
                <span className="tg soft">{company.chainPosition}</span>
                <span className="tg soft">{formatDate(company.updatedAt)}</span>
              </Link>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="IDEA-ATT" title="連結策略想法" sub="依主題篩選正式策略資料" right={detailLive ? `${result.data.ideas.length} 筆` : stateLabel(dependentState)}>
            {!detailLive && <div className="terminal-note"><span className={`tg ${dependentTone}`}>{stateLabel(dependentState)}</span> {dependentReason}</div>}
            {detailLive && result.data.ideas.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有策略想法掛在此主題。</div>}
            {detailLive && result.data.ideas.slice(0, 8).map((idea) => (
              <div className="row idea-row" key={`${idea.companyId}-${idea.symbol}`}>
                <Link href={`/companies/${idea.symbol}`} className="tg gold">{idea.symbol}</Link>
                <span className={`tg ${directionTone(idea.direction)}`}>{directionLabel(idea.direction)}</span>
                <span className="num">{idea.score.toFixed(1)}</span>
                <span className={`tg ${decisionTone(idea.marketData.decision)}`}>{decisionLabel(idea.marketData.decision)}</span>
                <span className="tc soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{idea.rationale.primaryReason}</span>
                <Link href={`/companies/${idea.symbol}`} className="mini-button">公司</Link>
              </div>
            ))}
          </Panel>

          <Panel code="SIG-TAPE" title="主題訊號流" sub="正式訊號資料" right={detailLive ? `${result.data.signals.length} 則` : stateLabel(dependentState)}>
            {!detailLive && <div className="terminal-note"><span className={`tg ${dependentTone}`}>{stateLabel(dependentState)}</span> {dependentReason}</div>}
            {detailLive && result.data.signals.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有訊號掛在此主題。</div>}
            {detailLive && result.data.signals.slice(0, 10).map((signal) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "76px 78px 74px 1fr" }} key={signal.id}>
                <span className="tg soft">{formatTime(signal.createdAt)}</span>
                <span className="tg gold">{signal.category}</span>
                <span className={`tg ${directionTone(signal.direction)}`}>{directionLabel(signal.direction)}</span>
                <span className="tc soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {signal.title} / C{signal.confidence}
                </span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
