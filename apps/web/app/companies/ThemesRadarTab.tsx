"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// API Types — /api/v1/themes/index response shape
// ---------------------------------------------------------------------------

type ThemeIndexItem = {
  token: string;
  companyCount: number;
  sample_tickers: string[];
};

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (typeof window !== "undefined" ? "" : "http://localhost:3001");

const WORKSPACE_SLUG =
  process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

async function fetchThemesIndex(limit = 50): Promise<ThemeIndexItem[]> {
  const res = await fetch(
    `${API_BASE}/api/v1/themes/index?limit=${limit}`,
    {
      credentials: "include",
      headers: { "x-workspace-slug": WORKSPACE_SLUG },
    }
  );
  if (!res.ok) {
    throw new Error(`themes/index ${res.status}`);
  }
  const json = (await res.json()) as { data: ThemeIndexItem[] };
  return Array.isArray(json.data) ? json.data : [];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type LoadState = "loading" | "ok" | "error" | "empty";

export function ThemesRadarTab() {
  const [themes, setThemes] = useState<ThemeIndexItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    fetchThemesIndex(50)
      .then((items) => {
        if (cancelled) return;
        if (items.length === 0) {
          setLoadState("empty");
        } else {
          setThemes(items);
          setLoadState("ok");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn("[ThemesRadarTab] themes/index 載入失敗", err);
        setLoadState("error");
      });
    return () => { cancelled = true; };
  }, []);

  // ── loading ──
  if (loadState === "loading") {
    return (
      <div style={containerStyle}>
        <SkeletonGrid />
        <p style={footerStyle}>讀取中...</p>
      </div>
    );
  }

  // ── error ──
  if (loadState === "error") {
    return (
      <div style={containerStyle}>
        <div style={stateBoxStyle}>
          <span style={{ fontSize: 28, opacity: 0.4 }}>◈</span>
          <p style={{ margin: "8px 0 0", color: "var(--night-mid)", fontSize: 13 }}>
            主題資料載入失敗
          </p>
          <p style={{ margin: "4px 0 0", color: "var(--night-soft)", fontSize: 11, fontFamily: "var(--mono)" }}>
            請稍後重新整理頁面
          </p>
        </div>
      </div>
    );
  }

  // ── empty ──
  if (loadState === "empty") {
    return (
      <div style={containerStyle}>
        <div style={stateBoxStyle}>
          <span style={{ fontSize: 28, opacity: 0.4 }}>◈</span>
          <p style={{ margin: "8px 0 0", color: "var(--night-mid)", fontSize: 13 }}>
            尚無主題資料
          </p>
        </div>
      </div>
    );
  }

  // ── ok ──
  return (
    <div style={containerStyle}>
      {/* Theme cards grid */}
      <div style={gridStyle}>
        {themes.map((theme) => (
          <ThemeCard key={theme.token} theme={theme} />
        ))}
      </div>

      <p style={footerStyle}>
        共 {themes.length} 個主題 token；點選跳轉至主題詳頁。
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theme card
// ---------------------------------------------------------------------------

function ThemeCard({ theme }: { theme: ThemeIndexItem }) {
  const tickers = theme.sample_tickers.slice(0, 3);

  return (
    <Link
      href={`/themes/wiki/${encodeURIComponent(theme.token)}`}
      style={cardBaseStyle}
    >
      {/* Token + company count */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--mono)",
            fontWeight: 800,
            fontSize: 15,
            color: "#5cc8ff",
            letterSpacing: 0,
          }}
        >
          {theme.token}
        </span>
        <span style={countBadgeStyle}>
          {theme.companyCount} 檔
        </span>
      </div>

      {/* Sample tickers */}
      {tickers.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
          {tickers.map((ticker) => (
            <span key={ticker} style={tickerChipStyle}>
              {ticker}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loading grid
// ---------------------------------------------------------------------------

function SkeletonGrid() {
  return (
    <div style={gridStyle}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder order is stable
          key={i}
          style={{
            border: "1px solid rgba(220,228,240,0.08)",
            borderRadius: 8,
            background: "rgba(255,255,255,0.02)",
            padding: "14px 15px",
            minHeight: 72,
            animation: "pulse 1.4s ease-in-out infinite",
          }}
        />
      ))}
      <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.8} }`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  padding: "0 16px 24px",
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 12,
};

const cardBaseStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  border: "1px solid rgba(92,200,255,0.25)",
  borderRadius: 8,
  background: "rgba(92,200,255,0.04)",
  padding: "14px 15px",
  textDecoration: "none",
  gap: 4,
  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
};

const countBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "var(--mono)",
  color: "var(--night-soft)",
  background: "rgba(220,228,240,0.07)",
  border: "1px solid rgba(220,228,240,0.1)",
  borderRadius: 999,
  padding: "2px 7px",
  whiteSpace: "nowrap",
};

const tickerChipStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "var(--mono)",
  color: "var(--night-mid)",
  background: "rgba(220,228,240,0.06)",
  border: "1px solid rgba(220,228,240,0.1)",
  borderRadius: 4,
  padding: "1px 5px",
};

const footerStyle: React.CSSProperties = {
  marginTop: 20,
  fontSize: 11,
  color: "var(--night-soft)",
  fontFamily: "var(--mono)",
};

const stateBoxStyle: React.CSSProperties = {
  padding: "48px 24px",
  textAlign: "center",
};
