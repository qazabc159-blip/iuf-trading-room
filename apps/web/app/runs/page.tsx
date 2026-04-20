"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type {
  StrategyIdeasDecisionMode,
  StrategyIdeasQualityFilter,
  StrategyRunListItem,
  StrategyRunListSort,
  StrategyRunListView
} from "@iuf-trading-room/contracts";

import { AppShell } from "@/components/app-shell";
import { listStrategyRuns, type StrategyRunListParams } from "@/lib/api";
import {
  DECISION_BADGE,
  DECISION_LABEL,
  DIRECTION_BADGE,
  DIRECTION_LABEL,
  MODE_LABEL,
  QUALITY_BADGE,
  QUALITY_LABEL
} from "@/lib/strategy-vocab";

const SORT_LABEL: Record<StrategyRunListSort, string> = {
  created_at: "最新建立",
  score: "最高分數",
  symbol: "代號 A–Z"
};

const DEFAULT_QUERY: StrategyRunListParams = {
  limit: 20,
  sort: "created_at"
};

export default function RunsPage() {
  const [query, setQuery] = useState<StrategyRunListParams>(DEFAULT_QUERY);
  const [view, setView] = useState<StrategyRunListView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [symbolDraft, setSymbolDraft] = useState("");
  const [themeDraft, setThemeDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listStrategyRuns(query)
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

  const applySearch = () => {
    setQuery((prev) => ({
      ...prev,
      symbol: symbolDraft.trim() || undefined,
      theme: themeDraft.trim() || undefined
    }));
  };

  const items = view?.items ?? [];

  return (
    <AppShell eyebrow="策略歷史" title="Strategy Runs · 歷史快照">
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[01]</span>
        篩選 · FILTERS
      </h3>
      <section className="panel hud-frame">
        <div className="filter-bar">
          <label>
            <span className="eyebrow">模式</span>
            <select
              value={query.decisionMode ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setQuery({
                  ...query,
                  decisionMode: v === "" ? undefined : (v as StrategyIdeasDecisionMode)
                });
              }}
            >
              <option value="">全部</option>
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
              value={query.sort ?? "created_at"}
              onChange={(e) =>
                setQuery({ ...query, sort: e.target.value as StrategyRunListSort })
              }
            >
              {(Object.keys(SORT_LABEL) as StrategyRunListSort[]).map((s) => (
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
              value={query.limit ?? 20}
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
        <span className="ascii-head-bracket">[02]</span>
        Runs · {view?.total ?? 0} 筆
      </h3>
      {loading ? (
        <p className="muted loading-text" style={{ fontSize: "var(--fs-sm)" }}>
          載入歷史 runs...
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
            尚無符合條件的 run。從 <Link href="/ideas">/ideas</Link> 觸發一次策略推薦即會寫入 run 快照。
          </p>
        </div>
      ) : (
        <section style={{ display: "grid", gap: 10 }}>
          {items.map((run) => (
            <RunListCard key={run.id} run={run} />
          ))}
        </section>
      )}
    </AppShell>
  );
}

function RunListCard({ run }: { run: StrategyRunListItem }) {
  const created = useMemo(() => {
    try {
      return new Date(run.createdAt).toLocaleString("zh-TW");
    } catch {
      return run.createdAt;
    }
  }, [run.createdAt]);

  const summary = run.summary;
  const topIdea = run.topIdea;
  const qualityBreakdown = run.quality;
  const shortId = run.id.slice(0, 8);

  return (
    <article className="panel hud-frame" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div className="mono" style={{ fontSize: "var(--fs-md)", fontWeight: 700 }}>
            RUN {shortId}
          </div>
          <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>
            建立於 {created}
          </div>
        </div>
        <div className="action-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>
            {MODE_LABEL[run.decisionMode]}
          </span>
          <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>
            排序 {run.query.sort ?? "score"}
          </span>
          {run.query.qualityFilter ? (
            <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>
              品質 {run.query.qualityFilter}
            </span>
          ) : null}
          {run.query.symbol ? (
            <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>
              代號 {run.query.symbol}
            </span>
          ) : null}
          {run.query.theme ? (
            <span className="badge" style={{ fontSize: "var(--fs-xs)" }}>
              主題 {run.query.theme}
            </span>
          ) : null}
        </div>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: 6,
          paddingTop: 4,
          borderTop: "1px solid var(--line, #2a2a2a)"
        }}
      >
        <Metric label="總推薦" value={String(summary.total)} />
        <Metric label="允許" value={String(summary.allow)} tone="accent" />
        <Metric label="需審視" value={String(summary.review)} tone="warn" />
        <Metric label="封鎖" value={String(summary.block)} tone="bear" />
        <Metric label="可執行" value={String(qualityBreakdown.strategyReady)} tone="accent" />
        <Metric label="僅參考" value={String(qualityBreakdown.referenceOnly)} tone="warn" />
        <Metric label="不足" value={String(qualityBreakdown.insufficient)} tone="dim" />
      </div>

      {topIdea ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "baseline",
            flexWrap: "wrap",
            paddingTop: 4,
            borderTop: "1px solid var(--line, #2a2a2a)"
          }}
        >
          <span className="eyebrow">Top Idea</span>
          <span className="mono" style={{ fontWeight: 700 }}>{topIdea.symbol}</span>
          <span className="dim" style={{ fontSize: "var(--fs-xs)" }}>
            {topIdea.companyName}
          </span>
          <span className={DIRECTION_BADGE[topIdea.direction]}>
            {DIRECTION_LABEL[topIdea.direction]}
          </span>
          <span className={DECISION_BADGE[topIdea.marketDecision]}>
            {DECISION_LABEL[topIdea.marketDecision]}
          </span>
          <span className={QUALITY_BADGE[topIdea.qualityGrade]}>
            {QUALITY_LABEL[topIdea.qualityGrade]}
          </span>
          <span className="dim" style={{ fontSize: "var(--fs-xs)" }}>
            分數 {Math.round(topIdea.score)} · 信心 {Math.round(topIdea.confidence * 100)}%
          </span>
        </div>
      ) : (
        <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>
          此 run 沒有任何推薦項。
        </div>
      )}

      {run.topSymbols.length > 0 ? (
        <div style={{ fontSize: "var(--fs-sm)" }}>
          <span className="eyebrow" style={{ marginRight: 6 }}>Top Symbols</span>
          <span className="mono">{run.topSymbols.join(" · ")}</span>
        </div>
      ) : null}

      <div className="dim" style={{ fontSize: "var(--fs-xs)" }}>
        品質主因：{qualityBreakdown.primaryReason}
      </div>

      <footer
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          paddingTop: 4,
          flexWrap: "wrap"
        }}
      >
        <Link className="btn-sm" href="/ideas" title="打開即時策略推薦">
          去 /ideas →
        </Link>
        <Link className="btn-sm" href={`/runs/${run.id}`} title="查看此 run 的完整 snapshot">
          查看詳細 →
        </Link>
      </footer>
    </article>
  );
}

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: "warn" | "bear" | "accent" | "dim";
}) {
  return (
    <div>
      <div className={`mono${tone ? ` ${tone}` : ""}`} style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
