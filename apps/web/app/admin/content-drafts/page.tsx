import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { getContentDrafts, type ContentDraftEntry, type ContentDraftStatus } from "@/lib/api";
import {
  CONTENT_DRAFT_STATUSES,
  contentDraftBody,
  contentDraftDate,
  contentDraftMarketState,
  contentDraftReviewActor,
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
        <span className="tg soft">來源：審稿草稿</span>
        <span className="tg soft">更新 {formatDateTime(updatedAt)}</span>
        <span className="state-reason">{reason}</span>
      </div>
    </Panel>
  );
}

const ADM_DRAFTS_CSS = `
  ._bty-adm-kpi {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: 1px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 6px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  ._bty-adm-kpi-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 8px;
    background: rgba(0,0,0,0.25);
    gap: 4px;
  }
  ._bty-adm-kpi-val {
    font-size: 18px;
    font-weight: 700;
    font-family: var(--mono, monospace);
    color: #e0e0e0;
    line-height: 1;
  }
  ._bty-adm-kpi-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  ._bty-adm-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
    padding: 10px 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
    align-items: center;
  }
  ._bty-adm-filter-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding-right: 8px;
    border-right: 1px solid rgba(255,255,255,0.1);
    margin-right: 2px;
  }
  ._bty-adm-filter-btn {
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    border: 1px solid rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.6);
    background: transparent;
    transition: background 0.1s;
  }
  ._bty-adm-filter-btn:hover {
    background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.9);
  }
  ._bty-adm-filter-btn.active {
    background: rgba(255,184,0,0.2);
    border-color: rgba(255,184,0,0.5);
    color: #ffb800;
    font-weight: 600;
  }
  ._bty-adm-draft-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  ._bty-adm-draft-row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: start;
    padding: 12px 14px;
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.07);
    border-left: 3px solid var(--_status-color, #888);
    border-radius: 4px;
    transition: background 0.1s;
  }
  ._bty-adm-draft-row:hover {
    background: rgba(255,255,255,0.04);
  }
  ._bty-adm-col-id {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 90px;
  }
  ._bty-adm-id {
    font-family: var(--mono, monospace);
    font-size: 11px;
    color: #ffb800;
    font-weight: 600;
  }
  ._bty-adm-target-tag {
    font-size: 10px;
    color: rgba(255,255,255,0.5);
    padding: 1px 6px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 3px;
    font-family: var(--mono, monospace);
    width: fit-content;
  }
  ._bty-adm-col-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  ._bty-adm-title {
    font-size: 13px;
    font-weight: 500;
    color: rgba(255,255,255,0.85);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  ._bty-adm-body {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  ._bty-adm-trail {
    font-size: 10px;
    color: rgba(255,255,255,0.35);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  ._bty-adm-col-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    flex-shrink: 0;
  }
  ._bty-adm-status {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
  ._bty-adm-ts {
    font-size: 10px;
    color: rgba(255,255,255,0.35);
  }
  ._bty-adm-open-btn {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    text-decoration: none;
    background: rgba(255,184,0,0.12);
    border: 1px solid rgba(255,184,0,0.3);
    color: #ffb800;
    transition: background 0.1s;
  }
  ._bty-adm-open-btn:hover {
    background: rgba(255,184,0,0.22);
  }
  @media (prefers-reduced-motion: reduce) {
    ._bty-adm-draft-row, ._bty-adm-filter-btn, ._bty-adm-open-btn { transition: none !important; }
  }
`;

function statusColorVar(status: string): string {
  if (status === "approved") return "#4caf50";
  if (status === "rejected") return "#ef5350";
  if (status === "pending") return "#ffb800";
  return "#888";
}

function statusStyleProps(status: string): React.CSSProperties {
  const color = statusColorVar(status);
  return {
    "--_status-color": color,
    background: `${color}1a`,
    color: color,
    border: `1px solid ${color}55`,
  } as React.CSSProperties;
}

