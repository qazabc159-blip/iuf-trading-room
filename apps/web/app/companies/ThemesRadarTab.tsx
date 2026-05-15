"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Hardcoded popular themes list v1
// Jason v2 will add GET /api/v1/themes/index endpoint
// ---------------------------------------------------------------------------

type ThemeEntry = {
  token: string;
  label: string;
  description: string;
  category: string;
};

const POPULAR_THEMES: ThemeEntry[] = [
  { token: "CoWoS", label: "CoWoS", description: "台積電先進封裝需求鏈", category: "先進封裝" },
  { token: "HBM", label: "HBM", description: "高頻寬記憶體 AI 用量", category: "記憶體" },
  { token: "EUV", label: "EUV", description: "極紫外光微影設備供應鏈", category: "設備" },
  { token: "AI伺服器", label: "AI 伺服器", description: "AI 訓練推論伺服器需求鏈", category: "AI基礎建設" },
  { token: "光阻液", label: "光阻液", description: "半導體光阻材料供應商", category: "材料" },
  { token: "散熱", label: "散熱", description: "AI GPU 熱管理解決方案", category: "AI基礎建設" },
  { token: "銅箔基板", label: "銅箔基板", description: "ABF 載板及 CCL 供應鏈", category: "基板" },
  { token: "矽光子", label: "矽光子", description: "光電共封裝相關技術鏈", category: "先進封裝" },
  { token: "液冷", label: "液冷", description: "資料中心液冷散熱方案", category: "AI基礎建設" },
  { token: "化合物半導體", label: "化合物半導體", description: "SiC/GaN 功率元件供應鏈", category: "材料" },
  { token: "2nm", label: "2nm 製程", description: "台積電 N2 製程相關供應商", category: "先進製程" },
  { token: "Blackwell", label: "Blackwell", description: "NVIDIA Blackwell GPU 供應鏈", category: "AI基礎建設" },
];

const CATEGORIES = [...new Set(POPULAR_THEMES.map((t) => t.category))];

const CATEGORY_COLORS: Record<string, { border: string; bg: string; label: string }> = {
  先進封裝: { border: "rgba(92,200,255,0.35)", bg: "rgba(92,200,255,0.07)", label: "#5cc8ff" },
  記憶體: { border: "rgba(226,184,92,0.35)", bg: "rgba(226,184,92,0.07)", label: "#e2b85c" },
  設備: { border: "rgba(88,214,141,0.35)", bg: "rgba(88,214,141,0.07)", label: "#58d68d" },
  AI基礎建設: { border: "rgba(200,148,63,0.35)", bg: "rgba(200,148,63,0.07)", label: "#c8943f" },
  材料: { border: "rgba(180,130,220,0.35)", bg: "rgba(180,130,220,0.07)", label: "#b482dc" },
  基板: { border: "rgba(240,180,90,0.35)", bg: "rgba(240,180,90,0.07)", label: "#f0b45a" },
  先進製程: { border: "rgba(92,200,255,0.3)", bg: "rgba(92,200,255,0.06)", label: "#5cc8ff" },
};

function getCategoryStyle(category: string) {
  return (
    CATEGORY_COLORS[category] ?? {
      border: "rgba(220,228,240,0.2)",
      bg: "rgba(220,228,240,0.04)",
      label: "#9aa8b6",
    }
  );
}

// ---------------------------------------------------------------------------
// Per-theme company count fetch (optional enrichment)
// ---------------------------------------------------------------------------

type ThemeCount = { token: string; count: number | null };

async function fetchThemeCount(token: string): Promise<ThemeCount> {
  const API_BASE =
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    (typeof window !== "undefined" ? "" : "http://localhost:3001");
  const WORKSPACE_SLUG =
    process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

  try {
    const res = await fetch(
      `${API_BASE}/api/v1/themes/${encodeURIComponent(token)}/companies`,
      {
        credentials: "include",
        headers: { "x-workspace-slug": WORKSPACE_SLUG },
      }
    );
    if (!res.ok) return { token, count: null };
    const json = (await res.json()) as { count?: number };
    return { token, count: typeof json.count === "number" ? json.count : null };
  } catch {
    return { token, count: null };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ThemesRadarTab() {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [filterCat, setFilterCat] = useState<string>("");

  useEffect(() => {
    // Fetch company counts for each theme in the background
    for (const theme of POPULAR_THEMES) {
      fetchThemeCount(theme.token).then(({ token, count }) => {
        setCounts((prev) => ({ ...prev, [token]: count }));
      });
    }
  }, []);

  const filtered = filterCat
    ? POPULAR_THEMES.filter((t) => t.category === filterCat)
    : POPULAR_THEMES;

  return (
    <div style={{ padding: "0 16px 24px" }}>
      {/* Category filter */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => setFilterCat("")}
          style={catBtnStyle(filterCat === "")}
        >
          全部
        </button>
        {CATEGORIES.map((cat) => (
          <button
            type="button"
            key={cat}
            onClick={() => setFilterCat(cat)}
            style={catBtnStyle(filterCat === cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Theme cards grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {filtered.map((theme) => {
          const cs = getCategoryStyle(theme.category);
          const count = counts[theme.token];

          return (
            <Link
              key={theme.token}
              href={`/themes/wiki/${encodeURIComponent(theme.token)}`}
              style={{
                display: "flex",
                flexDirection: "column",
                border: `1px solid ${cs.border}`,
                borderRadius: 8,
                background: cs.bg,
                padding: "14px 15px",
                textDecoration: "none",
                gap: 6,
                transition: "border-color 0.15s ease, box-shadow 0.15s ease",
              }}
            >
              {/* Token + count */}
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
                    color: cs.label,
                    letterSpacing: 0,
                  }}
                >
                  {theme.label}
                </span>
                {count !== null && count !== undefined ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--mono)",
                      color: "var(--night-soft)",
                      background: "rgba(220,228,240,0.07)",
                      border: "1px solid rgba(220,228,240,0.1)",
                      borderRadius: 999,
                      padding: "2px 7px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {count} 檔
                  </span>
                ) : null}
              </div>

              {/* Description */}
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: "var(--night-mid)",
                  lineHeight: 1.5,
                }}
              >
                {theme.description}
              </p>

              {/* Category badge */}
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "var(--mono)",
                  color: cs.label,
                  opacity: 0.75,
                }}
              >
                {theme.category}
              </span>
            </Link>
          );
        })}
      </div>

      <p
        style={{
          marginTop: 20,
          fontSize: 11,
          color: "var(--night-soft)",
          fontFamily: "var(--mono)",
        }}
      >
        v1 顯示 {POPULAR_THEMES.length} 個熱門主題 token；點選跳轉至主題詳頁。Jason v2 加 /themes/index 全列表。
      </p>
    </div>
  );
}

function catBtnStyle(active: boolean): React.CSSProperties {
  return {
    minHeight: 30,
    border: active
      ? "1px solid rgba(200,148,63,0.55)"
      : "1px solid rgba(220,228,240,0.12)",
    borderRadius: 6,
    background: active ? "rgba(200,148,63,0.13)" : "rgba(255,255,255,0.03)",
    color: active ? "#e2b85c" : "var(--night-mid)",
    fontFamily: "var(--mono)",
    fontSize: 11,
    fontWeight: 700,
    padding: "4px 11px",
    cursor: "pointer",
    transition: "border-color 0.12s ease",
  };
}
