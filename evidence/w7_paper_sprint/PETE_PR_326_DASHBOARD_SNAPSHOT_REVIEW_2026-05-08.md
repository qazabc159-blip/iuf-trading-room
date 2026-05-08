# PR #326 Desk Review — Pete 2026-05-08

## 1. PR Intent
- This PR upgrades `/api/v1/dashboard/snapshot` from a hardcoded meta-only shell to a real 6-panel fan-out aggregator.
- The aggregator calls existing handlers (no logic duplication), uses Promise.allSettled for fault isolation, and caches per userId for 30s.
- Corresponding sprint task: session_handoff.md §5/8 backlog P2 "`/api/v1/dashboard/snapshot` aggregation endpoint (vendor Path A)".
- Base branch: `main` (DIRTY merge state — stale EC2 deploy files from #319 will auto-drop on rebase, confirmed non-conflicting with real diff).

## 2. Diff Summary (actual, verified via `git diff main..branch --name-only`)

Real new/modified files in this PR:
- `apps/api/src/dashboard-snapshot-aggregator.ts` (+408 lines) — new aggregator
- `apps/api/src/__tests__/dashboard-snapshot.test.ts` (+215 lines) — T1-T4 tests
- `apps/api/src/server.ts` (+66/-118) — route wire + BUNDLED: announcements filter refactor

Files listed in task description but NOT in actual branch diff (already on main from PR #306):
- `apps/api/src/__tests__/quote-realtime-wire.test.ts` — pre-existing, ignore
- `apps/api/src/broker/kgi-quote-client.ts` — pre-existing, ignore

Additional files in diff (carry-forward from DIRTY merge state, will disappear on rebase):
- `services/kgi-gateway/deploy/*`, `.github/workflows/daily-prod-smoke.yml`, `apps/web/*`

LOC (real PR scope): +689 / -118 across 3 files.

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [PASS] No KILL_SWITCH / EXECUTION_MODE toggle in diff. The old placeholder route had `getExecutionFlagSnapshot()` which is REMOVED (not moved) in this PR — correct.
- [PASS] No `place_order` / `submit_order` / `kgi.order.create` in any new code.
- [PASS] No `/order/create` reference anywhere in aggregator or new route.
- [PASS] Feature flag: no new flags added. All panels are read-only.

### B. Auth / Secret Hygiene
- [PASS] `/api/v1/dashboard/snapshot` sits inside the global `app.use("/api/v1/*")` middleware (line 312 server.ts) which gates on `iuf_session` cookie. Auth is by construction — no per-route gap.
- [PASS] Additional READ_DRAFT_ROLES check (Owner/Admin/Analyst) at route entry — consistent with other draft-adjacent endpoints.
- [PASS] No hardcoded API key / token / password in any new file.
- [PASS] `.env.example` change: no new env vars added (the file change in diff is from DIRTY merge carry-over only).
- [WARN/YELLOW] `errors[panelName] = err.message` — raw Error `.message` is returned to the caller in the `errors` field. In a DB error, `err.message` may include the SQL query fragment, table name, or connection string segment. No token/person_id observed in test paths, but a postgres connection error (e.g. `connection to server at "host" ... failed`) would include the DB host. See Finding 2 below.
- [PASS] No person_id / userId / sessionId in response body. Cache key = userId (not exposed).

### C. State / Schema Integrity
- [PASS] No DB schema change. No migration files touched.
- [PASS] No enum changes.
- [PASS] No state machine modifications.
- [WARN] `_cache` is a module-level `Map<string, CacheEntry>`. TTL-only eviction, no size cap. Grows one entry per userId per server restart. See Finding 3 below.

### D. PR Hygiene
- [PASS] Branch name `feat/api-dashboard-snapshot-aggregation-2026-05-08` matches sprint pattern.
- [PASS] Commit message uses `feat(api):` conventional prefix.
- [PASS] PR description lists evidence path and hard rules. 204/204 CI PASS claimed.
- [FAIL] PR description does NOT call out the bundled `announcements` refactor in `server.ts`. The diff includes a non-trivial refactor of `marketNewsScore()` → `isMarketWideNews()` (boolean, simplified logic, term list reduced). This is out-of-scope for a "dashboard snapshot" PR title. See Finding 1 below.

### E. IUF-Specific
- [PASS] No agent lane crossings.
- [PASS] No governance bypass (DRAFT state maintained, no force-push to main).
- [PASS] No `/order/create` call anywhere.
- [PASS] No redaction policy violation. No PII in evidence or response.

---

## 4. Findings — Priority Ranked

### Blockers

None. Zero hard blockers found.

### Suggestions

**S1 — Bundled announcements filter refactor out of PR scope (server.ts)**

Location: `apps/api/src/server.ts` lines 5010-5213 (diff)

The branch diff includes a substantial refactor of `/api/v1/market-intel/announcements`:
- `marketNewsScore()` (numeric scoring function, ~70 LOC) replaced by `isMarketWideNews()` (boolean, ~25 LOC).
- High-signal market term list shrunk (降息/升息/CPI/PCE/非農/財測/NVIDIA/半導體展 removed).
- Broader market term list also shrunk.
- SQL LIMIT for market scope changed from `Math.max(limit * 20, 240)` to `Math.max(limit * 8, 80)`.

This refactor is unrelated to the dashboard snapshot feature and was not described in the PR description. It changes production behaviour of an existing live endpoint.

Recommended action: Elva ACK explicit. If Jason bundled this in the same commit by mistake, separate into its own PR. If intentional quality improvement, add a note to PR description that this was bundled + confirm no regression on announcements endpoint.

**S2 — `errors[panelName]` may surface DB error messages to authenticated callers**

Location: `dashboard-snapshot-aggregator.ts` lines 354-358 and `server.ts` line 7447

Raw `Error.message` from a DB failure (e.g. postgres connection error, SQL parse error) is returned verbatim in the `errors` record. Postgres error messages can include host:port, schema details, or column names.

Callers are authenticated (Owner/Admin/Analyst), so this is not a public leak. However it violates defence-in-depth and may expose infra topology to a compromised Analyst account.

Recommended fix: sanitize error messages before surfacing — either truncate to first 100 chars, strip host/port patterns, or return a generic `"panel_fetch_failed"` string with the real message logged server-side only. The `console.warn` call already logs the message server-side; the `errors` field in the response can be less specific.

**S3 — `audit_stats` panel missing `content_draft.factual_reject` vs canonical endpoint**

Location: `dashboard-snapshot-aggregator.ts` lines 244-254 (IN clause)

The canonical `/api/v1/internal/observability/audit-stats` endpoint (server.ts line 9276) includes `content_draft.factual_reject` (Layer 5 factual reviewer) in its IN clause and exposes `factual_reject` in the response.

The new `fetchAuditStatsPanel()` IN clause omits it:
```
'content_draft.ai_approved',
'content_draft.ai_rejected',
'hallucination_reject',
'content_draft.adversarial_audit',
'content_draft.ai_yellow_held',
'paper_submit'
```

The snapshot `audit_stats.factual_reject` will always be `undefined`. This creates a silent discrepancy between the dashboard snapshot and the dedicated audit-stats endpoint.

Recommended fix: add `'content_draft.factual_reject'` to the IN clause and expose `factual_reject` in the return object (and in the no-db fallback).

**S4 — `_cache` unbounded growth (no MAX_USERS eviction)**

Location: `dashboard-snapshot-aggregator.ts` lines 56-75

The in-process `_cache: Map<string, CacheEntry>` evicts individual entries only when they are read past their TTL (lazy eviction on `getCached()`). If userId A's entry is never read again, it persists until process restart.

At current user volume (single operator) this is harmless. For future multi-user expansion, a FIFO cap (MAX 200 entries, evict oldest on insert when over limit) is the established IUF pattern (see PR #273 FIFO Map eviction pattern in memory).

Recommended fix: add eviction at `setCache()` when `_cache.size > MAX_CACHE_ENTRIES` (suggested: 500). One-liner using the FIFO `Map.keys().next().value` / `.delete()` pattern.

**S5 — `adversarialIntercept` and `aiYellowHeld` may double-count the same brief event in `total`**

Location: `dashboard-snapshot-aggregator.ts` line 291

A brief with adversarial score >= 7 fires BOTH `content_draft.adversarial_audit` (counted in `adversarialIntercept`) AND `content_draft.ai_yellow_held` (counted in `aiYellowHeld`). The `total` sums both. For the same brief intercept event, `total` is incremented by 2.

This matches the same semantic concern in the canonical audit-stats endpoint (carried forward from PR #292/PR #296). It is not a safety issue, but the `total` field will over-count intercept events.

Recommended fix: either document the double-count explicitly in the field description, or exclude `adversarialIntercept` from `total` (since it is a subset of `aiYellowHeld` for the score>=7 path). Align with whatever decision is made for the canonical endpoint.

### Nits

**N1 — T2 test does not actually inject a panel failure**

Location: `dashboard-snapshot.test.ts` lines 80-125

T2 is titled "one panel fails — partial success" but the test body falls back to running in memory mode where all panels gracefully return empty results (no throw). The `stale_panels` error-capture path through `resolvePanel()` is never exercised — the test only verifies the shape contract (same as T1, different userId).

The real `resolvePanel(name, rejected, fallback)` branch (when `result.status === "rejected"`) has zero test coverage.

Recommended improvement: inject a thrown error via a mock import or dependency injection hook. If full DI is not available, consider exporting individual panel fetcher functions for direct testing. Current T2 is effectively a duplicate of T1 with a different userId assertion added.

**N2 — `watchlist_quotes` upgrade path documented in code only, not in response or backlog**

Location: `dashboard-snapshot-aggregator.ts` lines 312-317

The function comment documents the future shape `{ symbol, lastPrice, state, source }`. The `[]` return is acceptable as a placeholder. However the HTTP response has no `_note` field explaining to the Codex frontend that this panel is a placeholder and will be populated when the watchlist table exists.

Per the "Vendor aggregate endpoint honest-empty pattern" (memory, PR #294), adding `_watchlist_note: "watchlist table not yet provisioned — always []"` to the snapshot (or documented in a Codex channel letter) would prevent the frontend from treating `[]` as "user has empty watchlist" vs "feature not yet available".

---

## 5. Verdict

**NEEDS_FIX (S1 requires Elva explicit ACK before merge)**

The dashboard snapshot aggregator is functionally sound:
- Promise.allSettled correctly used, zero rejection silent-loss.
- Cache key is userId — user A cannot see user B's snapshot.
- Existing handler functions are reused (no logic duplication).
- Auth chain is correct (global middleware + READ_DRAFT_ROLES).
- No order/broker/risk mutation touched.
- No kill-switch, no real-order path, no secret leak.

The single blocker-equivalent item is S1 (bundled announcements refactor): a live endpoint's scoring logic was changed in the same commit without description. This is a scope hygiene issue, not a functional safety issue. Elva ACK resolves it.

S3 (factual_reject missing) is a silent inconsistency — should be fixed before merge but is not a safety blocker. S2/S4/S5 are hardening items that can land in a follow-up.

---

## 6. Suggested Owner for Fixes

- S1 (announcements refactor ACK or separate PR) → Elva decision, then Jason BG if split needed
- S2 (error message sanitization) → Jason BG, 1-line fix
- S3 (`factual_reject` IN clause) → Jason BG, 2-line fix
- S4 (cache eviction cap) → Jason BG, 3-line fix
- S5 (total double-count comment) → Jason BG, comment only
- N1 (T2 real failure injection) → Jason BG, test improvement
- N2 (watchlist _note) → Jason BG or Codex channel letter

---

## 7. Re-review Required

NO — after S1 Elva ACK and S3 fix are confirmed, Pete re-review not required. S2/S4/S5/N1/N2 can be tracked separately without blocking merge.

---

## Praise

- The `resolvePanel()` helper is clean and correctly handles all three cases: success value, rejection with Error, rejection with non-Error reason. The fallback shapes are consistent and thoughtful.
- `adversarialIntercept` correctly uses the `severityScore >= 7` JSONB filter — this was a known anti-pattern in earlier PRs (#292) and is done right here.
- `paperSubmitRejected` is correctly excluded from `total` (it is a JSONB-filtered subset of `paper_submit`, consistent with PR #296 approved pattern).
- The `_clearDashboardCache()` export is a clean test seam — no awkward timer manipulation needed for cache tests.
- Dynamic `await import("./dashboard-snapshot-aggregator.js")` in the route handler is the correct IUF pattern for lazy-loaded aggregator modules (avoids circular dep risk at module load time).

---

Reviewer: Pete
Date: 2026-05-08
Sprint: W7 Day 10 (paper sprint final day)
Auto-merge clearance (Elva): **After rebase clears DIRTY state + Elva ACK on bundled announcements refactor (S1) + S3 factual_reject fix confirmed — then CLEAR TO MERGE.**
