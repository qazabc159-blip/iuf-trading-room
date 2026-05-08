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

const DRAFT_DISPLAY_LIMIT = 30;

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function parseStatus(value: string | undefined): ContentDraftStatus | undefined {
  return CONTENT_DRAFT_STATUSES.includes(value as ContentDraftStatus)
    ? value as ContentDraftStatus
    : undefined;
}

function statusAccentColor(status: string) {
  if (status === "approved") return "#4caf50";
  if (status === "rejected") return "#ef5350";
  if (status === "awaiting_review") return "#ffb800";
  if (status === "draft") return "#888";
  return "#888";
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

const DRAFTS_CSS = `
  ._bty-draft-kpi {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: 1px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 6px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  ._bty-draft-kpi-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 8px;
    background: rgba(0,0,0,0.25);
    gap: 4px;
  }
  ._bty-draft-kpi-val {
    font-size: 18px;
    font-weight: 700;
    font-family: var(--mono, monospace);
    color: #e0e0e0;
    line-height: 1;
  }
  ._bty-draft-kpi-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  ._bty-filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
    padding: 10px 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
  }
  ._bty-filter-label {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    display: flex;
    align-items: center;
    padding-right: 8px;
    border-right: 1px solid rgba(255,255,255,0.1);
    margin-right: 2px;
  }
  ._bty-filter-btn {
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    transition: background 0.1s, color 0.1s;
    border: 1px solid rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.6);
    background: transparent;
  }
  ._bty-filter-btn:hover {
    background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.9);
  }
  ._bty-filter-btn.active {
    background: rgba(255,184,0,0.2);
    border-color: rgba(255,184,0,0.5);
    color: #ffb800;
    font-weight: 600;
  }
  ._bty-draft-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  ._bty-draft-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
    text-decoration: none;
    color: inherit;
    transition: background 0.1s, border-color 0.1s;
    position: relative;
    overflow: hidden;
  }
  ._bty-draft-card::before {
    content: "";
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 3px;
    background: var(--_status-color, #888);
  }
  ._bty-draft-card:hover {
    background: rgba(255,255,255,0.04);
    border-color: rgba(255,255,255,0.13);
  }
  ._bty-draft-card-left {
    flex: 1;
    min-width: 0;
  }
  ._bty-draft-card-id {
    font-family: var(--mono, monospace);
    font-size: 10px;
    color: #ffb800;
    margin-bottom: 4px;
  }
  ._bty-draft-card-title {
    font-size: 13px;
    font-weight: 500;
    color: rgba(255,255,255,0.85);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  ._bty-draft-card-body {
    font-size: 11px;
    color: rgba(255,255,255,0.45);
    margin-top: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  ._bty-draft-card-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    flex-shrink: 0;
  }
  ._bty-status-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    background: var(--_status-bg, rgba(100,100,100,0.2));
    color: var(--_status-color, #888);
    border: 1px solid var(--_status-border, rgba(100,100,100,0.3));
  }
  ._bty-card-meta {
    font-size: 10px;
    color: rgba(255,255,255,0.35);
  }
  ._bty-target-tag {
    font-size: 10px;
    color: rgba(255,255,255,0.5);
    padding: 1px 6px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 3px;
    font-family: var(--mono, monospace);
  }
  @media (prefers-reduced-motion: reduce) {
    ._bty-draft-card, ._bty-filter-btn { transition: none !important; }
  }
`;

function statusColors(status: string): { bg: string; color: string; border: string } {
  if (status === "approved") return { bg: "rgba(76,175,80,0.15)", color: "#4caf50", border: "rgba(76,175,80,0.35)" };
  if (status === "rejected") return { bg: "rgba(239,83,80,0.15)", color: "#ef5350", border: "rgba(239,83,80,0.35)" };
  if (status === "awaiting_review") return { bg: "rgba(255,184,0,0.15)", color: "#ffb800", border: "rgba(255,184,0,0.35)" };
  return { bg: "rgba(100,100,100,0.15)", color: "#888", border: "rgba(100,100,100,0.3)" };
}

function DraftCards({ drafts }: { drafts: ContentDraftEntry[] }) {
  return (
    <div className="_bty-draft-list">
      {drafts.map((draft) => {
        const body = cleanNarrativeText(contentDraftBody(draft), "");
        const sc = statusColors(draft.status);
        return (
          <Link
            className="_bty-draft-card"
            href={`/admin/content-drafts/${draft.id}`}
            key={draft.id}
            style={{
              "--_status-color": sc.color,
              "--_status-bg": sc.bg,
              "--_status-border": sc.border,
            } as React.CSSProperties}
          >
            <div className="_bty-draft-card-left">
              <div className="_bty-draft-card-id">{draft.id.slice(0, 8)}</div>
              <div className="_bty-draft-card-title">
                {cleanExternalHeadline(contentDraftTitle(draft), "內容草稿")}
              </div>
              {body && <div className="_bty-draft-card-body">{body}</div>}
            </div>
            <div className="_bty-draft-card-right">
              <span
                className="_bty-status-badge"
                style={{
                  "--_status-bg": sc.bg,
                  "--_status-color": sc.color,
                  "--_status-border": sc.border,
                } as React.CSSProperties}
              >
                {contentDraftStatusLabel(draft.status)}
              </span>
              <span className="_bty-target-tag">{contentDraftTargetLabel(draft)}</span>
              <span className="_bty-card-meta">{formatDateTime(draft.updatedAt)}</span>
            </div>
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

  const visibleDrafts = drafts.slice(0, DRAFT_DISPLAY_LIMIT);
  const hiddenCount = Math.max(0, drafts.length - visibleDrafts.length);

  const approvedCount = drafts.filter((d) => d.status === "approved").length;
  const pendingCount = drafts.filter((d) => d.status === "awaiting_review").length;
  const rejectedCount = drafts.filter((d) => d.status === "rejected").length;

  return (
    <PageFrame
      code="DRF"
      title="內容草稿"
      sub="AI 內容草稿與審核佇列"
      note="此頁只讀取正式資料庫的內容草稿，不顯示假草稿。"
    >
      <style>{DRAFTS_CSS}</style>

      {/* Hero KPI */}
      <div className="_bty-draft-kpi">
        <div className="_bty-draft-kpi-cell">
          <span className="_bty-draft-kpi-val" style={{ color: error ? "#ef5350" : "#4caf50" }}>
            {error ? "暫停" : "正常"}
          </span>
          <span className="_bty-draft-kpi-lbl">狀態</span>
        </div>
        <div className="_bty-draft-kpi-cell">
          <span className="_bty-draft-kpi-val" style={{ color: "#e0e0e0" }}>{drafts.length}</span>
          <span className="_bty-draft-kpi-lbl">總計</span>
        </div>
        <div className="_bty-draft-kpi-cell">
          <span className="_bty-draft-kpi-val" style={{ color: "#ffb800" }}>{pendingCount}</span>
          <span className="_bty-draft-kpi-lbl">待審</span>
        </div>
        <div className="_bty-draft-kpi-cell">
          <span className="_bty-draft-kpi-val" style={{ color: "#4caf50" }}>{approvedCount}</span>
          <span className="_bty-draft-kpi-lbl">核准</span>
        </div>
        <div className="_bty-draft-kpi-cell">
          <span className="_bty-draft-kpi-val" style={{ color: "#ef5350" }}>{rejectedCount}</span>
          <span className="_bty-draft-kpi-lbl">退回</span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="_bty-filter-bar">
        <span className="_bty-filter-label">篩選</span>
        <Link className={`_bty-filter-btn${!status ? " active" : ""}`} href="/drafts">全部</Link>
        {CONTENT_DRAFT_STATUSES.map((item) => (
          <Link
            className={`_bty-filter-btn${status === item ? " active" : ""}`}
            href={`/drafts?status=${item}`}
            key={item}
          >
            {contentDraftStatusLabel(item)}
          </Link>
        ))}
      </div>

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
          {hiddenCount > 0 && (
            <div className="terminal-note" style={{ marginBottom: 18 }}>
              目前顯示最新 {visibleDrafts.length} 筆，另外 {hiddenCount} 筆仍保留在資料庫與後台審核流程中。
            </div>
          )}
          <DraftCards drafts={visibleDrafts} />
        </Panel>
      )}
    </PageFrame>
  );
}
