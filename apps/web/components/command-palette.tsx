"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  searchCompanyGraph,
  searchThemeGraph
} from "@/lib/api";
import type {
  CompanyGraphSearchResult,
  ThemeGraphSearchResult
} from "@iuf-trading-room/contracts";

// ── W4: iuf:timezone / iuf:interval custom event dispatch ─────
function dispatchTimezone(tz: string) {
  window.dispatchEvent(new CustomEvent("iuf:timezone", { detail: { tz } }));
}
function dispatchInterval(iv: string) {
  window.dispatchEvent(new CustomEvent("iuf:interval", { detail: { iv } }));
}

// ── W4: ACTION items (tz × 3 + iv × 8) ───────────────────────
type ActionItem = { kind: "action"; key: string; label: string; subtitle: string; action: string };

const ACTION_ITEMS: ActionItem[] = [
  { kind: "action", key: "tz-tst", label: "切時區 → TST", subtitle: "Asia/Taipei (UTC+8) · 台灣標準時間", action: "tz:Asia/Taipei" },
  { kind: "action", key: "tz-utc", label: "切時區 → UTC", subtitle: "協調世界時間", action: "tz:UTC" },
  { kind: "action", key: "tz-et",  label: "切時區 → ET",  subtitle: "America/New_York · 美東時間", action: "tz:America/New_York" },
  { kind: "action", key: "iv-1m",  label: "切週期 → 1m",  subtitle: "1分鐘K線", action: "iv:1m" },
  { kind: "action", key: "iv-5m",  label: "切週期 → 5m",  subtitle: "5分鐘K線", action: "iv:5m" },
  { kind: "action", key: "iv-15m", label: "切週期 → 15m", subtitle: "15分鐘K線", action: "iv:15m" },
  { kind: "action", key: "iv-1h",  label: "切週期 → 1h",  subtitle: "1小時K線", action: "iv:1h" },
  { kind: "action", key: "iv-4h",  label: "切週期 → 4h",  subtitle: "4小時K線", action: "iv:4h" },
  { kind: "action", key: "iv-D",   label: "切週期 → 日線", subtitle: "日線 (D)", action: "iv:D" },
  { kind: "action", key: "iv-W",   label: "切週期 → 週線", subtitle: "週線 (W)", action: "iv:W" },
  { kind: "action", key: "iv-M",   label: "切週期 → 月線", subtitle: "月線 (M)", action: "iv:M" },
];

// ── 靜態頁面導航清單 ───────────────────────────────────────
const PAGE_ITEMS: Array<{ href: string; label: string; subtitle: string; keywords: string }> = [
  { href: "/", label: "總覽", subtitle: "首頁戰情儀表板", keywords: "總覽 首頁 dashboard 儀表板" },
  { href: "/themes", label: "主題戰區", subtitle: "主題排名與 graph", keywords: "主題 戰區 themes" },
  { href: "/companies", label: "公司資料庫", subtitle: "全部公司列表", keywords: "公司 資料庫 companies" },
  { href: "/signals", label: "訊號雷達", subtitle: "追蹤所有訊號", keywords: "訊號 雷達 signals" },
  { href: "/ideas", label: "策略推薦", subtitle: "品質分級即時推薦", keywords: "策略 推薦 ideas strategy" },
  { href: "/runs", label: "策略歷史", subtitle: "歷史策略 run 快照", keywords: "歷史 runs strategy runs 快照 snapshot" },
  { href: "/plans", label: "交易計畫", subtitle: "進行中與規劃中計畫", keywords: "計畫 交易 plans" },
  { href: "/portfolio", label: "持倉部位", subtitle: "帳戶 / 部位 / 風控 / kill switch", keywords: "持倉 部位 portfolio 帳戶 風控 broker 凱基 kill switch" },
  { href: "/reviews", label: "交易檢討", subtitle: "歷史結果回顧", keywords: "檢討 回顧 reviews" },
  { href: "/briefs", label: "每日簡報", subtitle: "Morning brief 彙整", keywords: "簡報 briefs daily" },
  { href: "/drafts", label: "草稿審核", subtitle: "OpenAlice 待審佇列", keywords: "草稿 審核 drafts openalice" },
  { href: "/ops", label: "系統戰情", subtitle: "活動趨勢 / 稽核", keywords: "戰情 系統 ops 稽核" },
  { href: "/companies/duplicates", label: "公司重複偵測", subtitle: "資料品質診斷", keywords: "重複 duplicates 診斷" }
];

