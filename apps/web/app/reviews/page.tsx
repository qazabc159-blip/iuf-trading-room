import { PageFrame, Panel } from "@/components/PageFrame";
import { getReviews } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
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

function surfaceLabel(state: "EMPTY" | "BLOCKED") {
  return state === "EMPTY" ? "無資料" : "暫停";
}

function ReviewStatePanel({
  state,
  reason,
  updatedAt,
}: {
  state: "EMPTY" | "BLOCKED";
  reason: string;
  updatedAt: string;
}) {
  return (
    <Panel code={`REV-${state}`} title={surfaceLabel(state)} right="交易檢討資料">
      <div className="state-panel">
        <span className={`badge ${state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{surfaceLabel(state)}</span>
        <span className="tg soft">交易檢討資料</span>
        <span className="tg soft">更新 {formatDateTime(updatedAt)}</span>
        <span className="state-reason">{reason}</span>
      </div>
    </Panel>
  );
}

export default async function ReviewsPage() {
  let reviews: ReviewEntry[] = [];
  let error: string | null = null;
  const requestedAt = new Date().toISOString();

  try {
    const response = await getReviews();
    reviews = sortReviews(response.data ?? []);
  } catch (err) {
    error = friendlyDataError(err, "交易檢討暫時無法讀取。");
  }

  return (
    <PageFrame
      code="REV"
      title="交易檢討"
      sub="成交後復盤與執行品質"
      note="此頁只讀取正式資料庫的交易檢討，不顯示假資料，也不提供本地模擬動作。"
    >
      {error && (
        <ReviewStatePanel
          state="BLOCKED"
          reason={`交易檢討資料暫時無法讀取；後端負責人 Jason/Elva。${error}`}
          updatedAt={requestedAt}
        />
      )}

      {!error && reviews.length === 0 && (
        <ReviewStatePanel
          state="EMPTY"
          reason="目前工作區沒有交易檢討紀錄。"
          updatedAt={requestedAt}
        />
      )}

      {!error && reviews.length > 0 && (
        <Panel
          code="REV-LIVE"
          title="交易檢討紀錄"
          right={
            <span className="source-line" style={{ margin: 0 }}>
              <span className="badge badge-green">正常</span>
              <span>交易檢討資料</span>
              <span>更新 {formatDateTime(reviews[0].createdAt)}</span>
              <span>{reviews.length} 筆</span>
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
                  <span className="tg soft">計畫 {review.tradePlanId.slice(0, 8)}</span>
                </div>
                <h2>{review.outcome || "未命名檢討"}</h2>
                {review.attribution && (
                  <p><b>歸因：</b>{review.attribution}</p>
                )}
                {review.lesson && (
                  <p><b>教訓：</b>{review.lesson}</p>
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

      <Panel code="REV-ACTION" title="審核動作" right="待後端契約">
        <div className="state-panel">
          <span className="badge badge-red">暫停</span>
          <span className="tg soft">負責人：Jason/Elva</span>
          <span className="state-reason">
            目前沒有正式後端契約可在此頁核准或退回檢討。舊的本地按鈕已移除，避免把模擬動作誤認為已寫入資料庫。
          </span>
        </div>
      </Panel>
    </PageFrame>
  );
}
