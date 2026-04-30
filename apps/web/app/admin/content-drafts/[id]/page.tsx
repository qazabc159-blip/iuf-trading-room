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
  if (!value) return "NOT SET";
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function DetailStatePanel({
  state,
  reason,
}: {
  state: "EMPTY" | "BLOCKED";
  reason: string;
}) {
  return (
    <Panel code={`DRF-${state}`} title={state} right="Content draft detail">
      <div className="state-panel">
        <span className={`badge ${state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{state}</span>
        <span className="tg soft">Source: GET /api/v1/content-drafts</span>
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
          <span className="badge badge-green">LIVE</span>
          <span className="tg soft">Source: GET /api/v1/content-drafts</span>
          <span className={`badge ${contentDraftStatusBadge(draft.status)}`}>
            {contentDraftStatusLabel(draft.status)}
          </span>
        </div>
        <article className="review-ledger-card">
          <h2>{contentDraftTitle(draft)}</h2>
          {body ? (
            <p>{body}</p>
          ) : (
            <p className="tg soft">No body-like field was found in payload; raw payload is shown below.</p>
          )}
          <pre className="payload-pre">{contentDraftPayloadText(draft)}</pre>
        </article>
      </Panel>

      <Panel code="DRF-META" title="Metadata">
        {[
          ["ID", draft.id],
          ["Target table", draft.targetTable],
          ["Target entity", draft.targetEntityId ?? "NONE"],
          ["Source job", draft.sourceJobId ?? "NONE"],
          ["Producer", draft.producerVersion],
          ["Dedupe key", draft.dedupeKey],
          ["Reviewed by", draft.reviewedBy ?? "NONE"],
          ["Reviewed at", formatDateTime(draft.reviewedAt)],
          ["Approved ref", draft.approvedRefId ?? "NONE"],
          ["Reject reason", draft.rejectReason ?? "NONE"],
          ["Created", formatDateTime(draft.createdAt)],
          ["Updated", formatDateTime(draft.updatedAt)],
        ].map(([key, value]) => (
          <div className="row" key={key} style={{ gridTemplateColumns: "126px 1fr", gap: 12, padding: "9px 0" }}>
            <span className="tg gold">{key}</span>
            <span className="tg" style={{ overflowWrap: "anywhere" }}>{value}</span>
          </div>
        ))}
      </Panel>

      <Panel code="DRF-ACT" title="Persisted actions" right="gated">
        <div className="state-panel">
          <span className="badge badge-red">BLOCKED</span>
          <span className="tg soft">Owner: Jason/Elva.</span>
          <span className="state-reason">
            Approve/reject APIs exist, but this UI binding is intentionally not enabled in this slice.
            The previous local-only action buttons were removed so no simulated approval can be mistaken
            for a persisted DB decision.
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

  try {
    const response = await getContentDrafts({ limit: 200 });
    draft = (response.data ?? []).find((item) => item.id === id) ?? null;
  } catch (err) {
    error = err instanceof Error ? err.message : "content draft detail request failed";
  }

  return (
    <PageFrame
      code="ADM-DRF-D"
      title={draft ? contentDraftTitle(draft) : "Content Draft Detail"}
      sub={id}
      exec
      note="[ADM-DRF-D] Read-only LIVE/EMPTY/BLOCKED surface for content draft detail"
    >
      <div style={{ marginBottom: 12 }}>
        <Link className="btn-sm" href="/admin/content-drafts">BACK TO DRAFTS</Link>
      </div>

      {error && (
        <DetailStatePanel
          state="BLOCKED"
          reason={`API request failed or role denied. Owner: Jason/Elva. Detail: ${error}`}
        />
      )}
      {!error && !draft && (
        <DetailStatePanel
          state="EMPTY"
          reason="The API returned drafts, but none matched this id. No mock fallback draft is rendered."
        />
      )}
      {!error && draft && <DraftDetail draft={draft} />}
    </PageFrame>
  );
}
