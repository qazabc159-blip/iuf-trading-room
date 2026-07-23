/**
 * rec-card-shared.ts
 * ────────────────────
 * Pure, framework-agnostic pieces of StockRecCard.tsx pulled out into a
 * plain module. StockRecCard.tsx is `"use client"` (it needs useState for
 * the watchlist button) — a Server Component cannot directly *call* a
 * function exported from a client-boundary file (only render it as JSX),
 * so MorningBriefLead/MorningBriefStory (Server Components) could not use
 * `displaySource()`/`displaySourceTrail()`/`BUCKET_CONFIG` while they lived
 * in StockRecCard.tsx (caught in local execution: "Attempted to call
 * displaySource() from the server but displaySource is on the client").
 * These three exports never needed client-side state to begin with, so
 * they move here verbatim (zero logic changes) and StockRecCard.tsx now
 * imports them back — single source of truth, no behavior change.
 */

export type BucketLabel = "A+" | "A" | "B" | "C";

export const BUCKET_CONFIG: Record<BucketLabel, { tone: "ok" | "warn" | "bad"; nav_pct: string; max_nav: string }> = {
  "A+": { tone: "ok", nav_pct: "0.8%", max_nav: "12%" },
  A: { tone: "ok", nav_pct: "0.6%", max_nav: "8%" },
  B: { tone: "warn", nav_pct: "0.4%", max_nav: "5%" },
  C: { tone: "bad", nav_pct: "0", max_nav: "0" },
};

export function displaySource(source: string | null | undefined): string {
  const raw = source?.trim();
  if (!raw) return "AI 推薦引擎";
  if (raw.toLowerCase().includes("brain_react")) return "AI 推薦引擎";
  return raw;
}

function uniqueParts(parts: string[]) {
  return Array.from(new Set(parts));
}

export function displaySourceTrail(sourceTrail: string | null | undefined): string {
  const raw = sourceTrail?.trim();
  if (!raw || raw.toLowerCase().includes("sourcetrail")) {
    return "資料路徑尚未完整回傳";
  }

  const normalized = raw.toLowerCase();
  const parts: string[] = [];

  if (normalized.includes("recommendation_source=brain_react")) {
    parts.push("推薦來源：AI 推薦引擎");
  } else if (normalized.includes("recommendation_source=")) {
    parts.push("推薦來源：推薦資料庫");
  }

  if (normalized.includes("run(") || normalized.includes("ai_recommendations_runs")) {
    parts.push("推薦批次：已讀取今日推薦結果");
  }

  if (normalized.includes("official_announcements")) {
    if (normalized.includes("state=live")) {
      parts.push("官方公告：已納入重大訊息狀態");
    } else if (normalized.includes("state=empty")) {
      parts.push("官方公告：目前無可用新公告");
    } else {
      parts.push("官方公告：資料狀態待確認");
    }
  }

  if (
    normalized.includes("technical(")
    || normalized.includes("finmind_ohlcv")
    || normalized.includes("get_company_technical")
    || normalized.includes("lastprice")
  ) {
    parts.push("技術/量價：已納入報價與 K 線資料");
  }

  if (normalized.includes("get_news_top10") || normalized.includes("news")) {
    parts.push("新聞/題材：已納入市場新聞資料");
  }

  if (parts.length === 0) return raw;
  return uniqueParts(parts).join("；");
}
