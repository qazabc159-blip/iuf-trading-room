/**
 * data-reason-copy.ts — dataset id → 人話對照層（2026-07-19 側欄健康 widget 修復）
 *
 * `GET /api/v1/market-data/overview` 的 `marketContext.index.reason` 欄位（見
 * `apps/api/src/market-data.ts`）回傳的是內部工程代碼，可能是單一 token
 * （例如 `official_daily_index`）或用逗號串接的多個 token
 * （`indexRow.item.reasons.join(", ")`，例如 `"missing_quote, fallback:no_fresh_quote"`）。
 * 側欄「MARKET INTEL」健康 widget（`components/Sidebar.tsx`）曾直接把這個原始
 * 字串塞進「資料延遲：<reason>」文案顯示，踩了「UI 禁工程語意」鐵律
 * （`CLAUDE.md` 產品鐵律）。
 *
 * `humanizeDataReason()` 是唯一負責把這些 token 轉成操作員看得懂的中文的地方——
 * 呼叫端（`ticker-tape.ts::deriveTickerDisplay`）在把 backend 的 `reason` 收進
 * 前端顯示模型（`TickerDisplay.reason`）之前先過這一層，Sidebar 與 TickerTape
 * 兩個消費者因此一起修好，不需要各自重寫一份。
 *
 * 涵蓋範圍：grep `apps/api/src/market-data.ts` 找到、會流向
 * `marketContext.index.reason` 的所有已知 token（含 `fallback:`/`stale:` 前綴
 * 的動態組合，對應 `QuoteResolutionFallbackReason`/`QuoteResolutionStaleReason`
 * 兩個 enum 的全部成員），加一個「未知 token」的誠實 fallback——不印原始字串，
 * 但也不假裝知道原因。這支函式同時是 `apps/web/app/quote/page.tsx` 單一 symbol
 * 報價頁 `item.reasons[]`（`buildEffectiveQuoteReasons()` 產出）的唯一翻譯層
 * （2026-07-19 #1309 Pete review 🔴 fast-follow）——`official_close_snapshot`/
 * `official_close_stale_intraday_fallback` 兩個 token 是 official_close 兜底
 * tier 專屬（`_applyOfficialCloseFallback`/`_synthesizeItemForMissingSymbol`
 * 疊加在既有 reasons 之上），一併收錄在下面的 `KNOWN_REASON_LABELS`。
 *
 * 只對「看起來像內部代碼」的字串（純小寫英數字/底線，可選 `prefix:suffix`）動
 * 手；已經是人話的呼叫端輸入（例如 `"3/8 檔尚未計價"`）原樣通過，不在這裡被
 * 覆寫（那些是呼叫端自己負責的文案，不是這層要治的病）。
 */

const KNOWN_REASON_LABELS: Record<string, string> = {
  official_daily_index: "使用官方日線指數（非即時報價來源）",
  market_index_daily_missing: "官方日線指數尚未提供今日資料",
  market_index_quote_missing: "即時報價來源目前沒有指數資料",
  missing_quote: "目前沒有可用報價",
  synthetic_source: "來源為推算值，非即時報價",
  non_live_source: "來源非即時報價管道",
  provider_disconnected: "報價來源暫時斷線",
  // 2026-07-19 (#1309 round 2 fast-follow): official_close fallback tier's own
  // reason tokens, appended in market-data.ts's _applyOfficialCloseFallback /
  // _synthesizeItemForMissingSymbol on top of the existing reasons[] entries.
  official_close_snapshot: "非交易時段，顯示最近收盤價",
  official_close_stale_intraday_fallback: "盤中即時報價中斷，暫以最近收盤價顯示",
};

const FALLBACK_SUB_LABELS: Record<string, string> = {
  higher_priority_stale: "優先來源資料已過期",
  higher_priority_missing: "優先來源缺少資料",
  higher_priority_unavailable: "優先來源暫時無法使用",
  no_fresh_quote: "沒有最新報價可用",
  no_quote: "沒有報價可用",
};

const STALE_SUB_LABELS: Record<string, string> = {
  age_exceeded: "資料已超過新鮮度上限",
  missing_last: "缺少最新成交價",
  no_quote: "沒有報價可用",
  provider_unavailable: "報價來源暫時無法使用",
};

/** 未知 token 的誠實 fallback——絕不印原始內部代碼。 */
const UNKNOWN_REASON_FALLBACK = "資料延遲原因暫未提供";

/** 內部代碼的形狀：`token` 或 `token:sub_token`，全小寫英數字/底線。 */
const ENGINEERING_TOKEN_PATTERN = /^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)?$/;

function humanizeSingleToken(token: string): string {
  if (token in KNOWN_REASON_LABELS) return KNOWN_REASON_LABELS[token];

  if (token.startsWith("fallback:")) {
    const sub = token.slice("fallback:".length);
    return FALLBACK_SUB_LABELS[sub] ?? UNKNOWN_REASON_FALLBACK;
  }
  if (token.startsWith("stale:")) {
    const sub = token.slice("stale:".length);
    return STALE_SUB_LABELS[sub] ?? UNKNOWN_REASON_FALLBACK;
  }

  return UNKNOWN_REASON_FALLBACK;
}

/**
 * 把後端回傳的原始 `reason` 值轉成操作員看得懂的中文。
 *
 * - `null`/`undefined`/空字串：原樣回傳（呼叫端自行決定 fallback 文案）。
 * - 每個逗號分隔的 token 都符合「內部代碼」形狀（純小寫英數字/底線，可選
 *   `prefix:suffix`）：逐一轉換、去重、用「、」串接。
 * - 只要有任一 token 不符合這個形狀（代表呼叫端傳的已經是人話，例如
 *   `"3/8 檔尚未計價"`）：整串原樣通過，不覆寫。
 */
export function humanizeDataReason(rawReason: string | null | undefined): string | null {
  if (!rawReason) return rawReason ?? null;

  const tokens = rawReason.split(",").map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return rawReason;
  if (!tokens.every((token) => ENGINEERING_TOKEN_PATTERN.test(token))) return rawReason;

  const labels = tokens.map(humanizeSingleToken);
  return Array.from(new Set(labels)).join("、");
}
