# Bruce — Commit Instructions (2026-05-05 Wave P1-P5)

Jason's Bash tool is non-functional. Bruce must run these commands.

## Step 1: Verify build

```bash
cd "C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP"
pnpm --filter @iuf-trading-room/api build
```

Expected: no TypeScript errors.

If build fails, look for errors in `apps/api/src/server.ts` around lines 4339-4634 (P5 block).

## Step 2: Stage files

```bash
git add apps/api/src/server.ts
git add evidence/w7_paper_sprint/
```

## Step 3: Commit

```bash
git commit -m "feat(api): paper E2E + diagnostics + lab bundles + company datasets (W8 product completion)"
```

## What was changed

All changes are in `apps/api/src/server.ts`:

- Added `type OhlcvBar` to companies-ohlcv import
- P1: `GET /api/v1/auth/session-probe`
- P2: `GET /api/v1/diagnostics/finmind` + `recordFinMindFetch()` export
- P3: `POST /api/v1/paper/preview`, `POST /api/v1/paper/submit`, `GET /api/v1/paper/fills`, `GET /api/v1/paper/portfolio`
- P4: `POST /api/v1/lab/bundles/intake`, `GET /api/v1/lab/bundles`
- P5: 6 company dataset endpoints with `{ source, asof, data, _meta }` envelope

## Stop lines confirmed

- No KGI write-side
- No frontend changes
- No migration
- No mock data as live
- No token in any response

---

## ADDENDUM — Post-initial-write changes (2026-05-05)

### Financials route rename

After the initial P5 write, Jason renamed the financials route to avoid H-series shadow:

- **Old path:** `GET /api/v1/companies/:symbol/financials`
- **New path:** `GET /api/v1/companies/:symbol/financials-v2`
- **Why:** Hono route `GET /api/v1/companies/:id/financials` already registered at line ~3759
  (H-series, uses UUID `:id`). Two routes with different param names but same path pattern
  create ambiguity. Rename removes the shadow cleanly.
- **File changed:** `apps/api/src/server.ts` line ~4468 (comment + `app.get(...)` path only)
- **Evidence updated:** `evidence/w7_paper_sprint/jason_p5_company_datasets_2026-05-05.md`
  section 3 now documents `/financials-v2` with rename note.

### Codex frontend note

Codex must use `/financials-v2` (not `/financials`) for the P5 FinMind envelope route.
H-series `/financials` (UUID-based) is a separate endpoint and should NOT be confused.

### PR #39 defer memo added

New file: `evidence/w7_paper_sprint/jason_pr39_post_w8_defer_2026-05-05.md`
Status: POST_W8_DEFER. Mike (migration auditor) on STANDBY, not active.

---

## Updated commit scope

```bash
git add apps/api/src/server.ts
git add evidence/w7_paper_sprint/jason_p5_company_datasets_2026-05-05.md
git add evidence/w7_paper_sprint/jason_pr39_post_w8_defer_2026-05-05.md
git add evidence/w7_paper_sprint/BRUCE_COMMIT_INSTRUCTIONS_2026-05-05.md
```

Suggested commit message (unchanged):

```
feat(api): paper E2E + diagnostics + lab bundles + company datasets (W8 product completion)
```
