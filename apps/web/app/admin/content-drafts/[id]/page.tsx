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

function DraftDetail({ draft }: { draft: ContentDraftEntry }) {
  const body = contentDraftBody(draft);
  const sections = contentDraftSections(draft);
  const draftDate = contentDraftDate(draft);

  return (
    <div className="main-grid">
      <Panel code="DRF-BODY" title={contentDraftTargetLabel(draft)}>
        <div className="source-line">
          <span className="badge badge-green">正常</span>
          <span className="tg soft">來源：審稿草稿</span>
          <span>更新 {formatDateTime(draft.updatedAt)}</span>
          <span className={`badge ${contentDraftStatusBadge(draft.status)}`}>
            {contentDraftStatusLabel(draft.status)}
          </span>
        </div>
        <article className="review-ledger-card">
          <h2>{contentDraftTitle(draft)}</h2>
          {body ? (
            <p>{body}</p>
          ) : (
            <p className="tg soft">草稿沒有摘要欄位，改用下方段落檢查。</p>
          )}
          {sections.length > 0 && (
            <div className="content-draft-section-list">
              {sections.map((section, index) => (
                <section className="content-draft-section" key={`${section.heading}-${index}`}>
                  <span className="tg gold">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{section.heading}</h3>
                    <p>{section.body || "本段沒有正文，不應發布到正式每日簡報。"}</p>
                  </div>
                </section>
              ))}
            </div>
          )}
        </article>
      </Panel>

      <Panel code="DRF-TRAIL" title="來源與審核軌跡" right={draftDate ?? "未標日期"}>
        <div className="content-draft-trail-grid">
          {[
            ["來源工作", draft.sourceJobId ? "已連結" : "尚未連結"],
            ["產生流程", "每日內容流程"],
            ["目標", contentDraftTargetLabel(draft)],
            ["審核者", contentDraftReviewActor(draft)],
            ["審核結論", contentDraftReviewNote(draft)],
          ].map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
        <p className="tg soft" style={{ lineHeight: 1.7, marginTop: 14 }}>
          這裡只呈現 AI 草稿與審核線索；未核准內容不會顯示在正式每日簡報，也不會被包裝成投資建議。
        </p>
      </Panel>

      <Panel code="DRF-META" title="審核資料">
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
          <div className="row" key={key} style={{ gridTemplateColumns: "126px 1fr", gap: 12, padding: "9px 0" }}>
            <span className="tg gold">{key}</span>
            <span className="tg" style={{ overflowWrap: "anywhere" }}>{value}</span>
          </div>
        ))}
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
      <div style={{ marginBottom: 12 }}>
        <Link className="btn-sm" href="/admin/content-drafts">返回草稿列表</Link>
      </div>

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
