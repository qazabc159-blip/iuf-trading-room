"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { ThemeGraphRankingView } from "@iuf-trading-room/contracts";

import { AppShell } from "@/components/app-shell";
import { TopKpiStrip } from "@/components/TopKpiStrip";
import { getOpsSnapshot, getThemeGraphRankings, type OpsSnapshotData } from "@/lib/api";
import { blockSpark } from "@/lib/block-spark";

export default function HomePage() {
  const [snap, setSnap] = useState<OpsSnapshotData | null>(null);
  const [rankings, setRankings] = useState<ThemeGraphRankingView | null>(null);

  useEffect(() => {
    getOpsSnapshot().then((r) => setSnap(r.data)).catch(() => {});
    getThemeGraphRankings({ limit: 6 }).then((r) => setRankings(r.data)).catch(() => {});
  }, []);

  const s = snap?.stats;
  const oa = snap?.openAlice;
  const audit = snap?.audit;

  return (
    <AppShell eyebrow="今日作戰總覽" title="台股 AI 交易戰情室">
      {/* W4: TopKpiStrip — 7-cell nav KPI bar */}
      <TopKpiStrip />

      {/* 上排：關鍵指標 */}
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[01]</span>
        核心指標 · CORE METRICS
      </h3>
      <section className="kpi-strip">
        <KpiCard label="主題戰區" value={s?.themes} />
        <KpiCard label="公司資料庫" value={s?.companies} sub={s ? `核心 ${s.coreCompanies} / 直接 ${s.directCompanies}` : undefined} />
        <KpiCard label="活躍訊號" value={s?.signals} sub={s ? `看多 ${s.bullishSignals}` : undefined} />
        <KpiCard label="交易計畫" value={s?.plans} sub={s ? `執行中 ${s.activePlans}` : undefined} tone={s && s.activePlans > 0 ? "warn" : undefined} />
        <KpiCard label="待審草稿" value={s?.reviewQueue} tone={s && s.reviewQueue > 0 ? "warn" : undefined} />
        <KpiCard label="已發布簡報" value={s?.publishedBriefs} />
      </section>

      {/* 中排：OpenAlice + 稽核 */}
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[02]</span>
        代理狀態與稽核 · AGENT & AUDIT
      </h3>
      <section className="split-panels">
        <div className="panel hud-frame">
          <p className="eyebrow">OpenAlice 代理狀態</p>
          {oa ? (
            <div className="action-row" style={{ gap: 16, marginTop: 8 }}>
              <MiniStat label="背景程序" value={oa.observability.workerStatus} color={oa.observability.workerStatus === "healthy" ? "var(--bull)" : "var(--bear)"} />
              <MiniStat label="排程" value={oa.observability.sweepStatus} color={oa.observability.sweepStatus === "healthy" ? "var(--bull)" : "var(--bear)"} />
              <MiniStat label="佇列" value={String(oa.queue.queued)} />
              <MiniStat label="執行中" value={String(oa.queue.running)} />
              <MiniStat label="待審" value={String(oa.queue.reviewable)} color={oa.queue.reviewable > 0 ? "var(--warn)" : undefined} />
              <MiniStat label="失敗" value={String(oa.queue.failed)} color={oa.queue.failed > 0 ? "var(--bear)" : undefined} />
            </div>
          ) : (
            <p className="muted loading-text" style={{ fontSize: "var(--fs-sm)" }}>載入中...</p>
          )}
        </div>

        <div className="panel hud-frame">
          <p className="eyebrow">稽核紀錄（{audit?.windowHours ?? 24}h）</p>
          {audit ? (
            <div style={{ marginTop: 8 }}>
              <p style={{ fontSize: "var(--fs-sm)" }}>
                共 <strong className="mono">{audit.total}</strong> 筆操作
              </p>
              <div className="action-row" style={{ marginTop: 6 }}>
                {audit.actions.slice(0, 6).map((a) => (
                  <span key={a.action} className="badge" style={{ fontSize: "var(--fs-xs)" }}>
                    {a.action} ×{a.count}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted loading-text" style={{ fontSize: "var(--fs-sm)" }}>載入中...</p>
          )}
        </div>
      </section>

      {/* 主題排名戰區 */}
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[03]</span>
        主題火力排名 · THEME LEADERBOARD
      </h3>
      <section className="panel hud-frame">
        <div className="panel-header">
          <p className="eyebrow">Top 6</p>
          <Link href="/themes" className="btn-sm">查看全部</Link>
        </div>
        {!rankings ? (
          <p className="muted loading-text" style={{ fontSize: "var(--fs-sm)" }}>載入排名...</p>
        ) : rankings.results.length === 0 ? (
          <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>尚無主題排名</p>
        ) : (
          <div className="theme-ranking-grid">
            {rankings.results.slice(0, 6).map((r, idx) => (
              <div key={r.themeId} className="theme-ranking-card">
                <div className="theme-ranking-head">
                  <span className="theme-rank-num mono">#{idx + 1}</span>
                  <div className="theme-ranking-score mono">{r.score}</div>
                </div>
                <div className="theme-ranking-name">{r.name}</div>
                <div className="theme-ranking-meta dim">
                  {r.summary.themeCompanyCount} 家核心 · {r.summary.relatedCompanyCount} 家關聯
                  <span className="block-spark" style={{ marginLeft: 8 }}>
                    {blockSpark([
                      r.breakdown.conviction,
                      r.breakdown.connectivity,
                      r.breakdown.leverage,
                      r.breakdown.keywordRichness
                    ])}
                  </span>
                </div>
                {r.signals.length > 0 ? (
                  <div className="theme-ranking-signals">
                    {r.signals.slice(0, 3).map((sig, i) => (
                      <span key={i} className="badge" style={{ fontSize: "var(--fs-xs)" }}>{sig}</span>
                    ))}
                  </div>
                ) : null}
                <div className="theme-ranking-bars">
                  <Bar label="信念" value={r.breakdown.conviction} max={40} />
                  <Bar label="連結" value={r.breakdown.connectivity} max={30} />
                  <Bar label="槓桿" value={r.breakdown.leverage} max={20} />
                  <Bar label="關鍵詞" value={r.breakdown.keywordRichness} max={10} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 下排：最新動態流 */}
      <h3 className="ascii-head">
        <span className="ascii-head-bracket">[04]</span>
        最新動態流 · LIVE FEED
      </h3>
      <section className="triple-panels">
        <LatestList title="最新訊號" items={snap?.latest.signals} linkBase="/signals" />
        <LatestList title="最新計畫" items={snap?.latest.plans} linkBase="/plans" />
        <LatestList title="最新檢討" items={snap?.latest.reviews} linkBase="/reviews" />
      </section>

      {/* 快速導航 */}
      <div className="quick-nav">
        <Link href="/themes" className="hero-link primary">主題戰區</Link>
        <Link href="/companies" className="hero-link">公司資料庫</Link>
        <Link href="/signals" className="hero-link">訊號雷達</Link>
        <Link href="/drafts" className="hero-link">草稿審核</Link>
        <Link href="/ops" className="hero-link">系統戰情</Link>
      </div>
    </AppShell>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone
}: {
  label: string;
  value?: number;
  sub?: string;
  tone?: "warn" | "bear" | "accent" | "dim";
}) {
  return (
    <div className="kpi-card">
      <div className={`kpi-value${tone ? ` ${tone}` : ""}`}>
        {value != null ? value : "—"}
      </div>
      <div className="kpi-label">{label}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="mini-stat">
      <div className="mini-stat-value" style={color ? { color } : undefined}>{value}</div>
      <div className="mini-stat-label">{label}</div>
    </div>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="theme-bar">
      <div className="theme-bar-row">
        <span className="theme-bar-label">{label}</span>
        <span className="theme-bar-value mono">{value}</span>
      </div>
      <div className="theme-bar-track">
        <div className="theme-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LatestList({ title, items, linkBase }: { title: string; items?: Array<{ id: string; label: string; subtitle?: string; timestamp: string }>; linkBase: string }) {
  return (
    <div className="panel">
      <p className="eyebrow">{title}</p>
      {!items ? (
        <p className="muted loading-text" style={{ fontSize: "var(--fs-sm)" }}>載入中...</p>
      ) : items.length === 0 ? (
        <p className="dim" style={{ fontSize: "var(--fs-sm)" }}>尚無資料</p>
      ) : (
        <div className="card-stack">
          {items.slice(0, 5).map((item) => (
            <Link key={item.id} href={linkBase} className="record-card" style={{ display: "block" }}>
              <div className="timeline-title">{item.label}</div>
              {item.subtitle ? <div className="timeline-sub">{item.subtitle}</div> : null}
              <div className="mono" style={{ fontSize: "var(--fs-xs)", color: "var(--dim)", marginTop: 2 }}>
                {new Date(item.timestamp).toLocaleString("zh-TW")}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
