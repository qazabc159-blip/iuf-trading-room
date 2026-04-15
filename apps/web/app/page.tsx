"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { getOpsSnapshot, type OpsSnapshotData } from "@/lib/api";

export default function HomePage() {
  const [snap, setSnap] = useState<OpsSnapshotData | null>(null);

  useEffect(() => {
    getOpsSnapshot().then((r) => setSnap(r.data)).catch(() => {});
  }, []);

  const s = snap?.stats;
  const oa = snap?.openAlice;
  const audit = snap?.audit;

  return (
    <AppShell eyebrow="今日作戰總覽" title="台股 AI 交易戰情室">
      {/* 上排：關鍵指標 */}
      <section className="dashboard-grid" style={{ marginBottom: 14 }}>
        <StatCard label="主題戰區" value={s?.themes} />
        <StatCard label="公司資料庫" value={s?.companies} sub={s ? `核心 ${s.coreCompanies} / 直接 ${s.directCompanies}` : undefined} />
        <StatCard label="活躍訊號" value={s?.signals} sub={s ? `看多 ${s.bullishSignals}` : undefined} color="var(--bull)" />
        <StatCard label="交易計畫" value={s?.plans} sub={s ? `執行中 ${s.activePlans}` : undefined} />
        <StatCard label="待審草稿" value={s?.reviewQueue} color={s && s.reviewQueue > 0 ? "var(--warn)" : undefined} />
        <StatCard label="已發布簡報" value={s?.publishedBriefs} />
      </section>

      {/* 中排：OpenAlice + 稽核 */}
      <section className="dashboard-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
        <div className="panel">
          <p className="eyebrow">OpenAlice 代理狀態</p>
          {oa ? (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
              <MiniStat label="Worker" value={oa.observability.workerStatus} color={oa.observability.workerStatus === "healthy" ? "var(--bull)" : "var(--bear)"} />
              <MiniStat label="排程" value={oa.observability.sweepStatus} color={oa.observability.sweepStatus === "healthy" ? "var(--bull)" : "var(--bear)"} />
              <MiniStat label="佇列" value={String(oa.queue.queued)} />
              <MiniStat label="執行中" value={String(oa.queue.running)} />
              <MiniStat label="待審" value={String(oa.queue.reviewable)} color={oa.queue.reviewable > 0 ? "var(--warn)" : undefined} />
              <MiniStat label="失敗" value={String(oa.queue.failed)} color={oa.queue.failed > 0 ? "var(--bear)" : undefined} />
            </div>
          ) : (
            <p className="muted" style={{ fontSize: "0.8rem" }}>載入中...</p>
          )}
        </div>

        <div className="panel">
          <p className="eyebrow">稽核紀錄（{audit?.windowHours ?? 24}h）</p>
          {audit ? (
            <div style={{ marginTop: 8 }}>
              <p style={{ fontSize: "0.85rem" }}>
                共 <strong className="mono">{audit.total}</strong> 筆操作
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                {audit.actions.slice(0, 6).map((a) => (
                  <span key={a.action} className="badge" style={{ fontSize: "0.7rem" }}>
                    {a.action} ×{a.count}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: "0.8rem" }}>載入中...</p>
          )}
        </div>
      </section>

      {/* 下排：最新動態流 */}
      <section className="dashboard-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <LatestList title="最新訊號" items={snap?.latest.signals} linkBase="/signals" />
        <LatestList title="最新計畫" items={snap?.latest.plans} linkBase="/plans" />
        <LatestList title="最新檢討" items={snap?.latest.reviews} linkBase="/reviews" />
      </section>

      {/* 快速導航 */}
      <div className="action-row" style={{ marginTop: 18 }}>
        <Link href="/themes" className="hero-link primary">主題戰區</Link>
        <Link href="/companies" className="hero-link">公司資料庫</Link>
        <Link href="/signals" className="hero-link">訊號雷達</Link>
        <Link href="/drafts" className="hero-link">草稿審核</Link>
        <Link href="/ops" className="hero-link">系統戰情</Link>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value?: number; sub?: string; color?: string }) {
  return (
    <div className="panel" style={{ textAlign: "center", padding: "14px 10px" }}>
      <div className="big-num" style={{ color: color ?? "var(--text)" }}>
        {value != null ? value : "—"}
      </div>
      <div style={{ fontSize: "0.72rem", color: "var(--dim)", marginTop: 4 }}>{label}</div>
      {sub ? <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div className="mono" style={{ fontSize: "0.9rem", fontWeight: 700, color: color ?? "var(--text)" }}>{value}</div>
      <div style={{ fontSize: "0.62rem", color: "var(--dim)" }}>{label}</div>
    </div>
  );
}

function LatestList({ title, items, linkBase }: { title: string; items?: Array<{ id: string; label: string; subtitle?: string; timestamp: string }>; linkBase: string }) {
  return (
    <div className="panel">
      <p className="eyebrow">{title}</p>
      {!items ? (
        <p className="muted" style={{ fontSize: "0.8rem" }}>載入中...</p>
      ) : items.length === 0 ? (
        <p className="dim" style={{ fontSize: "0.8rem" }}>尚無資料</p>
      ) : (
        <div className="card-stack">
          {items.slice(0, 5).map((item) => (
            <Link key={item.id} href={linkBase} className="record-card" style={{ display: "block", padding: "8px 10px" }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.label}
              </div>
              {item.subtitle ? (
                <div style={{ fontSize: "0.65rem", color: "var(--dim)", marginTop: 2 }}>{item.subtitle}</div>
              ) : null}
              <div className="mono" style={{ fontSize: "0.6rem", color: "var(--dim)", marginTop: 2 }}>
                {new Date(item.timestamp).toLocaleString("zh-TW")}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
