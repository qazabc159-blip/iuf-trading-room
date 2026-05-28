"use client";

/**
 * AiAnalystReportPanel.tsx
 * ────────────────────────
 * AI 分析師深度報告 panel — company page.
 *
 * Wires to (Jason Phase A, read-only):
 *   POST /api/v1/admin/brain/react/run        → { run_id }
 *   GET  /api/v1/admin/brain/react/decisions/:run_id  → ReactRunResult
 *
 * Graceful 404 fallback while Jason's endpoint is not yet merged:
 *   POST → 404 → shows "點此生成" button
 *   GET  → 404 → shows empty state
 *
 * Owner-only: other roles see a locked placeholder.
 * No fake data is ever shown.
 */

import { useEffect, useRef, useState } from "react";
import { apiGetMe } from "@/lib/auth-client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReactTraceStep {
  type: "reason" | "act" | "observe";
  content: string;
  tool?: string;
  elapsed_ms?: number;
}

export interface ReactRunResult {
  run_id: string;
  status: "running" | "complete" | "error" | "over_budget";
  ticker: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  budget_usd: number;
  report_md: string | null;
  trace: ReactTraceStep[];
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

// ── apiFetch (client-side canonical, no SSR cookie logic) ─────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  const res = await fetch(`${base}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const json = (await res.json()) as { data: T };
  return json.data;
}

// ── Panel state machine ───────────────────────────────────────────────────────

type PanelPhase =
  | { kind: "role-loading" }
  | { kind: "not-owner" }
  | { kind: "idle" }             // never generated
  | { kind: "submitting" }       // POST in flight
  | { kind: "polling"; run_id: string }
  | { kind: "complete"; result: ReactRunResult }
  | { kind: "over-budget"; result: ReactRunResult }
  | { kind: "error"; message: string };

// ── Markdown renderer (simple, no XSS risk since content is from our own backend) ──

function renderMarkdownSimple(md: string): React.ReactNode[] {
  const lines = md.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // H1
    if (line.startsWith("# ")) {
      nodes.push(<h2 key={i} className="_ai-md-h1">{line.slice(2)}</h2>);
      i++;
      continue;
    }
    // H2
    if (line.startsWith("## ")) {
      nodes.push(<h3 key={i} className="_ai-md-h2">{line.slice(3)}</h3>);
      i++;
      continue;
    }
    // H3
    if (line.startsWith("### ")) {
      nodes.push(<h4 key={i} className="_ai-md-h3">{line.slice(4)}</h4>);
      i++;
      continue;
    }
    // Bullet
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const bullets: string[] = [];
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("* "))) {
        bullets.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="_ai-md-ul">
          {bullets.map((b, j) => <li key={j}>{b}</li>)}
        </ul>
      );
      continue;
    }
    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }
    // Paragraph
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !lines[i].startsWith("- ") && !lines[i].startsWith("* ")) {
      para.push(lines[i]);
      i++;
    }
    if (para.length > 0) {
      nodes.push(<p key={`p-${i}`} className="_ai-md-p">{para.join(" ")}</p>);
    }
  }

  return nodes;
}

// ── Trace step icon ───────────────────────────────────────────────────────────

function traceIcon(type: ReactTraceStep["type"]) {
  if (type === "reason") return "R";
  if (type === "act") return "T";
  return "O";
}

function traceTypeLabel(type: ReactTraceStep["type"]) {
  if (type === "reason") return "推理";
  if (type === "act") return "工具";
  return "觀察";
}

// ── Tool badge ────────────────────────────────────────────────────────────────

function ToolBadge({ tool }: { tool?: string }) {
  if (!tool) return null;
  return (
    <span className="_ai-trace-tool">
      工具：{tool}
    </span>
  );
}

// ── Date display ─────────────────────────────────────────────────────────────

