"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import type {
  StrategyIdea,
  StrategyIdeasDecisionMode,
  StrategyIdeasQualityFilter,
  StrategyIdeasSort,
  StrategyIdeasView
} from "@iuf-trading-room/contracts";

import { AppShell } from "@/components/app-shell";
import { getStrategyIdeas, type StrategyIdeasQueryParams } from "@/lib/api";
import { handoffFromIdea, writeIdeaHandoff } from "@/lib/idea-handoff";
import { parseIdeasQuery } from "@/lib/ideas-query";
import {
  DECISION_BADGE,
  DECISION_LABEL,
  DIRECTION_BADGE,
  DIRECTION_LABEL,
  MODE_LABEL,
  QUALITY_BADGE,
  QUALITY_LABEL,
  SORT_LABEL
} from "@/lib/strategy-vocab";

const DEFAULT_QUERY: StrategyIdeasQueryParams = {
  decisionMode: "strategy",
  sort: "score",
  limit: 12,
  includeBlocked: false
};

export default function IdeasPage() {
  return (
    <Suspense fallback={null}>
      <IdeasPageInner />
    </Suspense>
  );
}

function IdeasPageInner() {
  const searchParams = useSearchParams();
  // Parse URL once on mount so `/runs -> /ideas?...` carries saved query state.
  // Subsequent filter edits live in local state; we don't re-sync from URL.
  const [query, setQuery] = useState<StrategyIdeasQueryParams>(() => ({
    ...DEFAULT_QUERY,
    ...parseIdeasQuery(new URLSearchParams(searchParams.toString()))
  }));
  const [view, setView] = useState<StrategyIdeasView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [symbolDraft, setSymbolDraft] = useState(() => query.symbol ?? "");
  const [themeDraft, setThemeDraft] = useState(() => query.theme ?? "");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getStrategyIdeas(query)
      .then((res) => {
        if (!cancelled) setView(res.data);
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
  }, [query]);

  const summary = view?.summary;
  const items = view?.items ?? [];

  const applySearch = () => {
    setQuery((prev) => ({
      ...prev,
      symbol: symbolDraft.trim() || undefined,
      theme: themeDraft.trim() || undefined
    }));
  };

  return (
    <AppShell eyebrow="策略推薦" title="Strategy Ideas · 品質分級">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[01]</span>
        推薦摘要 · SUMMARY
      </h3>
      <section className="kpi-strip">
        <KpiCard label="總推薦" value={summary?.total} />
        <KpiCard label="允許送單" value={summary?.allow} tone="accent" />
        <KpiCard label="需審視" value={summary?.review} tone="warn" />
        <KpiCard label="封鎖" value={summary?.block} tone="bear" />
        <KpiCard label="可策略執行" value={summary?.quality.strategyReady} tone="accent" />
        <KpiCard label="僅供參考" value={summary?.quality.referenceOnly} tone="warn" />
        <KpiCard label="資料不足" value={summary?.quality.insufficient} tone="dim" />
      </section>

      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[02]</span>
        過濾與排序 · FILTERS
      </h3>
      <section className="panel hud-frame">
        <div className="filter-bar">
          <label>
            <span className="eyebrow">模式</span>
            <select
              value={query.decisionMode ?? "strategy"}
              onChange={(e) =>
                setQuery({ ...query, decisionMode: e.target.value as StrategyIdeasDecisionMode })
              }
            >
              {(Object.keys(MODE_LABEL) as StrategyIdeasDecisionMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="eyebrow">品質</span>
            <select
              value={query.qualityFilter ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setQuery({
                  ...query,
                  qualityFilter: v === "" ? undefined : (v as StrategyIdeasQualityFilter)
                });
              }}
            >
              <option value="">全部</option>
              <option value="strategy_ready">僅可策略執行</option>
              <option value="exclude_insufficient">排除資料不足</option>
            </select>
          </label>

          <label>
            <span className="eyebrow">排序</span>
            <select
              value={query.sort ?? "score"}
              onChange={(e) =>
                setQuery({ ...query, sort: e.target.value as StrategyIdeasSort })
              }
            >
              {(Object.keys(SORT_LABEL) as StrategyIdeasSort[]).map((s) => (
                <option key={s} value={s}>
                  {SORT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="eyebrow">數量</span>
            <input
              type="number"
              min={1}
              max={50}
              value={query.limit ?? 12}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1 && n <= 50) {
                  setQuery({ ...query, limit: n });
                }
              }}
            />
          </label>

          <label>
            <span className="eyebrow">代號</span>
            <input
              className="search-input"
              type="text"
              placeholder="例: 2330"
              value={symbolDraft}
              onChange={(e) => setSymbolDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch();
              }}
            />
          </label>

          <label>
            <span className="eyebrow">主題關鍵字</span>
            <input
              className="search-input"
              type="text"
              placeholder="例: AI / 電動車"
              value={themeDraft}
              onChange={(e) => setThemeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch();
              }}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={query.includeBlocked ?? false}
              onChange={(e) => setQuery({ ...query, includeBlocked: e.target.checked })}
            />
            <span className="eyebrow" style={{ margin: 0 }}>含封鎖項</span>
          </label>

          <button className="btn-sm" onClick={applySearch}>
            套用搜尋
          </button>
          <button
            className="btn-sm"
            onClick={() => {
              setSymbolDraft("");
              setThemeDraft("");
              setQuery(DEFAULT_QUERY);
            }}
          >
            重置
          </button>
        </div>
      </section>

      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[03]</span>
        推薦列表 · IDEAS
      </h3>
      {loading ? (
        <p className="muted loading-text" style={{ fontSize: "var(--fs-sm)" }}>
          載入推薦...
        </p>
      ) : error ? (
        <div className="panel hud-frame">
          <p className="eyebrow">載入失敗</p>
          <p className="mono" style={{ fontSize: "var(--fs-sm)", color: "var(--bear)" }}>
            {error}
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="panel hud-frame">
          <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>
            目前沒有符合條件的推薦。試試放寬品質條件或開啟「含封鎖項」。
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
          {items.map((item) => (
            <IdeaCard key={item.companyId} item={item} mode={query.decisionMode ?? "strategy"} />
          ))}
        </section>
      )}

      {view?.generatedAt ? (
        <p className="dim" style={{ fontSize: "var(--fs-xs)", marginTop: 12 }}>
          資料產生於 {new Date(view.generatedAt).toLocaleString("zh-TW")}
        </p>
      ) : null}
    </AppShell>
  );
}

