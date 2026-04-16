"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getCompanyGraphStats,
  getOpsSnapshot,
  getThemeGraphStats,
  type OpsSnapshotData
} from "@/lib/api";
import type { CompanyGraphStats, ThemeGraphStatsView } from "@iuf-trading-room/contracts";

type TickerItem = {
  label: string;
  value: string;
  tone?: "phosphor" | "amber" | "bear" | "dim";
};

const REFRESH_MS = 30_000;

export function TickerTape() {
  const [ops, setOps] = useState<OpsSnapshotData | null>(null);
  const [themes, setThemes] = useState<ThemeGraphStatsView | null>(null);
  const [companies, setCompanies] = useState<CompanyGraphStats | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      Promise.allSettled([
        getOpsSnapshot({ auditHours: 24, recentLimit: 3 }),
        getThemeGraphStats({ limit: 5 }),
        getCompanyGraphStats()
      ]).then(([opsRes, themeRes, companyRes]) => {
        if (cancelled) return;
        if (opsRes.status === "fulfilled") setOps(opsRes.value.data);
        if (themeRes.status === "fulfilled") setThemes(themeRes.value.data);
        if (companyRes.status === "fulfilled") setCompanies(companyRes.value.data);
      });
    };
    load();
    const id = setInterval(() => {
      load();
      setTick((t) => t + 1);
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const items = useMemo<TickerItem[]>(() => {
    const out: TickerItem[] = [];

    if (ops) {
      out.push({ label: "主題", value: String(ops.stats.themes) });
      out.push({ label: "公司", value: String(ops.stats.companies) });
      out.push({
        label: "進行中計畫",
        value: String(ops.stats.activePlans),
        tone: ops.stats.activePlans > 0 ? "amber" : "dim"
      });
      out.push({
        label: "看多訊號",
        value: String(ops.stats.bullishSignals),
        tone: "phosphor"
      });
      out.push({
        label: "待審佇列",
        value: String(ops.openAlice.queue.reviewable),
        tone: ops.openAlice.queue.reviewable > 0 ? "amber" : "dim"
      });
      out.push({
        label: "失敗任務",
        value: String(ops.openAlice.queue.failed),
        tone: ops.openAlice.queue.failed > 0 ? "bear" : "dim"
      });

      const worker = ops.openAlice.observability.workerStatus;
      out.push({
        label: "Worker",
        value: worker === "healthy" ? "HEALTHY" : worker === "stale" ? "STALE" : "MISSING",
        tone: worker === "healthy" ? "phosphor" : worker === "stale" ? "amber" : "bear"
      });

      out.push({
        label: "近 24h 事件",
        value: String(ops.audit.total),
        tone: "phosphor"
      });
    }

    if (themes && themes.topThemes.length > 0) {
      themes.topThemes.slice(0, 5).forEach((t) => {
        out.push({
          label: t.marketState,
          value: `${t.name} ▸ ${t.themeCompanyCount + t.relatedCompanyCount}`,
          tone: "phosphor"
        });
      });
    }

    if (companies && companies.topConnectedCompanies.length > 0) {
      companies.topConnectedCompanies.slice(0, 5).forEach((c) => {
        out.push({
          label: c.ticker,
          value: `${c.name} ${c.relationCount}↔${c.keywordCount}`,
          tone: "amber"
        });
      });
    }

    if (out.length === 0) {
      out.push({ label: "系統", value: "IUF TRADING ROOM — 資料載入中", tone: "dim" });
    }

    return out;
  }, [ops, themes, companies]);

  // 為了做無縫循環，把 items 複製一份串在後面
  const doubled = useMemo(() => [...items, ...items], [items]);

  return (
    <div className="ticker-tape" aria-label="即時戰情跑馬燈">
      <div className="ticker-track" key={`track-${tick}-${items.length}`}>
        {doubled.map((item, idx) => (
          <span className="ticker-item" key={`${item.label}-${idx}`}>
            <span className="ticker-label">{item.label}</span>
            <span className={`ticker-value${item.tone && item.tone !== "phosphor" ? ` ${item.tone}` : ""}`}>
              {item.value}
            </span>
            <span className="ticker-sep">│</span>
          </span>
        ))}
      </div>
    </div>
  );
}
