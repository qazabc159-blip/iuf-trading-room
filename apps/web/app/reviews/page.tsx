import { PageFrame, Panel } from "@/components/PageFrame";
import { getReviews } from "@/lib/api";
import type { ReviewEntry } from "@iuf-trading-room/contracts";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function sortReviews(reviews: ReviewEntry[]) {
  return [...reviews].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function qualityBadge(value: number) {
  if (value >= 4) return "badge-green";
  if (value <= 2) return "badge-red";
  return "badge-yellow";
}

function ReviewStatePanel({
  state,
  reason,
}: {
  state: "EMPTY" | "BLOCKED";
  reason: string;
}) {
  return (
    <Panel code={`REV-${state}`} title={state} right="Review ledger source">
      <div className="state-panel">
        <span className={`badge ${state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{state}</span>
        <span className="tg soft">Source: GET /api/v1/reviews</span>
        <span className="state-reason">{reason}</span>
      </div>
    </Panel>
  );
}

export default async function ReviewsPage() {
  let reviews: ReviewEntry[] = [];
  let error: string | null = null;

  try {
    const response = await getReviews();
    reviews = sortReviews(response.data ?? []);
  } catch (err) {
    error = err instanceof Error ? err.message : "reviews request failed";
  }

  return (
    <PageFrame
      code="REV"
      title="Review Ledger"
      sub="Post-trade review entries from production DB"
      note="[REV] Read-only LIVE/EMPTY/BLOCKED surface for GET /api/v1/reviews"
    >
      {error && (
        <ReviewStatePanel
          state="BLOCKED"
          reason={`API request failed. Owner: Jason/Elva. Detail: ${error}`}
        />
      )}

      {!error && reviews.length === 0 && (
        <ReviewStatePanel
          state="EMPTY"
          reason="The API returned zero review entries for the authenticated workspace. No mock queue is rendered."
        />
      )}

      {!error && reviews.length > 0 && (
        <Panel
          code="REV-LIVE"
          title="Review entries"
          right={
            <span className="source-line" style={{ margin: 0 }}>
              <span className="badge badge-green">LIVE</span>
              <span>Source: GET /api/v1/reviews</span>
              <span>{reviews.length} rows</span>
            </span>
          }
        >
          <div className="review-ledger-list">
            {reviews.map((review) => (
              <article className="review-ledger-card" key={review.id}>
                <div className="review-ledger-head">
                  <span className="tg gold">{formatDateTime(review.createdAt)}</span>
                  <span className={`badge ${qualityBadge(review.executionQuality)}`}>
                    Q{review.executionQuality}
                  </span>
                  <span className="tg soft">Plan {review.tradePlanId.slice(0, 8)}</span>
                </div>
                <h2>{review.outcome || "Untitled review"}</h2>
                {review.attribution && (
                  <p><b>Attribution:</b> {review.attribution}</p>
                )}
                {review.lesson && (
                  <p><b>Lesson:</b> {review.lesson}</p>
                )}
                {review.setupTags.length > 0 && (
                  <div className="review-tag-row">
                    {review.setupTags.map((tag) => (
                      <span className="badge" key={`${review.id}-${tag}`}>{tag}</span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </Panel>
      )}

      <Panel code="REV-ACTION" title="Action queue" right="contract required">
        <div className="state-panel">
          <span className="badge badge-red">BLOCKED</span>
          <span className="tg soft">Owner: Jason/Elva.</span>
          <span className="state-reason">
            No production contract exists for an accept/reject review queue on this page. The old local-only
            buttons were removed so operators cannot mistake simulated actions for persisted review decisions.
          </span>
        </div>
      </Panel>
    </PageFrame>
  );
}
