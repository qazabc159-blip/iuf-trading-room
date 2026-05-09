import { PageFrame } from "@/components/PageFrame";
import { getReviews } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanNarrativeText, cleanTradePlanText } from "@/lib/operator-copy";
import type { ReviewEntry } from "@iuf-trading-room/contracts";

function formatDateShort(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

function sortReviews(reviews: ReviewEntry[]) {
  return [...reviews].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function qualityColor(value: number) {
  if (value >= 4) return { border: "rgba(46,204,113,0.55)", bg: "rgba(46,204,113,0.08)", text: "#4adb88" };
  if (value <= 2) return { border: "rgba(230,57,70,0.55)", bg: "rgba(230,57,70,0.08)", text: "#ff6b77" };
  return { border: "rgba(200,148,63,0.55)", bg: "rgba(200,148,63,0.08)", text: "#e2b85c" };
}

function qualityLabel(value: number) {
  if (value >= 4) return "執行優";
  if (value <= 2) return "待改善";
  return "尚可";
}

function qualityKpiClass(value: number | string) {
  if (value === "--") return "dim";
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (n >= 4) return "ok";
  if (n <= 2) return "bad";
  return "warn";
}

const REVIEWS_CSS = `
._rev-panel {
  margin-bottom: 0;
}
._rev-list {
  display: grid;
  gap: 14px;
  margin-top: 8px;
}
._rev-card {
  position: relative;
  padding: 22px 26px;
  border-radius: 4px;
  border: 1px solid rgba(220,228,240,0.08);
  border-left: 3px solid;
  background: rgba(8,11,16,0.58);
  transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s;
  overflow: hidden;
}
._rev-card:hover {
  transform: translateY(-2px);
  background: rgba(14,18,26,0.82);
  box-shadow: 0 8px 28px rgba(0,0,0,0.35);
}
@media (prefers-reduced-motion: reduce) {
  ._rev-card { transition: none; }
  ._rev-card:hover { transform: none; }
}
._rev-card-glow {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 60px;
  pointer-events: none;
}
._rev-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  position: relative;
  z-index: 1;
}
._rev-q-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 2px solid;
  font-size: 16px;
  font-weight: 800;
  font-family: var(--mono, monospace);
  flex-shrink: 0;
}
._rev-date {
  font-size: 12px;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.7);
  letter-spacing: 0.02em;
}
._rev-plan-id {
  font-size: 10px;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.4);
  letter-spacing: 0.02em;
  margin-left: auto;
}
._rev-outcome {
  font-size: 15px;
  font-weight: 600;
  color: #e7ecf3;
  line-height: 1.5;
  margin-bottom: 10px;
  position: relative;
  z-index: 1;
}
._rev-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
  position: relative;
  z-index: 1;
}
._rev-detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
._rev-detail-label {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(145,160,181,0.55);
  font-family: var(--mono, monospace);
}
._rev-detail-text {
  font-size: 12px;
  color: rgba(220,228,240,0.75);
  line-height: 1.55;
}
._rev-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
  position: relative;
  z-index: 1;
}
._rev-tag {
  font-size: 10px;
  font-family: var(--mono, monospace);
  letter-spacing: 0.05em;
  padding: 2px 8px;
  border-radius: 3px;
  background: rgba(220,228,240,0.05);
  border: 1px solid rgba(220,228,240,0.12);
  color: rgba(145,160,181,0.8);
}
._rev-note {
  padding: 16px 20px;
  border-radius: 4px;
  background: rgba(200,148,63,0.06);
  border: 1px solid rgba(200,148,63,0.2);
  border-left: 3px solid rgba(200,148,63,0.55);
  margin-top: 24px;
}
._rev-note-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #e2b85c;
  font-family: var(--mono, monospace);
  margin-bottom: 6px;
}
._rev-note-body {
  font-size: 12px;
  color: rgba(145,160,181,0.8);
  line-height: 1.6;
}
@media (max-width: 640px) {
  ._rev-detail-grid { grid-template-columns: 1fr; }
}
`;

export default async function ReviewsPage() {
  let reviews: ReviewEntry[] = [];
  let error: string | null = null;

  try {
    const response = await getReviews();
    reviews = sortReviews(response.data ?? []);
  } catch (err) {
    error = friendlyDataError(err, "交易檢討暫時無法讀取。");
  }

  const totalQ = reviews.length > 0 ? reviews.reduce((s, r) => s + r.executionQuality, 0) : 0;
  const avgQ = reviews.length > 0 ? (totalQ / reviews.length).toFixed(1) : "--";
  const highQ = reviews.filter((r) => r.executionQuality >= 4).length;
  const lowQ = reviews.filter((r) => r.executionQuality <= 2).length;
  const taggedCount = reviews.filter((r) => r.setupTags.length > 0).length;

  return (
    <PageFrame
      code="REV"
      title="交易檢討"
      sub="成交後復盤與執行品質"
      note="此頁只讀取正式資料庫的交易檢討，不顯示假資料，也不提供本地模擬動作。"
    >
      <style>{REVIEWS_CSS}</style>

      {/* parity-kpi-bar hero */}
      <div className="parity-kpi-bar">
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">覆盤紀錄</span>
          <span className={`parity-kpi-value ${reviews.length > 0 ? "ok" : "dim"}`}>
            {reviews.length}
          </span>
          <span className="parity-kpi-sub">份已記錄</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">平均品質 Q</span>
          <span className={`parity-kpi-value ${qualityKpiClass(avgQ)}`}>
            {avgQ}
          </span>
          <span className="parity-kpi-sub">滿分 5 分</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">優質執行</span>
          <span className={`parity-kpi-value ${highQ > 0 ? "ok" : "dim"}`}>
            {highQ}
          </span>
          <span className="parity-kpi-sub">Q≥4 標準</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">待改善</span>
          <span className={`parity-kpi-value ${lowQ > 0 ? "bad" : "dim"}`}>
            {lowQ}
          </span>
          <span className="parity-kpi-sub">Q≤2 需檢討</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">有標籤</span>
          <span className={`parity-kpi-value ${taggedCount > 0 ? "warn" : "dim"}`}>
            {taggedCount}
          </span>
          <span className="parity-kpi-sub">標籤化覆盤</span>
        </div>
      </div>

      {error && (
        <div className="parity-empty">
          <div className="parity-empty-icon">✕</div>
          <h3>資料來源暫停</h3>
          <p>交易檢討資料暫時無法讀取。系統持續嘗試重連；請稍候重新整理。</p>
        </div>
      )}

      {!error && reviews.length === 0 && (
        <div className="parity-empty">
          <div className="parity-empty-icon">◌</div>
          <h3>尚無覆盤紀錄</h3>
          <p>目前工作區沒有交易檢討紀錄。完成交易後由操作員建立覆盤條目，數據不補假值。</p>
        </div>
      )}

      {!error && reviews.length > 0 && (
        <div className="_rev-list">
          {reviews.map((review) => {
            const qc = qualityColor(review.executionQuality);
            return (
              <div
                key={review.id}
                className="_rev-card"
                style={{ borderLeftColor: qc.border }}
              >
                {/* Glow */}
                <div
                  className="_rev-card-glow"
                  style={{ background: `radial-gradient(ellipse at 0% 0%, ${qc.bg.replace("0.08", "0.14")}, transparent 60%)` }}
                />

                {/* Head */}
                <div className="_rev-head">
                  <div
                    className="_rev-q-badge"
                    style={{
                      borderColor: qc.border,
                      background: qc.bg,
                      color: qc.text,
                    }}
                  >
                    Q{review.executionQuality}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span
                      className="parity-badge"
                      style={{ color: qc.text, borderColor: qc.border, background: qc.bg }}
                    >
                      {qualityLabel(review.executionQuality)}
                    </span>
                    <span className="_rev-date">{formatDateShort(review.createdAt)}</span>
                  </div>
                  <span className="_rev-plan-id">計畫 {review.tradePlanId.slice(0, 8)}</span>
                </div>

                {/* Outcome */}
                <div className="_rev-outcome">
                  {cleanTradePlanText(review.outcome, "未命名檢討")}
                </div>

                {/* Attribution + Lesson */}
                {(review.attribution || review.lesson) && (
                  <div className="_rev-detail-grid">
                    {review.attribution && (
                      <div className="_rev-detail-item">
                        <span className="_rev-detail-label">歸因</span>
                        <span className="_rev-detail-text">
                          {cleanNarrativeText(review.attribution, "歸因尚未完成中文整理。")}
                        </span>
                      </div>
                    )}
                    {review.lesson && (
                      <div className="_rev-detail-item">
                        <span className="_rev-detail-label">教訓</span>
                        <span className="_rev-detail-text">
                          {cleanNarrativeText(review.lesson, "教訓尚未完成中文整理。")}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Setup tags */}
                {review.setupTags.length > 0 && (
                  <div className="_rev-tag-row">
                    {review.setupTags.map((tag) => (
                      <span key={`${review.id}-${tag}`} className="_rev-tag">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Read-only boundary note */}
      <div className="_rev-note" style={{ marginTop: reviews.length > 0 ? 24 : 16 }}>
        <div className="_rev-note-title">READ-ONLY 邊界</div>
        <div className="_rev-note-body">
          本頁是只讀覆盤面板。模擬委託預覽與送出已放在個股頁；核准或退回動作尚未有正式後端契約，舊的本地按鈕已移除。
        </div>
      </div>
    </PageFrame>
  );
}
