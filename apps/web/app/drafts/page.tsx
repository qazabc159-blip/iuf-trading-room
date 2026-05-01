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

function DraftStatePanel({
  state,
  reason,
}: {
  state: "EMPTY" | "BLOCKED";
  reason: string;
}) {
  return (
    <Panel code={`DRF-${state}`} title={state} right="Content draft source">
      <div className="state-panel">
        <span className={`badge ${state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{state}</span>
        <span className="tg soft">Source: GET /api/v1/content-drafts</span>
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
        <span>Target</span>
        <span>Title</span>
        <span>Status</span>
        <span>Updated</span>
        <span>Open</span>
      </div>
      {drafts.map((draft) => {
        const body = contentDraftBody(draft);
        return (
          <Link className="content-draft-row" href={`/admin/content-drafts/${draft.id}`} key={draft.id}>
            <span className="tg gold">{draft.id.slice(0, 8)}</span>
            <span className="tg">{contentDraftTargetLabel(draft)}</span>
            <span className="content-draft-title">
              {contentDraftTitle(draft)}
              {body && <small>{body}</small>}
            </span>
            <span className={`badge ${contentDraftStatusBadge(draft.status)}`}>
              {contentDraftStatusLabel(draft.status)}
            </span>
            <span className="tg soft">{formatDateTime(draft.updatedAt)}</span>
            <span className="mini-button">VIEW</span>
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

  try {
    const response = await getContentDrafts({ status, limit: 100 });
    drafts = response.data ?? [];
  } catch (err) {
    error = err instanceof Error ? err.message : "content drafts request failed";
  }

  return (
    <PageFrame
      code="DRF"
      title="Content Drafts"
      sub="OpenAlice drafts from production DB"
      note="[DRF] Read-only LIVE/EMPTY/BLOCKED surface for GET /api/v1/content-drafts"
    >
      <Panel code="DRF-FLT" title="Status filter" right={status ? contentDraftStatusLabel(status) : "ALL"}>
        <div className="filter-row">
          <Link className={!status ? "mini-button" : "outline-button"} href="/drafts">ALL</Link>
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
          reason={`API request failed. Owner: Jason/Elva. Detail: ${error}`}
        />
      )}

      {!error && drafts.length === 0 && (
        <DraftStatePanel
          state="EMPTY"
          reason="The API returned zero content drafts for this filter. No mock drafts are rendered."
        />
      )}

      {!error && drafts.length > 0 && (
        <Panel
          code="DRF-LIVE"
          title="Draft queue"
          right={
            <span className="source-line" style={{ margin: 0 }}>
              <span className="badge badge-green">LIVE</span>
              <span>Source: GET /api/v1/content-drafts</span>
              <span>Updated {formatDateTime(latestUpdatedAt(drafts))}</span>
              <span>{drafts.length} rows</span>
            </span>
          }
        >
          <DraftRows drafts={drafts} />
        </Panel>
      )}
    </PageFrame>
  );
}
