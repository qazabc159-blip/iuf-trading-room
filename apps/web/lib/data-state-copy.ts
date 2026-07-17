/**
 * data-state-copy.ts — 全站四態誠實詞彙表（C-3）
 *
 * 對應 `reports/product_flow/DAILY_DECISION_FLOW_DESIGN_v1.md` §5：
 *   live    — 綠點 — 「即時」／「盤中快照（約 5-20 秒）」
 *   close   — 琥珀 — 「MM/DD 收盤」（用資料自身日期，禁止「今日收盤」配舊資料）
 *   delayed — 琥珀 — 「資料延遲：<原因>」／「N/M 檔已計價，缺價部位以成本列示」
 *   empty   — 灰   — 「尚無資料：<為什麼>＋<何時會有>」（禁止永駐「載入中…」或空白）
 *
 * 純函式，無 React / DOM 依賴，供 <DataStateBadge> 與其他頁面直接引用文案規則。
 */

import { taipeiCalendarDate } from "./taipei-date";

export type DataState = "live" | "close" | "delayed" | "empty";

export type DataStateTone = {
  color: string;
  border: string;
  background: string;
};

const DATA_STATE_TONE: Record<DataState, DataStateTone> = {
  live: { color: "#34d399", border: "rgba(52,211,153,0.34)", background: "rgba(52,211,153,0.08)" },
  close: { color: "#fbbf24", border: "rgba(251,191,36,0.34)", background: "rgba(251,191,36,0.08)" },
  delayed: { color: "#fbbf24", border: "rgba(251,191,36,0.34)", background: "rgba(251,191,36,0.08)" },
  empty: { color: "#9ca3af", border: "rgba(156,163,175,0.28)", background: "rgba(156,163,175,0.08)" },
};

export function dataStateTone(state: DataState): DataStateTone {
  return DATA_STATE_TONE[state];
}

/**
 * 把 ISO 日期／日期時間字串轉成 "MM/DD"（Taipei 日曆日，見 `taipei-date.ts`）。
 * 空值或格式不對回 null（呼叫端決定 fallback 文案，不在這裡編數字）。
 *
 * 2026-07-18 修正：舊版對輸入字串做 `value.slice(0, 10)` 天真截字串，UTC "Z"
 * 格式時間戳（例如 market-data/overview 的 `marketContext.index.timestamp`）
 * 在 UTC 小時 >= 16:00 時，UTC 日曆日跟 Taipei 日曆日會差一天，導致公司頁 /
 * AI 推薦頁的收盤 banner 顯示「07/16」而首頁顯示「07/17」（同一個交易日）。
 */
export function formatAsOfDate(value: string | null | undefined): string | null {
  const isoDate = taipeiCalendarDate(value);
  if (!isoDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const [, , month, day] = match;
  return `${month}/${day}`;
}

export type DataStateTextParams = {
  state: DataState;
  /** close 態：資料自身的交易日／時間戳（ISO），不是「現在」 */
  asOf?: string | null;
  /** delayed / empty 態：為什麼 */
  reason?: string | null;
  /** empty 態：何時會有 */
  eta?: string | null;
};

/** 依 §5 詞彙表把 state 組成單一顯示字串。 */
export function dataStateLabel(params: DataStateTextParams): string {
  const { state, asOf, reason, eta } = params;

  if (state === "live") return "即時";

  if (state === "close") {
    const dateLabel = formatAsOfDate(asOf);
    return dateLabel ? `${dateLabel} 收盤` : "收盤";
  }

  if (state === "delayed") {
    return reason ? `資料延遲：${reason}` : "資料延遲";
  }

  // empty
  const whyPart = reason ? `：${reason}` : "";
  const etaPart = eta ? `（${eta}）` : "";
  return `尚無資料${whyPart}${etaPart}`;
}