function AdminDraftCards({ drafts }: { drafts: ContentDraftEntry[] }) {
  return (
    <div className="_bty-adm-draft-list">
      {drafts.map((draft) => {
        const body = contentDraftBody(draft);
        const draftDate = contentDraftDate(draft);
        const marketState = contentDraftMarketState(draft);
        const statusColor = statusColorVar(draft.status);
        return (
          <div
            className="_bty-adm-draft-row"
            key={draft.id}
            style={{ "--_status-color": statusColor } as React.CSSProperties}
          >
            <div className="_bty-adm-col-id">
              <span className="_bty-adm-id">{draft.id.slice(0, 8)}</span>
              <span className="_bty-adm-target-tag">{contentDraftTargetLabel(draft)}</span>
            </div>

            <div className="_bty-adm-col-main">
              <div className="_bty-adm-title">{contentDraftTitle(draft)}</div>
              {body && <div className="_bty-adm-body">{body}</div>}
              <div className="_bty-adm-trail">
                <span>每日內容流程 / {draft.sourceJobId ? "來源已連結" : "來源未連結"}</span>
                {(draftDate || marketState) && <span>{[draftDate, marketState].filter(Boolean).join(" / ")}</span>}
                <span>{contentDraftReviewActor(draft)}</span>
              </div>
            </div>

            <div className="_bty-adm-col-right">
              <span
                className="_bty-adm-status"
                style={statusStyleProps(draft.status)}
              >
                {contentDraftStatusLabel(draft.status)}
              </span>
              <span className="_bty-adm-ts">{formatDateTime(draft.updatedAt)}</span>
              <Link className="_bty-adm-open-btn" href={`/admin/content-drafts/${draft.id}`}>查看</Link>
            </div>
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

  const approvedCount = drafts.filter((d) => d.status === "approved").length;
  const pendingCount = drafts.filter((d) => d.status === "pending").length;
  const rejectedCount = drafts.filter((d) => d.status === "rejected").length;

  return (
    <PageFrame
      code="ADM-DRF"
      title="內容草稿審核"
      sub="AI 內容審稿佇列"
      exec
      note="內容草稿審核 / 顯示 AI 產文、來源線索與審核狀態；尚未核准的草稿不會進正式頁面。"
    >
      <style>{ADM_DRAFTS_CSS}</style>

      {/* Hero KPI */}
      <div className="_bty-adm-kpi">
        <div className="_bty-adm-kpi-cell">
          <span className="_bty-adm-kpi-val" style={{ color: error ? "#ef5350" : "#4caf50" }}>
            {error ? "暫停" : "正常"}
          </span>
          <span className="_bty-adm-kpi-lbl">狀態</span>
        </div>
        <div className="_bty-adm-kpi-cell">
          <span className="_bty-adm-kpi-val">{drafts.length}</span>
          <span className="_bty-adm-kpi-lbl">總計</span>
        </div>
        <div className="_bty-adm-kpi-cell">
          <span className="_bty-adm-kpi-val" style={{ color: "#ffb800" }}>{pendingCount}</span>
          <span className="_bty-adm-kpi-lbl">待審</span>
        </div>
        <div className="_bty-adm-kpi-cell">
          <span className="_bty-adm-kpi-val" style={{ color: "#4caf50" }}>{approvedCount}</span>
          <span className="_bty-adm-kpi-lbl">核准</span>
        </div>
        <div className="_bty-adm-kpi-cell">
          <span className="_bty-adm-kpi-val" style={{ color: "#ef5350" }}>{rejectedCount}</span>
          <span className="_bty-adm-kpi-lbl">退回</span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="_bty-adm-filter">
        <span className="_bty-adm-filter-lbl">篩選</span>
        <Link className={`_bty-adm-filter-btn${!status ? " active" : ""}`} href="/admin/content-drafts">全部</Link>
        {CONTENT_DRAFT_STATUSES.map((item) => (
          <Link
            className={`_bty-adm-filter-btn${status === item ? " active" : ""}`}
            href={`/admin/content-drafts?status=${item}`}
            key={item}
          >
            {contentDraftStatusLabel(item)}
          </Link>
        ))}
      </div>

      {error && (
        <AdminDraftStatePanel
          state="BLOCKED"
          reason="審稿草稿暫時無法讀取或權限不足。"
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
              <span>來源：審稿草稿</span>
              <span>更新 {formatDateTime(latestUpdatedAt(drafts))}</span>
              <span>{drafts.length} 筆</span>
            </span>
          }
        >
          <AdminDraftCards drafts={drafts} />
        </Panel>
      )}
    </PageFrame>
  );
}
