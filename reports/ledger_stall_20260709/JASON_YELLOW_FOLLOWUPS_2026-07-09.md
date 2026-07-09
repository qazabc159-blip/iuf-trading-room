# #1184 YELLOW Follow-ups — Fix Report

**Jason — Backend Strategy Lane — 2026-07-09**
**Branch: `fix/ledger-yellow-followups-jason-20260709`**

Continuation of `JASON_LEDGER_STALL_ROOTCAUSE_2026-07-09.md` (PR #1184). Three
YELLOW follow-ups from that root-cause session, collected while memory was
fresh.

---

## YELLOW-1 — TPEX tier-1b date validation (+ a live TWSE parser bug found while fixing it)

**Grep-confirmed still present** before this fix: `s1-sim-runner.ts`'s tier-1b
mark-to-market validated `stockRows[0].Date` (TWSE STOCK_DAY_ALL) against
today before use, but merged `tpexRows` (TPEX daily_close_quotes) in
unconditionally — no date check at all.

**Additional finding while implementing the symmetric TPEX check**: the
existing TWSE date parser only handled the legacy slash-separated ROC format
(`"115/06/30"`.split("/")). Live-queried today (2026-07-09):

```
curl https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL
→ {"Date":"1150708", ...}   # compact 7-digit ROC, no separator
curl https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes
→ {"Date":"1150709", ...}   # same compact format
```

Against the compact format, the old parser's `.split("/")` produces a
1-element array (`parts.length !== 3`), so `stockDateIso` silently resolved to
`null` and the `if (stockDateIso && stockDateIso !== todayTst)` guard never
fired — it fell through to "fresh" unconditionally. The TWSE stale-date guard
added in the 6/30 YELLOW-1 fix has therefore been a no-op against live traffic
since the API's wire format uses the compact shape. (`twse-openapi-client.ts`'s
market-breadth function already handles both shapes locally — s1-sim-runner.ts
had its own separate, narrower parser that didn't.)

**Fix** (`apps/api/src/s1-sim-runner.ts`):
- New local helper `_parseRocEodDateIso(raw)` (exported for direct unit
  testing) handles both the compact 7-digit and legacy slash-separated shapes.
- TWSE tier-1b guard now uses this helper (fixes the silent no-op).
- New symmetric TPEX guard: `tpexDateIso` / `tpexFresh` computed the same way.
  A stale TPEX date pushes a `tpex_eod_stale:` note and skips only the TPEX
  merge (TWSE-listed positions still price normally; OTC positions fall
  through to the MIS tier-1c / DB tier-1d fallback instead of a stale TPEX
  close) — narrower blast radius than the TWSE guard, which skips the entire
  pass, because TWSE and TPEX are independent upstream publishers.

## YELLOW-2 — pricingQuality not surfaced on NAV read

`sim_ledger_nav.notes` already carries a `pricing_quality: mis_fallback_full`
marker (written by #1184) when a ledger point was priced via the MIS fallback
instead of official TWSE/TPEX EOD, but `buildFAutoNavFull()` (backs
`GET /api/v1/portfolio/f-auto/nav`) never selected `notes` or surfaced it.

**Fix** (`apps/api/src/track-record-handlers.ts`):
- `navRows` SQL now selects `notes`.
- New `derivePricingQuality(notes)` helper (exported) + new
  `pricingQuality: "official" | "mis_fallback_full"` field on
  `FAutoNavCurvePointFull`, populated for every navCurve point.
- **Additive only** — the 5 pre-existing fields (`navDate`/`equityTwd`/
  `returnPct`/`weekNum`/`source`) are untouched; `TRK-8` regression-asserts
  each field's mapping line is unchanged.
- Scope: the Owner-only `/api/v1/portfolio/f-auto/nav` route only (per task
  ask). The public `/api/v1/track-record/nav` whitelist (`toPublicNav`) is
  intentionally left unchanged — it's a deliberately thinner surface by
  existing design, and widening it wasn't asked for.

## YELLOW-3 — stale docstring

`writeLiveLedgerAfterEod`'s JSDoc (`sim-ledger-backfill.ts`) still read
*"Called only when snapshot.pricingComplete=true AND today is Tuesday."*
after #1184 changed the call site's gate to
`pricingComplete || fullyPriced`. Updated to describe the actual gate and
point at the `fullyPriced` doc comment for the rationale.

---

## Not fixed (out of scope, flagged for awareness)

`server.ts`'s general TWSE EOD cron (`_runTwseEodCron`, ~line 18538) also
persists TPEX closes to `quote_last_close` without a TPEX date check. This is
a *different* code path — the general market-data manual-quote-cache cron, not
the S1 tier-1b pricing gate — and lives outside the strategy route section of
`server.ts` (lane boundary). Not touched this round; flagging for whoever owns
that cron.

---

## Verification

| Check | Result |
|---|---|
| `pnpm run build:packages` | green (5/5) |
| `pnpm typecheck` | green (15/15 packages, 0 errors) |
| `pnpm test` | 1584 pass / 2 fail / 8 skipped (1594 total). **The 2 failures (`finmind-client.test.ts` T3/T11) are a pre-existing local-environment leak** (a `FINMIND_TOKEN` value present in this shell's env defeats the "token missing" test scenario) — reproduced identically on a clean `git stash` of this branch (i.e. present on origin/main HEAD `2e2b5deb` before any of this round's edits), unrelated to any file this PR touches. |
| `pnpm run smoke` | green (1/1) |
| `pnpm run test:db` | not run — no local Postgres/Docker daemon available in this environment (`docker ps` fails: daemon not running). None of the 3 files that command covers (`idempotency-race`, `paper-executor`, `strategy-ideas`) are touched by this PR. Real coverage will come from the GHA `db-tests` CI job (#1186) on push. |
| New tests | SIM-LEDGER-19/20/21 (YELLOW-1 + YELLOW-3), TRK-7/8/9 (YELLOW-2) — all pass; `_parseRocEodDateIso` and `derivePricingQuality` are directly unit-tested (not just source-regex assertions) |

## Files changed

- `apps/api/src/s1-sim-runner.ts` — TPEX date validation + shared ROC date parser (YELLOW-1)
- `apps/api/src/sim-ledger-backfill.ts` — JSDoc fix (YELLOW-3)
- `apps/api/src/track-record-handlers.ts` — pricingQuality on NAV read (YELLOW-2)
- `tests/ci.test.ts` — SIM-LEDGER-19/20/21, TRK-7/8/9

## Lane boundary

No touch to `trading-service.ts` / `broker/*` / risk files / `apps/web/*` / any migration. No DB schema change (`sim_ledger_nav.notes` already existed).

*Jason — IUF Trading Room Backend Strategy Lane — 2026-07-09*
