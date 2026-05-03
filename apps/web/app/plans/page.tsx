import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import {
  getBriefs,
  getCompanies,
  getPlans,
  getReviews,
  getSignals,
  getStrategyIdeas,
  getThemes,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline, cleanNarrativeText, cleanRiskRewardText, cleanTradePlanText } from "@/lib/operator-copy";
import { reasonLabel } from "@/lib/strategy-vocab";

export const dynamic = "force-dynamic";

type PlanRow = Awaited<ReturnType<typeof getPlans>>["data"][number];
type CompanyRow = Awaited<ReturnType<typeof getCompanies>>["data"][number];
type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type SignalRow = Awaited<ReturnType<typeof getSignals>>["data"][number];
type BriefRow = Awaited<ReturnType<typeof getBriefs>>["data"][number];
type ReviewRow = Awaited<ReturnType<typeof getReviews>>["data"][number];
type IdeaRow = Awaited<ReturnType<typeof getStrategyIdeas>>["data"]["items"][number];
type PlansData = {
  plans: PlanRow[];
  companies: CompanyRow[];
  themes: ThemeRow[];
  signals: SignalRow[];
  briefs: BriefRow[];
  reviews: ReviewRow[];
  ideas: IdeaRow[];
};
type LoadState =
  | { state: "LIVE"; data: PlansData; updatedAt: string; source: string }
  | { state: "EMPTY"; data: PlansData; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: PlansData; updatedAt: string; source: string; reason: string };

const emptyData: PlansData = {
  plans: [],
  companies: [],
  themes: [],
  signals: [],
  briefs: [],
  reviews: [],
  ideas: [],
};

