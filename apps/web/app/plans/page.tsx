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
  const source = "GET /api/v1/plans + briefs/reviews/signals/themes/companies + strategy ideas";
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
        reason: "Plans, briefs, and strategy ideas endpoints returned zero actionable rows.",
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

function companyForPlan(plan: PlanRow, companies: CompanyRow[]) {
  return companies.find((company) => company.id === plan.companyId) ?? null;
}

function themeForCompany(company: CompanyRow | null, themes: ThemeRow[]) {
  const themeId = company?.themeIds[0];
  return themeId ? themes.find((theme) => theme.id === themeId) ?? null : null;
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
      title="Plans"
      sub="Plan board"
      note="[08] PLANS reads production trade plans, briefs, reviews, signals, themes, and strategy ideas. Paper/live order controls are hidden here."
    >
      <MetricStrip
        cells={[
          { label: "STATE", value: result.state, tone: stateTone(result.state) },
          { label: "PLANS", value: countsAvailable ? plans.length : "--" },
          { label: "READY", value: countsAvailable ? readyPlans : "--", tone: countsAvailable && readyPlans > 0 ? "up" : "muted" },
          { label: "REVIEWS", value: countsAvailable ? result.data.reviews.length : "--" },
          { label: "BRIEFS", value: countsAvailable ? result.data.briefs.length : "--", tone: countsAvailable && result.data.briefs.length > 0 ? "gold" : "muted" },
          { label: "IDEAS", value: countsAvailable ? result.data.ideas.length : "--", tone: countsAvailable && result.data.ideas.length > 0 ? "up" : "muted" },
          { label: "SIGNALS", value: countsAvailable ? result.data.signals.length : "--" },
        ]}
        columns={7}
      />

      <div className="main-grid">
        <div>
          <Panel code="PLN-LST" title={`${formatTime(result.updatedAt)} TPE`} sub="TRADE PLANS / REAL DB" right={result.state}>
            <SourceLine result={result} />
            <EmptyOrBlocked result={result} />
            {plans.length === 0 && result.state === "LIVE" && <div className="terminal-note"><span className="tg gold">EMPTY</span> No trade plans currently exist.</div>}
            {plans.length > 0 && (
              <div className="row position-row table-head tg" style={{ gridTemplateColumns: "58px minmax(88px,1fr) 70px 80px 70px 84px" }}>
                <span>SYM</span><span>PLAN</span><span>STATUS</span><span>RR</span><span>REVIEW</span><span>UPDATED</span>
              </div>
            )}
            {plans.slice(0, 12).map((plan) => {
              const company = companyForPlan(plan, result.data.companies);
              const theme = themeForCompany(company, result.data.themes);
              return (
                <div className="row position-row" style={{ gridTemplateColumns: "58px minmax(88px,1fr) 70px 80px 70px 84px" }} key={plan.id}>
                  {company ? <Link href={`/companies/${company.ticker}`} className="tg gold">{company.ticker}</Link> : <span className="tg muted">--</span>}
                  <span className="tc soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {theme ? `${theme.slug} / ` : ""}{plan.entryPlan}
                  </span>
                  <span className={`tg ${statusTone(plan.status)}`}>{plan.status}</span>
                  <span className="tg">{plan.riskReward || "--"}</span>
                  <span className={`tg ${reviewedPlanIds.has(plan.id) ? "gold" : "muted"}`}>{reviewedPlanIds.has(plan.id) ? "YES" : "NO"}</span>
                  <span className="tg soft">{formatDate(plan.updatedAt)}</span>
                </div>
              );
            })}
          </Panel>

          <Panel code="IDEA-REF" title="STRATEGY IDEAS" sub="paper decision candidates / read only" right={contextLive ? `${result.data.ideas.length} ROWS` : "BLOCKED"}>
            {!contextLive && <div className="terminal-note"><span className="tg down">BLOCKED</span> Strategy ideas are hidden because the plans context source is not live.</div>}
            {contextLive && result.data.ideas.length === 0 && <div className="terminal-note"><span className="tg gold">EMPTY</span> No paper-decision ideas currently returned.</div>}
            {contextLive && result.data.ideas.slice(0, 8).map((idea) => (
              <div className="row idea-row" key={`${idea.companyId}-${idea.symbol}`}>
                <Link href={`/companies/${idea.symbol}`} className="tg gold">{idea.symbol}</Link>
                <span className={`tg ${directionTone(idea.direction)}`}>{idea.direction}</span>
                <span className="num">{idea.score.toFixed(1)}</span>
                <span className={`tg ${decisionTone(idea.marketData.decision)}`}>{idea.marketData.decision}</span>
                <span className="tc soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {idea.rationale.primaryReason}
                </span>
                <Link href={`/companies/${idea.symbol}`} className="mini-button">DETAIL</Link>
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="BRF-LAT" title={contextLive ? latestBrief?.date ?? "NO BRIEF" : "BLOCKED"} sub="daily brief rows / real DB" right={contextLive ? latestBrief?.status ?? "EMPTY" : "BLOCKED"}>
            {!contextLive && <div className="terminal-note"><span className="tg down">BLOCKED</span> Brief context is hidden because the plans context source is not live.</div>}
            {contextLive && !latestBrief && <div className="terminal-note"><span className="tg gold">EMPTY</span> No daily brief row currently exists.</div>}
            {contextLive && latestBrief && (
              <div style={{ display: "grid", gap: 12, paddingBottom: 12 }}>
                <div className="row limit-row">
                  <span className="tg gold">MARKET</span>
                  <span className="tg" style={{ gridColumn: "span 2", textAlign: "right" }}>{latestBrief.marketState}</span>
                </div>
                {latestBrief.sections.slice(0, 4).map((section) => (
                  <div style={{ borderBottom: "1px solid var(--night-rule)", paddingBottom: 10 }} key={section.heading}>
                    <div className="tg gold">{section.heading}</div>
                    <div className="tc soft" style={{ marginTop: 6, lineHeight: 1.65 }}>{section.body}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel code="REV-LDG" title="REVIEW LEDGER" sub="post-trade review rows" right={contextLive ? `${result.data.reviews.length} ROWS` : "BLOCKED"}>
            {!contextLive && <div className="terminal-note"><span className="tg down">BLOCKED</span> Review ledger is hidden because the plans context source is not live.</div>}
            {contextLive && result.data.reviews.length === 0 && <div className="terminal-note"><span className="tg gold">EMPTY</span> No review rows currently exist.</div>}
            {contextLive && result.data.reviews.slice(0, 6).map((review) => (
              <div style={{ padding: "10px 0", borderBottom: "1px solid var(--night-rule)" }} key={review.id}>
                <div className="tg" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span className="gold">Q{review.executionQuality}</span>
                  <span className="soft">{formatDate(review.createdAt)}</span>
                </div>
                <div className="tc soft" style={{ marginTop: 6, lineHeight: 1.65 }}>{review.outcome}</div>
              </div>
            ))}
          </Panel>
        </div>

        <div>
          <Panel code="SIG-CUE" title="SIGNAL CONTEXT" sub="latest live signals" right={contextLive ? `${result.data.signals.length} EVENTS` : "BLOCKED"}>
            {!contextLive && <div className="terminal-note"><span className="tg down">BLOCKED</span> Signal context is hidden because the plans context source is not live.</div>}
            {contextLive && result.data.signals.length === 0 && <div className="terminal-note"><span className="tg gold">EMPTY</span> No signal rows currently exist.</div>}
            {contextLive && result.data.signals.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 10).map((signal) => (
              <div className="row telex-row" style={{ gridTemplateColumns: "76px 76px 1fr" }} key={signal.id}>
                <span className="tg soft">{formatTime(signal.createdAt)}</span>
                <span className="tg gold">{signal.category}</span>
                <span className="tc soft" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {signal.title}
                </span>
              </div>
            ))}
          </Panel>

          <Panel code="PLAN-GATE" title="WRITE CONTROLS" sub="truthfulness gate" right="BLOCKED">
            <div className="terminal-note">
              <span className="tg down">BLOCKED</span> This page is a read-only planning surface. Paper order preview/submit lives in Contract 1 UI; live submit remains behind the risk gates and explicit operator approval.
            </div>
          </Panel>
        </div>
      </div>
    </PageFrame>
  );
}
