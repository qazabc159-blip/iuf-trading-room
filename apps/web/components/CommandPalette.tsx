"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  getCompanies,
  getStrategyIdeas,
  getThemes,
  listStrategyRuns,
} from "@/lib/api";
import type {
  Company,
  StrategyIdea,
  StrategyRunListItem,
  Theme,
} from "@iuf-trading-room/contracts";

type ItemGroup = "頁面" | "主題" | "公司" | "想法" | "批次" | "狀態";

type Item = {
  code: string;
  label: string;
  sub: string;
  href: string | null;
  group: ItemGroup;
};

type LoadState = "idle" | "loading" | "live" | "empty" | "blocked";

const ROUTES: Item[] = [
  { code: "01", label: "戰情台", sub: "大盤、觀察清單、重大訊息與策略總覽", href: "/", group: "頁面" },
  { code: "02", label: "主題板", sub: "台股主題、產業鏈與投資敘事", href: "/themes", group: "頁面" },
  { code: "03", label: "公司板", sub: "公司池、個股資料與 K 線", href: "/companies", group: "頁面" },
  { code: "04", label: "策略想法", sub: "由真實訊號與市場資料產生的紙上想法", href: "/ideas", group: "頁面" },
  { code: "05", label: "策略批次", sub: "策略批次紀錄與輸出", href: "/runs", group: "頁面" },
  { code: "06", label: "紙上交易", sub: "資金、部位、委託、成交與風控", href: "/portfolio", group: "頁面" },
  { code: "07", label: "訊號證據", sub: "訊號資料與證據紀錄", href: "/signals", group: "頁面" },
  { code: "08", label: "交易計畫", sub: "交易計畫與審核佇列", href: "/plans", group: "頁面" },
  { code: "09", label: "營運監控", sub: "系統狀態、稽核與工作流", href: "/ops", group: "頁面" },
  { code: "10", label: "重大訊息", sub: "公告、新聞線索與市場情報", href: "/market-intel", group: "頁面" },
];

