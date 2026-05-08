import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { getContentDrafts, type ContentDraftEntry } from "@/lib/api";
import {
  contentDraftBody,
  contentDraftDate,
  contentDraftReviewActor,
  contentDraftReviewNote,
  contentDraftSections,
  contentDraftStatusBadge,
  contentDraftStatusLabel,
  contentDraftTargetLabel,
  contentDraftTitle,
} from "@/lib/content-draft-view";

function formatDateTime(value: string | null) {
  if (!value) return "未設定";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function DetailStatePanel({
  state,
  reason,
  updatedAt,
}: {
  state: "EMPTY" | "BLOCKED";
  reason: string;
  updatedAt: string;
}) {
  const label = state === "EMPTY" ? "無資料" : "暫停";
  return (
    <Panel code={`DRF-${state}`} title={label} right="草稿明細">
      <div className="state-panel">
        <span className={`badge ${state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{label}</span>
        <span className="tg soft">來源：審稿草稿</span>
        <span className="tg soft">更新 {formatDateTime(updatedAt)}</span>
        <span className="state-reason">{reason}</span>
      </div>
    </Panel>
  );
}

const DETAIL_CSS = `
  ._bty-adm-detail-grid {
    display: grid;
    grid-template-columns: 1fr 280px;
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 860px) {
    ._bty-adm-detail-grid { grid-template-columns: 1fr; }
  }
  ._bty-adm-status-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 14px;
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
    margin-bottom: 14px;
  }
  ._bty-adm-status-badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
  }
  ._bty-adm-article {
    padding: 16px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
  }
  ._bty-adm-article h2 {
    font-size: 16px;
    font-weight: 600;
    color: rgba(255,255,255,0.9);
    margin: 0 0 10px;
    line-height: 1.3;
  }
  ._bty-adm-article p {
    font-size: 13px;
    color: rgba(255,255,255,0.65);
    line-height: 1.7;
    margin: 0;
  }
  ._bty-adm-sections {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 16px;
  }
  ._bty-adm-section {
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: 10px;
    align-items: start;
    padding: 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 4px;
  }
  ._bty-adm-section-num {
    font-family: var(--mono, monospace);
    font-size: 13px;
    color: #ffb800;
    font-weight: 700;
    padding-top: 1px;
  }
  ._bty-adm-section h3 {
    font-size: 13px;
    font-weight: 600;
    color: rgba(255,255,255,0.85);
    margin: 0 0 6px;
  }
  ._bty-adm-section p {
    font-size: 12px;
    color: rgba(255,255,255,0.55);
    line-height: 1.65;
    margin: 0;
  }
  ._bty-trail-grid {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
    overflow: hidden;
  }
  ._bty-trail-row {
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 10px;
    padding: 9px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  ._bty-trail-row:last-child {
    border-bottom: none;
  }
  ._bty-trail-key {
    font-size: 11px;
    color: #ffb800;
    font-weight: 500;
  }
  ._bty-trail-val {
    font-size: 12px;
    color: rgba(255,255,255,0.7);
    overflow-wrap: anywhere;
  }
  ._bty-meta-grid {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
    overflow: hidden;
    margin-top: 10px;
  }
  ._bty-meta-row {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    font-size: 11px;
  }
  ._bty-meta-row:last-child { border-bottom: none; }
  ._bty-meta-key { color: rgba(255,255,255,0.4); }
  ._bty-meta-val { color: rgba(255,255,255,0.7); overflow-wrap: anywhere; }
  ._bty-back-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    text-decoration: none;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.7);
    margin-bottom: 14px;
    transition: background 0.1s;
  }
  ._bty-back-btn:hover { background: rgba(255,255,255,0.09); }
  @media (prefers-reduced-motion: reduce) {
    ._bty-back-btn { transition: none !important; }
  }
`;

function statusProps(status: string): React.CSSProperties {
  if (status === "approved") return { background: "rgba(76,175,80,0.15)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.35)" };
  if (status === "rejected") return { background: "rgba(239,83,80,0.15)", color: "#ef5350", border: "1px solid rgba(239,83,80,0.35)" };
  if (status === "pending") return { background: "rgba(255,184,0,0.15)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.35)" };
  return { background: "rgba(100,100,100,0.15)", color: "#888", border: "1px solid rgba(100,100,100,0.3)" };
}

function DraftDetail({ draft }: { draft: ContentDraftEntry }) {
  const body = contentDraftBody(draft);
  const sections = contentDraftSections(draft);
  const draftDate = contentDraftDate(draft);

  return (
    <div className="_bty-adm-detail-grid">
      {/* Left: content */}
      <div>
        <Panel code="DRF-BODY" title={contentDraftTargetLabel(draft)}>
          <div className="_bty-adm-status-bar">
            <span className="badge badge-green">正常</span>
            <span className="tg soft" style={{ fontSize: 12 }}>來源：審稿草稿</span>
            <span className="tg soft" style={{ fontSize: 12 }}>更新 {formatDateTime(draft.updatedAt)}</span>
            <span
              className="_bty-adm-status-badge"
              style={statusProps(draft.status)}
            >
              {contentDraftStatusLabel(draft.status)}
            </span>
          </div>
          <div className="_bty-adm-article">
            <h2>{contentDraftTitle(draft)}</h2>
            {body ? (
              <p>{body}</p>
            ) : (
              <p className="tg soft" style={{ fontSize: 12 }}>草稿沒有摘要欄位，改用下方段落檢查。</p>
            )}
          </div>
          {sections.length > 0 && (
            <div className="_bty-adm-sections">
              {sections.map((section, index) => (
                <div className="_bty-adm-section" key={`${section.heading}-${index}`}>
                  <span className="_bty-adm-section-num">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{section.heading}</h3>
                    <p>{section.body || "本段沒有正文，不應發布到正式每日簡報。"}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Right: trail + meta */}
      <div>
        <Panel code="DRF-TRAIL" title="來源與審核軌跡" right={draftDate ?? "未標日期"}>
          <div className="_bty-trail-grid">
            {[
              ["來源工作", draft.sourceJobId ? "已連結" : "尚未連結"],
              ["產生流程", "每日內容流程"],
              ["目標", contentDraftTargetLabel(draft)],
              ["審核者", contentDraftReviewActor(draft)],
              ["審核結論", contentDraftReviewNote(draft)],
            ].map(([key, value]) => (
              <div className="_bty-trail-row" key={key}>
                <span className="_bty-trail-key">{key}</span>
                <span className="_bty-trail-val">{value}</span>
              </div>
            ))}
          </div>
          <p className="tg soft" style={{ lineHeight: 1.7, marginTop: 12, fontSize: 11 }}>
            這裡只呈現 AI 草稿與審核線索；未核准內容不會顯示在正式每日簡報，也不會被包裝成投資建議。
          </p>
        </Panel>

        <Panel code="DRF-META" title="審核資料">
          <div className="_bty-meta-grid">
            {[
              ["目標", contentDraftTargetLabel(draft)],
              ["來源工作", draft.sourceJobId ? "已連結" : "尚未連結"],
              ["產生流程", "每日內容流程"],
              ["審核者", draft.reviewedBy ?? "無"],
              ["審核時間", formatDateTime(draft.reviewedAt)],
              ["退回原因", draft.rejectReason ?? "無"],
              ["建立", formatDateTime(draft.createdAt)],
              ["更新", formatDateTime(draft.updatedAt)],
            ].map(([key, value]) => (
              <div className="_bty-meta-row" key={key}>
                <span className="_bty-meta-key">{key}</span>
                <span className="_bty-meta-val">{value}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel code="DRF-ACT" title="寫入動作" right="受控">
          <div className="state-panel">
            <span className="badge badge-yellow">受控</span>
            <span className="tg soft">來源：草稿審核流程</span>
            <span className="state-reason">
              本頁先清楚揭露目前狀態、來源與審核結果；核准與退回必須留下正式稽核紀錄。
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default async function ContentDraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let draft: ContentDraftEntry | null = null;
  let error: string | null = null;
  const requestedAt = new Date().toISOString();

  try {
    const response = await getContentDrafts({ limit: 200 });
    draft = (response.data ?? []).find((item) => item.id === id) ?? null;
  } catch (err) {
    error = err instanceof Error ? err.message : "草稿明細讀取失敗";
  }

  return (
    <PageFrame
      code="ADM-DRF-D"
      title={draft ? contentDraftTitle(draft) : "內容草稿明細"}
      sub="草稿審核"
      exec
      note="內容草稿明細 / 只讀；無資料或資料服務暫停時不顯示假內容。"
    >
      <style>{DETAIL_CSS}</style>

      <Link className="_bty-back-btn" href="/admin/content-drafts">← 返回草稿列表</Link>

      {error && (
        <DetailStatePanel
          state="BLOCKED"
          reason="草稿明細暫時無法讀取或權限不足。"
          updatedAt={requestedAt}
        />
      )}
      {!error && !draft && (
        <DetailStatePanel
          state="EMPTY"
          reason="找不到指定草稿；不顯示假草稿。"
          updatedAt={requestedAt}
        />
      )}
      {!error && draft && <DraftDetail draft={draft} />}
    </PageFrame>
  );
}
