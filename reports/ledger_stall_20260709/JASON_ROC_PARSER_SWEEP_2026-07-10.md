# Whole-tree ROC date parser sweep — 2026-07-10

**Branch**: `fix/roc-parser-sweep-jason-20260710`
**Trigger**: Pete re-review after #1202 independently grep'd two more duplicate ROC date parsers in `apps/api/src` (feature: `+ 1911` next to a `split("/")` or 7-digit-compact check) that the prior file-scoped rounds (#1199, #1202) had not caught. This round is a one-time, whole-tree sweep — "prove the pattern is extinct."

## Method

Grepped the entire `apps/api/src` tree for ROC-calendar date-parsing features, cross-referencing multiple patterns: `1911` (bare, catches `+ 1911` / `+1911` regardless of spacing), `split("/")` near a `Date`/日期 field, `\d{7}` compact-format checks, `rocYear`/`ROC year`/`民國` comments. Every hit was read in full context (which endpoint/function it feeds, what upstream data source produces the raw string), and where the upstream wire format was uncertain, curl'd live (2026-07-10) to check actual current format rather than trusting code comments.

## Full inventory

| # | File:Line (pre-fix) | Feeds | Wire format (verified 2026-07-10 unless noted) | Pre-fix behavior | Decision |
|---|---|---|---|---|---|
| 0 | `lib/roc-date.ts:24-33` | canonical shared parser | N/A | — | Source of truth, untouched |
| 1 | `server.ts:2865-2871` | `GET /api/v1/realtime/snapshot` EOD `source_time` | `openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL` → compact `"1150710"` (curl-verified) | Slash-only inline parser; against compact input, silently fell through to `sourceTime = nowIso` — **mislabels a possibly-stale EOD close as "right now" on a public-ish (Viewer+) endpoint** | **FIXED** — delegate to `parseRocEodDateIso` |
| 2 | `server.ts:8639-8651` (`rocDateToIso` in company-announcements `twseIihRowsFromSection`) | `www.twse.com.tw/rwd/zh/IIH/company/events?code=...` (重大訊息/財務報告/法說會) | `curl -s "https://www.twse.com.tw/rwd/zh/IIH/company/events?code=2330"` (live, 2026-07-10) → **every row's `date` field is ROC 2-3-digit-year slash, e.g. `"115/07/02"` — never compact 7-digit** across all three sections (news/fina/conference), 30 sample rows checked | Handles ROC slash (`\d{2,3}/\d{1,2}/\d{1,2}`) correctly; additionally has a Gregorian dash/slash fallback branch (`text.replace(/\//g,"-")` validated against `^\d{4}-\d{2}-\d{2}$`) that `lib/roc-date.ts` does not have | **NOT FIXED — documented exception.** See "Why #2 is not delegated" below. |
| 3 | `data-sources/twse-openapi-client.ts:517-529` (`parseRocDate`/`rocDateToTaipeiTs`, feeds `MI_INDEX` index snapshot `ts`) | `openapi.twse.com.tw/v1/exchangeReport/MI_INDEX` (`row["日期"]`) | `curl -s "https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX"` → compact `"1150709"` (live, 2026-07-10) | Compact-only (`s.length===7`, no digit validation — any 7-char string produces `NaN` silently); no slash fallback; returns raw input as-is on failure (not null) | **FIXED** — delegate to `parseRocEodDateIso`, preserve "return input as-is" fallback convention |
| 4 | `data-sources/twse-openapi-client.ts:887-891` (`fetchTaiexMonthDailyCloses`, feeds `getTaiexPrevSessionSnapshot`/`getTaiexDailyCloses`) | `www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST` (`row[0]`) | `curl -s ".../MI_5MINS_HIST?date=20260701&response=json"` → slash `"115/07/01"` (live, 2026-07-10) — **different domain/convention than openapi.twse.com.tw** | Slash-only — already correct for this endpoint's actual wire format; no compact fallback (latent risk if format ever changes) | **FIXED (dedup, not a live bug)** — delegate to `parseRocEodDateIso` for consistency + future-proofing |
| 5 | `data-sources/twse-openapi-client.ts:1453-1461` (`getTwseMarketBreadth` `asOf`) | `STOCK_DAY_ALL` (shared cache) | compact (curl-verified, same source as #1) | Already dual-format (slash + compact) — functionally identical to `lib/roc-date.ts` | **FIXED (dedup, not a live bug)** — exact-duplicate logic collapsed |
| 6 | `data-sources/twse-openapi-client.ts:1563-1568` (`getTwseLeaders` `asOf`, feeds `GET /api/v1/market/leaders/twse` TWSE-fallback branch) | `STOCK_DAY_ALL` (shared cache) | compact (curl-verified, same source as #1) | Slash-only — against compact input, **`asOf` was silently, permanently `null`** on this endpoint's TWSE-fallback branch (only reached when `FINMIND_TOKEN` unset) | **FIXED** — delegate to `parseRocEodDateIso` |
| 7 | `ai-recommendation-v2/candidate-pool.ts:54-65` (`rocDateToIso`, feeds AI rec v3 candidate-pool prompt `dataDate` label) | `STOCK_DAY_ALL` (via `getStockDayAllRows()`) | compact (curl-verified, same source as #1) | Already dual-format (compact-first, then slash); no `year > 1900` sanity guard (shared lib has one) | **FIXED (dedup, not a live bug)** — delegate; gains a strictly-safer guard as a side effect |
| 8 | `kgi-heatmap-enricher.ts:120-136` (`parseTwseDate`, feeds `updateLastCloseFromTwse` Tier-2 KGI-heatmap fallback) | `STOCK_DAY_ALL` (via `enrichHeatmapTiles(kgiTiles, twseRows)`) | compact (curl-verified, same source as #1) | Already dual-format (slash + compact); returns `""` (not null) on failure | **FIXED (dedup, not a live bug)** — delegate, preserve `""` convention |
| 9 | `theme-refresh.ts:179-191` (`latestEodDateLabel`, feeds theme-refresh LLM prompt's EOD date label) | `STOCK_DAY_ALL` (via `getStockDayAllRows()`) | compact (curl-verified, same source as #1) | **Compact-ONLY** (opposite asymmetry from #1/#3/#6) — would silently return `"未知"` if this field ever reverted to slash format | **FIXED** — delegate (strict improvement, adds slash resilience it lacked); extracted pure helper `_deriveEodDateLabel` for direct testability |
| — | `jobs/market-intel-finmind-sync.ts:177` (`normalizeDividendYear`) | FinMind dividend `row.year` labels like `"111年"` | N/A | Extracts a bare ROC **year number** for fiscal-year labeling — no month/day, no date-string-to-ISO conversion at all | **OUT OF SCOPE** — different domain (fiscal year label, not calendar-date parsing); matched the `民國`/`ROC` grep pattern but not the `+1911`/date-parsing family |
| — | `jobs/twse-announcement-ingest.ts:173` (`parseTwseDate`) | already-Gregorian `"YYYY/MM/DD"` announcement dates | N/A | Same-name-as-#8 coincidence, different module — converts slash→dash on an **already-Gregorian** date, no ROC `+1911` math at all | **OUT OF SCOPE** — not a ROC parser, confirmed by reading its own test file's own docstring ("YYYY/MM/DD → ISO") |

## Why #2 (`server.ts:8639` company-announcements `rocDateToIso`) is NOT delegated

Per the coordinator's explicit instruction, curl'd the upstream endpoint before deciding:

```
curl -s "https://www.twse.com.tw/rwd/zh/IIH/company/events?code=2330"
```

Result (2026-07-10, live): all 30 sampled rows across `news`/`fina`/`conference` sections have `date` in ROC 2-3-digit-year slash format (`"115/07/02"`, `"115/06/29"`, ...). **No compact 7-digit dates observed.** The "silently fails against a compact wire format" bug class this whole sweep is chasing simply does not apply here — there is no compact input to fail against.

Beyond that, this function has a behavior `lib/roc-date.ts` does **not** have, and delegating would be a **regression, not a fix**:
- Its ROC-match regex is `^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$` — constrained to a **2-3 digit year**.
- `lib/roc-date.ts`'s slash branch has **no digit-count constraint** on the year (`slashParts.length === 3` then `+ 1911` unconditionally).
- If this endpoint ever emitted a genuinely-Gregorian 4-digit-year slash date (e.g. `"2026/07/02"`), the original function's regex would NOT match it (4 digits > `\d{2,3}`), correctly falling through to its OWN Gregorian fallback branch (`text.replace(/\//g,"-")` → `"2026-07-02"`, validated against `^\d{4}-\d{2}-\d{2}$`) — but `parseRocEodDateIso` would happily match it as ROC-slash and compute `2026 + 1911 = 3937`, a garbage date.

Live sample also surfaced two upstream data-quality anomalies this function already handles correctly (and would continue to under either implementation): `"215/12/18"` (ROC year 215 — an upstream typo, both implementations produce the same garbage `"2126-12-18"`, not a parser bug) and `"-1906/12/15"` (a placeholder/sentinel — both implementations correctly reject it: the original because `-1906` doesn't match `\d{2,3}` at all as-is due to the leading `-`; `parseRocEodDateIso` because of its `year <= 1900` guard).

**Conclusion**: leaving this one alone is the correct call — it is narrower and safer than the shared lib for its actual input space, and forcing it onto the shared parser would introduce exactly the kind of new parsing divergence Pete's brief explicitly warned against.

## Changes

- **`apps/api/src/lib/roc-date.ts`**: unchanged (already the canonical parser from #1199).
- **`apps/api/src/server.ts`**: fixed #1 (`/realtime/snapshot` `source_time`); #2 explicitly left alone (documented, regression-tested via ROC-SWEEP-8/9).
- **`apps/api/src/data-sources/twse-openapi-client.ts`**: fixed #3 (`rocDateToTaipeiTs`), #4 (`fetchTaiexMonthDailyCloses`), #5 (`getTwseMarketBreadth`), #6 (`getTwseLeaders`) — all four now import `parseRocEodDateIso` from `../lib/roc-date.js`.
- **`apps/api/src/ai-recommendation-v2/candidate-pool.ts`**: fixed #7 — local `rocDateToIso` now `const rocDateToIso = parseRocEodDateIso;`.
- **`apps/api/src/kgi-heatmap-enricher.ts`**: fixed #8 — local `parseTwseDate` now delegates, `""`-on-failure convention preserved.
- **`apps/api/src/theme-refresh.ts`**: fixed #9 — extracted pure, exported `_deriveEodDateLabel` (mirrors the `_computeTwseEodCronTradingDateIso` pattern from #1202) for direct testability; `"未知"`-on-failure convention preserved.

## Tests (`tests/ci.test.ts`, all new except one pre-existing update)

- `ROC-SWEEP-1` — source-check: `/realtime/snapshot` derives `source_time` via the shared parser; regression guard the old slash-only inline parser is gone.
- `ROC-SWEEP-2` — behavior: `rocDateToTaipeiTs` handles both formats + preserves as-is fallback.
- `ROC-SWEEP-3` — behavior (mocked fetch): `getTwseMarketBreadth().asOf` correct under compact format.
- `ROC-SWEEP-4` — behavior (mocked fetch): `getTwseLeaders().asOf` correct under compact format (was permanently `null` before this fix).
- `ROC-SWEEP-5` — source-check: `candidate-pool.ts` delegates.
- `ROC-SWEEP-6` — behavior: `enrichHeatmapTiles()` Tier-2 `ts` correct under compact format.
- `ROC-SWEEP-7` — behavior: `_deriveEodDateLabel` now accepts both formats (previously compact-only).
- `ROC-SWEEP-8` — source-check: the #2 exception still exists with its own narrower regex + Gregorian fallback (regression guard against someone "helpfully" delegating it later without re-reading this report).
- `ROC-SWEEP-9` — **whole-tree audit**: recursively walks `apps/api/src` (all non-test `.ts` files), asserts the substring `"1911"` appears in **exactly** `lib/roc-date.ts` and `server.ts` (the documented #2 exception) and nowhere else. This is the literal "proof of extinction" — if anyone reintroduces a duplicate ROC parser anywhere in `apps/api/src`, this test fails.
- **Updated pre-existing test**: `TWSE-MIS-8` (`tests/ci.test.ts`) previously grepped for the exact inline-regex literal in `getTwseMarketBreadth` that #5's dedup removed; updated to check the new call site instead (same intent — breadth `asOf` handles compact format — verified behaviorally by `ROC-SWEEP-3` now too).

No other existing assertions were changed.

## Validation

- `pnpm typecheck` — green (15/15 packages)
- `pnpm run build:packages` — green
- `pnpm test` — 1610 tests (9 new), 1600 pass, 2 fail (pre-existing `finmind-client.test.ts` T3/T11 `FINMIND_TOKEN` env leak, unrelated — reproduces identically on clean origin/main, see prior #1199/#1202 reports), 8 skipped
- `pnpm --filter @iuf-trading-room/api run build` — green
- `pnpm smoke` — 1/1 PASS
- Additionally ran the pre-existing (not currently wired into root `pnpm test`) `apps/api/src/__tests__/twse-market-overview.test.ts` directly (`node --import ./tests/setup-test-env.mjs --import tsx --test apps/api/src/__tests__/twse-market-overview.test.ts`) as extra due-diligence since it already has real fetch-mock infrastructure for several of the functions touched here (`getTwseLeaders`, `getTaiexPrevSessionSnapshot`, `getTaiexDailyCloses`) — 14/14 PASS, confirming the `fetchTaiexMonthDailyCloses`/`getTwseLeaders` changes are compatible with its existing fixtures (which already use the compact format). This file is not part of the CI-run suite (separate pre-existing gap, out of scope here) so it was not relied on as the primary evidence — `ROC-SWEEP-2/3/4` in `tests/ci.test.ts` are.

## Lane note

Touches `server.ts` (general, non-strategy area), `data-sources/twse-openapi-client.ts`, `ai-recommendation-v2/candidate-pool.ts`, `kgi-heatmap-enricher.ts`, and `theme-refresh.ts` — outside this role's default file scope, but this round's dispatch explicitly directed a whole-tree sweep as a direct continuation of #1199/#1202. No risk/broker/real-money paths touched, no migration.
