# PR #236 Desk Review — Pete 2026-05-07

## 1. PR Intent
- Add `GET /api/v1/companies/:id/quote/realtime` — single aggregated snapshot (lastPrice/bid/ask/volume/freshness/state/source/updatedAt) for frontend company page 5s poll pattern.
- Sprint task: W7 BLOCK #5 Axis 2 "凱基系統即時報價"
- Base branch: main (commit a89a770 squash onto HEAD)

## 2. Diff Summary
- 2 files changed: apps/api/src/server.ts (+137L), evidence/w7_paper_sprint/jason_kgi_quote_realtime_audit_2026-05-07.md (+103L)
- LOC: +240 / -0

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [PASS] No KILL_SWITCH / EXECUTION_MODE toggle in diff
- [PASS] No place_order / submit_order / kgi.order.create reference in new code
- [PASS] No /order/create call — inline comment explicitly states "NO /order/create call (that route stays 409)"
- [PASS] Feature flag not applicable (read-only endpoint, no toggle needed)

### B. Auth / Secret Hygiene
- [PASS] Endpoint is under `/api/v1/*` — global middleware (line 301) requires valid iuf_session cookie; unauthenticated → 401 before handler runs
- [PASS] resolveCompany() called with c.get("session").workspace.slug — session is guaranteed by middleware
- [PASS] No hardcoded API key / token / password in diff
- [PASS] .env.example not modified (env vars KGI_QUOTE_STALE_THRESHOLD_MS / KGI_QUOTE_HARD_STALE_MS documented in freshness.ts comments)
- [PASS] Response body contains: symbol (public ticker), price data, state, source, timestamp — no person_id / userId / sessionId / account_no / token

### C. State / Schema Integrity
- [N/A] No DB schema change — no migration required
- [PASS] State enum LIVE/STALE/BLOCKED/NO_DATA is new (endpoint-local) — no existing contracts package dependency to sync
- [PASS] No state machine LEGAL_TRANSITIONS affected
- [PASS] No module-level mutable state introduced; getKgiQuoteClient() returns singleton, existing pattern

### D. PR Hygiene
- [PASS] Commit message: `feat(api): kgi realtime quote endpoint for company page frontend` — conventional commit, clear
- [PASS] Evidence file included (jason_kgi_quote_realtime_audit_2026-05-07.md)
- [PASS] PR description (commit message) lists hard lines + design rationale
- [PASS] Single-purpose PR — no scope creep detected

### E. IUF-Specific Not-Crossable
- [PASS] No lane crossing
- [PASS] No governance bypass
- [PASS] No /order/create call
- [PASS] No redaction violation — symbol is public ticker only

---

## 4. Findings — Priority Ranked

### Blockers
None.

### Suggestions

1. **[freshness expired state — silent downgrade]**: `freshness.ts` canonical model has 4 states (fresh/stale/expired/not-available). The legacy `classifyFreshness()` in `kgi-quote-client.ts` collapses `expired` → `"stale"` (3-state compat). The new endpoint receives this 3-state value and treats `freshness === "stale"` as state=STALE. This is technically correct for the current client, but if `getRecentTicks` is ever upgraded to return `expired`, the endpoint will silently show STALE instead of something clearer. Recommend: add a note in the endpoint comment that this relies on 3-state legacy shim and flag for upgrade when kgi-quote-client migrates to classifyFreshness4.

2. **[bidask failure not BLOCKED]**: If the tick leg succeeds (blockedReason stays null) but the bidask leg rejects, bid/ask remain null and state proceeds to LIVE/STALE (depending on freshness). Frontend receives state=LIVE with bid=null/ask=null — which is a valid degraded case but may surprise the UI. Suggest adding a `bidask_unavailable` flag or at least documenting this intentional partial-data contract in the evidence file.

### Nits

1. **[updatedAt is request time, not data time]**: `updatedAt = new Date().toISOString()` is stamped at request entry, before the gateway calls. If gateway calls take 200-400ms, `updatedAt` is slightly early. Minor — for a poll pattern the difference is negligible, but renaming to `respondedAt` or moving the stamp after Promise.allSettled would be more precise.

2. **[evidence file in diff]**: jason_kgi_quote_realtime_audit file is included in the PR commit. This is fine — matches team convention. No action needed.

### Praise
- Fake-live protection is solid: gateway down or symbol not whitelisted → BLOCKED with honest reason string, no 200+fabricated data. This is the exact pattern IUF wants.
- Promise.allSettled design is correct — tick and bidask failures are independent; partial data (price without spread) is better than no data.
- Auth flows through the existing /api/v1/* session middleware without any additional gate needed — correct by construction.
- Response shape precisely matches the specified contract: symbol, lastPrice, bid, ask, volume, freshness, state, source, updatedAt — all present, all typed.
- Stop-line proof documented in evidence file §5 — easy for Bruce to verify.

---

## 5. Verdict

- [x] APPROVED — 0 blockers. 2 suggestions (freshness 4-state future compat, bidask partial-data contract clarity). Both are forward-looking, not current bugs. Safe to ready.

## 6. Suggested Owner for Fixes
- Suggestion #1 → Jason (add comment in endpoint, track upgrade ticket)
- Suggestion #2 → Jason (document bidask-fail partial-data intent in evidence §5 or inline comment)
- Nit #1 → Jason (optional, low priority)

## 7. Re-review Required
NO — suggestions are documentation/clarity only, no logic change needed before merge.

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Paper Sprint
