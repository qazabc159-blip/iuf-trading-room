"use client";

/**
 * /admin/brain/decisions — 主腦決策流 UI (M3)
 *
 * Owner-only. Consumes GET /api/v1/openalice/orchestrator/state
 * Read-only. No write actions or order triggers.
 */

import { useEffect, useState } from "react";
import { PageFrame, Panel } from "@/components/PageFrame";
import { apiGetMe } from "@/lib/auth-client";

// ── Types ──────────────────────────────────────────────────────────────────

type TickState = {
  tickRunning: boolean;
  lastTickAt: string | null;
  lastTickDecisions: number;
  lastTickError: string | null;
};

type ActionTickState = {
  tickRunning?: boolean;
  lastTickAt?: string | null;
  lastTickError?: string | null;
};

type StatusTotals = {
  total: number;
  byStatus: Partial<{
    proposed: number;
    executing: number;
    done: number;
    skipped: number;
  }>;
  byActionType: Partial<{
    deep_analyze: number;
    rec_reweight: number;
    rebalance_suggest: number;
    priority_alert: number;
  }>;
};

type DecisionOutcome = {
  advisory?: boolean;
  direction?: string;
  reason?: string;
  suggestedWeightDelta?: number;
  realOrderPath?: boolean;
  positionMutated?: boolean;
  orderSubmitted?: boolean;
  suggestedTickers?: string[];
  suggestedAction?: string;
  actionType?: string;
  tickers?: string[];
  eventId?: string;
  severity?: string;
  message?: string;
  ticker?: string;
  analyses?: Array<{ ticker: string; status: string; costUsd?: number; reportSummary?: string }>;
  totalCostUsd?: number;
};

type DecisionItem = {
  id: string;
  triggerType: string;
  actionType: string;
  confidence: number;
  priority: number;
  status: string;
  reasoning: string;
  createdAt: string;
  outcome?: DecisionOutcome | null;
};

type OrchestratorState = {
  tick: TickState;
  actionTick?: ActionTickState;
  totals: StatusTotals;
  recent: DecisionItem[];
};

// ── Translation maps ───────────────────────────────────────────────────────

const ACTION_TYPE_LABEL: Record<string, string> = {
  deep_analyze: "個股深析",
  rec_reweight: "推薦調權建議",
  rebalance_suggest: "調倉建議",
  priority_alert: "優先告警",
};

const STATUS_LABEL: Record<string, string> = {
  proposed: "待執行",
  executing: "執行中",
  done: "已完成",
  skipped: "略過",
};

const TRIGGER_TYPE_LABEL: Record<string, string> = {
  market_event: "市場事件",
  signal: "策略信號",
  news_signal: "新聞信號",
  breakout_signal: "突破信號",
  system_alert: "系統告警",
  manual: "手動觸發",
};

function labelActionType(raw: string) {
  return ACTION_TYPE_LABEL[raw] ?? raw;
}

function labelStatus(raw: string) {
  return STATUS_LABEL[raw] ?? raw;
}

function labelTrigger(raw: string) {
  return TRIGGER_TYPE_LABEL[raw] ?? raw;
}

// ── API fetch ──────────────────────────────────────────────────────────────

async function fetchOrchestratorState(): Promise<OrchestratorState> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  const res = await fetch(`${base}/api/v1/openalice/orchestrator/state?limit=20`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const json = (await res.json()) as { data: OrchestratorState };
  return json.data;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-TW", {
      hour12: false,
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtTimeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

function confidencePct(c: number): string {
  return `${Math.round(c * 100)}%`;
}

// ── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, React.CSSProperties> = {
    proposed: { background: "rgba(255,184,0,0.12)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.3)" },
    executing: { background: "rgba(33,150,243,0.12)", color: "#2196f3", border: "1px solid rgba(33,150,243,0.3)" },
    done: { background: "rgba(76,175,80,0.12)", color: "#4caf50", border: "1px solid rgba(76,175,80,0.3)" },
    skipped: { background: "rgba(145,160,181,0.1)", color: "#91a0b5", border: "1px solid rgba(145,160,181,0.2)" },
  };
  const style = styles[status] ?? { background: "rgba(255,255,255,0.06)", color: "#91a0b5", border: "1px solid rgba(255,255,255,0.1)" };
  return (
    <span className="_dec-badge" style={style}>
      {labelStatus(status)}
    </span>
  );
}

