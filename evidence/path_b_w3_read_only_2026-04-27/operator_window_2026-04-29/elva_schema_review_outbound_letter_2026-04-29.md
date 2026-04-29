# 給設計師的回信（精簡轉發版）

**用途**：楊董直接轉發給設計師。完整 review log 在 `elva_schema_review_2026-04-29.md`，需要時再給。

---

## 信件主體

> 您好，schema 審完了。**APPROVE WITH FIXES** — 整體形狀很好，照您列的 11 個核心點全部 PASS（PascalCase / 無 business refine / hard-line 檔頭 / pulse inline / ApiErrorSchema envelope / `killMode` GET-only / Theme detail extend / Today bundle 一次拿等等）。
>
> 三件事要改才能進 Day 1 step 2，其中 2 件是我前一輪 Q&A 答得不準，責任在我。給您改好可直接 apply 的 diff（見最下面）。
>
> **Critical 1 — KBar 欄位名 + 單位 + 時區**
>
> 您現在的 schema：`ts: number  // epoch seconds (Taipei +0800 server-side)`
>
> 後端真實回的是（`apps/api/src/broker/kgi-quote-client.ts` `KBarData` interface）：
> - 欄位名 `time`（不是 `ts`）
> - 單位 **Unix 毫秒**（不是秒）
> - 時區 **UTC**（不是 Taipei +0800）
>
> 如果照原 schema 寫，Day 1 step 2 chart 會全壞（毫秒當秒會跑到 1970-01-19）。lightweight-charts ^4.x 接 UTCTimestamp 是「秒」，所以轉換要在 chart adapter 邊界做（`Math.floor(time / 1000) as UTCTimestamp`），不要在 wire schema 那層改。
>
> **Critical 2 — Freshness enum 值**
>
> 您現在的 schema：`["FRESH", "STALE_LT_5S", "STALE_LT_30S", "STALE"]` 配 5s/30s/5min 邊界。
>
> 後端真實回的是（`apps/api/src/lib/freshness.ts`，PR #11 已 merge）：
> - 小寫 4-state：`"fresh" | "stale" | "expired" | "not-available"`
> - 邊界 **5s / 60s**（不是 5s/30s/5min）
> - `not-available` 是 gateway 從未收到該 symbol 任何 frame 時的回值，是非開盤時段最常見的狀態，schema 裡漏掉了
>
> 如果照原 schema 寫，每個 quote response 都會 `FreshnessSchema.parse()` 失敗（"fresh" 不在大寫 enum 內）。視覺上 4 個 tier 還在（FRESH 綠 / STALE 黃 / EXPIRED 紅 / NOT_AVAILABLE 灰），只是邊界對齊到後端的 5s/60s。如果未來想要 sub-stale 細分，client side 從 `asOf` 算 `ageMs` 就好（`Date.now() - Date.parse(asOf)`），不用動 wire schema。
>
> **Nit — `Quote.asOf` 加一行註解**：說明 client 可從 `asOf` 算 `ageMs` 做 badge sub-tier。純文件，schema 不動。
>
> **三個命名衝突的回答**
>
> 1. **TodayBundle** — repo 全文 0 match，沒衝突。請保留 `TodayBundle`。Day 4 整合 PR 會在 `apps/api` 加對應 `/api/v1/today` route。
> 2. **KBarResponse** — 確認包一層 `bars: KBar[]` 是對的。後端兩個 response（`/quote/kbar/recover` 和 `/quote/kbar`）都是 `{ symbol, bars: KBarData[], count, ... }`。您的 wrap 正確，多的 `count`/`buffer_size` 等欄位 BFF 會在 proxy 層 drop。
> 3. **Portfolio** — 後端目前只有 `/api/v1/trading/positions`（不分三條，也沒 `/portfolio` 整合 route）。您的 one-bundle `PortfolioSchema` 是 forward-looking placeholder，這完全 OK — schema 是 placeholder 的本意就是這樣。Day 4 整合 PR 會決定 (a) 後端加 `/api/v1/portfolio` 整合 route，或 (b) BFF 由 3 個 endpoint 組合出 Portfolio。Day 1 step 2 不被這個影響。
>
> **可直接 apply 的 unified diff**
>
> ```diff
> diff --git a/nextjs/src/lib/contracts.ts b/nextjs/src/lib/contracts.ts
> --- a/nextjs/src/lib/contracts.ts
> +++ b/nextjs/src/lib/contracts.ts
> @@ -19,11 +19,15 @@
>  /* ─── Primitives & freshness ─────────────────────────────────────────── */
> +/**
> + * Server-side freshness enum (lowercase, 4-state).
> + * Boundaries: STALE at 5 s; EXPIRED at 60 s. Tunable via
> + *   KGI_QUOTE_STALE_THRESHOLD_MS  (default 5000)
> + *   KGI_QUOTE_HARD_STALE_MS       (default 60000)
> + * For sub-stale UI tiers, derive ageMs client-side from `asOf`:
> + *   const ageMs = Date.now() - Date.parse(asOf);
> + * Source: apps/api/src/lib/freshness.ts (W5b A1, PR #11 merged 2026-04-28).
> + */
>  export const FreshnessSchema = z.enum([
> -  "FRESH",          // < 5s
> -  "STALE_LT_5S",    // 5-30s
> -  "STALE_LT_30S",   // 30s-5min
> -  "STALE",          // > 5min
> +  "fresh",
> +  "stale",
> +  "expired",
> +  "not-available",
>  ]);
>  export type Freshness = z.infer<typeof FreshnessSchema>;
>
> @@ -147,12 +151,13 @@
>  /* ─── Quotes (KGI gateway, proxied through apps/api) ─────────────────── */
>  export const QuoteSchema = z.object({
>    symbol: z.string(),
>    last: z.number(),
>    change: z.number(),
>    changePct: z.number(),
>    state: z.enum(["LIVE", "CLOSE", "HALT"]),
> -  asOf: z.string(),                 // ISO 8601
> +  asOf: z.string(),                 // ISO 8601 UTC. Client may derive ageMs = Date.now() - Date.parse(asOf).
>    freshness: FreshnessSchema,       // mandatory per W5b A1
>  });
>  export type Quote = z.infer<typeof QuoteSchema>;
>
> @@ -167,12 +172,15 @@
>  export const KBarIntervalSchema = z.enum(["1m", "5m", "15m", "1h", "1d", "1wk"]);
>  export type KBarInterval = z.infer<typeof KBarIntervalSchema>;
>
> +/**
> + * KBar wire shape. Field name + unit + timezone aligned to
> + *   apps/api/src/broker/kgi-quote-client.ts → KBarData.
> + *
> + * `time` is Unix MILLISECONDS in UTC.
> + * Chart adapter must convert at boundary:
> + *   const utcSeconds = Math.floor(time / 1000) as UTCTimestamp; // lightweight-charts ^4.x
> + */
>  export const KBarSchema = z.object({
> -  ts: z.number(),                   // epoch seconds (Taipei +0800 server-side)
> +  time: z.number(),                 // Unix milliseconds (UTC). Convert to seconds at chart boundary.
>    open: z.number(),
>    high: z.number(),
>    low: z.number(),
>    close: z.number(),
>    volume: z.number(),
>  });
>  export type KBar = z.infer<typeof KBarSchema>;
> ```
>
> apply 完跑 `tsc --noEmit` 通過 + smoke parse 通過（`FreshnessSchema.parse("fresh")` ok / `KBarSchema.parse({time: 1714374000000, open: 600, high: 605, low: 599, close: 603, volume: 1000})` ok）就可以直接進 Day 1 step 2，不用回我審第二輪。
>
> 之後您的 loop：apply diff → Day 1 step 2 → Day 2-3 自由跑 → Day 4 整合 PR 我再上線審。中途如果遇到任何 wire shape 跟您 schema 對不上的，立刻停手 ping 我，那是 backend/schema 真的對不齊，需要我這邊處理。
>
> 謝謝。
>
> — Elva（IUF Trading Room）

---

## 給楊董的補充說明

- 上面三件事其中 2 件（KBar 單位 + Freshness enum）是我前一輪 Q&A 答得不夠精準，已在 review 與信中明確認錯。
- diff 是設計師可直接 `git apply` 的格式（行號可能要微調）。
- 這封信沒邀請設計師動 PR #14 / KGI 寄信 / kill-mode / write-side 任何一件，halted lane 全保留。
- 沒有「KGI 群益」並列；提到 KGI gateway 都是「KGI gateway」或 `services/kgi-gateway`，命名規則維持。

要我直接寄出嗎？還是您先看完再轉？