async function loadPlans(): Promise<LoadState> {
  const source = "交易計畫資料庫";
  const updatedAt = new Date().toISOString();

  try {
    const [plansEnvelope, companiesEnvelope, themesEnvelope, signalsEnvelope, briefsEnvelope, reviewsEnvelope, ideasEnvelope] = await Promise.all([
      getPlans(),
      getCompanies(),
      getThemes(),
      getSignals(),
      getBriefs(),
      getReviews(),
      getStrategyIdeas({
        decisionMode: "paper",
        includeBlocked: true,
        limit: 12,
        sort: "score",
      }),
    ]);
    const data: PlansData = {
      plans: plansEnvelope.data,
      companies: companiesEnvelope.data,
      themes: themesEnvelope.data,
      signals: signalsEnvelope.data,
      briefs: briefsEnvelope.data,
      reviews: reviewsEnvelope.data,
      ideas: ideasEnvelope.data.items,
    };
    if (data.plans.length === 0 && data.briefs.length === 0 && data.ideas.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt,
        source,
        reason: "交易計畫、簡報與策略想法目前沒有可處理資料列。",
      };
    }
    return { state: "LIVE", data, updatedAt, source };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: emptyData,
      updatedAt,
      source,
      reason: friendlyDataError(error, "交易計畫暫時無法讀取。"),
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

function planStatusLabel(status: PlanRow["status"]) {
  if (status === "ready") return "就緒";
  if (status === "active") return "進行中";
  if (status === "closed") return "已結案";
  if (status === "canceled") return "取消";
  if (status === "reduced") return "降碼";
  return status;
}

function directionLabel(direction: IdeaRow["direction"]) {
  if (direction === "bullish") return "偏多";
  if (direction === "bearish") return "偏空";
  return "中性";
}

function decisionLabel(decision: IdeaRow["marketData"]["decision"]) {
  if (decision === "allow") return "可觀察";
  if (decision === "review") return "待審";
  return "阻擋";
}

function statusTone(status: PlanRow["status"]) {
  if (status === "ready" || status === "active") return "up";
  if (status === "closed" || status === "canceled") return "muted";
  if (status === "reduced") return "gold";
  return "muted";
}

function directionTone(direction: IdeaRow["direction"]) {
  if (direction === "bullish") return "up";
  if (direction === "bearish") return "down";
  return "muted";
}

function decisionTone(decision: IdeaRow["marketData"]["decision"]) {
  if (decision === "allow") return "up";
  if (decision === "review") return "gold";
  return "down";
}

function marketStateLabel(value: string | null | undefined) {
  if (value === "Attack") return "進攻";
  if (value === "Selective Attack") return "選擇進攻";
  if (value === "Defense") return "防守";
  if (value === "Preservation") return "保全";
  if (value === "Balanced") return "平衡";
  return value ?? "--";
}

function briefStatusLabel(status: BriefRow["status"] | null | undefined) {
  if (!status) return "無資料";
  const key = status.toLowerCase();
  if (key === "published" || key === "approved") return "已核准";
  if (key === "draft") return "草稿";
  if (key === "archived") return "封存";
  return cleanNarrativeText(status, "狀態待整理");
}

function signalCategoryLabel(value: string | null | undefined) {
  if (!value) return "未分類";
  const key = value.toLowerCase();
  if (key === "industry") return "產業";
  if (key === "theme") return "主題";
  if (key === "earnings") return "財報";
  if (key === "revenue") return "營收";
  if (key === "news") return "新聞";
  if (key === "company") return "公司";
  if (key === "market") return "市場";
  if (key === "technical") return "技術";
  if (key === "fundamental") return "基本面";
  if (key === "test" || key === "dryrun") return "內部測試";
  return value.replace(/[_-]/g, " ");
}

function displayPlanEntry(plan: PlanRow) {
  return cleanTradePlanText(plan.entryPlan);
}

function companyForPlan(plan: PlanRow, companies: CompanyRow[]) {
  return companies.find((company) => company.id === plan.companyId) ?? null;
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="plans-source-line">
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

export default async function PlansPage() {
  const result = await loadPlans();
  const plans = result.data.plans.slice().sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  const latestBrief = result.data.briefs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] ?? null;
  const readyPlans = plans.filter((plan) => plan.status === "ready" || plan.status === "active").length;
  const reviewedPlanIds = new Set(result.data.reviews.map((review) => review.tradePlanId));
  const contextLive = result.state === "LIVE";
  const countsAvailable = result.state !== "BLOCKED";

  return (
    <PageFrame
      code="08"
      title="交易計畫"
      sub="計畫書與審核佇列"
      note="交易計畫 / 正式交易計畫、簡報、覆盤、訊號與策略想法；本頁不提供模擬或實盤下單。"
    >
      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "計畫", value: countsAvailable ? plans.length : "--" },
          { label: "就緒", value: countsAvailable ? readyPlans : "--", tone: countsAvailable && readyPlans > 0 ? "up" : "muted" },
          { label: "覆盤", value: countsAvailable ? result.data.reviews.length : "--" },
          { label: "簡報", value: countsAvailable ? result.data.briefs.length : "--", tone: countsAvailable && result.data.briefs.length > 0 ? "gold" : "muted" },
          { label: "想法", value: countsAvailable ? result.data.ideas.length : "--", tone: countsAvailable && result.data.ideas.length > 0 ? "up" : "muted" },
          { label: "訊號", value: countsAvailable ? result.data.signals.length : "--" },
        ]}
        columns={7}
      />

      <div className="plans-workbench-grid">
        <div className="plans-primary-column">
          <section className="plans-command-surface plans-command-surface-primary">
            <div className="plans-surface-head">
              <div>
                <span className="tg panel-code">交易計畫</span>
                <h2>決策工作台</h2>
                <p>正式資料庫，僅顯示可追溯來源；本頁不送單。</p>
              </div>
              <span className={`badge ${result.state === "LIVE" ? "badge-green" : result.state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>
                {stateLabel(result.state)}
              </span>
            </div>
            <SourceLine result={result} />
            <EmptyOrBlocked result={result} />
            {plans.length === 0 && result.state === "LIVE" && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有交易計畫。</div>}
            {plans.length > 0 && (
              <div className="plans-ledger">
                {plans.slice(0, 12).map((plan) => {
                  const company = companyForPlan(plan, result.data.companies);
                  const reviewed = reviewedPlanIds.has(plan.id);
                  return (
                    <article className="plan-card" key={plan.id}>
                      <div className="plan-card-symbol">
                        {company ? <Link href={`/companies/${company.ticker}`} className="tg gold">{company.ticker}</Link> : <span className="tg muted">--</span>}
                        <span className={`tg ${statusTone(plan.status)}`}>{planStatusLabel(plan.status)}</span>
                        {company?.name && <span className="tc soft">{company.name}</span>}
                      </div>
                      <div className="plan-card-body">
                        <p>{displayPlanEntry(plan)}</p>
                        <dl className="plan-card-meta">
                          <div>
                            <dt>風報</dt>
                            <dd>{cleanRiskRewardText(plan.riskReward)}</dd>
                          </div>
                          <div>
                            <dt>覆盤</dt>
                            <dd className={reviewed ? "gold" : "muted"}>{reviewed ? "有" : "無"}</dd>
                          </div>
                          <div>
                            <dt>更新</dt>
                            <dd>{formatDate(plan.updatedAt)}</dd>
                          </div>
                        </dl>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="plans-command-surface plans-idea-surface">
            <div className="plans-surface-head compact">
              <div>
                <span className="tg panel-code">策略想法</span>
                <h2>候選清單</h2>
                <p>紙上決策來源，只讀，不會轉委託。</p>
              </div>
              <span className="tg soft">{contextLive ? `${result.data.ideas.length} 筆` : "暫停"}</span>
            </div>
            {!contextLive && <div className="terminal-note"><span className="tg down">暫停</span> 交易計畫來源未正常時，策略想法先隱藏。</div>}
            {contextLive && result.data.ideas.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有模擬決策想法。</div>}
            {contextLive && result.data.ideas.length > 0 && (
              <div className="ideas-rail">
                {result.data.ideas.slice(0, 8).map((idea) => (
                  <article className="idea-ticket" key={`${idea.companyId}-${idea.symbol}`}>
                    <div className="idea-ticket-symbol">
                      <Link href={`/companies/${idea.symbol}`} className="tg gold">{idea.symbol}</Link>
                      <span className={`tg ${directionTone(idea.direction)}`}>{directionLabel(idea.direction)}</span>
                      <span className="num">{idea.score.toFixed(1)}</span>
                    </div>
                    <div className="idea-ticket-body">
                      <span className={`tg ${decisionTone(idea.marketData.decision)}`}>{decisionLabel(idea.marketData.decision)}</span>
                      <p>{reasonLabel(idea.rationale.primaryReason)}</p>
                    </div>
                    <Link href={`/companies/${idea.symbol}`} className="mini-button">查看公司</Link>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="plans-context-column">
          <section className="plans-brief-card">
            <div className="plans-surface-head compact">
              <div>
                <span className="tg panel-code">每日簡報</span>
                <h2>{contextLive ? latestBrief?.date ?? "無簡報" : "資料暫停"}</h2>
                <p>正式資料庫；未來後台 AI 只負責產生草稿，前端不顯示假簡報。</p>
              </div>
              <span className="tg soft">{contextLive ? briefStatusLabel(latestBrief?.status) : "暫停"}</span>
            </div>
            {!contextLive && <div className="terminal-note"><span className="tg down">暫停</span> 交易計畫來源未正常時，簡報內容先隱藏。</div>}
            {contextLive && !latestBrief && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有每日簡報。</div>}
            {contextLive && latestBrief && (
              <div className="plans-brief-preview">
                <div className="brief-snapshot">
                  <span className="tg gold">盤勢</span>
                  <strong>{marketStateLabel(latestBrief.marketState)}</strong>
                  <span className="tg soft">更新 {formatDateTime(latestBrief.createdAt)}</span>
                </div>
                {latestBrief.sections.slice(0, 4).map((section) => (
                  <article className="plans-brief-section" key={section.heading}>
                    <div className="tg gold">{cleanExternalHeadline(section.heading, "簡報段落")}</div>
                    <div className="tc soft">
                      {cleanNarrativeText(section.body, "簡報段落尚未完成中文整理；保留來源紀錄。")}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="plans-command-surface plans-review-surface">
            <div className="plans-surface-head compact">
              <div>
                <span className="tg panel-code">覆盤紀錄</span>
                <h2>交易後檢討</h2>
              </div>
              <span className="tg soft">{contextLive ? `${result.data.reviews.length} 筆` : "暫停"}</span>
            </div>
            {!contextLive && <div className="terminal-note"><span className="tg down">暫停</span> 交易計畫來源未正常時，覆盤紀錄先隱藏。</div>}
            {contextLive && result.data.reviews.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有覆盤紀錄。</div>}
            {contextLive && result.data.reviews.slice(0, 6).map((review) => (
              <article className="plans-review-row" key={review.id}>
                <div className="tg">
                  <span className="gold">Q{review.executionQuality}</span>
                  <span className="soft">{formatDate(review.createdAt)}</span>
                </div>
                <div className="tc soft">
                  {cleanTradePlanText(review.outcome, "覆盤紀錄尚未完成中文整理；保留來源紀錄。")}
                </div>
              </article>
            ))}
          </section>

          <section className="plans-command-surface plans-signal-surface">
            <div className="plans-surface-head compact">
              <div>
                <span className="tg panel-code">訊號脈絡</span>
                <h2>最新真實訊號</h2>
              </div>
              <span className="tg soft">{contextLive ? `${result.data.signals.length} 筆` : "暫停"}</span>
            </div>
            {!contextLive && <div className="terminal-note"><span className="tg down">暫停</span> 交易計畫來源未正常時，訊號脈絡先隱藏。</div>}
            {contextLive && result.data.signals.length === 0 && <div className="terminal-note"><span className="tg gold">無資料</span> 目前沒有訊號列。</div>}
            {contextLive && result.data.signals.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 10).map((signal) => (
              <article className="plans-signal-row" key={signal.id}>
                <span className="tg soft">{formatDateTime(signal.createdAt)}</span>
                <span className="tg gold">{signalCategoryLabel(signal.category)}</span>
                <span className="tc soft">
                  {cleanExternalHeadline(signal.title, "訊號內容尚未完成中文整理；保留來源紀錄。")}
                </span>
              </article>
            ))}
          </section>

          <Panel code="PLAN-LOCK" title="寫入控管" sub="真實性閘門" right="暫停">
            <div className="terminal-note">
              <span className="tg down">暫停</span> 本頁是只讀計畫面板。模擬委託預覽與送出已放在模擬交易頁；實盤送單仍需風控閘門與操作員明示。
            </div>
          </Panel>
        </aside>
      </div>
    </PageFrame>
  );
}