function fmtDateTime(iso: string | null): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" });
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AiAnalystReportPanel({ ticker }: { ticker: string }) {
  const [phase, setPhase] = useState<PanelPhase>({ kind: "role-loading" });
  const [traceOpen, setTraceOpen] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Role check on mount ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function checkRole() {
      const result = await apiGetMe();
      if (cancelled) return;
      if (!result.ok || result.user.role !== "Owner") {
        setPhase({ kind: "not-owner" });
        return;
      }
      setPhase({ kind: "idle" });
    }
    void checkRole();
    return () => { cancelled = true; };
  }, [ticker]);

  // ── Cleanup poll timer on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  // ── Poll for result ──────────────────────────────────────────────────────
  function startPolling(run_id: string) {
    setPhase({ kind: "polling", run_id });
    schedulePoll(run_id, 0);
  }

  function schedulePoll(run_id: string, attempt: number) {
    const delay = attempt === 0 ? 3000 : 5000;
    pollTimer.current = setTimeout(() => {
      void poll(run_id, attempt);
    }, delay);
  }

  async function poll(run_id: string, attempt: number) {
    if (attempt > 30) {
      // 30 * 5s = 150s max wait
      setPhase({ kind: "error", message: "AI 分析超時 (>150 秒)，請重試。" });
      return;
    }
    try {
      const result = await apiFetch<ReactRunResult>(
        `/api/v1/admin/brain/react/decisions/${run_id}`
      );
      if (result.status === "running") {
        schedulePoll(run_id, attempt + 1);
        return;
      }
      if (result.status === "over_budget") {
        setPhase({ kind: "over-budget", result });
        return;
      }
      if (result.status === "error") {
        setPhase({ kind: "error", message: result.error_message ?? "AI 分析失敗" });
        return;
      }
      setPhase({ kind: "complete", result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "404") {
        // run_id not found yet, keep polling briefly
        if (attempt < 5) {
          schedulePoll(run_id, attempt + 1);
          return;
        }
        setPhase({ kind: "error", message: "AI 分析服務暫時無法使用，30 秒後重試。" });
        return;
      }
      setPhase({ kind: "error", message: "AI 分析服務暫時無法使用，30 秒後重試。" });
    }
  }

  // ── Trigger ReAct run ────────────────────────────────────────────────────
  async function handleGenerate() {
    setPhase({ kind: "submitting" });
    try {
      const result = await apiFetch<{ run_id: string }>(
        "/api/v1/admin/brain/react/run",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: `請針對台灣上市公司 ${ticker} 進行深度分析，涵蓋：1) 近期營運動態 2) 財務體質 3) 主題產業受惠度 4) 風險點 5) 操作觀察結論。請使用繁體中文回覆。`,
            context: { ticker, source: "company_page" },
            budget_usd: 0.5,
          }),
        }
      );
      startPolling(result.run_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "404") {
        // Jason's endpoint not yet merged — graceful
        setPhase({ kind: "error", message: "AI 分析服務暫時無法使用，30 秒後重試。" });
        return;
      }
      setPhase({ kind: "error", message: "AI 分析服務暫時無法使用，30 秒後重試。" });
    }
  }

  function handleRefresh() {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setPhase({ kind: "idle" });
    void handleGenerate();
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (phase.kind === "role-loading") {
    return (
      <section className="panel hud-frame _ai-report-panel" aria-label="AI 分析師報告">
        <AiPanelHeader />
        <div className="_ai-body-placeholder dim">驗證身份中…</div>
      </section>
    );
  }

  if (phase.kind === "not-owner") {
    return (
      <section className="panel hud-frame _ai-report-panel" aria-label="AI 分析師報告">
        <AiPanelHeader />
        <div className="_ai-owner-lock">
          <div className="_ai-lock-icon">🔒</div>
          <div className="_ai-lock-msg">需要分析權限</div>
          <div className="_ai-lock-sub dim">目前帳號無法生成深度報告；頁面不顯示假分析內容。</div>
        </div>
      </section>
    );
  }

  if (phase.kind === "idle") {
    return (
      <section className="panel hud-frame _ai-report-panel" aria-label="AI 分析師報告">
        <AiPanelHeader />
        <div className="_ai-empty-state">
          <div className="_ai-empty-icon">🤖</div>
          <div className="_ai-empty-msg">尚未生成 AI 分析報告</div>
          <div className="_ai-empty-sub dim">AI 會用唯讀資料源整理市場、財務、主題與風險，不會建立交易委託。</div>
          <button className="_ai-generate-btn btn-sm" onClick={() => void handleGenerate()}>
            點此生成 {ticker} AI 分析
          </button>
        </div>
      </section>
    );
  }

  if (phase.kind === "submitting") {
    return (
      <section className="panel hud-frame _ai-report-panel" aria-label="AI 分析師報告">
        <AiPanelHeader />
        <div className="_ai-running-state">
          <div className="_ai-spinner" aria-hidden="true" />
          <div className="_ai-running-msg">AI 正在分析中… 預計 30-90 秒</div>
          <div className="_ai-running-sub dim">正在用唯讀工具整理 {ticker} 的市場資料與風險線索。</div>
        </div>
      </section>
    );
  }

  if (phase.kind === "polling") {
    return (
      <section className="panel hud-frame _ai-report-panel" aria-label="AI 分析師報告">
        <AiPanelHeader />
        <div className="_ai-running-state">
          <div className="_ai-spinner" aria-hidden="true" />
          <div className="_ai-running-msg">AI 正在分析中… 預計 30-90 秒</div>
          <div className="_ai-running-sub dim">任務已建立，等待報告完成；畫面會自動更新。</div>
        </div>
      </section>
    );
  }

  if (phase.kind === "error") {
    return (
      <section className="panel hud-frame _ai-report-panel" aria-label="AI 分析師報告">
        <AiPanelHeader />
        <div className="_ai-error-state">
          <div className="_ai-error-msg">{phase.message}</div>
          <button className="_ai-generate-btn btn-sm" onClick={() => setPhase({ kind: "idle" })}>
            重試
          </button>
        </div>
      </section>
    );
  }

  // complete or over_budget
  const result = phase.result;
  const isOverBudget = phase.kind === "over-budget";
  const totalTokens = (result.prompt_tokens ?? 0) + (result.completion_tokens ?? 0);
  const costStr = result.cost_usd != null ? `$${result.cost_usd.toFixed(4)} USD` : "--";
  const budgetStr = result.budget_usd != null ? `$${result.budget_usd.toFixed(2)} USD` : "--";

  return (
    <section className="panel hud-frame _ai-report-panel" aria-label="AI 分析師報告">
      <AiPanelHeader />

      {/* ── Meta strip ── */}
      <div className="_ai-meta-strip">
        <div className="_ai-meta-cell">
          <span className="_ai-meta-lbl">生成時間</span>
          <span className="_ai-meta-val">{fmtDateTime(result.completed_at ?? result.started_at)}</span>
        </div>
        <div className="_ai-meta-cell">
          <span className="_ai-meta-lbl">模型</span>
          <span className="_ai-meta-val">{result.model ?? "--"}</span>
        </div>
        <div className="_ai-meta-cell">
          <span className="_ai-meta-lbl">用量</span>
          <span className="_ai-meta-val">{totalTokens.toLocaleString("zh-TW")}</span>
        </div>
        <div className="_ai-meta-cell">
          <span className="_ai-meta-lbl">費用</span>
          <span className={`_ai-meta-val ${isOverBudget ? "_ai-over-budget" : ""}`}>{costStr}</span>
        </div>
        <div className="_ai-meta-cell">
          <span className="_ai-meta-lbl">預算</span>
          <span className="_ai-meta-val">{budgetStr}</span>
        </div>
        <div style={{ flex: 1 }} />
        <button className="_ai-refresh-btn btn-sm" onClick={handleRefresh}>
          重新分析
        </button>
      </div>

      {/* ── Over-budget warning ── */}
      {isOverBudget && (
        <div className="_ai-budget-banner">
          本次分析超出預算 ({budgetStr})，以下為部分結果
        </div>
      )}

      {/* ── Report body ── */}
      <div className="_ai-report-body">
        {result.report_md ? (
          <div className="_ai-md-content">
            {renderMarkdownSimple(result.report_md)}
          </div>
        ) : (
          <div className="dim" style={{ padding: "16px 0" }}>報告內容未回傳</div>
        )}
      </div>

      {/* ── ReAct trace (collapsible) ── */}
      {result.trace && result.trace.length > 0 && (
        <div className="_ai-trace-section">
          <button
            className="_ai-trace-toggle"
            onClick={() => setTraceOpen(!traceOpen)}
            aria-expanded={traceOpen}
          >
            <span className="_ai-trace-arrow">{traceOpen ? "▼" : "▶"}</span>
            AI 思考過程 ({result.trace.length} 步)
          </button>

          {traceOpen && (
            <div className="_ai-trace-list" role="list">
              {result.trace.map((step, idx) => (
                <div key={idx} className={`_ai-trace-step _ai-trace-${step.type}`} role="listitem">
                  <div className="_ai-trace-step-head">
                    <span className="_ai-trace-icon" aria-hidden="true">{traceIcon(step.type)}</span>
                    <span className="_ai-trace-type">{traceTypeLabel(step.type)}</span>
                    <ToolBadge tool={step.tool} />
                    {step.elapsed_ms != null && (
                      <span className="_ai-trace-elapsed">{step.elapsed_ms}ms</span>
                    )}
                  </div>
                  <div className="_ai-trace-content">{step.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AiPanelHeader() {
  return (
    <h3 className="ascii-head" style={{ marginBottom: 12 }}>
      <span className="ascii-head-bracket">AI 分析師報告</span>
      <span className="tg soft" style={{ marginLeft: 8, fontSize: 10 }}>
        AI 分析 / 唯讀資料
      </span>
    </h3>
  );
}
