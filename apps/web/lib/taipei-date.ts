/**
 * taipei-date.ts — 2026-07-18 banner-date-unify root-cause fix.
 *
 * 楊董反覆抓到跨頁「顯示 MM/DD 收盤資料」banner 日期不一致（公司頁/AI 推薦頁顯
 * 07/16，首頁顯 07/17，同一個交易日）。追查發現真根因不是 resolver 選錯來源
 * （`resolveAuthoritativeTradeDate()` 在 `index-snapshot-freshness.ts` 早已用
 * Taipei 日曆日正確比較），而是「把已經正確比較出的日期字串，拿去顯示成
 * MM/DD」這一步——`lib/data-state-copy.ts::formatAsOfDate()` 和
 * `lib/index-snapshot-freshness.ts` 各自用 `value.slice(0, 10)` 天真截字串，
 * 對 `market-data/overview` 的 `marketContext.index.timestamp`（UTC "Z" 格式，
 * 例："2026-07-16T16:00:00.000Z"）而言，UTC 的日曆日跟 Taipei 的日曆日不同
 * （UTC 16:00 = Taipei 隔天 00:00），naive slice 拿到的是 UTC 日期「07/16」，
 * 但真正的 Taipei 交易日其實是「07/17」。首頁湊巧沒踩到這個坑，是因為它的
 * KGI 分支拿到的時間戳本來就是 Taipei-local「+08:00」格式（slice 剛好對），
 * 不是因為首頁的日期換算邏輯比較對。
 *
 * 這支檔案是全站唯一一個「timestamp → Taipei 日曆日」轉換函式，取代原本兩處
 * 各自重寫的邏輯。任何要顯示「這筆資料是哪一個交易日」的地方都必須經過這裡，
 * 不准再自己 slice ISO 字串。
 */

const TAIPEI_TZ = "Asia/Taipei";

/**
 * Returns the Taipei calendar date ("YYYY-MM-DD") for a given ISO
 * date/datetime string, or `null` when the input is missing/unparseable.
 * Correctly handles UTC ("Z") timestamps that roll over into the next
 * Taipei calendar day (UTC hour >= 16:00) — this is the case a naive
 * `value.slice(0, 10)` gets wrong.
 */
export function taipeiCalendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: TAIPEI_TZ });
}
