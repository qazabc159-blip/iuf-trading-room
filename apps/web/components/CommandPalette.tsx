"use client";
/**
 * CommandPalette — ⌘K / Ctrl+K
 *
 * Full-page items source:
 *   • All 9 routes (with codes)
 *   • All themes (api.themes)
 *   • All companies (api.companies)
 *   • Recent ideas (api.ideas)        — jump to /companies/[symbol]
 *   • Recent runs (api.runs)          — jump to /runs/[id]
 *
 * Keyboard: ↑/↓ select · enter jump · esc close.
 * Visual: night-1 floor, gold left-rule on active, JetBrains Mono labels.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/radar-api";
import type { Theme, Company, Idea, Run } from "@/lib/radar-types";

type ItemGroup = "ROUTE" | "THEME" | "COMPANY" | "IDEA" | "RUN";
type Item = { code: string; label: string; sub: string; href: string; group: ItemGroup };

const ROUTES: Item[] = [
  { code: "01", label: "DASHBOARD", sub: "戰情台",     href: "/",          group: "ROUTE" },
  { code: "02", label: "THEMES",    sub: "主題板",     href: "/themes",    group: "ROUTE" },
  { code: "03", label: "COMPANIES", sub: "公司板",     href: "/companies", group: "ROUTE" },
  { code: "04", label: "IDEAS",     sub: "策略意見",   href: "/ideas",     group: "ROUTE" },
  { code: "05", label: "RUNS",      sub: "策略歷史",   href: "/runs",      group: "ROUTE" },
  { code: "06", label: "PORTFOLIO", sub: "下單台·EXEC", href: "/portfolio", group: "ROUTE" },
  { code: "07", label: "SIGNALS",   sub: "訊號",       href: "/signals",   group: "ROUTE" },
  { code: "08", label: "PLANS",     sub: "計畫",       href: "/plans",     group: "ROUTE" },
  { code: "09", label: "OPS",       sub: "戰情室",     href: "/ops",       group: "ROUTE" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  /* hot-key */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(o => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* lazy-load themes + companies on first open */
  useEffect(() => {
    if (!open) return;
    if (!themes.length) api.themes().then(setThemes).catch(() => {});
    if (!companies.length) api.companies().then(setCompanies).catch(() => {});
    if (!ideas.length) api.ideas().then(setIdeas).catch(() => {});
    if (!runs.length) api.runs().then(setRuns).catch(() => {});
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...ROUTES,
      ...themes.map(t => ({ code: t.code, label: t.code, sub: t.name, href: `/themes/${t.short}`, group: "THEME" as const })),
      ...companies.map(c => ({ code: c.symbol, label: c.symbol, sub: c.name, href: `/companies/${c.symbol}`, group: "COMPANY" as const })),
      ...ideas.map(i => ({
        code: i.id,
        label: `${i.symbol}·${i.side}`,
        sub: i.rationale.length > 32 ? i.rationale.slice(0, 32) + "…" : i.rationale,
        href: `/companies/${i.symbol}`,
        group: "IDEA" as const,
      })),
      ...runs.map(r => ({
        code: r.id,
        label: r.state,
        sub: `${r.source} · ${r.ideasEmitted} ideas · ${r.strategyVersion}`,
        href: `/runs/${encodeURIComponent(r.id)}`,
        group: "RUN" as const,
      })),
    ];
    if (!q.trim()) return all.slice(0, 40);
    const needle = q.trim().toLowerCase();
    return all.filter(i =>
      i.code.toLowerCase().includes(needle) ||
      i.label.toLowerCase().includes(needle) ||
      i.sub.toLowerCase().includes(needle),
    ).slice(0, 40);
  }, [q, themes, companies, ideas, runs]);

  const go = useCallback((href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  }, [router]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(8,8,6,0.62)", backdropFilter: "blur(2px)",
        display: "grid", placeItems: "start center", paddingTop: "12vh",
        fontFamily: "var(--mono)",
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(640px, 92vw)",
        background: "var(--night-1)",
        border: "1px solid var(--night-rule-strong)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
      }}>
        {/* input */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--night-rule-strong)" }}>
          <span style={{ color: "var(--gold)", fontSize: 11, letterSpacing: "0.18em", fontWeight: 700 }}>⌘K</span>
          <input
            ref={inputRef}
            value={q}
            onChange={e => { setQ(e.target.value); setActive(0); }}
            onKeyDown={e => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, items.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
              else if (e.key === "Enter") { const it = items[active]; if (it) go(it.href); }
            }}
            placeholder="搜尋路由 / 主題 / 公司 …"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "var(--night-ink)", fontFamily: "var(--serif)", fontSize: 16,
              fontStyle: "italic", fontWeight: 300,
            }}
          />
          <span style={{ color: "var(--night-soft)", fontSize: 10, letterSpacing: "0.18em" }}>
            {items.length} HITS
          </span>
        </div>
        {/* list */}
        <div style={{ maxHeight: "56vh", overflowY: "auto" }}>
          {items.length === 0 && (
            <div style={{ padding: "20px 16px", color: "var(--night-soft)", fontSize: 12 }}>無結果</div>
          )}
          {items.map((it, idx) => {
            const on = idx === active;
            return (
              <button
                key={`${it.group}-${it.href}`}
                onClick={() => go(it.href)}
                onMouseEnter={() => setActive(idx)}
                style={{
                  display: "grid", gridTemplateColumns: "60px 70px 1fr 80px", gap: 10,
                  alignItems: "baseline", width: "100%",
                  padding: "9px 14px",
                  borderLeft: on ? "2px solid var(--gold)" : "2px solid transparent",
                  background: on ? "rgba(184,138,62,0.08)" : "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--night-rule)",
                  textAlign: "left", cursor: "pointer",
                  color: on ? "var(--night-ink)" : "var(--night-mid)",
                }}
              >
                <span style={{ color: "var(--night-soft)", fontSize: 9.5, letterSpacing: "0.16em" }}>{it.group}</span>
                <span style={{ color: on ? "var(--gold-bright)" : "var(--gold)", fontWeight: 700, fontSize: 11.5 }}>{it.code}</span>
                <span style={{ fontFamily: "var(--serif-tc)", fontSize: 14 }}>{it.sub}</span>
                <span style={{ color: "var(--night-soft)", fontSize: 10, letterSpacing: "0.18em", textAlign: "right" }}>{it.label}</span>
              </button>
            );
          })}
        </div>
        {/* foot */}
        <div style={{ display: "flex", gap: 16, padding: "8px 14px", borderTop: "1px solid var(--night-rule-strong)", color: "var(--night-soft)", fontSize: 10, letterSpacing: "0.16em" }}>
          <span>↑↓ NAV</span><span>↵ JUMP</span><span>ESC CLOSE</span>
        </div>
      </div>
    </div>
  );
}
