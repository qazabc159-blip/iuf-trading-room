import { FinalOnlyFrame } from "@/components/FinalOnlyFrame";

// 交易台「原封搬原稿」路由（2026-07-14）。
// 靜態頁本體在 apps/web/public/desk-exact/index.html（byte-exact 原稿＋比例
// 控制 override），資料與 paper 送單由頁內 inline script 走既有代理。
//
// 2026-07-14 楊董三連退修正：全屏 fixed wrapper 砍掉側欄導航＋1280 密度設計
// 拉滿大螢幕比例失衡 → 改回 FinalOnlyFrame（app 殼內嵌，側欄/頂欄回歸，與
// /market-intel 同款），index.html override 改 max-width 置中控比例。
//
// 2026-07-14 深夜（互動接活 round）：首頁「帶入模擬單」CTA 會帶
// ?symbol=X&side=buy 跳來這裡——之前這兩個 query 從沒被轉發進 iframe src，
// 頁內 script 的 applyQueryPrefill() 永遠讀不到。比照
// apps/web/app/final-v031/portfolio/page.tsx 讀 searchParams 轉發進 iframe
// src 的既有模式（該檔 buildPaperRoomSrc() 是 paper-trading-room 專用的
// URL 形狀，這裡自己寫一個等價但範圍更小的 sanitizer，而非跨模組硬套）。
export const dynamic = "force-dynamic";
export const revalidate = 0;

type DeskExactSearchParams = Record<string, string | string[] | undefined>;

function safeTicker(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const ticker = raw?.trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9._-]{1,16}$/.test(ticker)) return null;
  return ticker;
}

function safeSide(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "buy" || raw === "sell" ? raw : null;
}

function buildDeskExactSrc(params: DeskExactSearchParams | undefined) {
  const symbol = safeTicker(params?.symbol);
  const side = safeSide(params?.side);
  const query = new URLSearchParams();
  if (symbol) query.set("symbol", symbol);
  if (side) query.set("side", side);
  // Stable rev for a handoff load (same handoff = same iframe, no remount);
  // time-bucketed rev for a plain visit so a fresh load always gets the
  // latest desk HTML after a deploy — same rationale as buildPaperRoomSrc().
  query.set("rev", symbol || side ? `handoff-${symbol ?? ""}-${side ?? ""}` : Date.now().toString(36));
  return `/desk-exact/index.html?${query.toString()}`;
}

export default async function DeskExactPage({
  searchParams,
}: {
  searchParams?: Promise<DeskExactSearchParams>;
}) {
  const params = searchParams ? await searchParams : undefined;
  return <FinalOnlyFrame title="交易台" src={buildDeskExactSrc(params)} />;
}
