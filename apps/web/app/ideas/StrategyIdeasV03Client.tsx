"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { cleanNarrativeText } from "@/lib/operator-copy";
import { reasonLabel } from "@/lib/strategy-vocab";

import styles from "./strategy-ideas-v03.module.css";

export type IdeaDirectionV03 = "bullish" | "bearish" | "neutral";
export type IdeaDecisionV03 = "allow" | "review" | "block";
export type IdeaQualityV03 = "strategy_ready" | "reference_only" | "insufficient";

export type IdeaRowV03 = {
  companyId: string;
  symbol: string;
  companyName: string;
  direction: IdeaDirectionV03;
  score: number;
  confidence: number;
  signalCount: number;
  topThemes: Array<{ themeId: string; name: string }>;
  marketData: {
    decision: IdeaDecisionV03;
    readiness: "ready" | "degraded" | "missing";
    freshnessStatus: "fresh" | "stale" | "missing";
    reason?: string | null;
  };
  quality: {
    grade: IdeaQualityV03;
    missing?: string[];
  };
  rationale: {
    primaryReason?: string | null;
    supportingReasons?: string[];
  };
};

export type IdeasViewV03 = {
  generatedAt: string;
  summary: {
    total: number;
    allow: number;
    review: number;
    block: number;
    bullish: number;
    bearish: number;
    neutral: number;
    quality: {
      strategyReady: number;
      referenceOnly: number;
      insufficient: number;
      primaryReasons: Array<{ reason: string; count?: number; total?: number }>;
    };
  };
  items: IdeaRowV03[];
};

export type IdeasLoadStateV03 =
  | { state: "LIVE"; data: IdeasViewV03; updatedAt: string; source: string }
  | { state: "EMPTY"; data: IdeasViewV03; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: IdeasViewV03; updatedAt: string; source: string; reason: string };

type Filter = "all" | IdeaDecisionV03;
type DirectionFilter = "all" | IdeaDirectionV03;

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function decisionLabel(value: IdeaDecisionV03) {
  if (value === "allow") return "可觀察";
  if (value === "review") return "待審";
  return "不進流程";
}

function decisionClass(value: IdeaDecisionV03) {
  if (value === "allow") return styles.ok;
  if (value === "review") return styles.warn;
  return styles.bad;
}

function directionLabel(value: IdeaDirectionV03) {
  if (value === "bullish") return "偏多";
  if (value === "bearish") return "偏空";
  return "中性";
}

function qualityLabel(value: IdeaQualityV03) {
  if (value === "strategy_ready") return "可策略觀察";
  if (value === "reference_only") return "僅供參考";
  return "資料不足";
}

function readinessLabel(value: IdeaRowV03["marketData"]["readiness"]) {
  if (value === "ready") return "資料可用";
  if (value === "degraded") return "資料待補";
  return "資料不足";
}

function freshnessLabel(value: IdeaRowV03["marketData"]["freshnessStatus"]) {
  if (value === "fresh") return "資料新鮮";
  if (value === "stale") return "資料偏舊";
  return "缺資料";
}

function reasonText(value: string | null | undefined) {
  return cleanNarrativeText(reasonLabel(value), "策略理由尚未完成中文整理。");
}

function ideaSummary(idea: IdeaRowV03) {
  const theme = idea.topThemes[0]?.name ?? "尚未連結主題";
  return cleanNarrativeText(
    `${idea.companyName} / ${theme} / ${reasonText(idea.rationale.primaryReason)}`,
    `${idea.companyName} / ${theme} / 策略理由尚未整理完成。`
  );
}

function filterCount(items: IdeaRowV03[], filter: Filter) {
  if (filter === "all") return items.length;
  return items.filter((item) => item.marketData.decision === filter).length;
}

