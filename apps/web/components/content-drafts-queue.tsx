"use client";

import { useEffect, useMemo, useState } from "react";

import {
  approveContentDraft,
  getBriefs,
  getContentDrafts,
  getCompanyNotes,
  getThemeSummaries,
  rejectContentDraft,
  type ContentDraftEntry,
  type ContentDraftStatus
} from "@/lib/api";

const statusLabel: Record<ContentDraftStatus, string> = {
  awaiting_review: "待審核",
  approved: "已核准",
  rejected: "已退回"
};

const statusBadge: Record<ContentDraftStatus, string> = {
  awaiting_review: "badge-yellow",
  approved: "badge-green",
  rejected: "badge-red"
};

const targetLabel: Record<string, string> = {
  theme_summaries: "主題摘要",
  company_notes: "公司筆記",
  daily_briefs: "每日簡報"
};

type DailyBriefSection = { heading: string; body: string };

type DailyBriefPayload = {
  date: string;
  marketState: string;
  sections: DailyBriefSection[];
};

const marketStateBadge = (s: string) => {
  if (s === "Risk-On") return "badge-green";
  if (s === "Risk-Off") return "badge-red";
  return "badge-yellow"; // Balanced
};

const marketStateLabel: Record<string, string> = {
  "Risk-On": "Risk-On 進攻",
  "Balanced": "Balanced 平衡",
  "Risk-Off": "Risk-Off 防禦"
};

function isDailyBriefPayload(p: unknown): p is DailyBriefPayload {
  if (!p || typeof p !== "object") return false;
  const obj = p as Record<string, unknown>;
  return (
    typeof obj.date === "string" &&
    typeof obj.marketState === "string" &&
    Array.isArray(obj.sections)
  );
}

function extractDraftText(entry: ContentDraftEntry): string {
  const p = entry.payload;
  if (!p || typeof p !== "object") return JSON.stringify(p ?? null, null, 2);
  const obj = p as Record<string, unknown>;
  if (typeof obj.summary === "string") return obj.summary;
  if (typeof obj.note === "string") return obj.note;
  if (isDailyBriefPayload(p)) {
    return p.sections.map((s) => `[${s.heading}]\n${s.body}`).join("\n\n");
  }
  return JSON.stringify(obj, null, 2);
}

type FormalRow =
  | { kind: "theme_summary"; id: string; text: string; generatedAt: string }
  | { kind: "company_note"; id: string; text: string; generatedAt: string }
  | { kind: "daily_brief"; id: string; date: string; marketState: string; sections: DailyBriefSection[]; createdAt: string }
  | { kind: "none" };

async function fetchLatestFormal(entry: ContentDraftEntry): Promise<FormalRow> {
  if (entry.targetTable === "theme_summaries") {
    if (!entry.targetEntityId) return { kind: "none" };
    try {
      const res = await getThemeSummaries({ themeId: entry.targetEntityId, limit: 1 });
      const row = res.data[0];
      if (!row) return { kind: "none" };
      return { kind: "theme_summary", id: row.id, text: row.summary, generatedAt: row.generatedAt };
    } catch {
      return { kind: "none" };
    }
  }

  if (entry.targetTable === "company_notes") {
    if (!entry.targetEntityId) return { kind: "none" };
    try {
      const res = await getCompanyNotes({ companyId: entry.targetEntityId, limit: 1 });
      const row = res.data[0];
      if (!row) return { kind: "none" };
      return { kind: "company_note", id: row.id, text: row.note, generatedAt: row.generatedAt };
    } catch {
      return { kind: "none" };
    }
  }

  if (entry.targetTable === "daily_briefs") {
    try {
      const res = await getBriefs();
      // find brief matching the draft date if payload has one
      const draftDate = isDailyBriefPayload(entry.payload) ? entry.payload.date : null;
      const match = draftDate
        ? res.data.find((b) => b.date === draftDate)
        : res.data[0];
      if (!match) return { kind: "none" };
      return {
        kind: "daily_brief",
        id: match.id,
        date: match.date,
        marketState: match.marketState,
        sections: match.sections,
        createdAt: match.createdAt
      };
    } catch {
      return { kind: "none" };
    }
  }

  return { kind: "none" };
}