type PageItem = (typeof PAGE_ITEMS)[number];
type ResultKind = "action" | "theme" | "company" | "page";

type FlatResult =
  | { kind: "action";   key: string; item: ActionItem }
  | { kind: "theme";   key: string; item: ThemeGraphSearchResult }
  | { kind: "company"; key: string; item: CompanyGraphSearchResult }
  | { kind: "page";    key: string; item: PageItem };

const DEBOUNCE_MS = 200;

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [themeResults, setThemeResults] = useState<ThemeGraphSearchResult[]>([]);
  const [companyResults, setCompanyResults] = useState<CompanyGraphSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);

  // 全域快捷鍵監聽
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const hotkey = (isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === "k";
      if (hotkey) {
        event.preventDefault();
        setOpen((prev) => !prev);
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // 開啟時聚焦、關閉時清狀態
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      // 下一個 frame 聚焦，確保 modal 已掛載
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setDebouncedQuery("");
      setThemeResults([]);
      setCompanyResults([]);
      setLoading(false);
    }
  }, [open]);

  // debounce
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, open]);

  // 抓搜尋結果
  useEffect(() => {
    if (!open) return;
    if (debouncedQuery.length < 1) {
      setThemeResults([]);
      setCompanyResults([]);
      setLoading(false);
      return;
    }
    const rid = ++requestIdRef.current;
    setLoading(true);
    Promise.allSettled([
      searchThemeGraph({ query: debouncedQuery, limit: 8 }),
      searchCompanyGraph({ query: debouncedQuery, limit: 8 })
    ]).then((results) => {
      if (rid !== requestIdRef.current) return;
      const [themeRes, companyRes] = results;
      setThemeResults(themeRes.status === "fulfilled" ? themeRes.value.data.results : []);
      setCompanyResults(companyRes.status === "fulfilled" ? companyRes.value.data : []);
      setLoading(false);
    });
  }, [debouncedQuery, open]);

  // 頁面過濾：有輸入才用 keyword match；沒輸入顯示全部
  const filteredPages = useMemo<PageItem[]>(() => {
    const q = debouncedQuery.toLowerCase();
    if (!q) return PAGE_ITEMS;
    return PAGE_ITEMS.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.subtitle.toLowerCase().includes(q) ||
        p.keywords.toLowerCase().includes(q) ||
        p.href.toLowerCase().includes(q)
    );
  }, [debouncedQuery]);

  // 過濾 ACTION items
  const filteredActions = useMemo<ActionItem[]>(() => {
    const q = debouncedQuery.toLowerCase();
    if (!q) return ACTION_ITEMS;
    return ACTION_ITEMS.filter(a => a.label.toLowerCase().includes(q) || a.subtitle.toLowerCase().includes(q) || a.action.toLowerCase().includes(q));
  }, [debouncedQuery]);

  // 扁平化成一個 index list 供鍵盤導航
  const flatResults = useMemo<FlatResult[]>(() => {
    const flat: FlatResult[] = [];
    filteredActions.forEach((a) => flat.push({ kind: "action", key: a.key, item: a }));
    themeResults.forEach((t) => flat.push({ kind: "theme", key: `theme-${t.themeId}`, item: t }));
    companyResults.forEach((c) => flat.push({ kind: "company", key: `company-${c.companyId}`, item: c }));
    filteredPages.forEach((p) => flat.push({ kind: "page", key: `page-${p.href}`, item: p }));
    return flat;
  }, [filteredActions, themeResults, companyResults, filteredPages]);

  // activeIndex clamp
  useEffect(() => {
    if (activeIndex >= flatResults.length) {
      setActiveIndex(Math.max(0, flatResults.length - 1));
    }
  }, [flatResults.length, activeIndex]);

  // 滾動 active 進入視窗
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-cmdk-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const commit = useCallback(
    (result: FlatResult) => {
      if (result.kind === "action") {
        const action = result.item.action;
        if (action.startsWith("tz:")) dispatchTimezone(action.slice(3));
        else if (action.startsWith("iv:")) dispatchInterval(action.slice(3));
        setOpen(false);
        return;
      }
      setOpen(false);
      if (result.kind === "theme") {
        router.push("/themes");
      } else if (result.kind === "company") {
        router.push("/companies");
      } else {
        router.push(result.item.href);
      }
    },
    [router]
  );

  const handleInputKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(flatResults.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = flatResults[activeIndex];
      if (target) commit(target);
    }
  };

  if (!open) return null;

  let runningIndex = 0;
  const actionStart = runningIndex;
  runningIndex += filteredActions.length;
  const themeStart = runningIndex;
  runningIndex += themeResults.length;
  const companyStart = runningIndex;
  runningIndex += companyResults.length;
  const pageStart = runningIndex;

  return (
    <div className="cmdk-overlay" role="dialog" aria-modal="true" onMouseDown={() => setOpen(false)}>
      <div className="cmdk-modal" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          type="text"
          placeholder="搜尋主題、公司、頁面… (⌘K / Ctrl+K)"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKey}
          spellCheck={false}
          autoComplete="off"
        />

        <div className="cmdk-list" ref={listRef}>
          {loading && <div className="cmdk-status">搜尋中…</div>}

          {!loading && flatResults.length === 0 && (
            <div className="cmdk-status">
              {debouncedQuery ? `找不到「${debouncedQuery}」相關結果` : "輸入關鍵字開始搜尋"}
            </div>
          )}

          {filteredActions.length > 0 && (
            <div className="cmdk-group">
              <div className="cmdk-group-title">指令 ({filteredActions.length})</div>
              {filteredActions.map((a, idx) => {
                const index = actionStart + idx;
                return (
                  <div
                    key={a.key}
                    className={`cmdk-item${activeIndex === index ? " active" : ""}`}
                    data-cmdk-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit({ kind: "action", key: a.key, item: a })}
                  >
                    <div className="cmdk-item-label" style={{ fontWeight: 600 }}>{a.label}</div>
                    <div className="cmdk-item-meta"><span>{a.subtitle}</span></div>
                  </div>
                );
              })}
            </div>
          )}

          {themeResults.length > 0 && (
            <div className="cmdk-group">
              <div className="cmdk-group-title">主題 ({themeResults.length})</div>
              {themeResults.map((t, idx) => {
                const index = themeStart + idx;
                return (
                  <div
                    key={`theme-${t.themeId}`}
                    className={`cmdk-item${activeIndex === index ? " active" : ""}`}
                    data-cmdk-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit({ kind: "theme", key: `theme-${t.themeId}`, item: t })}
                  >
                    <div className="cmdk-item-label">{t.name}</div>
                    <div className="cmdk-item-meta">
                      <span>{t.marketState}</span>
                      <span>·</span>
                      <span>{t.lifecycle}</span>
                      <span>·</span>
                      <span>分數 {t.score}</span>
                      <span>·</span>
                      <span>{t.matchedCompanies} 家公司</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {companyResults.length > 0 && (
            <div className="cmdk-group">
              <div className="cmdk-group-title">公司 ({companyResults.length})</div>
              {companyResults.map((c, idx) => {
                const index = companyStart + idx;
                return (
                  <div
                    key={`company-${c.companyId}`}
                    className={`cmdk-item${activeIndex === index ? " active" : ""}`}
                    data-cmdk-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit({ kind: "company", key: `company-${c.companyId}`, item: c })}
                  >
                    <div className="cmdk-item-label">
                      <span className="cmdk-ticker">{c.ticker}</span>
                      {c.name}
                    </div>
                    <div className="cmdk-item-meta">
                      <span>{c.market}</span>
                      <span>·</span>
                      <span>{c.chainPosition}</span>
                      <span>·</span>
                      <span>{c.relationCount} 關聯</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filteredPages.length > 0 && (
            <div className="cmdk-group">
              <div className="cmdk-group-title">頁面 ({filteredPages.length})</div>
              {filteredPages.map((p, idx) => {
                const index = pageStart + idx;
                return (
                  <div
                    key={`page-${p.href}`}
                    className={`cmdk-item${activeIndex === index ? " active" : ""}`}
                    data-cmdk-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit({ kind: "page", key: `page-${p.href}`, item: p })}
                  >
                    <div className="cmdk-item-label">{p.label}</div>
                    <div className="cmdk-item-meta">
                      <span>{p.subtitle}</span>
                      <span>·</span>
                      <span className="cmdk-path">{p.href}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="cmdk-footer">
          <span>↑↓ 選擇</span>
          <span>Enter 跳轉</span>
          <span>Esc 關閉</span>
        </div>
      </div>
    </div>
  );
}
