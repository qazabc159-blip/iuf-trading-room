# Elva Schema Review — `nextjs/src/lib/contracts.ts` (placeholder)

**Author**: Elva
**Date**: 2026-04-29 (within the architect's 30-min gate)
**Subject**: Day 1 step 1 schema placeholder review
**Source file reviewed**: `C:\Users\User\Downloads\contracts.ts` (382 lines, zod schemas)
**Review verdict**: **APPROVE WITH FIXES** — 2 critical alignments + 1 documentation note. Architect may apply the unified diff at §6 directly.

---

## §1 — Overall

Schema is well-structured and meets all 4 of the Day 0 rules I'd put on it:

| Rule | State |
|------|-------|
| PascalCase naming, mirrors `src/lib/types.ts` | ✓ |
| No business validation (`.refine` / `.min` / `.max` / `.length`) | ✓ — only primitives |
| Hard-line comments at file head | ✓ — three POST routes named explicitly |
| No `OrderTicket` / `OrderAck` / kill-mode write surface | ✓ — `killMode` is GET-only field |

PR-level decisions in the schema that I agree with:
- `ApiErrorSchema` envelope shape aligns with server convention
- `ThemeDetailSchema = ThemeSchema.extend({ companies })` for Q3 split
- `pulse` arrays inline on `Theme` and `Run` (Q5 no-N+1) — correct
- `Portfolio.killMode` + absence of `OrderTicket`/`OrderAck` types — hard-line at type layer
- `BriefBundle` / `ReviewBundle` / `WeeklyPlan` shapes are reasonable Phase 1 placeholders

What follows is what needs to change before Day 1 step 2 begins.

---

## §2 — Critical fix #1: KBar field name + unit + timezone

The schema currently has:

```ts
export const KBarSchema = z.object({
  ts: z.number(),     // epoch seconds (Taipei +0800 server-side)
  ...
});
```

Real backend (`apps/api/src/broker/kgi-quote-client.ts` lines 162-172) returns:

```ts
export interface KBarData {
  time: number;   // Unix milliseconds (int). Timestamps normalised to UTC in gateway.
  open, high, low, close, volume
}
```

Three divergences:
1. **Field name**: `ts` vs server's `time`
2. **Unit**: schema says "epoch seconds", server is "Unix milliseconds" (factor of 1000 off)
3. **Timezone**: schema says "Taipei +0800", server is "UTC"

**Cause**: my Q-round answer earlier today was imprecise on KBar shape. The architect followed my draft, not the server. This is my error to fix.

**Implication if shipped as-is**:
- Day 1 step 2's typed client (`lib/api.ts`) would receive milliseconds but pass them to `lightweight-charts` as if they were seconds → all bars would render as if they were in 1970-01-19, charts blank.
- Or vice-versa — divide by 1000 too aggressively → all bars stack on one timestamp.

**Fix**: rename field to `time`, document unit as Unix ms UTC. lightweight-charts ^4.x accepts ms via `UTCTimestamp` after conversion (`Math.floor(time / 1000)`); chart adapter does the conversion at the chart boundary, not at the wire boundary. See diff in §6.

---

## §3 — Critical fix #2: Freshness enum value alignment

The schema currently has:

```ts
export const FreshnessSchema = z.enum([
  "FRESH",          // < 5s
  "STALE_LT_5S",    // 5-30s
  "STALE_LT_30S",   // 30s-5min
  "STALE",          // > 5min
]);
```

Real backend (`apps/api/src/lib/freshness.ts` line 60-78, `FreshnessResult.freshness` field on responses) emits:

```ts
type FreshnessState = "fresh" | "stale" | "expired" | "not-available";
```

Boundaries are 5 s (default `KGI_QUOTE_STALE_THRESHOLD_MS`) and 60 s (default `KGI_QUOTE_HARD_STALE_MS`):

| Server state | Condition |
|--------------|-----------|
| `"fresh"` | `ageMs ≤ 5000` |
| `"stale"` | `5000 < ageMs ≤ 60000` |
| `"expired"` | `ageMs > 60000` (treat as missing) |
| `"not-available"` | no last-received timestamp |

Three divergences vs schema:
1. **Case**: lowercase vs schema's UPPERCASE
2. **Boundaries**: 5 s/60 s (server) vs 5 s/30 s/5 min (schema)
3. **Coverage**: schema has no `not-available` state; real APIs return `not-available` when the gateway has never received a frame for the symbol (this is the most-common failure path during off-hours)

**Cause**: same as §2 — my prior Q-round answer gave the architect 5 s/30 s/5 min thresholds, but those don't exist server-side. The 5 s/60 s thresholds are tunable via `KGI_QUOTE_STALE_THRESHOLD_MS` / `KGI_QUOTE_HARD_STALE_MS`.

**Implication if shipped as-is**: every quote response would fail `FreshnessSchema.parse()` because `"fresh"` is not in `["FRESH", "STALE_LT_5S", "STALE_LT_30S", "STALE"]`. Day 1 step 2 would break on first live request.

**Fix**: align enum values to server's lowercase 4-state. Visual badge can still be 4 colors (FRESH green / STALE yellow / EXPIRED red / NOT_AVAILABLE grey) — same number of tiers, just different boundaries. If sub-stale granularity is needed for UX later, derive `ageMs` client-side from `asOf` (`Date.now() - Date.parse(asOf)`) — no schema change required. See diff in §6.

---

## §4 — Nit: badge tier derivation pattern (no schema change)

For visual states beyond the 4-state enum (e.g. "stale-but-still-recent" badge color shade), the schema already has enough info:

- `Quote.asOf: string` (ISO 8601) — present
- Client computes `ageMs = Date.now() - Date.parse(asOf)`
- Badge component reads `ageMs` and renders sub-tier

This is documentation-only — no schema change. I recommend adding a one-line comment under `Quote.asOf` to flag this pattern. See diff in §6.

---

## §5 — 三個 命名衝突 待確認 — answers

> **Q1**: TodayBundle — apps/api 真的叫這名嗎？還是 HomeBundle / DashboardSnapshot？

**A**: No conflict. `git grep "TodayBundle\|HomeBundle\|DashboardSnapshot"` returns 0 matches across the entire repo. The homepage today uses RSC + direct fetch (no aggregate route exists yet on `apps/api`). You are defining a **new** shape — keep `TodayBundle`. When Day 4 wires it to backend, the integration PR will add the matching `/api/v1/today` route on `apps/api`. No naming change.

> **Q2**: KBarResponse — apps/api 是回 `bars: KBar[]` 還是直接 `KBar[]`？

**A**: Server wraps in an envelope. Two real response types on server:
- `KgiKbarRecoverResponseRaw` (for `/quote/kbar/recover`): `{ symbol, bars: KBarData[], count, from_date, to_date, note? }`
- `KgiKbarLatestResponseRaw` (for `/quote/kbar`): `{ symbol, bars: KBarData[], count, buffer_size, buffer_used }`

Your `KBarResponseSchema = { symbol, interval, bars: KBarSchema[], freshness }` correctly wraps. Confirmed CORRECT — keep as-is. (Note: the wire-level server response carries extra fields like `count` / `buffer_size` that you've omitted; that's fine for placeholder, BFF can drop them at the proxy layer.)

> **Q3**: Portfolio — schema 是不是分 Portfolio + PortfolioPositions + PortfolioRisk 三條？

**A**: Backend currently has only `/api/v1/trading/positions` (returns positions array). There is no `/portfolio` aggregate route yet. Your one-bundle `PortfolioSchema` (with `killMode` + `navTwd` + `pnlTodayTwd` + `positions` + `riskLimits` + `asOf` + `freshness`) is **forward-looking placeholder** — that's fine because schema is placeholder by definition. Day 4 integration PR will either:
(a) Add `/api/v1/portfolio` aggregate route on backend, OR
(b) Have BFF compose `Portfolio` from `/positions` + `/risk` + `/killmode` (3 fetches).

Either is acceptable; the choice belongs to the integration PR, not Day 1. Your schema is the design target. Keep as one bundle.

---

## §6 — Unified diff for direct apply

Apply this patch to `nextjs/src/lib/contracts.ts`:

```diff
diff --git a/nextjs/src/lib/contracts.ts b/nextjs/src/lib/contracts.ts
--- a/nextjs/src/lib/contracts.ts
+++ b/nextjs/src/lib/contracts.ts
@@ -19,11 +19,15 @@
 /* ─── Primitives & freshness ─────────────────────────────────────────── */
+/**
+ * Server-side freshness enum (lowercase, 4-state).
+ * Boundaries: STALE at 5 s; EXPIRED at 60 s. Tunable via
+ *   KGI_QUOTE_STALE_THRESHOLD_MS  (default 5000)
+ *   KGI_QUOTE_HARD_STALE_MS       (default 60000)
+ * For sub-stale UI tiers, derive ageMs client-side from `asOf`:
+ *   const ageMs = Date.now() - Date.parse(asOf);
+ * Source: apps/api/src/lib/freshness.ts (W5b A1, PR #11 merged 2026-04-28).
+ */
 export const FreshnessSchema = z.enum([
-  "FRESH",          // < 5s
-  "STALE_LT_5S",    // 5-30s
-  "STALE_LT_30S",   // 30s-5min
-  "STALE",          // > 5min
+  "fresh",
+  "stale",
+  "expired",
+  "not-available",
 ]);
 export type Freshness = z.infer<typeof FreshnessSchema>;

@@ -147,12 +151,13 @@
 /* ─── Quotes (KGI gateway, proxied through apps/api) ─────────────────── */
 export const QuoteSchema = z.object({
   symbol: z.string(),
   last: z.number(),
   change: z.number(),
   changePct: z.number(),
   state: z.enum(["LIVE", "CLOSE", "HALT"]),
-  asOf: z.string(),                 // ISO 8601
+  asOf: z.string(),                 // ISO 8601 UTC. Client may derive ageMs = Date.now() - Date.parse(asOf).
   freshness: FreshnessSchema,       // mandatory per W5b A1
 });
 export type Quote = z.infer<typeof QuoteSchema>;

@@ -167,12 +172,15 @@
 export const KBarIntervalSchema = z.enum(["1m", "5m", "15m", "1h", "1d", "1wk"]);
 export type KBarInterval = z.infer<typeof KBarIntervalSchema>;

+/**
+ * KBar wire shape. Field name + unit + timezone aligned to
+ *   apps/api/src/broker/kgi-quote-client.ts → KBarData.
+ *
+ * `time` is Unix MILLISECONDS in UTC.
+ * Chart adapter must convert at boundary:
+ *   const utcSeconds = Math.floor(time / 1000) as UTCTimestamp; // lightweight-charts ^4.x
+ */
 export const KBarSchema = z.object({
-  ts: z.number(),                   // epoch seconds (Taipei +0800 server-side)
+  time: z.number(),                 // Unix milliseconds (UTC). Convert to seconds at chart boundary.
   open: z.number(),
   high: z.number(),
   low: z.number(),
   close: z.number(),
   volume: z.number(),
 });
 export type KBar = z.infer<typeof KBarSchema>;
```

That's the full set. No other field changes needed.

---

## §7 — Acceptance gate for Day 1 step 2

After applying §6 diff:

| Item | Verify |
|------|--------|
| Diff applied cleanly | `git diff` shows only those 3 hunks |
| Type check passes | `tsc --noEmit` on the placeholder file |
| Smoke parse | `FreshnessSchema.parse("fresh")` returns ok; `KBarSchema.parse({ time: 1714374000000, open: 600, high: 605, low: 599, close: 603, volume: 1000 })` returns ok |
| Hard-line absence | `grep "OrderTicket\|OrderAck\|killMode.*set\|/order/create\|/portfolio/kill-mode\|/run/start\|/run/stop"` returns 0 matches in `nextjs/src` (verify after Day 1 step 2 lands) |

Once those 4 are green: Day 1 step 2 (typed client + SWR + errors + freshness badge) is **GO**.

---

## §8 — What's NOT changing

For clarity (these were also asked or implied):

- All other schemas (`Theme`, `Idea`, `Run`, `Signal`, `MarketState`, `BriefBundle`, `ReviewBundle`, `WeeklyPlan`, `OpsBundle`, `ApiHealth`, `WorkerJob`, `ActivityEvent`, `AuditEvent`) — keep as drafted. PASS.
- Pulse arrays (length-7 doc-comment without `.length(7)` runtime enforcement) — correct per Day 0 rule. Server enforces; client doesn't double-validate.
- `ApiErrorSchema` envelope — matches server convention. Use `lib/errors.ts` mapping table for code → user message localisation per architect's plan.
- `Portfolio.killMode` GET-only — correct; matches server hard line.
- `Portfolio` having no `OrderTicket` / `OrderAck` types — correct; hard-line enforced at type layer.
- File header hard-line comments — keep verbatim; do not delete on integration.

---

## §9 — Note for the architect (optional read)

You can apply §6 diff directly. No need to circle back through me for re-approval — the only gate was getting these 3 alignments right. After apply: proceed to Day 1 step 2. If you hit any **server response shape** that disagrees with your schema during Day 1 step 2 typed-client work, stop and ping — that's a real backend/schema mismatch that needs my eyes (not a placeholder issue).

I'll re-engage at:
- Day 4 (integration PR review against `apps/api` real routes)
- OR earlier if you hit a wire mismatch

Until then your loop is: apply diff → Day 1 step 2 → Day 2-3 free run → ping at Day 4 integration.

— Elva
