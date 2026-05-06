import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { getContentDrafts, type ContentDraftEntry } from "@/lib/api";
import {
  contentDraftBody,
  contentDraftDate,
  contentDraftPayloadText,
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
        <span className="tg soft">來源：審稿草稿資料庫</span>
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
          <span className="tg soft">來源：審稿草稿資料庫</span>
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
            <p className="tg soft">payload 沒有 summary / note / body 欄位，改用下方結構化段落與原始內容檢查。</p>
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
          <pre className="payload-pre">{contentDraftPayloadText(draft)}</pre>
        </article>
      </Panel>

      <Panel code="DRF-TRAIL" title="來源與審核軌跡" right={draftDate ?? "未標日期"}>
        <div className="content-draft-trail-grid">
          {[
            ["來源工作", draft.sourceJobId ?? "無來源工作"],
            ["產生者", draft.producerVersion],
            ["目標", contentDraftTargetLabel(draft)],
            ["目標 ID", draft.targetEntityId ?? "無"],
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
          這裡只呈現 OpenAlice 草稿與審核線索；未核准內容不會顯示在正式每日簡報，也不會被包裝成投資建議。
        </p>
      </Panel>

      <Panel code="DRF-META" title="中繼資料">
        {[
          ["ID", draft.id],
          ["目標表", draft.targetTable],
          ["目標 ID", draft.targetEntityId ?? "無"],
          ["來源工作", draft.sourceJobId ?? "無"],
          ["產生者", draft.producerVersion],
          ["去重鍵", draft.dedupeKey],
          ["審核者", draft.reviewedBy ?? "無"],
          ["審核時間", formatDateTime(draft.reviewedAt)],
          ["核准參照", draft.approvedRefId ?? "無"],
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
          <span className="tg soft">來源：content-drafts approve / reject endpoint</span>
          <span className="state-reason">
            核准與退回的正式後端路徑已存在；本頁先清楚揭露目前狀態、來源與審核結果。若要開放按鈕，必須接正式 endpoint、記錄稽核，不得使用本機假成功。
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
      sub={id}
      exec
      note="內容草稿明細 / 只讀；無資料或後端暫停時不顯示假內容。"
    >
      <div style={{ marginBottom: 12 }}>
        <Link className="btn-sm" href="/admin/content-drafts">返回草稿列表</Link>
      </div>

      {error && (
        <DetailStatePanel
          state="BLOCKED"
          reason={`草稿明細暫時無法讀取或權限不足。負責：內容與後端資料管線。細節：${error}`}
          updatedAt={requestedAt}
        />
      )}
      {!error && !draft && (
        <DetailStatePanel
          state="EMPTY"
          reason="後端有回傳草稿，但沒有符合這個 ID 的資料；不顯示假草稿。"
          updatedAt={requestedAt}
        />
      )}
      {!error && draft && <DraftDetail draft={draft} />}
    </PageFrame>
  );
}
