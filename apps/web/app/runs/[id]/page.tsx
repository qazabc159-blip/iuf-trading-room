"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type {
  StrategyIdea,
  StrategyIdeasDecisionMode,
  StrategyRunRecord
} from "@iuf-trading-room/contracts";

import { AppShell } from "@/components/app-shell";
import { getStrategyRunById } from "@/lib/api";
import { handoffFromIdea, writeIdeaHandoff } from "@/lib/idea-handoff";
import {
  DECISION_BADGE,
  DECISION_LABEL,
  DIRECTION_BADGE,
  DIRECTION_LABEL,
  MODE_LABEL,
  QUALITY_BADGE,
  QUALITY_LABEL
} from "@/lib/strategy-vocab";

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = typeof params?.id === "string" ? params.id : "";

  const [run, setRun] = useState<StrategyRunRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        <RunDetailBody run={run} />
      )}
    </AppShell>
  );
}

function RunDetailBody({ run }: { run: StrategyRunRecord }) {
  const created = useMemo(() => safeDate(run.createdAt), [run.createdAt]);
  const generated = useMemo(() => safeDate(run.generatedAt), [run.generatedAt]);
  const query = run.query;
  const summary = run.summary;
  const mode = query.decisionMode;

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
            <Link className="btn-sm" href="/ideas" title="打開即時策略推薦">
              去 /ideas →
            </Link>
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
    </>
  );
}

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
