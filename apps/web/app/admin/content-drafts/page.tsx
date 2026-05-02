import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { getContentDrafts, type ContentDraftEntry, type ContentDraftStatus } from "@/lib/api";
import {
  CONTENT_DRAFT_STATUSES,
  contentDraftBody,
  contentDraftStatusBadge,
  contentDraftStatusLabel,
  contentDraftTargetLabel,
  contentDraftTitle,
} from "@/lib/content-draft-view";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function parseStatus(value: string | undefined): ContentDraftStatus | undefined {
  return CONTENT_DRAFT_STATUSES.includes(value as ContentDraftStatus)
    ? value as ContentDraftStatus
    : undefined;
}

function AdminDraftStatePanel({
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
    <Panel code={`ADM-${state}`} title={label} right="審稿草稿來源">
      <div className="state-panel">
        <span className={`badge ${state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{label}</span>
        <span className="tg soft">來源：審稿草稿資料庫</span>
        <span className="tg soft">更新 {formatDateTime(updatedAt)}</span>
        <span className="state-reason">{reason}</span>
      </div>
    </Panel>
  );
}

function AdminDraftRows({ drafts }: { drafts: ContentDraftEntry[] }) {
  return (
    <div className="content-draft-table">
      <div className="content-draft-row admin table-head">
        <span>ID</span>
        <span>目標</span>
        <span>標題</span>
        <span>狀態</span>
        <span>產生者</span>
        <span>更新</span>
        <span>開啟</span>
      </div>
      {drafts.map((draft) => {
        const body = contentDraftBody(draft);
        return (
          <div className="content-draft-row admin" key={draft.id}>
            <span className="tg gold">{draft.id.slice(0, 8)}</span>
            <span className="tg">{contentDraftTargetLabel(draft)}</span>
            <span className="content-draft-title">
              {contentDraftTitle(draft)}
              {body && <small>{body}</small>}
            </span>
            <span className={`badge ${contentDraftStatusBadge(draft.status)}`}>
              {contentDraftStatusLabel(draft.status)}
            </span>
            <span className="tg soft">{draft.producerVersion}</span>
            <span className="tg soft">{formatDateTime(draft.updatedAt)}</span>
            <Link className="mini-button" href={`/admin/content-drafts/${draft.id}`}>查看</Link>
          </div>
        );
      })}
    </div>
  );
}

function latestUpdatedAt(drafts: ContentDraftEntry[]) {
  return drafts
    .map((draft) => draft.updatedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

export default async function ContentDraftsAdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status = parseStatus(params?.status);
  let drafts: ContentDraftEntry[] = [];
  let error: string | null = null;
  const requestedAt = new Date().toISOString();

  try {
    const response = await getContentDrafts({ status, limit: 100 });
    drafts = response.data ?? [];
  } catch (err) {
    error = err instanceof Error ? err.message : "審稿草稿讀取失敗";
  }

  return (
    <PageFrame
      code="ADM-DRF"
      title="內容草稿審核"
      sub="AI 內容審稿佇列"
      exec
      note="內容草稿審核 / 只讀佇列；核准與退回動作仍在明確閘門後才開。"
    >
      <Panel code="ADM-FLT" title="狀態篩選" right={status ? contentDraftStatusLabel(status) : "全部"}>
        <div className="filter-row">
          <Link className={!status ? "mini-button" : "outline-button"} href="/admin/content-drafts">全部</Link>
          {CONTENT_DRAFT_STATUSES.map((item) => (
            <Link
              className={status === item ? "mini-button" : "outline-button"}
              href={`/admin/content-drafts?status=${item}`}
              key={item}
            >
              {contentDraftStatusLabel(item)}
            </Link>
          ))}
        </div>
      </Panel>

      {error && (
        <AdminDraftStatePanel
          state="BLOCKED"
          reason={`審稿草稿暫時無法讀取或權限不足。負責：Jason / Elva。細節：${error}`}
          updatedAt={requestedAt}
        />
      )}

      {!error && drafts.length === 0 && (
        <AdminDraftStatePanel
          state="EMPTY"
          reason="目前篩選條件沒有內容草稿，不顯示假審稿佇列。"
          updatedAt={requestedAt}
        />
      )}

      {!error && drafts.length > 0 && (
        <Panel
          code="ADM-LIVE"
          title="草稿佇列"
          right={
            <span className="source-line" style={{ margin: 0 }}>
              <span className="badge badge-green">正常</span>
              <span>來源：審稿草稿資料庫</span>
              <span>更新 {formatDateTime(latestUpdatedAt(drafts))}</span>
              <span>{drafts.length} 筆</span>
            </span>
          }
        >
          <AdminDraftRows drafts={drafts} />
        </Panel>
      )}
    </PageFrame>
  );
}
