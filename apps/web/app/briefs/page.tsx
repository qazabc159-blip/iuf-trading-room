import { PageFrame, Panel } from "@/components/PageFrame";
import { getBriefs } from "@/lib/api";
import type { DailyBrief } from "@iuf-trading-room/contracts";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function sortBriefs(briefs: DailyBrief[]) {
  return [...briefs].sort((a, b) => {
    const bTime = Date.parse(b.createdAt);
    const aTime = Date.parse(a.createdAt);
    return bTime - aTime;
  });
}

function statusBadge(status: DailyBrief["status"]) {
  return status === "published" ? "badge-green" : "badge-yellow";
}

function BriefStatePanel({
  state,
  reason,
  updatedAt,
}: {
  state: "EMPTY" | "BLOCKED";
  reason: string;
  updatedAt: string;
}) {
  return (
    <Panel code={`BRF-${state}`} title={state} right="Daily brief source">
      <div className="state-panel">
        <span className={`badge ${state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{state}</span>
        <span className="tg soft">Source: GET /api/v1/briefs</span>
        <span className="tg soft">Updated {formatDateTime(updatedAt)}</span>
        <span className="state-reason">{reason}</span>
      </div>
    </Panel>
  );
}

export default async function BriefsPage() {
  let briefs: DailyBrief[] = [];
  let error: string | null = null;
  const requestedAt = new Date().toISOString();

  try {
    const response = await getBriefs();
    briefs = sortBriefs(response.data ?? []);
  } catch (err) {
    error = err instanceof Error ? err.message : "brief request failed";
  }

  const latest = briefs[0] ?? null;

  return (
    <PageFrame
      code="BRF"
      title="Daily Brief"
      sub="Operator brief from production DB"
      note="[BRF] LIVE/EMPTY/BLOCKED surface for GET /api/v1/briefs"
    >
      {error && (
        <BriefStatePanel
          state="BLOCKED"
          reason={`API request failed. Owner: Jason/Elva. Detail: ${error}`}
          updatedAt={requestedAt}
        />
      )}

      {!error && !latest && (
        <BriefStatePanel
          state="EMPTY"
          reason="The API returned zero daily briefs for the authenticated workspace. No mock brief is rendered."
          updatedAt={requestedAt}
        />
      )}

      {!error && latest && (
        <>
          <Panel
            code="BRF-LIVE"
            title={latest.marketState || "Market brief"}
            sub={latest.date}
            right={
              <span className="source-line" style={{ margin: 0 }}>
                <span className="badge badge-green">LIVE</span>
                <span>Source: GET /api/v1/briefs</span>
                <span>Updated {formatDateTime(latest.createdAt)}</span>
              </span>
            }
          >
            <div className="brief-section-list">
              {latest.sections.map((section) => (
                <article className="brief-section" key={`${latest.id}-${section.heading}`}>
                  <h2>{section.heading}</h2>
                  <p>{section.body}</p>
                </article>
              ))}
            </div>
          </Panel>

          <Panel code="BRF-HIST" title="Brief history" right={`${briefs.length} rows`}>
            <div className="brief-history-table">
              <div className="brief-history-row table-head">
                <span>Date</span>
                <span>State</span>
                <span>Status</span>
                <span>Generated</span>
                <span>Created</span>
              </div>
              {briefs.map((brief) => (
                <div className="brief-history-row" key={brief.id}>
                  <span className="tg gold">{brief.date}</span>
                  <span className="tg">{brief.marketState}</span>
                  <span className={`badge ${statusBadge(brief.status)}`}>{brief.status.toUpperCase()}</span>
                  <span className="tg soft">{brief.generatedBy}</span>
                  <span className="tg soft">{formatDateTime(brief.createdAt)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </PageFrame>
  );
}
