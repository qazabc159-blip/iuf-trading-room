"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  getCompanies,
  getStrategyIdeas,
  getThemes,
  listStrategyRuns
} from "@/lib/api";
import type {
  Company,
  StrategyIdea,
  StrategyRunListItem,
  Theme
} from "@iuf-trading-room/contracts";

type ItemGroup = "ROUTE" | "THEME" | "COMPANY" | "IDEA" | "RUN" | "STATE";

type Item = {
  code: string;
  label: string;
  sub: string;
  href: string | null;
  group: ItemGroup;
};

type LoadState = "idle" | "loading" | "live" | "empty" | "blocked";

const ROUTES: Item[] = [
  { code: "01", label: "Dashboard", sub: "market, risk, and live desk overview", href: "/", group: "ROUTE" },
  { code: "02", label: "Themes", sub: "theme graph and investment narratives", href: "/themes", group: "ROUTE" },
  { code: "03", label: "Companies", sub: "company universe and detail panels", href: "/companies", group: "ROUTE" },
  { code: "04", label: "Ideas", sub: "strategy ideas from real signals and market data", href: "/ideas", group: "ROUTE" },
  { code: "05", label: "Runs", sub: "strategy run records and lineage", href: "/runs", group: "ROUTE" },
  { code: "06", label: "Portfolio", sub: "paper balance, positions, orders, fills, and risk", href: "/portfolio", group: "ROUTE" },
  { code: "07", label: "Signals", sub: "stored signal evidence", href: "/signals", group: "ROUTE" },
  { code: "08", label: "Plans", sub: "trade plans and review queue", href: "/plans", group: "ROUTE" },
  { code: "09", label: "Ops", sub: "production snapshot and audit logs", href: "/ops", group: "ROUTE" },
  { code: "10", label: "Market Intel", sub: "announcements and news-style evidence", href: "/market-intel", group: "ROUTE" }
];

function clip(value: string | null | undefined, max = 72) {
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
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
        sort: "score"
      }),
      listStrategyRuns({
        decisionMode: "paper",
        limit: 20,
        sort: "created_at"
      })
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
        setLoadError(error instanceof Error ? error.message : "command palette data request failed");
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
              code: "BLOCKED",
              label: "Backend unavailable",
              sub: clip(loadError, 90),
              href: null,
              group: "STATE"
            }
          ]
        : loadState === "empty"
          ? [
              {
                code: "EMPTY",
                label: "No live rows returned",
                sub: "routes still available; backend returned zero rows for searchable data",
                href: null,
                group: "STATE"
              }
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
        group: "THEME" as const
      })),
      ...companies.map((company) => ({
        code: company.ticker,
        label: company.name,
        sub: `${company.market} | ${company.beneficiaryTier} | ${clip(company.chainPosition, 56)}`,
        href: `/companies/${company.ticker}`,
        group: "COMPANY" as const
      })),
      ...ideas.map((idea) => ({
        code: idea.symbol,
        label: `${idea.direction.toUpperCase()} | ${idea.score.toFixed(1)}`,
        sub: `${idea.companyName} | ${idea.marketData.readiness} | ${idea.rationale.primaryReason}`,
        href: `/companies/${idea.symbol}`,
        group: "IDEA" as const
      })),
      ...runs.map((run) => ({
        code: run.id.slice(0, 8),
        label: `${run.decisionMode} | ${run.summary.total} ideas`,
        sub: `${run.topIdea?.symbol ?? "no top idea"} | ${run.quality.primaryReason} | ${run.generatedAt}`,
        href: `/runs/${encodeURIComponent(run.id)}`,
        group: "RUN" as const
      }))
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

  const sourceLabel =
    loadState === "live"
      ? `LIVE | ${loadedAt ?? "loaded"}`
      : loadState === "loading"
        ? "LOADING | backend"
        : loadState === "empty"
          ? `EMPTY | ${loadedAt ?? "loaded"}`
          : loadState === "blocked"
            ? `BLOCKED | ${loadedAt ?? "checked"}`
            : "IDLE";

  return (
    <div
      role="dialog"
      aria-label="Command palette"
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
        fontFamily: "var(--mono)"
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(720px, 92vw)",
          background: "var(--night-1)",
          border: "1px solid var(--night-rule-strong)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)"
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            padding: "12px 14px",
            borderBottom: "1px solid var(--night-rule-strong)"
          }}
        >
          <span style={{ color: "var(--gold)", fontSize: 11, letterSpacing: "0.18em", fontWeight: 700 }}>
            CMD
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
                setActive((current) => Math.min(current + 1, Math.max(items.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter") {
                const item = items[active];
                if (item) go(item.href);
              }
            }}
            placeholder="Search pages, themes, companies, ideas, and runs"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--night-ink)",
              fontFamily: "var(--serif)",
              fontSize: 16,
              fontStyle: "italic",
              fontWeight: 300
            }}
          />
          <span style={{ color: "var(--night-soft)", fontSize: 10, letterSpacing: "0.16em", whiteSpace: "nowrap" }}>
            {sourceLabel}
          </span>
        </div>

        <div style={{ maxHeight: "56vh", overflowY: "auto" }}>
          {items.length === 0 && (
            <div style={{ padding: "20px 16px", color: "var(--night-soft)", fontSize: 12 }}>
              EMPTY | no matching live rows
            </div>
          )}
          {items.map((item, index) => {
            const selected = index === active;
            const content = (
              <>
                <span style={{ color: "var(--night-soft)", fontSize: 9.5, letterSpacing: "0.14em" }}>
                  {item.group}
                </span>
                <span style={{ color: selected ? "var(--gold-bright)" : "var(--gold)", fontWeight: 700, fontSize: 11.5 }}>
                  {clip(item.code, 12)}
                </span>
                <span style={{ fontFamily: "var(--serif-tc)", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.sub}
                </span>
                <span style={{ color: "var(--night-soft)", fontSize: 10, letterSpacing: "0.12em", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.label}
                </span>
              </>
            );
            const rowStyle = {
              display: "grid",
              gridTemplateColumns: "82px 110px 1fr 86px",
              gap: 10,
              alignItems: "baseline",
              width: "100%",
              minHeight: 44,
              padding: "9px 14px",
              borderLeft: selected ? "2px solid var(--gold)" : "2px solid transparent",
              background: selected ? "rgba(184,138,62,0.08)" : "transparent",
              borderTop: "none",
              borderRight: "none",
              borderBottom: "1px solid var(--night-rule)",
              textAlign: "left" as const,
              color: selected ? "var(--night-ink)" : "var(--night-mid)"
            };

            if (!item.href) {
              return (
                <div
                  key={`${item.group}-${item.code}-${index}`}
                  role="note"
                  onMouseEnter={() => setActive(index)}
                  style={{ ...rowStyle, cursor: "default", opacity: 0.82 }}
                >
                  {content}
                </div>
              );
            }

            return (
              <button
                key={`${item.group}-${item.href}-${index}`}
                onClick={() => go(item.href)}
                onMouseEnter={() => setActive(index)}
                style={{ ...rowStyle, cursor: "pointer", opacity: 1 }}
              >
                {content}
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            gap: 16,
            padding: "8px 14px",
            borderTop: "1px solid var(--night-rule-strong)",
            color: "var(--night-soft)",
            fontSize: 10,
            letterSpacing: "0.14em"
          }}
        >
          <span>ARROWS NAV</span>
          <span>ENTER OPEN</span>
          <span>ESC CLOSE</span>
        </div>
      </div>
    </div>
  );
}