function IdeaCard({ item, mode }: { item: StrategyIdea; mode: StrategyIdeasDecisionMode }) {
  const scorePct = Math.round(item.score);
  const confPct = Math.round(item.confidence * 100);
  const topTheme = item.topThemes[0] ?? null;
  const rationale = item.rationale;
  const qualityLabel = QUALITY_LABEL[item.quality.grade];
  const decisionLabel = DECISION_LABEL[item.marketData.decision];
  const directionLabel = DIRECTION_LABEL[item.direction];

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
        <span className={DIRECTION_BADGE[item.direction]}>{directionLabel}</span>
      </header>

      <div className="action-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className={DECISION_BADGE[item.marketData.decision]}>
          {decisionLabel} · {MODE_LABEL[mode]}
        </span>
        <span className={QUALITY_BADGE[item.quality.grade]}>{qualityLabel}</span>
        {item.marketData.selectedSource ? (
          <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>
            來源 {item.marketData.selectedSource}
          </span>
        ) : null}
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
        <Metric label="推薦分數" value={`${scorePct}`} sub="0–100" />
        <Metric label="信心度" value={`${confPct}%`} />
        <Metric
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
            · {topTheme.marketState} · {topTheme.lifecycle} · 熱度 {Math.round(topTheme.score)}
          </span>
          {item.topThemes.length > 1 ? (
            <span className="dim" style={{ marginLeft: 6 }}>
              +{item.topThemes.length - 1}
            </span>
          ) : null}
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
          最近訊號：{new Date(item.latestSignalAt).toLocaleString("zh-TW")}
        </div>
      ) : null}

      <footer style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
        <Link
          className="btn-sm"
          href={`/portfolio?symbol=${encodeURIComponent(item.symbol)}`}
          title={`帶 ${item.symbol} 與策略上下文到下單台`}
          onClick={() => {
            // Write handoff synchronously before Link triggers navigation so
            // /portfolio's read side always sees fresh context for this idea.
            writeIdeaHandoff(handoffFromIdea(item, mode));
          }}
        >
          帶去下單台 →
        </Link>
      </footer>
    </article>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
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