function ActionBadge({ actionType }: { actionType: string }) {
  const styles: Record<string, React.CSSProperties> = {
    deep_analyze: { background: "rgba(156,39,176,0.12)", color: "#ce93d8", border: "1px solid rgba(156,39,176,0.3)" },
    rec_reweight: { background: "rgba(33,150,243,0.12)", color: "#90caf9", border: "1px solid rgba(33,150,243,0.25)" },
    rebalance_suggest: { background: "rgba(0,188,212,0.12)", color: "#80deea", border: "1px solid rgba(0,188,212,0.25)" },
    priority_alert: { background: "rgba(255,87,34,0.12)", color: "#ffab91", border: "1px solid rgba(255,87,34,0.3)" },
  };
  const style = styles[actionType] ?? { background: "rgba(255,255,255,0.06)", color: "#91a0b5", border: "1px solid rgba(255,255,255,0.1)" };
  return (
    <span className="_dec-badge" style={style}>
      {labelActionType(actionType)}
    </span>
  );
}

// ── Health row ─────────────────────────────────────────────────────────────

function HealthRow({ tick, actionTick }: { tick: TickState; actionTick?: ActionTickState }) {
  const hasError = Boolean(tick.lastTickError);
  const actionHasError = Boolean(actionTick?.lastTickError);

  return (
    <div className="_dec-health-row">
      <div className="_dec-health-cell">
        <span className="_dec-health-dot" style={{ background: hasError ? "#ef5350" : "#4caf50" }} />
        <span className="_dec-health-label">決策 Tick</span>
        <span className="_dec-health-val">
          {tick.lastTickAt ? fmtDateTime(tick.lastTickAt) : "尚未執行"}
        </span>
        {tick.lastTickAt && (
          <span className="_dec-health-ago">{fmtTimeAgo(tick.lastTickAt)}</span>
        )}
      </div>

      {actionTick && (
        <div className="_dec-health-cell">
          <span className="_dec-health-dot" style={{ background: actionHasError ? "#ef5350" : "#4caf50" }} />
          <span className="_dec-health-label">執行 Tick</span>
          <span className="_dec-health-val">
            {actionTick.lastTickAt ? fmtDateTime(actionTick.lastTickAt) : "尚未執行"}
          </span>
          {actionTick.lastTickAt && (
            <span className="_dec-health-ago">{fmtTimeAgo(actionTick.lastTickAt)}</span>
          )}
        </div>
      )}

      <div className="_dec-health-cell">
        <span className="_dec-health-dot" style={{ background: tick.tickRunning ? "#2196f3" : "rgba(255,255,255,0.15)" }} />
        <span className="_dec-health-label">運行狀態</span>
        <span className="_dec-health-val" style={{ color: tick.tickRunning ? "#2196f3" : "rgba(255,255,255,0.5)" }}>
          {tick.tickRunning ? "Tick 執行中" : "待機中"}
        </span>
      </div>

      {hasError && (
        <div className="_dec-health-error">
          <span className="_dec-health-err-label">上次決策錯誤</span>
          <span className="_dec-health-err-msg">{tick.lastTickError}</span>
        </div>
      )}
      {actionHasError && (
        <div className="_dec-health-error">
          <span className="_dec-health-err-label">上次執行錯誤</span>
          <span className="_dec-health-err-msg">{actionTick?.lastTickError}</span>
        </div>
      )}
    </div>
  );
}

// ── Totals overview ────────────────────────────────────────────────────────