export function ContentDraftsQueue() {
  const [drafts, setDrafts] = useState<ContentDraftEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<ContentDraftStatus | "">("awaiting_review");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [formalCache, setFormalCache] = useState<Record<string, FormalRow>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadDrafts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getContentDrafts(filterStatus ? { status: filterStatus, limit: 100 } : { limit: 100 });
      setDrafts(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入草稿");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  const awaiting = useMemo(() => drafts.filter((d) => d.status === "awaiting_review"), [drafts]);

  const toggleExpand = async (entry: ContentDraftEntry) => {
    const next = expanded === entry.id ? null : entry.id;
    setExpanded(next);
    if (next && !formalCache[entry.id]) {
      const formal = await fetchLatestFormal(entry);
      setFormalCache((curr) => ({ ...curr, [entry.id]: formal }));
    }
  };

  const onApprove = async (entry: ContentDraftEntry) => {
    setActionLoading(entry.id);
    setError(null);
    try {
      const res = await approveContentDraft(entry.id);
      setDrafts((curr) => curr.map((d) => (d.id === entry.id ? res.data : d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "核准失敗");
    } finally {
      setActionLoading(null);
    }
  };

  const onReject = async (entry: ContentDraftEntry) => {
    const reason = (rejectReason[entry.id] ?? "").trim();
    if (!reason) {
      setError(`退回需要填寫原因（草稿 ${entry.id.slice(0, 8)}）`);
      return;
    }
    setActionLoading(entry.id);
    setError(null);
    try {
      const res = await rejectContentDraft(entry.id, reason);
      setDrafts((curr) => curr.map((d) => (d.id === entry.id ? res.data : d)));
      setRejectReason((curr) => {
        const next = { ...curr };
        delete next[entry.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "退回失敗");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <section style={{ display: "grid", gap: 14 }}>
      <div className="panel filter-bar">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as ContentDraftStatus | "")}>
          <option value="awaiting_review">待審核</option>
          <option value="approved">已核准</option>
          <option value="rejected">已退回</option>
          <option value="">全部</option>
        </select>
        <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
          <span style={{ fontSize: "var(--fs-base)" }}>{awaiting.length}</span>
          <small>待審核</small>
        </div>
        <div className="metric-chip" style={{ padding: "5px 10px", minWidth: "auto" }}>
          <span style={{ fontSize: "var(--fs-base)" }}>{drafts.length}</span>
          <small>顯示中</small>
        </div>
        <button className="btn-sm" style={{ marginLeft: "auto" }} onClick={() => void loadDrafts()}>
          重新整理
        </button>
      </div>

      {error ? (
        <div className="panel" style={{ padding: "10px 16px" }}>
          <p className="error-text" style={{ margin: 0 }}>{error}</p>
        </div>
      ) : null}

      {loading ? (
        <div className="panel" style={{ padding: 16 }}>
          <p className="muted loading-text">載入草稿...</p>
        </div>
      ) : drafts.length === 0 ? (
        <div className="panel" style={{ padding: 16 }}>
          <p className="muted">
            {filterStatus === "awaiting_review"
              ? "目前沒有待審核的草稿。OpenAlice runner 提交 draft_ready 後會出現在這。"
              : "此狀態下沒有草稿。"}
          </p>
        </div>
      ) : (
        <div className="panel">
          <div className="card-stack">
            {drafts.map((entry) => {
              const isExpanded = expanded === entry.id;
              const isAwaiting = entry.status === "awaiting_review";
              const draftText = extractDraftText(entry);
              const formal = formalCache[entry.id];
              const rejectText = rejectReason[entry.id] ?? "";

              return (
                <article
                  key={entry.id}
                  className="record-card"
                  style={{ borderLeft: isAwaiting ? "3px solid var(--warn)" : undefined }}
                >
                  <div
                    className="record-topline"
                    style={{ cursor: "pointer" }}
                    onClick={() => void toggleExpand(entry)}
                  >
                    <div>
                      <strong style={{ fontSize: "var(--fs-base)" }}>
                        {targetLabel[entry.targetTable] ?? entry.targetTable}
                      </strong>
                      {entry.targetTable === "daily_briefs" && isDailyBriefPayload(entry.payload) ? (
                        <>
                          <span className="mono" style={{ fontSize: "var(--fs-xs)", marginLeft: 8, fontWeight: 700 }}>
                            {entry.payload.date}
                          </span>
                          <span className={marketStateBadge(entry.payload.marketState)} style={{ fontSize: "var(--fs-xs)", marginLeft: 6 }}>
                            {marketStateLabel[entry.payload.marketState] ?? entry.payload.marketState}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="dim" style={{ fontSize: "var(--fs-xs)", marginLeft: 8 }}>
                            {entry.id.slice(0, 8)}
                          </span>
                          {entry.targetEntityId ? (
                            <span className="dim mono" style={{ fontSize: "var(--fs-xs)", marginLeft: 6 }}>
                              · {entry.targetEntityId.slice(0, 8)}
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                    <span className={statusBadge[entry.status] ?? "badge"}>
                      {statusLabel[entry.status] ?? entry.status}
                    </span>
                  </div>

                  <p className="record-meta">
                    建立：{new Date(entry.createdAt).toLocaleString("zh-TW")}
                    {entry.reviewedAt ? ` / 審核：${new Date(entry.reviewedAt).toLocaleString("zh-TW")}` : null}
                    {entry.sourceJobId ? ` / 來源 job：${entry.sourceJobId.slice(0, 8)}` : null}
                    {` / 版本：${entry.producerVersion}`}
                  </p>

                  {!isExpanded ? (
                    <p
                      className="dim"
                      style={{ fontSize: "var(--fs-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}
                    >
                      {draftText.replace(/\s+/g, " ").slice(0, 120)}
                      {draftText.length > 120 ? "..." : ""}
                    </p>
                  ) : null}

                  {isExpanded ? (
                    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                      <div
                        className="record-card"
                        style={{
                          background: "var(--panel-hi)",
                          borderColor: entry.targetTable === "daily_briefs" ? "var(--accent)" : undefined,
                          borderWidth: entry.targetTable === "daily_briefs" ? 1 : undefined,
                          borderStyle: entry.targetTable === "daily_briefs" ? "solid" : undefined
                        }}
                      >
                        <strong style={{ fontSize: "var(--fs-sm)", color: entry.targetTable === "daily_briefs" ? "var(--accent)" : "var(--muted)" }}>
                          {entry.targetTable === "daily_briefs" ? "[AI] 每日簡報草稿" : "草稿內容"}
                        </strong>

                        {entry.targetTable === "daily_briefs" && isDailyBriefPayload(entry.payload) ? (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                              <span className="mono" style={{ fontWeight: 700, fontSize: "var(--fs-base)" }}>{entry.payload.date}</span>
                              <span className={marketStateBadge(entry.payload.marketState)} style={{ fontSize: "var(--fs-xs)" }}>
                                {marketStateLabel[entry.payload.marketState] ?? entry.payload.marketState}
                              </span>
                            </div>
                            {entry.payload.sections.map((s, i) => (
                              <div key={i} style={{ marginBottom: 10 }}>
                                <p style={{ fontSize: "var(--fs-xs)", color: "var(--accent)", margin: "0 0 2px", fontWeight: 700 }}>{s.heading}</p>
                                <pre style={{ whiteSpace: "pre-wrap", fontSize: "var(--fs-sm)", lineHeight: 1.6, margin: 0, fontFamily: "inherit" }}>
                                  {s.body}
                                </pre>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <pre
                            style={{
                              whiteSpace: "pre-wrap",
                              fontSize: "var(--fs-sm)",
                              marginTop: 4,
                              maxHeight: 320,
                              overflow: "auto",
                              background: "var(--bg)",
                              padding: 10,
                              borderRadius: 8
                            }}
                          >
                            {draftText}
                          </pre>
                        )}
                      </div>

                      <div className="record-card" style={{ background: "var(--panel-hi)" }}>
                        <strong style={{ fontSize: "var(--fs-sm)", color: "var(--muted)" }}>目前正式資料（最新一筆）</strong>
                        {!formal ? (
                          <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>載入中…</p>
                        ) : formal.kind === "none" ? (
                          <p className="dim" style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>
                            尚無正式資料列（核准後將寫入第一筆）
                          </p>
                        ) : formal.kind === "daily_brief" ? (
                          <>
                            <p className="dim mono" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
                              id {formal.id.slice(0, 8)} · 日期 {formal.date} · 建立於 {new Date(formal.createdAt).toLocaleString("zh-TW")}
                            </p>
                            <div style={{ marginTop: 6 }}>
                              <span className={marketStateBadge(formal.marketState)} style={{ fontSize: "var(--fs-xs)" }}>
                                {marketStateLabel[formal.marketState] ?? formal.marketState}
                              </span>
                            </div>
                            {formal.sections.map((s, i) => (
                              <div key={i} style={{ marginTop: 6 }}>
                                <p style={{ fontSize: "var(--fs-xs)", color: "var(--muted)", margin: "0 0 2px", fontWeight: 700 }}>{s.heading}</p>
                                <pre style={{ whiteSpace: "pre-wrap", fontSize: "var(--fs-sm)", lineHeight: 1.6, margin: 0, fontFamily: "inherit", maxHeight: 120, overflow: "auto" }}>
                                  {s.body}
                                </pre>
                              </div>
                            ))}
                          </>
                        ) : (
                          <>
                            <p className="dim mono" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
                              id {formal.id.slice(0, 8)} · 產生於 {new Date(formal.generatedAt).toLocaleString("zh-TW")}
                            </p>
                            <pre
                              style={{
                                whiteSpace: "pre-wrap",
                                fontSize: "var(--fs-sm)",
                                marginTop: 4,
                                maxHeight: 220,
                                overflow: "auto",
                                background: "var(--bg)",
                                padding: 10,
                                borderRadius: 8
                              }}
                            >
                              {formal.text}
                            </pre>
                          </>
                        )}
                      </div>

                      <details>
                        <summary className="dim" style={{ cursor: "pointer", fontSize: "var(--fs-xs)" }}>
                          raw payload JSON
                        </summary>
                        <pre
                          style={{
                            whiteSpace: "pre-wrap",
                            fontSize: "var(--fs-xs)",
                            marginTop: 4,
                            maxHeight: 220,
                            overflow: "auto",
                            background: "var(--bg)",
                            padding: 10,
                            borderRadius: 8
                          }}
                        >
                          {JSON.stringify(entry.payload, null, 2)}
                        </pre>
                      </details>

                      {entry.rejectReason ? (
                        <p className="error-text" style={{ fontSize: "var(--fs-sm)" }}>
                          退回原因：{entry.rejectReason}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {isAwaiting ? (
                    <div style={{ marginTop: 8 }}>
                      <textarea
                        value={rejectText}
                        onChange={(e) =>
                          setRejectReason((prev) => ({ ...prev, [entry.id]: e.target.value }))
                        }
                        placeholder="退回時需填寫原因（核准不需）"
                        style={{
                          width: "100%",
                          minHeight: 48,
                          fontSize: "var(--fs-sm)",
                          marginBottom: 6,
                          resize: "vertical"
                        }}
                      />
                      <div className="action-row">
                        <button
                          className="btn-sm"
                          style={{ background: "var(--accent)", color: "var(--bg)", borderColor: "var(--accent)" }}
                          disabled={actionLoading === entry.id}
                          onClick={() => void onApprove(entry)}
                        >
                          {actionLoading === entry.id ? "..." : "核准並發布"}
                        </button>
                        <button
                          className="btn-sm"
                          style={{ borderColor: "rgba(255,93,93,0.3)", color: "var(--bear)" }}
                          disabled={actionLoading === entry.id}
                          onClick={() => void onReject(entry)}
                        >
                          {actionLoading === entry.id ? "..." : "退回"}
                        </button>
                        {!isExpanded ? (
                          <button className="btn-sm" onClick={() => void toggleExpand(entry)}>
                            檢視詳情
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
