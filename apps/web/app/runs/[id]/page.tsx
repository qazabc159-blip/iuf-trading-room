"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AutopilotExecuteResult,
  AutopilotOrderResult,
  StrategyIdea,
  StrategyIdeasDecisionMode,
  StrategyRunRecord
} from "@iuf-trading-room/contracts";

import { AppShell } from "@/components/app-shell";
import { executeStrategyRun, getStrategyRunById, requestConfirmToken } from "@/lib/api";
import { handoffFromIdea, writeIdeaHandoff } from "@/lib/idea-handoff";
import { buildIdeasSearchString } from "@/lib/ideas-query";
import {
  DECISION_BADGE,
  DECISION_LABEL,
  DIRECTION_BADGE,
  DIRECTION_LABEL,
  MODE_LABEL,
  QUALITY_BADGE,
  QUALITY_LABEL
} from "@/lib/strategy-vocab";

// ── Autopilot default input ────────────────────────────────────────────────

const DEFAULT_AUTOPILOT_INPUT = {
  accountId: "paper-default",
  sidePolicy: "bullish_long" as const,
  sizeMode: "fixed_pct" as const,
  sizePct: 1.0,
  maxOrders: 3,
  dryRun: true
};

// ── Page root ──────────────────────────────────────────────────────────────

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = typeof params?.id === "string" ? params.id : "";

  const [run, setRun] = useState<StrategyRunRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Autopilot state — lives here so modal open/close doesn't lose it
  const [modalOpen, setModalOpen] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<AutopilotExecuteResult | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [executeResult, setExecuteResult] = useState<AutopilotExecuteResult | null>(null);
  const [executeError, setExecuteError] = useState<string | null>(null);

  // Confirm gate state (R11 Wave 3)
  // confirmState: idle | fetching_token | token_ready | executing
  const [confirmState, setConfirmState] = useState<"idle" | "fetching_token" | "token_ready" | "executing">("idle");
  const [confirmToken, setConfirmToken] = useState<string | null>(null);
  const [confirmExpiresAt, setConfirmExpiresAt] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // countdown in seconds (0 = expired)
  const [confirmCountdown, setConfirmCountdown] = useState<number>(0);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getStrategyRunById(runId)
      .then((res) => {
        if (!cancelled) setRun(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Derived: kill-switch detection (no separate API call)
  const isKillSwitchHalted =
    dryRunResult !== null &&
    dryRunResult.submitted.length === 0 &&
    dryRunResult.blocked.some((b) => b.blockedReason === "kill_switch");

  // R11 Wave 3: canRealSubmit derived from dryRunResult
  // Wave 2 Bruce全綠 → enable condition: dryRun has at least 1 submitted AND kill-switch not halted
  const canRealSubmit =
    dryRunResult !== null &&
    dryRunResult.submitted.length > 0 &&
    !isKillSwitchHalted;

  function handleOpenModal() {
    if (!runId) return;
    setModalOpen(true);
    setDryRunResult(null);
    setExecuteError(null);
    setDryRunLoading(true);
    // Reset confirm state when modal opens
    setConfirmState("idle");
    setConfirmToken(null);
    setConfirmExpiresAt(null);
    setConfirmError(null);
    setConfirmCountdown(0);
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    let cancelled = false;
    executeStrategyRun(runId, { ...DEFAULT_AUTOPILOT_INPUT, dryRun: true })
      .then((res) => {
        if (!cancelled) setDryRunResult(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setExecuteError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setDryRunLoading(false);
      });

    // Expose cancel flag via closure — cancelled=true on modal close
    return () => {
      cancelled = true;
    };
  }

  function handleCloseModal() {
    setModalOpen(false);
    setDryRunResult(null);
    setExecuteError(null);
    setDryRunLoading(false);
    // Clean up confirm state
    setConfirmState("idle");
    setConfirmToken(null);
    setConfirmExpiresAt(null);
    setConfirmError(null);
    setConfirmCountdown(0);
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }

  // Step 1: fetch confirm token and start countdown
  function handleFetchConfirmToken() {
    if (!runId) return;
    setConfirmState("fetching_token");
    setConfirmError(null);
    setConfirmToken(null);
    setConfirmExpiresAt(null);
    setConfirmCountdown(0);
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    requestConfirmToken(runId)
      .then(({ token, expiresAt }) => {
        setConfirmToken(token);
        setConfirmExpiresAt(expiresAt);
        setConfirmState("token_ready");

        // Start countdown timer
        const ttlMs = new Date(expiresAt).getTime() - Date.now();
        const initialSec = Math.max(0, Math.floor(ttlMs / 1000));
        setConfirmCountdown(initialSec);

        const timer = setInterval(() => {
          setConfirmCountdown((prev) => {
            if (prev <= 1) {
              // Token expired — silently re-fetch
              clearInterval(timer);
              countdownTimerRef.current = null;
              handleFetchConfirmToken();
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
        countdownTimerRef.current = timer;
      })
      .catch((err: unknown) => {
        setConfirmState("idle");
        setConfirmError(err instanceof Error ? err.message : "無法取得確認 Token，請稍後再試");
      });
  }

  // Map confirm gate error codes to zh-TW copy (per spec section 4)
  function mapConfirmErrorCode(rawMsg: string): string {
    try {
      const parsed = JSON.parse(rawMsg) as { error?: string; message?: string };
      const code = parsed.error ?? "";
      switch (code) {
        case "confirm_required": return "請先取得確認 Token";
        case "confirm_invalid": return "Token 不符，請重新取得";
        case "confirm_expired": return "Token 已過期（60s），請重新取得";
        case "confirm_used": return "Token 已使用，請重新取得";
        case "confirm_run_mismatch": return "Token 與此 Run 不符，請重新取得";
        default: return parsed.message ?? rawMsg;
      }
    } catch {
      return rawMsg;
    }
  }

  // Step 2: execute with confirm token (real submit, dryRun:false)
  function handleRealSubmit() {
    if (!runId || !confirmToken) return;
    setConfirmState("executing");
    setExecuteLoading(true);
    setExecuteError(null);
    // Clear countdown timer during execution
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }

    executeStrategyRun(runId, {
      ...DEFAULT_AUTOPILOT_INPUT,
      dryRun: false,
      confirmToken
    })
      .then((res) => {
        setExecuteResult(res.data);
        setConfirmState("idle");
        // Close modal to show section [04] result panel
        handleCloseModal();
      })
      .catch((err: unknown) => {
        const rawMsg = err instanceof Error ? err.message : String(err);
        const friendlyMsg = mapConfirmErrorCode(rawMsg);
        // Check if it's a confirm gate error — if so, re-fetch token
        const isGateError = ["confirm_required", "confirm_invalid", "confirm_expired", "confirm_used", "confirm_run_mismatch"]
          .some((code) => rawMsg.includes(code));
        if (isGateError) {
          setConfirmError(friendlyMsg);
          // Re-fetch token for retry
          handleFetchConfirmToken();
        } else {
          setConfirmError(friendlyMsg);
          setConfirmState("idle");
          setExecuteError(friendlyMsg);
        }
      })
      .finally(() => {
        setExecuteLoading(false);
      });
  }

  return (
    <AppShell eyebrow="策略歷史" title="Run Snapshot · 歷史策略快照">
      {loading ? (
        <p className="muted loading-text" style={{ fontSize: "var(--fs-sm)" }}>
          載入 run {runId.slice(0, 8)}…
        </p>
      ) : error ? (
        <div className="panel hud-frame">
          <p className="eyebrow">載入失敗</p>
          <p className="mono" style={{ fontSize: "var(--fs-sm)", color: "var(--bear)" }}>
            {error}
          </p>
          <div style={{ marginTop: 8 }}>
            <Link className="btn-sm" href="/runs">
              ← 回 /runs
            </Link>
          </div>
        </div>
      ) : !run ? (
        <div className="panel hud-frame">
          <p className="dim">查無此 run。</p>
        </div>
      ) : (
        <>
          <RunDetailBody
            run={run}
            onExecuteRun={handleOpenModal}
            executeResult={executeResult}
          />

          {/* Autopilot Modal */}
          {modalOpen && (
            <AutopilotModal
              dryRunLoading={dryRunLoading}
              dryRunResult={dryRunResult}
              executeLoading={executeLoading}
              executeError={executeError}
              isKillSwitchHalted={isKillSwitchHalted}
              canRealSubmit={canRealSubmit}
              confirmState={confirmState}
              confirmCountdown={confirmCountdown}
              confirmError={confirmError}
              onClose={handleCloseModal}
              onFetchConfirmToken={handleFetchConfirmToken}
              onRealSubmit={handleRealSubmit}
            />
          )}
        </>
      )}
    </AppShell>
  );
}

// ── RunDetailBody ──────────────────────────────────────────────────────────

interface RunDetailBodyProps {
  run: StrategyRunRecord;
  onExecuteRun: () => void;
  executeResult: AutopilotExecuteResult | null;
}

function RunDetailBody({ run, onExecuteRun, executeResult }: RunDetailBodyProps) {
  const created = useMemo(() => safeDate(run.createdAt), [run.createdAt]);
  const generated = useMemo(() => safeDate(run.generatedAt), [run.generatedAt]);
  const query = run.query;
  const summary = run.summary;
  const mode = query.decisionMode;
  const ideasHref = useMemo(() => {
    const qs = buildIdeasSearchString(query);
    return qs ? `/ideas?${qs}` : "/ideas";
  }, [query]);

  return (
    <>
      <section className="panel hud-frame" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div>
            <p className="eyebrow">RUN {run.id}</p>
            <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>
              建立於 {created} · 產生於 {generated}
            </div>
          </div>
          <div className="action-row" style={{ gap: 8 }}>
            <Link className="btn-sm" href="/runs">
              ← 回 /runs
            </Link>
            <Link className="btn-sm" href={ideasHref} title="以此 run 的 query 條件打開 /ideas">
              去 /ideas →
            </Link>
            <button
              className="btn-sm"
              onClick={onExecuteRun}
              title="以 Autopilot 執行此 Run（dryRun 預覽）"
              aria-label="Execute Run — 以 Autopilot 執行此策略快照"
            >
              ▶ Execute Run
            </button>
          </div>
        </header>
      </section>

      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[01]</span>
        Saved Query · QUERY SNAPSHOT
      </h3>
      <section className="panel hud-frame">
        <div className="filter-bar" style={{ gap: 12 }}>
          <QuerySlot label="模式" value={MODE_LABEL[mode]} />
          <QuerySlot label="排序" value={String(query.sort)} />
          <QuerySlot label="數量" value={String(query.limit)} />
          <QuerySlot label="Signal days" value={String(query.signalDays)} />
          <QuerySlot label="含封鎖" value={query.includeBlocked ? "是" : "否"} />
          <QuerySlot label="品質過濾" value={query.qualityFilter ?? "—"} />
          <QuerySlot label="Decision 過濾" value={query.decisionFilter ?? "—"} />
          <QuerySlot label="市場" value={query.market ?? "—"} />
          <QuerySlot label="代號" value={query.symbol ?? "—"} />
          <QuerySlot label="主題關鍵字" value={query.theme ?? "—"} />
          <QuerySlot label="主題 ID" value={query.themeId ?? "—"} />
        </div>
      </section>

      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[02]</span>
        Summary · 推薦摘要
      </h3>
      <section className="kpi-strip">
        <KpiCard label="總推薦" value={summary.total} />
        <KpiCard label="允許送單" value={summary.allow} tone="accent" />
        <KpiCard label="需審視" value={summary.review} tone="warn" />
        <KpiCard label="封鎖" value={summary.block} tone="bear" />
        <KpiCard label="看多" value={summary.bullish} tone="accent" />
        <KpiCard label="看空" value={summary.bearish} tone="bear" />
        <KpiCard label="中性" value={summary.neutral} tone="dim" />
        <KpiCard label="可策略執行" value={summary.quality.strategyReady} tone="accent" />
        <KpiCard label="僅供參考" value={summary.quality.referenceOnly} tone="warn" />
        <KpiCard label="資料不足" value={summary.quality.insufficient} tone="dim" />
      </section>
      {summary.quality.primaryReasons.length > 0 ? (
        <div className="panel hud-frame">
          <p className="eyebrow">品質主因分佈</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--fs-sm)" }}>
            {summary.quality.primaryReasons.map((row) => (
              <li key={row.reason} className="mono">
                {row.reason} <span className="dim">× {row.total}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[03]</span>
        Items · 推薦項快照（{run.items.length}）
      </h3>
      {run.items.length === 0 ? (
        <div className="panel hud-frame">
          <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>
            此 run 沒有保留 item snapshot（可能當時無結果）。
          </p>
        </div>
      ) : (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 12
          }}
        >
          {run.items.map((item) => (
            <SnapshotItemCard key={item.companyId} item={item} mode={mode} />
          ))}
        </section>
      )}

      {/* Section [04] — Autopilot Execute Result (real submit only, shown after modal closes) */}
      {executeResult ? (
        <AutopilotExecutePanel result={executeResult} />
      ) : null}
    </>
  );
}

// ── AutopilotModal ─────────────────────────────────────────────────────────

interface AutopilotModalProps {
  dryRunLoading: boolean;
  dryRunResult: AutopilotExecuteResult | null;
  executeLoading: boolean;
  executeError: string | null;
  isKillSwitchHalted: boolean;
  canRealSubmit: boolean;
  confirmState: "idle" | "fetching_token" | "token_ready" | "executing";
  confirmCountdown: number;
  confirmError: string | null;
  onClose: () => void;
  onFetchConfirmToken: () => void;
  onRealSubmit: () => void;
}

function AutopilotModal({
  dryRunLoading,
  dryRunResult,
  executeLoading,
  executeError,
  isKillSwitchHalted,
  canRealSubmit,
  confirmState,
  confirmCountdown,
  confirmError,
  onClose,
  onFetchConfirmToken,
  onRealSubmit
}: AutopilotModalProps) {
  const isConfirmBusy = confirmState === "fetching_token" || confirmState === "executing";

  return (
    <>
      {/* Backdrop — blocks pointer events to page content below */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Autopilot Execute — 策略自動成單預覽"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 200,
          background: "rgba(0,0,0,0.72)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          overflowY: "auto",
          padding: "48px 16px"
        }}
        onClick={(e) => {
          // Close if clicking the backdrop itself (not the modal content)
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="panel hud-frame"
          style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 12 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal header */}
          <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <h2 className="ascii-head" style={{ margin: 0 }}>
              <span className="ascii-head-bracket">[EXEC]</span>
              Autopilot Execute · 策略自動成單
            </h2>
            <button
              className="btn-sm"
              onClick={onClose}
              aria-label="關閉 Autopilot 執行視窗"
              disabled={isConfirmBusy}
            >
              ✕ 關閉
            </button>
          </header>

          {/* Config summary */}
          <div className="panel hud-frame" style={{ background: "var(--surface-alt, #111)", gap: 8 }}>
            <p className="eyebrow" style={{ marginBottom: 4 }}>執行參數</p>
            <div className="filter-bar" style={{ gap: 10 }}>
              <QuerySlot label="帳戶" value="paper-default" />
              <QuerySlot label="方向政策" value="bullish_long" />
              <QuerySlot label="倉位模式" value="fixed_pct" />
              <QuerySlot label="倉位 %" value="1.0%" />
              <QuerySlot label="最多筆數" value="3" />
            </div>
          </div>

          {/* Kill-switch halted banner */}
          {isKillSwitchHalted ? (
            <div
              className="panel hud-frame"
              style={{ borderColor: "var(--bear)", background: "rgba(255,60,60,0.08)" }}
              role="alert"
            >
              <p className="mono" style={{ color: "var(--bear)", fontWeight: 700 }}>
                TRADING HALTED — Kill Switch 已啟動
              </p>
              <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>
                所有訂單已被 kill_switch 封鎖，請先解除 Kill Switch 再執行。
              </p>
            </div>
          ) : null}

          {/* dryRun loading */}
          {dryRunLoading ? (
            <div className="panel hud-frame">
              <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>
                正在取得 dryRun 預覽…
              </p>
            </div>
          ) : null}

          {/* dryRun error */}
          {!dryRunLoading && executeError ? (
            <div className="panel hud-frame" role="alert">
              <p className="eyebrow" style={{ color: "var(--bear)" }}>執行錯誤</p>
              <p className="mono" style={{ fontSize: "var(--fs-sm)", color: "var(--bear)" }}>
                {executeError}
              </p>
              <p className="dim" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
                請關閉並再試一次，或確認後端狀態。
              </p>
            </div>
          ) : null}

          {/* Confirm gate error (separate from dryRun error) */}
          {confirmError && !executeError ? (
            <div className="panel hud-frame" role="alert">
              <p className="eyebrow" style={{ color: "var(--warn)" }}>確認閘道錯誤</p>
              <p className="mono" style={{ fontSize: "var(--fs-sm)", color: "var(--warn)" }}>
                {confirmError}
              </p>
              <p className="dim" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
                系統正在重新取得確認 Token…
              </p>
            </div>
          ) : null}

          {/* dryRun preflight results */}
          {!dryRunLoading && dryRunResult && !executeError ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <p className="eyebrow">DRY RUN 預覽結果</p>

              {/* KPI strip */}
              <section className="kpi-strip">
                <KpiCard label="總計" value={dryRunResult.summary.total} />
                <KpiCard label="可送出" value={dryRunResult.summary.submittedCount} tone="accent" />
                <KpiCard label="封鎖" value={dryRunResult.summary.blockedCount} tone="bear" />
                <KpiCard label="錯誤" value={dryRunResult.summary.errorCount} tone="warn" />
              </section>

              {/* SUBMITTED */}
              {dryRunResult.submitted.length > 0 ? (
                <div className="panel hud-frame">
                  <p className="eyebrow" style={{ color: "var(--accent)", marginBottom: 6 }}>
                    SUBMITTED ({dryRunResult.submitted.length})
                  </p>
                  {dryRunResult.submitted.map((order) => (
                    <DryRunOrderRow key={order.symbol} order={order} />
                  ))}
                </div>
              ) : (
                <div className="panel hud-frame">
                  <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>
                    沒有可送出的推薦（可能全為 neutral / 全被封鎖）
                  </p>
                </div>
              )}

              {/* BLOCKED */}
              {dryRunResult.blocked.length > 0 ? (
                <div className="panel hud-frame">
                  <p className="eyebrow" style={{ color: "var(--bear)", marginBottom: 6 }}>
                    BLOCKED ({dryRunResult.blocked.length})
                  </p>
                  {dryRunResult.blocked.map((order) => (
                    <DryRunOrderRow key={order.symbol} order={order} />
                  ))}
                </div>
              ) : null}

              {/* ERRORS */}
              {dryRunResult.errors.length > 0 ? (
                <div className="panel hud-frame">
                  <p className="eyebrow" style={{ color: "var(--warn)", marginBottom: 6 }}>
                    ERRORS ({dryRunResult.errors.length})
                  </p>
                  {dryRunResult.errors.map((err) => (
                    <div key={err.symbol} style={{ fontSize: "var(--fs-sm)", marginBottom: 4 }}>
                      <span className="mono" style={{ fontWeight: 700 }}>{err.symbol}</span>
                      <span className="dim" style={{ marginLeft: 8 }}>{err.message}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 2-Step Confirm Gate UI — only shows when canRealSubmit is true */}
          {canRealSubmit && !dryRunLoading && !executeError ? (
            <div
              className="panel hud-frame"
              style={{ borderColor: "var(--warn, #e6a817)", background: "rgba(230,168,23,0.06)", display: "flex", flexDirection: "column", gap: 8 }}
            >
              <p className="eyebrow" style={{ color: "var(--warn, #e6a817)" }}>
                REAL SUBMIT — 真實送出確認
              </p>
              <p className="dim" style={{ fontSize: "var(--fs-xs)" }}>
                真實送出將實際對 paper broker 下單，請確認 dryRun 預覽無誤後再操作。
              </p>

              {/* Countdown display */}
              {confirmState === "token_ready" && confirmCountdown > 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="eyebrow">確認碼有效期</span>
                  <span
                    className="mono"
                    style={{
                      fontWeight: 700,
                      color: confirmCountdown <= 15 ? "var(--bear)" : "var(--warn, #e6a817)",
                      fontSize: "var(--fs-md)"
                    }}
                  >
                    {confirmCountdown}s
                  </span>
                  <span className="dim" style={{ fontSize: "var(--fs-xs)" }}>（過期後自動重新取得）</span>
                </div>
              ) : null}

              {/* fetching_token status */}
              {confirmState === "fetching_token" ? (
                <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>
                  正在取得確認 Token…
                </p>
              ) : null}

              {/* executing status */}
              {confirmState === "executing" ? (
                <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>
                  正在送出真實訂單…
                </p>
              ) : null}

              {/* Action buttons — Step 1 then Step 2 */}
              <div className="action-row" style={{ gap: 8 }}>
                {/* Step 1: Get Token */}
                {confirmState === "idle" ? (
                  <button
                    className="btn-sm"
                    onClick={onFetchConfirmToken}
                    title="取得 60 秒有效確認 Token（Step 1）"
                    aria-label="取得真實送出確認 Token"
                    style={{
                      borderColor: "var(--warn, #e6a817)",
                      color: "var(--warn, #e6a817)"
                    }}
                  >
                    取得確認碼（Step 1）
                  </button>
                ) : null}

                {/* Step 2: Confirm Send */}
                {confirmState === "token_ready" ? (
                  <button
                    className="btn-sm"
                    onClick={onRealSubmit}
                    disabled={executeLoading}
                    title="此為真實送出，點擊後會實際下單"
                    aria-label="確認真實送出 — 將對 paper broker 實際下單"
                    style={{
                      borderColor: "var(--bear, #e05c5c)",
                      color: "var(--bear, #e05c5c)",
                      fontWeight: 700
                    }}
                  >
                    確認送出（Step 2）
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Action row */}
          <div className="action-row" style={{ gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
            <button className="btn-sm" onClick={onClose} disabled={isConfirmBusy}>
              取消
            </button>
            {/* Real submit button — disabled when canRealSubmit is false (no qualifying ideas / kill-switch) */}
            {!canRealSubmit ? (
              <button
                className="btn-sm"
                disabled={true}
                title={isKillSwitchHalted ? "Kill Switch 已啟動，無法真實送出" : "dryRun 無可送出推薦，按鈕不可用"}
                aria-label="真實送出 — 目前不可用"
                style={{ opacity: 0.45, cursor: "not-allowed" }}
              >
                真實送出（不可用）
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

// ── AutopilotExecutePanel [04] ────────────────────────────────────────────

function AutopilotExecutePanel({ result }: { result: AutopilotExecuteResult }) {
  const isKillSwitchHalted =
    result.submitted.length === 0 &&
    result.blocked.some((b) => b.blockedReason === "kill_switch");

  return (
    <>
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[04]</span>
        Autopilot Execute · 執行結果
      </h3>

      <section className="panel hud-frame" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div>
            <p className="eyebrow">Run {result.runId.slice(0, 8)}</p>
            <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>
              執行於 {safeDate(result.executedAt)} · dryRun: {result.dryRun ? "是" : "否"}
            </div>
          </div>
          {isKillSwitchHalted ? (
            <span className="badge-red">KILL SWITCH HALTED</span>
          ) : null}
        </header>

        {/* KPI */}
        <section className="kpi-strip">
          <KpiCard label="總計" value={result.summary.total} />
          <KpiCard label="送出" value={result.summary.submittedCount} tone="accent" />
          <KpiCard label="封鎖" value={result.summary.blockedCount} tone="bear" />
          <KpiCard label="錯誤" value={result.summary.errorCount} tone="warn" />
        </section>

        {/* SUBMITTED */}
        {result.submitted.length > 0 ? (
          <div>
            <p className="eyebrow" style={{ color: "var(--accent)", marginBottom: 6 }}>
              SUBMITTED ({result.submitted.length})
            </p>
            {result.submitted.map((order) => (
              <ExecuteOrderRow key={order.symbol} order={order} />
            ))}
          </div>
        ) : null}

        {/* BLOCKED */}
        {result.blocked.length > 0 ? (
          <div>
            <p className="eyebrow" style={{ color: "var(--bear)", marginBottom: 6 }}>
              BLOCKED ({result.blocked.length})
            </p>
            {result.blocked.map((order) => (
              <ExecuteOrderRow key={order.symbol} order={order} />
            ))}
          </div>
        ) : null}

        {/* ERRORS */}
        {result.errors.length > 0 ? (
          <div>
            <p className="eyebrow" style={{ color: "var(--warn)", marginBottom: 6 }}>
              ERRORS ({result.errors.length})
            </p>
            {result.errors.map((err) => (
              <div key={err.symbol} style={{ fontSize: "var(--fs-sm)", marginBottom: 4 }}>
                <span className="mono" style={{ fontWeight: 700 }}>{err.symbol}</span>
                <span className="dim" style={{ marginLeft: 8 }}>{err.message}</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

// ── Order row components ───────────────────────────────────────────────────

function DryRunOrderRow({ order }: { order: AutopilotOrderResult }) {
  const sideLabel = order.side === "buy" ? "買" : "賣";
  const sideBadge = order.side === "buy" ? "badge-green" : "badge-red";
  const priceLabel = order.price !== null ? String(order.price) : "市價";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        paddingBottom: 4,
        borderBottom: "1px solid var(--line, #2a2a2a)",
        marginBottom: 4,
        flexWrap: "wrap"
      }}
    >
      <span className="mono" style={{ fontWeight: 700, minWidth: 64 }}>{order.symbol}</span>
      <span className={sideBadge}>{sideLabel}</span>
      <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>× {order.quantity}</span>
      <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>@ {priceLabel}</span>
      {order.blockedReason ? (
        <span className="dim" style={{ fontSize: "var(--fs-xs)" }}>封鎖：{order.blockedReason}</span>
      ) : null}
    </div>
  );
}

function ExecuteOrderRow({ order }: { order: AutopilotOrderResult }) {
  const sideLabel = order.side === "buy" ? "買" : "賣";
  const sideBadge = order.side === "buy" ? "badge-green" : "badge-red";
  const priceLabel = order.price !== null ? String(order.price) : "市價";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        paddingBottom: 4,
        borderBottom: "1px solid var(--line, #2a2a2a)",
        marginBottom: 4,
        flexWrap: "wrap"
      }}
    >
      <span className="mono" style={{ fontWeight: 700, minWidth: 64 }}>{order.symbol}</span>
      <span className={sideBadge}>{sideLabel}</span>
      <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>× {order.quantity}</span>
      <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>@ {priceLabel}</span>
      {order.submitResult !== null ? (
        <span className="badge-green" style={{ fontSize: "var(--fs-xs)" }}>[已送出]</span>
      ) : null}
      {order.blockedReason ? (
        <span className="dim" style={{ fontSize: "var(--fs-xs)" }}>封鎖：{order.blockedReason}</span>
      ) : null}
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────

function SnapshotItemCard({
  item,
  mode
}: {
  item: StrategyIdea;
  mode: StrategyIdeasDecisionMode;
}) {
  const topTheme = item.topThemes[0] ?? null;
  const scorePct = Math.round(item.score);
  const confPct = Math.round(item.confidence * 100);
  const rationale = item.rationale;

  return (
    <article className="panel hud-frame" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div className="mono" style={{ fontSize: "var(--fs-md)", fontWeight: 700 }}>
            {item.symbol}
          </div>
          <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>
            {item.companyName} · {item.market}
          </div>
        </div>
        <span className={DIRECTION_BADGE[item.direction]}>
          {DIRECTION_LABEL[item.direction]}
        </span>
      </header>

      <div className="action-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className={DECISION_BADGE[item.marketData.decision]}>
          {DECISION_LABEL[item.marketData.decision]} · {MODE_LABEL[mode]}
        </span>
        <span className={QUALITY_BADGE[item.quality.grade]}>
          {QUALITY_LABEL[item.quality.grade]}
        </span>
        {item.marketData.selectedSource ? (
          <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>
            來源 {item.marketData.selectedSource}
          </span>
        ) : null}
        <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>
          新鮮度 {item.marketData.freshnessStatus}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 6,
          paddingTop: 4,
          borderTop: "1px solid var(--line, #2a2a2a)"
        }}
      >
        <SmallMetric label="分數" value={`${scorePct}`} sub="0–100" />
        <SmallMetric label="信心" value={`${confPct}%`} />
        <SmallMetric
          label="訊號"
          value={String(item.signalCount)}
          sub={`多${item.bullishSignalCount} / 空${item.bearishSignalCount}`}
        />
      </div>

      {topTheme ? (
        <div style={{ fontSize: "var(--fs-sm)" }}>
          <span className="eyebrow" style={{ marginRight: 6 }}>主題</span>
          <span className="mono">{topTheme.name}</span>
          <span className="dim" style={{ marginLeft: 6 }}>
            · 熱度 {Math.round(topTheme.score)}
          </span>
        </div>
      ) : null}

      <div style={{ fontSize: "var(--fs-sm)" }}>
        <span className="eyebrow" style={{ marginRight: 6 }}>主要理由</span>
        <span>{rationale.primaryReason}</span>
      </div>

      {rationale.marketData.primaryReason &&
      rationale.marketData.primaryReason !== rationale.primaryReason ? (
        <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>
          行情：{rationale.marketData.primaryReason}
        </div>
      ) : null}

      {item.quality.primaryReason &&
      item.quality.primaryReason !== rationale.primaryReason ? (
        <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>
          品質：{item.quality.primaryReason}
        </div>
      ) : null}

      {item.latestSignalAt ? (
        <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>
          最近訊號：{safeDate(item.latestSignalAt)}
        </div>
      ) : null}

      <footer style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
        <Link
          className="btn-sm"
          href={`/portfolio?symbol=${encodeURIComponent(item.symbol)}`}
          title={`帶 ${item.symbol} 與此 run 的策略上下文到下單台`}
          onClick={() => {
            writeIdeaHandoff(handoffFromIdea(item, mode));
          }}
        >
          帶去下單台 →
        </Link>
      </footer>
    </article>
  );
}

function QuerySlot({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div className="eyebrow">{label}</div>
      <div className="mono" style={{ fontSize: "var(--fs-sm)" }}>{value}</div>
    </div>
  );
}

function SmallMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone
}: {
  label: string;
  value?: number;
  tone?: "warn" | "bear" | "accent" | "dim";
}) {
  return (
    <div className="kpi-card">
      <div className={`kpi-value${tone ? ` ${tone}` : ""}`}>
        {value !== undefined ? value : "—"}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function safeDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-TW");
  } catch {
    return iso;
  }
}
