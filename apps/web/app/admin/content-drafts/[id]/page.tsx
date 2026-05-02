import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { getContentDrafts, type ContentDraftEntry } from "@/lib/api";
import {
  contentDraftBody,
  contentDraftPayloadText,
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
            <p className="tg soft">payload 沒有可直接顯示的正文欄位，以下顯示原始內容。</p>
          )}
          <pre className="payload-pre">{contentDraftPayloadText(draft)}</pre>
        </article>
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
          <span className="badge badge-red">暫停</span>
          <span className="tg soft">負責：內容與後端資料管線</span>
          <span className="state-reason">
            核准與退回的正式後端路徑已存在，但本輪介面先不啟用寫入。舊的本機假按鈕已移除，避免把模擬核准誤認成正式資料庫決策。
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
