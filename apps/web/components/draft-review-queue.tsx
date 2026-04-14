"use client";

import { useEffect, useState } from "react";

import {
  getOpenAliceJobs,
  type OpenAliceJobEntry,
  updateOpenAliceJobStatus
} from "@/lib/api";

const allStatuses = [
  "queued",
  "running",
  "draft_ready",
  "validation_failed",
  "failed",
  "published",
  "rejected"
] as const;

const reviewableStatuses = new Set(["draft_ready", "validation_failed"]);

const statusColor: Record<string, string> = {
  queued: "badge",
  running: "badge-blue",
  draft_ready: "badge-green",
  validation_failed: "badge-red",
  failed: "badge-red",
  published: "badge-green",
  rejected: "badge-red"
};

const statusLabel: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  draft_ready: "Draft Ready",
  validation_failed: "Validation Failed",
  failed: "Failed",
  published: "Published",
  rejected: "Rejected"
};

const taskTypeLabel: Record<string, string> = {
  daily_brief: "Daily Brief",
  theme_summary: "Theme Summary",
  company_note: "Company Note",
  signal_cluster: "Signal Cluster",
  trade_plan_draft: "Trade Plan Draft",
  review_summary: "Review Summary"
};

export function DraftReviewQueue() {
  const [jobs, setJobs] = useState<OpenAliceJobEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadJobs = async () => {
    try {
      const response = await getOpenAliceJobs();
      setJobs(response.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load jobs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadJobs();
  }, []);

  const filtered = filterStatus ? jobs.filter((j) => j.status === filterStatus) : jobs;

  const reviewable = jobs.filter((j) => reviewableStatuses.has(j.status));

  const handleAction = async (jobId: string, status: "published" | "rejected") => {
    setActionLoading(jobId);
    setError(null);
    try {
      await updateOpenAliceJobStatus(jobId, status);
      setJobs((current) =>
        current.map((j) => (j.id === jobId ? { ...j, status } : j))
      );
    } catch (actionError) {
      const msg = actionError instanceof Error ? actionError.message : String(actionError);
      if (msg.includes("404") || msg.includes("Not Found")) {
        setError(
          `Review action endpoint not yet deployed (PATCH /api/v1/openalice/jobs/${jobId}/review). ` +
            "The API route needs to be added — ask Codex to implement it."
        );
      } else {
        setError(msg);
      }
    } finally {
      setActionLoading(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((current) => (current === id ? null : id));
  };

  return (
    <section style={{ display: "grid", gap: 20 }}>
      {/* Summary bar */}
      <div className="panel" style={{ padding: "14px 22px" }}>
        <div
          style={{
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap"
          }}
        >
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All statuses ({jobs.length})</option>
            {allStatuses.map((s) => {
              const count = jobs.filter((j) => j.status === s).length;
              return (
                <option key={s} value={s}>
                  {statusLabel[s] ?? s} ({count})
                </option>
              );
            })}
          </select>

          <div className="metric-chip" style={{ padding: "6px 12px", minWidth: "auto" }}>
            <span style={{ fontSize: "0.95rem" }}>{reviewable.length}</span>
            <small style={{ fontSize: "0.7rem" }}>needs review</small>
          </div>

          <div className="metric-chip" style={{ padding: "6px 12px", minWidth: "auto" }}>
            <span style={{ fontSize: "0.95rem" }}>{filtered.length}</span>
            <small style={{ fontSize: "0.7rem" }}>showing</small>
          </div>

          <button
            className="hero-link"
            style={{ padding: "6px 14px", fontSize: "0.82rem", marginLeft: "auto" }}
            onClick={() => {
              setLoading(true);
              void loadJobs();
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="panel" style={{ padding: "14px 22px" }}>
          <p className="error-text" style={{ margin: 0 }}>
            {error}
          </p>
        </div>
      ) : null}

      {loading ? (
        <div className="panel" style={{ padding: "22px" }}>
          <p className="muted">Loading OpenAlice jobs...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel" style={{ padding: "22px" }}>
          <p className="muted">
            {jobs.length === 0
              ? "No OpenAlice jobs yet. Enqueue a job via POST /api/v1/openalice/jobs or wait for the worker to create one."
              : "No jobs match the selected filter."}
          </p>
        </div>
      ) : (
        <div className="panel">
          <div className="card-stack">
            {filtered.map((job) => {
              const isExpanded = expanded === job.id;
              const isReviewable = reviewableStatuses.has(job.status);

              return (
                <article
                  key={job.id}
                  className="record-card"
                  style={{
                    borderLeft: isReviewable
                      ? "3px solid var(--accent)"
                      : undefined
                  }}
                >
                  {/* Header row */}
                  <div
                    className="record-topline"
                    style={{ cursor: "pointer" }}
                    onClick={() => toggleExpand(job.id)}
                  >
                    <div>
                      <strong>{taskTypeLabel[job.taskType] ?? job.taskType}</strong>
                      <span
                        className="muted"
                        style={{ fontSize: "0.78rem", marginLeft: 8 }}
                      >
                        {job.id.slice(0, 8)}
                      </span>
                    </div>
                    <span className={statusColor[job.status] ?? "badge"}>
                      {statusLabel[job.status] ?? job.status}
                    </span>
                  </div>

                  {/* Meta row */}
                  <p className="record-meta">
                    Created: {new Date(job.createdAt).toLocaleString()}
                    {job.completedAt
                      ? ` / Completed: ${new Date(job.completedAt).toLocaleString()}`
                      : null}
                    {job.deviceId ? ` / Device: ${job.deviceId}` : null}
                    {job.attemptCount != null
                      ? ` / Attempts: ${job.attemptCount}/${job.maxAttempts ?? "?"}`
                      : null}
                  </p>

                  {/* Instructions preview */}
                  {!isExpanded ? (
                    <p
                      className="muted"
                      style={{
                        fontSize: "0.82rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "100%"
                      }}
                    >
                      {job.instructions.slice(0, 120)}
                      {job.instructions.length > 120 ? "..." : ""}
                    </p>
                  ) : null}

                  {/* Error */}
                  {job.error ? (
                    <p className="error-text" style={{ fontSize: "0.82rem" }}>
                      Error: {job.error}
                    </p>
                  ) : null}

                  {/* Expanded detail */}
                  {isExpanded ? (
                    <div style={{ marginTop: 12 }}>
                      <div
                        className="record-card"
                        style={{ background: "rgba(255,255,255,0.4)" }}
                      >
                        <strong style={{ fontSize: "0.82rem" }}>Instructions</strong>
                        <p style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", marginTop: 6 }}>
                          {job.instructions}
                        </p>
                      </div>

                      {job.contextRefs.length > 0 ? (
                        <div
                          className="record-card"
                          style={{
                            background: "rgba(255,255,255,0.4)",
                            marginTop: 8
                          }}
                        >
                          <strong style={{ fontSize: "0.82rem" }}>Context References</strong>
                          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: "0.85rem" }}>
                            {job.contextRefs.map((ref, i) => (
                              <li key={i}>
                                <strong>{ref.type}</strong>
                                {ref.id ? `: ${ref.id}` : ""}
                                {ref.path ? ` (${ref.path})` : ""}
                                {ref.url ? (
                                  <>
                                    {" "}
                                    <a
                                      href={ref.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ color: "var(--accent)" }}
                                    >
                                      link
                                    </a>
                                  </>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {/* Result section */}
                      {job.result ? (
                        <div
                          className="record-card"
                          style={{
                            background: "rgba(255,255,255,0.4)",
                            marginTop: 8
                          }}
                        >
                          <strong style={{ fontSize: "0.82rem" }}>
                            Result ({job.result.schemaName})
                          </strong>

                          {job.result.rawText ? (
                            <pre
                              style={{
                                whiteSpace: "pre-wrap",
                                fontSize: "0.82rem",
                                marginTop: 6,
                                maxHeight: 300,
                                overflow: "auto",
                                background: "rgba(0,0,0,0.03)",
                                padding: 10,
                                borderRadius: 8
                              }}
                            >
                              {job.result.rawText}
                            </pre>
                          ) : null}

                          {job.result.structured ? (
                            <pre
                              style={{
                                whiteSpace: "pre-wrap",
                                fontSize: "0.82rem",
                                marginTop: 6,
                                maxHeight: 300,
                                overflow: "auto",
                                background: "rgba(0,0,0,0.03)",
                                padding: 10,
                                borderRadius: 8
                              }}
                            >
                              {JSON.stringify(job.result.structured, null, 2)}
                            </pre>
                          ) : null}

                          {job.result.warnings && job.result.warnings.length > 0 ? (
                            <div style={{ marginTop: 8 }}>
                              <strong style={{ fontSize: "0.78rem", color: "#b45309" }}>
                                Warnings:
                              </strong>
                              <ul
                                style={{
                                  margin: "4px 0 0",
                                  paddingLeft: 18,
                                  fontSize: "0.82rem",
                                  color: "#b45309"
                                }}
                              >
                                {job.result.warnings.map((w, i) => (
                                  <li key={i}>{w}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {job.result.artifacts && job.result.artifacts.length > 0 ? (
                            <div style={{ marginTop: 8 }}>
                              <strong style={{ fontSize: "0.78rem" }}>Artifacts:</strong>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 6,
                                  flexWrap: "wrap",
                                  marginTop: 4
                                }}
                              >
                                {job.result.artifacts.map((a, i) => (
                                  <span
                                    key={i}
                                    className="badge"
                                    style={{ fontSize: "0.75rem" }}
                                  >
                                    {a.label}
                                    {a.mimeType ? ` (${a.mimeType})` : ""}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Action buttons for reviewable drafts */}
                  {isReviewable ? (
                    <div className="action-row" style={{ marginTop: 10 }}>
                      <button
                        className="hero-link primary"
                        style={{ fontSize: "0.8rem", padding: "6px 14px" }}
                        disabled={actionLoading === job.id}
                        onClick={() => void handleAction(job.id, "published")}
                      >
                        {actionLoading === job.id ? "..." : "Approve & Publish"}
                      </button>
                      <button
                        className="hero-link"
                        style={{
                          fontSize: "0.8rem",
                          padding: "6px 14px",
                          borderColor: "rgba(220,38,38,0.3)",
                          color: "#b91c1c"
                        }}
                        disabled={actionLoading === job.id}
                        onClick={() => void handleAction(job.id, "rejected")}
                      >
                        {actionLoading === job.id ? "..." : "Reject"}
                      </button>
                      {!isExpanded ? (
                        <button
                          className="hero-link"
                          style={{ fontSize: "0.8rem", padding: "6px 14px" }}
                          onClick={() => toggleExpand(job.id)}
                        >
                          Review details
                        </button>
                      ) : null}
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
