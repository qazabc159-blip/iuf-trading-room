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
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline, cleanNarrativeText } from "@/lib/operator-copy";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function parseStatus(value: string | undefined): ContentDraftStatus | undefined {
  return CONTENT_DRAFT_STATUSES.includes(value as ContentDraftStatus)
    ? value as ContentDraftStatus
    : undefined;
}

function DraftStatePanel({
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
    <Panel code={`DRF-${state}`} title={label} right="內容草稿資料">
      <div className="state-panel">
        <span className={`badge ${state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{label}</span>
        <span className="tg soft">內容草稿資料</span>
        <span className="tg soft">更新 {formatDateTime(updatedAt)}</span>
        <span className="state-reason">{reason}</span>
      </div>
    </Panel>
  );
}

function DraftRows({ drafts }: { drafts: ContentDraftEntry[] }) {
  return (
    <div className="content-draft-table">
      <div className="content-draft-row table-head">
        <span>ID</span>
        <span>目標</span>
        <span>標題</span>
        <span>狀態</span>
        <span>更新</span>
        <span>查看</span>
      </div>
      {drafts.map((draft) => {
        const body = cleanNarrativeText(contentDraftBody(draft), "");
        return (
          <Link className="content-draft-row" href={`/admin/content-drafts/${draft.id}`} key={draft.id}>
            <span className="tg gold">{draft.id.slice(0, 8)}</span>
            <span className="tg">{contentDraftTargetLabel(draft)}</span>
            <span className="content-draft-title">
              {cleanExternalHeadline(contentDraftTitle(draft), "內容草稿")}
              {body && <small>{body}</small>}
            </span>
            <span className={`badge ${contentDraftStatusBadge(draft.status)}`}>
              {contentDraftStatusLabel(draft.status)}
            </span>
            <span className="tg soft">{formatDateTime(draft.updatedAt)}</span>
            <span className="mini-button">查看</span>
          </Link>
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

export default async function DraftsPage({
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
    error = friendlyDataError(err, "內容草稿暫時無法讀取。");
  }

  return (
    <PageFrame
      code="DRF"
      title="內容草稿"
      sub="AI 內容草稿與審核佇列"
      note="此頁只讀取正式資料庫的內容草稿，不顯示假草稿。"
    >
      <Panel code="DRF-FLT" title="狀態篩選" right={status ? contentDraftStatusLabel(status) : "全部"}>
        <div className="filter-row">
          <Link className={!status ? "mini-button" : "outline-button"} href="/drafts">全部</Link>
          {CONTENT_DRAFT_STATUSES.map((item) => (
            <Link
              className={status === item ? "mini-button" : "outline-button"}
              href={`/drafts?status=${item}`}
              key={item}
            >
              {contentDraftStatusLabel(item)}
            </Link>
          ))}
        </div>
      </Panel>

      {error && (
        <DraftStatePanel
          state="BLOCKED"
          reason={`內容草稿資料暫時無法讀取；後端負責人 內容與後端資料管線。${error}`}
          updatedAt={requestedAt}
        />
      )}

      {!error && drafts.length === 0 && (
        <DraftStatePanel
          state="EMPTY"
          reason="目前篩選條件沒有內容草稿。"
          updatedAt={requestedAt}
        />
      )}

      {!error && drafts.length > 0 && (
        <Panel
          code="DRF-LIVE"
          title="草稿佇列"
          right={
            <span className="source-line" style={{ margin: 0 }}>
              <span className="badge badge-green">正常</span>
              <span>內容草稿資料</span>
              <span>更新 {formatDateTime(latestUpdatedAt(drafts))}</span>
              <span>{drafts.length} 筆</span>
            </span>
          }
        >
          <DraftRows drafts={drafts} />
        </Panel>
      )}
    </PageFrame>
  );
}