function TotalsOverview({ totals }: { totals: StatusTotals }) {
  // byStatus / byActionType may be {} when no decisions exist — default to 0
  const byStatus = totals.byStatus ?? {};
  const byActionType = totals.byActionType ?? {};

  const statusCells = [
    { key: "proposed" as const, color: "#ffb800" },
    { key: "executing" as const, color: "#2196f3" },
    { key: "done" as const, color: "#4caf50" },
    { key: "skipped" as const, color: "#91a0b5" },
  ];

  const actionCells = [
    { key: "deep_analyze" as const },
    { key: "rec_reweight" as const },
    { key: "rebalance_suggest" as const },
    { key: "priority_alert" as const },
  ];

  return (
    <div className="_dec-totals">
      <div className="_dec-totals-section">
        <div className="_dec-totals-head">決策總數</div>
        <div className="_dec-totals-big">{totals.total}</div>
      </div>

      <div className="_dec-totals-divider" />

      <div className="_dec-totals-section">
        <div className="_dec-totals-head">按狀態</div>
        <div className="_dec-totals-grid">
          {statusCells.map(({ key, color }) => (
            <div key={key} className="_dec-totals-cell">
              <span className="_dec-totals-num" style={{ color }}>{byStatus[key] ?? 0}</span>
              <span className="_dec-totals-lbl">{labelStatus(key)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="_dec-totals-divider" />

      <div className="_dec-totals-section">
        <div className="_dec-totals-head">按動作類型</div>
        <div className="_dec-totals-grid">
          {actionCells.map(({ key }) => (
            <div key={key} className="_dec-totals-cell">
              <span className="_dec-totals-num">{byActionType[key] ?? 0}</span>
              <span className="_dec-totals-lbl">{labelActionType(key)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Outcome block ──────────────────────────────────────────────────────────

function OutcomeBlock({ outcome, actionType }: { outcome: DecisionOutcome; actionType: string }) {
  if (actionType === "deep_analyze" && outcome.analyses) {
    return (
      <div className="_dec-outcome">
        <div className="_dec-outcome-head">執行結果</div>
        {outcome.analyses.map((a, i) => (
          <div key={i} className="_dec-outcome-row">
            <span className="_dec-outcome-ticker">{a.ticker}</span>
            <span className="_dec-outcome-status" style={{ color: a.status === "complete" ? "#4caf50" : "#91a0b5" }}>
              {a.status === "complete" ? "深析完成" : a.status === "error" ? "分析失敗" : a.status}
            </span>
            {a.reportSummary && (
              <span className="_dec-outcome-summary">{a.reportSummary}</span>
            )}
          </div>
        ))}
        {outcome.totalCostUsd != null && (
          <div className="_dec-outcome-cost">費用估算：${outcome.totalCostUsd.toFixed(4)} USD</div>
        )}
      </div>
    );
  }

  if (actionType === "priority_alert" && outcome.message) {
    return (
      <div className="_dec-outcome">
        <div className="_dec-outcome-head">告警內容</div>
        <div className="_dec-outcome-msg">{outcome.message}</div>
        {outcome.severity && (
          <div className="_dec-outcome-row">
            <span className="_dec-outcome-lbl">嚴重程度</span>
            <span className="_dec-outcome-val">{outcome.severity}</span>
          </div>
        )}
      </div>
    );
  }

  if ((actionType === "rec_reweight" || actionType === "rebalance_suggest") && outcome.advisory) {
    return (
      <div className="_dec-outcome">
        <div className="_dec-outcome-head">建議內容（僅供參考，不影響推薦）</div>
        {outcome.direction && (
          <div className="_dec-outcome-row">
            <span className="_dec-outcome-lbl">建議方向</span>
            <span className="_dec-outcome-val">{outcome.direction}</span>
          </div>
        )}
        {outcome.reason && (
          <div className="_dec-outcome-row">
            <span className="_dec-outcome-lbl">理由</span>
            <span className="_dec-outcome-val">{outcome.reason}</span>
          </div>
        )}
        {outcome.suggestedTickers && outcome.suggestedTickers.length > 0 && (
          <div className="_dec-outcome-row">
            <span className="_dec-outcome-lbl">建議標的</span>
            <span className="_dec-outcome-val">{outcome.suggestedTickers.join("、")}</span>
          </div>
        )}
        {outcome.suggestedAction && (
          <div className="_dec-outcome-row">
            <span className="_dec-outcome-lbl">建議操作</span>
            <span className="_dec-outcome-val">{outcome.suggestedAction}</span>
          </div>
        )}
        <div className="_dec-outcome-advisory">純建議 · 不自動執行 · 不影響推薦數據</div>
      </div>
    );
  }

  return null;
}

// ── Decision card ──────────────────────────────────────────────────────────

function DecisionCard({ item }: { item: DecisionItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`_dec-card _dec-card--${item.status}`}>
      <div className="_dec-card-header">
        <div className="_dec-card-meta">
          <span className="_dec-trigger-label">{labelTrigger(item.triggerType)}</span>
          <span className="_dec-meta-arrow">→</span>
          <ActionBadge actionType={item.actionType} />
          <span className="_dec-meta-arrow">→</span>
          <StatusBadge status={item.status} />
        </div>
        <div className="_dec-card-right">
          <span className="_dec-confidence" title="信心水準">
            信心 {confidencePct(item.confidence)}
          </span>
          <span className="_dec-priority" title="優先級（數字越小越高）">
            P{item.priority}
          </span>
          <span className="_dec-time">{fmtTimeAgo(item.createdAt)}</span>
        </div>
      </div>

      <div className="_dec-card-reasoning" onClick={() => setExpanded(!expanded)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded(!expanded); }}>
        <div className="_dec-reasoning-label">主腦推理</div>
        <div className={`_dec-reasoning-text${expanded ? " _dec-reasoning-text--expanded" : ""}`}>
          {item.reasoning}
        </div>
        {item.reasoning.length > 120 && (
          <button type="button" className="_dec-expand-btn" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? "收起" : "展開全部"}
          </button>
        )}
      </div>

      {item.outcome && (
        <OutcomeBlock outcome={item.outcome} actionType={item.actionType} />
      )}

      <div className="_dec-card-footer">
        <span className="_dec-card-time">{fmtDateTime(item.createdAt)}</span>
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="_dec-empty">
      <div className="_dec-empty-icon">◈</div>
      <div className="_dec-empty-title">主腦尚未產生決策</div>
      <div className="_dec-empty-sub">
        等待市場事件或策略信號觸發決策引擎。<br />
        主腦 Tick 每 10 分鐘執行一次，盤後深夜期間通常無觸發。
      </div>
    </div>
  );
}

// ── CSS ────────────────────────────────────────────────────────────────────

const CSS = `
  ._dec-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--mono, monospace);
    white-space: nowrap;
  }

  ._dec-health-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 14px 16px;
    background: rgba(0,0,0,0.2);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
    margin-bottom: 16px;
  }
  ._dec-health-cell {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 220px;
  }
  ._dec-health-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  ._dec-health-label {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
    font-family: var(--mono, monospace);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }
  ._dec-health-val {
    font-size: 12px;
    color: rgba(255,255,255,0.75);
    font-family: var(--mono, monospace);
  }
  ._dec-health-ago {
    font-size: 11px;
    color: rgba(255,255,255,0.35);
  }
  ._dec-health-error {
    width: 100%;
    padding: 8px 10px;
    background: rgba(239,83,80,0.08);
    border: 1px solid rgba(239,83,80,0.25);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  ._dec-health-err-label {
    font-size: 10px;
    color: #ef5350;
    text-transform: uppercase;
    font-family: var(--mono, monospace);
    letter-spacing: 0.05em;
  }
  ._dec-health-err-msg {
    font-size: 12px;
    color: rgba(255,140,135,0.9);
    font-family: var(--mono, monospace);
    word-break: break-word;
  }

  ._dec-totals {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
    background: rgba(0,0,0,0.2);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 16px;
  }
  ._dec-totals-section {
    padding: 14px 20px;
    flex: 1;
    min-width: 140px;
  }
  ._dec-totals-divider {
    width: 1px;
    background: rgba(255,255,255,0.06);
    flex-shrink: 0;
  }
  ._dec-totals-head {
    font-size: 10px;
    color: rgba(255,255,255,0.35);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-family: var(--mono, monospace);
    margin-bottom: 8px;
  }
  ._dec-totals-big {
    font-size: 32px;
    font-weight: 700;
    font-family: var(--mono, monospace);
    color: rgba(255,255,255,0.88);
    line-height: 1;
  }
  ._dec-totals-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 20px;
  }
  ._dec-totals-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  ._dec-totals-num {
    font-size: 20px;
    font-weight: 700;
    font-family: var(--mono, monospace);
    color: rgba(255,255,255,0.8);
    line-height: 1;
  }
  ._dec-totals-lbl {
    font-size: 10px;
    color: rgba(255,255,255,0.35);
    font-family: var(--mono, monospace);
  }

  ._dec-card {
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
    background: rgba(0,0,0,0.2);
    margin-bottom: 10px;
    overflow: hidden;
    transition: border-color 0.15s;
  }
  ._dec-card:hover {
    border-color: rgba(255,255,255,0.13);
  }
  ._dec-card--done {
    border-left: 3px solid rgba(76,175,80,0.5);
  }
  ._dec-card--executing {
    border-left: 3px solid rgba(33,150,243,0.5);
  }
  ._dec-card--proposed {
    border-left: 3px solid rgba(255,184,0,0.5);
  }
  ._dec-card--skipped {
    border-left: 3px solid rgba(145,160,181,0.3);
  }

  ._dec-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  ._dec-card-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  ._dec-trigger-label {
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    font-family: var(--mono, monospace);
  }
  ._dec-meta-arrow {
    font-size: 11px;
    color: rgba(255,255,255,0.25);
  }
  ._dec-card-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  ._dec-confidence {
    font-size: 11px;
    font-family: var(--mono, monospace);
    color: rgba(255,255,255,0.45);
  }
  ._dec-priority {
    font-size: 11px;
    font-family: var(--mono, monospace);
    color: rgba(255,184,0,0.7);
    border: 1px solid rgba(255,184,0,0.2);
    padding: 1px 5px;
    border-radius: 3px;
  }
  ._dec-time {
    font-size: 11px;
    color: rgba(255,255,255,0.3);
    font-family: var(--mono, monospace);
  }

  ._dec-card-reasoning {
    padding: 12px 14px;
    cursor: pointer;
  }
  ._dec-reasoning-label {
    font-size: 10px;
    color: rgba(255,184,0,0.6);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-family: var(--mono, monospace);
    margin-bottom: 5px;
  }
  ._dec-reasoning-text {
    font-size: 13px;
    color: rgba(255,255,255,0.72);
    line-height: 1.6;
    max-height: 3.2em;
    overflow: hidden;
    word-break: break-word;
  }
  ._dec-reasoning-text--expanded {
    max-height: none;
  }
  ._dec-expand-btn {
    margin-top: 6px;
    background: none;
    border: none;
    color: rgba(255,184,0,0.65);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
    font-family: var(--mono, monospace);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  ._dec-expand-btn:hover {
    color: #ffb800;
  }

  ._dec-outcome {
    padding: 10px 14px;
    background: rgba(0,0,0,0.15);
    border-top: 1px solid rgba(255,255,255,0.05);
  }
  ._dec-outcome-head {
    font-size: 10px;
    color: rgba(255,255,255,0.35);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-family: var(--mono, monospace);
    margin-bottom: 6px;
  }
  ._dec-outcome-row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin-bottom: 4px;
    font-size: 12px;
  }
  ._dec-outcome-ticker {
    color: #ffb800;
    font-family: var(--mono, monospace);
    font-weight: 600;
    font-size: 12px;
  }
  ._dec-outcome-status {
    font-size: 11px;
    font-family: var(--mono, monospace);
  }
  ._dec-outcome-summary {
    font-size: 12px;
    color: rgba(255,255,255,0.6);
    margin-left: 4px;
  }
  ._dec-outcome-cost {
    font-size: 11px;
    color: rgba(255,255,255,0.35);
    font-family: var(--mono, monospace);
    margin-top: 4px;
  }
  ._dec-outcome-msg {
    font-size: 13px;
    color: rgba(255,140,110,0.9);
    line-height: 1.55;
    margin-bottom: 4px;
  }
  ._dec-outcome-lbl {
    font-size: 11px;
    color: rgba(255,255,255,0.35);
    font-family: var(--mono, monospace);
    min-width: 80px;
    flex-shrink: 0;
  }
  ._dec-outcome-val {
    font-size: 12px;
    color: rgba(255,255,255,0.7);
  }
  ._dec-outcome-advisory {
    font-size: 10px;
    color: rgba(255,255,255,0.28);
    font-family: var(--mono, monospace);
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid rgba(255,255,255,0.04);
  }

  ._dec-card-footer {
    padding: 6px 14px;
    border-top: 1px solid rgba(255,255,255,0.04);
    background: rgba(0,0,0,0.1);
  }
  ._dec-card-time {
    font-size: 10px;
    color: rgba(255,255,255,0.25);
    font-family: var(--mono, monospace);
  }

  ._dec-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 64px 32px;
    text-align: center;
  }
  ._dec-empty-icon {
    font-size: 28px;
    color: rgba(255,255,255,0.12);
  }
  ._dec-empty-title {
    font-size: 15px;
    font-weight: 600;
    color: rgba(255,255,255,0.45);
  }
  ._dec-empty-sub {
    font-size: 13px;
    color: rgba(255,255,255,0.28);
    line-height: 1.65;
    max-width: 380px;
  }

  ._dec-gate-loading {
    padding: 56px 0;
    text-align: center;
    font-size: 13px;
    color: rgba(145,160,181,0.55);
    font-style: italic;
  }
  ._dec-gate-locked {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 64px 32px;
    text-align: center;
  }
  ._dec-gate-icon {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: rgba(230,57,70,0.07);
    border: 2px solid rgba(230,57,70,0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: #ff6b77;
  }
  ._dec-gate-title {
    font-size: 15px;
    font-weight: 600;
    color: #c6d0de;
    margin-bottom: 6px;
  }
  ._dec-gate-sub {
    font-size: 13px;
    color: #566276;
    line-height: 1.6;
  }

  ._dec-load-state {
    padding: 40px 0;
    text-align: center;
    font-size: 13px;
    color: rgba(145,160,181,0.5);
  }
  ._dec-error-state {
    padding: 24px;
    background: rgba(239,83,80,0.08);
    border: 1px solid rgba(239,83,80,0.2);
    border-radius: 6px;
    font-size: 13px;
    color: rgba(255,140,135,0.85);
    font-family: var(--mono, monospace);
  }

  ._dec-refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 5px 12px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    color: rgba(255,255,255,0.55);
    font-size: 12px;
    cursor: pointer;
    font-family: var(--mono, monospace);
  }
  ._dec-refresh-btn:hover {
    background: rgba(255,255,255,0.09);
    color: rgba(255,255,255,0.75);
  }
`;

// ── Main component ─────────────────────────────────────────────────────────

type PagePhase = "gate-loading" | "not-owner" | "loading" | "error" | "ready";

export default function DecisionsPage() {
  const [phase, setPhase] = useState<PagePhase>("gate-loading");
  const [state, setState] = useState<OrchestratorState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Owner gate
  useEffect(() => {
    apiGetMe().then((result) => {
      if (!result.ok || result.user.role !== "Owner") {
        setPhase("not-owner");
      } else {
        setPhase("loading");
      }
    });
  }, []);

  // Data fetch (only when phase is "loading")
  useEffect(() => {
    if (phase !== "loading") return;
    let cancelled = false;

    fetchOrchestratorState()
      .then((data) => {
        if (cancelled) return;
        setState(data);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg === "403" ? "此端點需要擁有者權限，請確認登入狀態。" : `資料讀取失敗 (${msg})`);
        setPhase("error");
      });

    return () => {
      cancelled = true;
    };
  }, [phase]);

  function handleRefresh() {
    setPhase("loading");
  }

  return (
    <PageFrame
      code="ADM-BRAIN-DEC"
      title="主腦決策流"
      sub="OpenAlice 決策閉環"
      note="Owner 限定 · 唯讀 · 顯示主腦看到什麼 → 怎麼推理 → 決定什麼動作 → 執行結果。不含任何真單路徑。"
    >
      <style>{CSS}</style>

      {phase === "gate-loading" && (
        <div className="_dec-gate-loading">驗證身份中…</div>
      )}

      {phase === "not-owner" && (
        <div className="_dec-gate-locked">
          <div className="_dec-gate-icon">✕</div>
          <div>
            <div className="_dec-gate-title">此頁面僅限帳號擁有者檢視</div>
            <div className="_dec-gate-sub">主腦決策流屬 Owner 限定資料，請使用擁有者帳號登入。</div>
          </div>
        </div>
      )}

      {phase === "loading" && (
        <div className="_dec-load-state">讀取主腦狀態中…</div>
      )}

      {phase === "error" && (
        <div className="_dec-error-state">
          {errorMsg}
          <br />
          <button type="button" className="_dec-refresh-btn" onClick={handleRefresh}>重新載入</button>
        </div>
      )}

      {phase === "ready" && state && (
        <>
          <HealthRow tick={state.tick} actionTick={state.actionTick} />

          <Panel
            code="ADM-BRAIN-DEC-TOT"
            title="決策概覽"
            right={`共 ${state.totals.total} 筆`}
          >
            <TotalsOverview totals={state.totals} />
          </Panel>

          <Panel
            code="ADM-BRAIN-DEC-LIST"
            title="最近決策"
            right={state.recent.length > 0 ? `${state.recent.length} 筆` : "無決策"}
          >
            {state.recent.length === 0 ? (
              <EmptyState />
            ) : (
              <div>
                {state.recent.map((item) => (
                  <DecisionCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </Panel>

          <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="_dec-refresh-btn" onClick={handleRefresh}>
              重新整理
            </button>
          </div>
        </>
      )}
    </PageFrame>
  );
}