export function StrategyIdeasV03Client({ result }: { result: IdeasLoadStateV03 }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [direction, setDirection] = useState<DirectionFilter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return result.data.items.filter((item) => {
      const decisionOk = filter === "all" || item.marketData.decision === filter;
      const directionOk = direction === "all" || item.direction === direction;
      const queryOk =
        !needle
        || item.symbol.toLowerCase().includes(needle)
        || item.companyName.toLowerCase().includes(needle)
        || item.topThemes.some((theme) => theme.name.toLowerCase().includes(needle));
      return decisionOk && directionOk && queryOk;
    });
  }, [direction, filter, query, result.data.items]);

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(result.data.items[0]?.symbol ?? null);
  const selected = filtered.find((item) => item.symbol === selectedSymbol) ?? filtered[0] ?? result.data.items[0] ?? null;

  return (
    <section className={styles.workbench}>
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          {([
            ["all", "全部"],
            ["allow", "可觀察"],
            ["review", "待審"],
            ["block", "不進流程"],
          ] as const).map(([value, label]) => (
            <button
              className={filter === value ? styles.tabActive : ""}
              key={value}
              type="button"
              onClick={() => setFilter(value)}
            >
              {label}<span>{filterCount(result.data.items, value)}</span>
            </button>
          ))}
        </div>

        <div className={styles.directionTabs}>
          {([
            ["all", "方向"],
            ["bullish", "偏多"],
            ["neutral", "中性"],
            ["bearish", "偏空"],
          ] as const).map(([value, label]) => (
            <button
              className={direction === value ? styles.tabActive : ""}
              key={value}
              type="button"
              onClick={() => setDirection(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <label className={styles.search}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋代號、公司或主題" />
        </label>
      </div>

      <div className={styles.board}>
        <div className={styles.cardList}>
          {filtered.length > 0 ? filtered.map((idea) => (
            <button
              className={`${styles.ideaCard} ${selected?.symbol === idea.symbol ? styles.selected : ""}`}
              key={`${idea.companyId}-${idea.symbol}`}
              type="button"
              onClick={() => setSelectedSymbol(idea.symbol)}
            >
              <div className={styles.cardTop}>
                <span className={styles.symbol}>{idea.symbol}</span>
                <b className={decisionClass(idea.marketData.decision)}>{decisionLabel(idea.marketData.decision)}</b>
              </div>
              <h3>{idea.companyName}</h3>
              <p>{ideaSummary(idea)}</p>
              <div className={styles.themeRow}>
                {idea.topThemes.slice(0, 3).map((theme) => <span key={theme.themeId}>{theme.name}</span>)}
              </div>
              <div className={styles.cardMetrics}>
                <span><b>{idea.score.toFixed(1)}</b><small>分數</small></span>
                <span><b>{percent(idea.confidence)}</b><small>信心</small></span>
                <span><b>{idea.signalCount}</b><small>訊號</small></span>
                <span><b>{directionLabel(idea.direction)}</b><small>方向</small></span>
              </div>
            </button>
          )) : (
            <div className={styles.emptyState}>
              <h3>目前沒有符合條件的候選</h3>
              <p>換一個篩選條件，或等待下一輪策略資料更新。</p>
            </div>
          )}
        </div>

        <aside className={styles.detailPanel}>
          {selected ? (
            <>
              <div className={styles.detailHead}>
                <span className={styles.code}>DETAIL</span>
                <b className={decisionClass(selected.marketData.decision)}>{decisionLabel(selected.marketData.decision)}</b>
              </div>
              <div className={styles.detailTitle}>
                <span>{selected.symbol}</span>
                <h2>{selected.companyName}</h2>
                <p>{ideaSummary(selected)}</p>
              </div>

              <div className={styles.detailMetrics}>
                <div><span>研究分數</span><b>{selected.score.toFixed(1)}</b></div>
                <div><span>信心</span><b>{percent(selected.confidence)}</b></div>
                <div><span>訊號數</span><b>{selected.signalCount}</b></div>
                <div><span>方向</span><b>{directionLabel(selected.direction)}</b></div>
              </div>

              <div className={styles.checklist}>
                <h3>進下一步前檢查</h3>
                <div><span>資料完整度</span><b>{readinessLabel(selected.marketData.readiness)}</b></div>
                <div><span>新鮮度</span><b>{freshnessLabel(selected.marketData.freshnessStatus)}</b></div>
                <div><span>品質等級</span><b>{qualityLabel(selected.quality.grade)}</b></div>
                <div><span>主要原因</span><b>{reasonText(selected.rationale.primaryReason)}</b></div>
              </div>

              {(selected.quality.missing?.length ?? 0) > 0 && (
                <div className={styles.missingBox}>
                  <h3>缺口</h3>
                  {selected.quality.missing?.slice(0, 5).map((item) => <span key={item}>{item.replace(/[_-]/g, " ")}</span>)}
                </div>
              )}

              <div className={styles.actions}>
                <Link href={`/companies/${encodeURIComponent(selected.symbol)}`}>查看公司頁</Link>
                <Link href={`/portfolio?symbol=${encodeURIComponent(selected.symbol)}`}>進 Paper Preview</Link>
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>
              <h3>尚未選擇候選</h3>
              <p>左側選一檔候選後，這裡會顯示資料品質與下一步檢查。</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
