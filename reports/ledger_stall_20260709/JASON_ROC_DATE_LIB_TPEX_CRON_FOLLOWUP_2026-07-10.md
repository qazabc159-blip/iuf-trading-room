# ROC date parser dedup + TPEX cron date validation — 2026-07-10

**Branch**: `fix/roc-date-lib-tpex-cron-jason-20260710`
**Follow-up to**: #1192 review (Pete) — two of the YELLOW findings recorded in
`JASON_YELLOW_FOLLOWUPS_2026-07-09.md`.

## 1. Shared ROC date parser lib

`apps/api/src/s1-sim-runner.ts` (`_parseRocEodDateIso`, added in #1192) and
`apps/api/src/server.ts` (`_rocDateToIso`, ~line 9888) implemented the same
ROC-calendar → ISO date parsing logic independently. Pete flagged this as the
exact failure pattern behind the 2026-07-09 dumb-guard bug: one copy got
updated to handle TWSE's live compact 7-digit wire format, the other did not.

Extracted to `apps/api/src/lib/roc-date.ts` (`parseRocEodDateIso`):
- `s1-sim-runner.ts`: imports the shared parser, `export const _parseRocEodDateIso = parseRocEodDateIso;` keeps the old exported name working for existing call sites and tests (SIM-LEDGER-19/20) — zero behavior change.
- `server.ts`: imports the shared parser directly; removed the local `_rocDateToIso` function (was nested inside the `/api/v1/companies/:id/quote/realtime` route handler, re-declared on every request); the one call site (`_twseEodFallback`'s `dataDate` field) now calls `parseRocEodDateIso(row.Date)` directly.

`grep -rn "function _rocDateToIso" apps/api/src` → no matches. No second parser implementation remains.

## 2. TPEX EOD cron date validation (server.ts `_runTwseEodCron`)

The general TWSE EOD cron's TPEX persist block (~line 18538, added in #1159)
tagged TPEX closes into `quote_last_close` using **TWSE's** trade date
(`tradingDateIso`, from `stockRows[0].Date`) — it never checked TPEX's own
`Date` field at all. Since TWSE and TPEX publish on separate schedules, a
stale TPEX payload could be silently persisted as if it were the current
(TWSE) trade date — the same bug class as the 2026-07-09 s1-sim-runner
tier-1b TPEX guard fix.

Fix: new exported pure helper `_isTpexEodCloseDateValid(expectedTradeDate, tpexDateRaw)`
(module-level, right before `startSchedulers`, using the shared `parseRocEodDateIso`).
The TPEX persist block now skips (fail-open, warn-only) when TPEX's own date
doesn't match the expected trade date; a missing/unparseable TPEX date is
still treated as "unvalidated" and allowed through (same convention as the
s1-sim-runner guard) so a field-shape hiccup never permanently blocks OTC
pricing.

## Tests (tests/ci.test.ts, all new — zero existing assertions changed)

- `ROC-DATE-1`: `parseRocEodDateIso` handles both wire formats + null/empty/garbage → null.
- `ROC-DATE-2`: source-check — both callers import/delegate to the shared lib; `function _rocDateToIso` regression guard (must be gone from server.ts).
- `S1-PERSIST-TPEX-3`: `_isTpexEodCloseDateValid` — stale TPEX date rejected, same-day (both wire formats) passes, missing/garbage date passes through unvalidated.
- `S1-PERSIST-TPEX-4`: source-check — TPEX persist call site is actually gated by the new guard, with a traceable warning on mismatch.

Existing `SIM-LEDGER-19/20/21` and `S1-PERSIST-TPEX-1/2` assertions untouched and still pass (confirms zero behavior change on the re-exported name and no regression on the pre-existing TPEX persist wiring checks).

## Validation

- `pnpm run build:packages` — green (contracts/db/domain/auth/ui, 5/5 cached+built)
- `pnpm typecheck` — green (15/15 packages, including `@iuf-trading-room/api`)
- `pnpm test` — 1598 tests (4 new), 1588 pass, 2 fail (pre-existing `finmind-client.test.ts` T3/T11 `FINMIND_TOKEN` env leak — reproduced identically on clean `git stash` = origin/main HEAD `36ce751b`, unrelated to this PR), 8 skipped, 0 cancelled
- `pnpm --filter @iuf-trading-room/api run build` — green (tsc, no errors)
- `pnpm smoke` — 1/1 PASS

One transient run showed a batch of `role-matrix.test.ts` ECONNREFUSED/cancelled
failures (port conflict from a stale process) — did not reproduce on immediate
re-run (confirmed flake, not a regression from this change).

## Lane note

`s1-sim-runner.ts` and the general (non-strategy) TWSE EOD cron block in
`server.ts` are outside this role's default file scope, but this round's
dispatch explicitly named both files and the root cause (continuation of the
#1192 line Jason authored) — treated as in-scope per existing team precedent
(see `jason_memory.md` 2026-07-09 entry re: same files under #1150/#1156/#1184/#1188/#1192).
No risk/broker/real-money paths touched.