function clip(value: string | null | undefined, max = 72) {
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function directionLabel(value: string) {
  if (value === "bullish") return "偏多";
  if (value === "bearish") return "偏空";
  if (value === "neutral") return "中性";
  return value;
}

function decisionModeLabel(value: string) {
  if (value === "paper") return "紙上";
  if (value === "live") return "實盤";
  if (value === "research") return "研究";
  return value;
}

function readinessLabel(value: string | null | undefined) {
  if (!value) return "未標示";
  if (value === "ready" || value === "allow") return "可用";
  if (value === "review") return "待審";
  if (value === "blocked") return "暫停";
  if (value === "stale") return "過期";
  if (value === "missing") return "缺資料";
  return value;
}

function sourceLabel(state: LoadState, loadedAt: string | null) {
  if (state === "live") return `正常 | ${loadedAt ?? "已載入"}`;
  if (state === "loading") return "讀取中 | 後端";
  if (state === "empty") return `無資料 | ${loadedAt ?? "已載入"}`;
  if (state === "blocked") return `暫停 | ${loadedAt ?? "已檢查"}`;
  return "待命";
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [ideas, setIdeas] = useState<StrategyIdea[]>([]);
  const [runs, setRuns] = useState<StrategyRunListItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;

    setActive(0);
    window.setTimeout(() => inputRef.current?.focus(), 30);

    let cancelled = false;
    setLoadState("loading");
    setLoadError(null);

    Promise.all([
      getThemes(),
      getCompanies(),
      getStrategyIdeas({
        decisionMode: "paper",
        includeBlocked: true,
        limit: 20,
        sort: "score",
      }),
      listStrategyRuns({
        decisionMode: "paper",
        limit: 20,
        sort: "created_at",
      }),
    ])
      .then(([themeRes, companyRes, ideaRes, runRes]) => {
        if (cancelled) return;
        setThemes(themeRes.data);
        setCompanies(companyRes.data);
        setIdeas(ideaRes.data.items);
        setRuns(runRes.data.items);
        setLoadedAt(new Date().toISOString());
        setLoadState(
          themeRes.data.length + companyRes.data.length + ideaRes.data.items.length + runRes.data.items.length > 0
            ? "live"
            : "empty"
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setThemes([]);
        setCompanies([]);
        setIdeas([]);
        setRuns([]);
        setLoadedAt(new Date().toISOString());
        setLoadError(error instanceof Error ? error.message : "指令面板資料讀取失敗");
        setLoadState("blocked");
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const stateItem: Item[] =
      loadState === "blocked"
        ? [
            {
              code: "暫停",
              label: "後端暫時無法讀取",
              sub: clip(loadError, 90),
              href: null,
              group: "狀態",
            },
          ]
        : loadState === "empty"
          ? [
              {
                code: "無資料",
                label: "目前沒有資料列",
                sub: "頁面仍可開啟；後端回傳可搜尋資料為零",
                href: null,
                group: "狀態",
              },
            ]
          : [];

    const all: Item[] = [
      ...stateItem,
      ...ROUTES,
      ...themes.map((theme) => ({
        code: `T${theme.priority}`,
        label: theme.name,
        sub: `${theme.marketState} | ${theme.lifecycle} | ${clip(theme.thesis, 56)}`,
        href: `/themes/${theme.slug}`,
        group: "主題" as const,
      })),
      ...companies.map((company) => ({
        code: company.ticker,
        label: company.name,
        sub: `${company.market} | ${company.beneficiaryTier} | ${clip(company.chainPosition, 56)}`,
        href: `/companies/${company.ticker}`,
        group: "公司" as const,
      })),
      ...ideas.map((idea) => ({
        code: idea.symbol,
        label: `${directionLabel(idea.direction)} | ${idea.score.toFixed(1)}`,
        sub: `${idea.companyName} | ${readinessLabel(idea.marketData.readiness)} | ${idea.rationale.primaryReason}`,
        href: `/companies/${idea.symbol}`,
        group: "想法" as const,
      })),
      ...runs.map((run) => ({
        code: run.id.slice(0, 8),
        label: `${decisionModeLabel(run.decisionMode)} | ${run.summary.total} 筆想法`,
        sub: `${run.topIdea?.symbol ?? "無主要想法"} | ${run.quality.primaryReason} | ${run.generatedAt}`,
        href: `/runs/${encodeURIComponent(run.id)}`,
        group: "批次" as const,
      })),
    ];

    if (!q.trim()) return all.slice(0, 48);
    const needle = q.trim().toLowerCase();
    return all
      .filter((item) =>
        item.code.toLowerCase().includes(needle) ||
        item.label.toLowerCase().includes(needle) ||
        item.sub.toLowerCase().includes(needle)
      )
      .slice(0, 48);
  }, [companies, ideas, loadError, loadState, q, runs, themes]);

  const go = useCallback((href: string | null) => {
    if (!href) return;
    setOpen(false);
    setQ("");
    router.push(href);
  }, [router]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="指令面板"
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(8,8,6,0.62)",
        backdropFilter: "blur(2px)",
        display: "grid",
        placeItems: "start center",
        paddingTop: "12vh",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(820px, calc(100vw - 28px))",
          border: "1px solid rgba(200,148,63,0.45)",
          background: "rgba(7,10,15,0.96)",
          boxShadow: "0 28px 90px rgba(0,0,0,0.58)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "13px 14px",
            borderBottom: "1px solid var(--night-rule)",
          }}
        >
          <span style={{ color: "var(--gold)", fontSize: 11, letterSpacing: "0.18em", fontWeight: 700 }}>
            指令
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((current) => Math.min(current + 1, Math.max(0, items.length - 1)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const item = items[active];
                if (item) go(item.href);
              }
            }}
            placeholder="搜尋頁面、主題、公司、策略想法與批次"
            style={{
              flex: 1,
              background: "transparent",
              border: 0,
              outline: "none",
              color: "var(--night-ink)",
              fontSize: 18,
              fontFamily: "var(--serif-tc)",
            }}
          />
          <span className="tg soft">{sourceLabel(loadState, loadedAt)}</span>
        </div>

        <div style={{ maxHeight: "56vh", overflowY: "auto" }}>
          {items.length === 0 && (
            <div style={{ padding: "20px 16px", color: "var(--night-soft)", fontSize: 12 }}>
              無資料 | 找不到符合條件的資料
            </div>
          )}
          {items.map((item, index) => {
            const selected = index === active;
            return (
              <button
                type="button"
                key={`${item.group}-${item.code}-${item.href ?? item.label}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(item.href)}
                style={{
                  width: "100%",
                  border: 0,
                  borderBottom: "1px solid rgba(49,60,72,0.42)",
                  background: selected ? "rgba(200,148,63,0.12)" : "transparent",
                  color: "var(--night-ink)",
                  display: "grid",
                  gridTemplateColumns: "74px 1fr 76px",
                  gap: 12,
                  alignItems: "center",
                  padding: "11px 14px",
                  textAlign: "left",
                  cursor: item.href ? "pointer" : "default",
                }}
              >
                <span className="tg gold">{item.code}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 700 }}>{item.label}</span>
                  <span className="tg soft" style={{ display: "block", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.sub}
                  </span>
                </span>
                <span className="tg soft" style={{ textAlign: "right" }}>{item.group}</span>
              </button>
            );
          })}
        </div>

        <div
          className="tg soft"
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderTop: "1px solid var(--night-rule)",
            letterSpacing: "0.14em",
          }}
        >
          <span>方向鍵選取</span>
          <span>確認鍵開啟</span>
          <span>Esc 關閉</span>
        </div>
      </div>
    </div>
  );
}
