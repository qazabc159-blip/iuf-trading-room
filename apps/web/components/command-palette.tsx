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

// ── 靜態頁面導航清單 ───────────────────────────────────────
const PAGE_ITEMS: Array<{ href: string; label: string; subtitle: string; keywords: string }> = [
  { href: "/", label: "總覽", subtitle: "首頁戰情儀表板", keywords: "總覽 首頁 dashboard 儀表板" },
  { href: "/themes", label: "主題戰區", subtitle: "主題排名與 graph", keywords: "主題 戰區 themes" },
  { href: "/companies", label: "公司資料庫", subtitle: "全部公司列表", keywords: "公司 資料庫 companies" },
  { href: "/signals", label: "訊號雷達", subtitle: "追蹤所有訊號", keywords: "訊號 雷達 signals" },
  { href: "/plans", label: "交易計畫", subtitle: "進行中與規劃中計畫", keywords: "計畫 交易 plans" },
  { href: "/reviews", label: "交易檢討", subtitle: "歷史結果回顧", keywords: "檢討 回顧 reviews" },
  { href: "/briefs", label: "每日簡報", subtitle: "Morning brief 彙整", keywords: "簡報 briefs daily" },
  { href: "/drafts", label: "草稿審核", subtitle: "OpenAlice 待審佇列", keywords: "草稿 審核 drafts openalice" },
  { href: "/ops", label: "系統戰情", subtitle: "活動趨勢 / 稽核", keywords: "戰情 系統 ops 稽核" },
  { href: "/companies/duplicates", label: "公司重複偵測", subtitle: "資料品質診斷", keywords: "重複 duplicates 診斷" }
];

type PageItem = (typeof PAGE_ITEMS)[number];
type ResultKind = "theme" | "company" | "page";

type FlatResult =
  | { kind: "theme"; key: string; item: ThemeGraphSearchResult }
  | { kind: "company"; key: string; item: CompanyGraphSearchResult }
  | { kind: "page"; key: string; item: PageItem };

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

  // 扁平化成一個 index list 供鍵盤導航
  const flatResults = useMemo<FlatResult[]>(() => {
    const flat: FlatResult[] = [];
    themeResults.forEach((t) => flat.push({ kind: "theme", key: `theme-${t.themeId}`, item: t }));
    companyResults.forEach((c) => flat.push({ kind: "company", key: `company-${c.companyId}`, item: c }));
    filteredPages.forEach((p) => flat.push({ kind: "page", key: `page-${p.href}`, item: p }));
    return flat;
  }, [themeResults, companyResults, filteredPages]);

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
