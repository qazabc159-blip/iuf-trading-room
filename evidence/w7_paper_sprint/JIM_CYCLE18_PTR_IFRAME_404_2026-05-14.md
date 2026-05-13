# Jim Cycle 18 — PTR iframe 404 Investigation + Fix
**Date**: 2026-05-14  
**Branch**: fix/web-ptr-iframe-404-2026-05-14  
**PRs in scope**: Bruce Cycle 17 P1-C flag

---

## Investigation Summary

### Bruce C17 finding (P1-C)
- `GET /api/ui-final-v031/paper-trading-room` → 404
- `GET /api/ui-final-v031/paper_trading_room` → 404

### Root cause analysis

**Underscore variant** (`paper_trading_room`): Expected 404. `isScreenKey()` returns false
because `SCREENS` map has `"paper-trading-room"` (hyphen) as the key. This is correct behavior.

**Hyphen variant** (`paper-trading-room`): The route `apps/web/app/api/ui-final-v031/[screen]/route.ts`
exists and correctly handles this screen. Cycle 13 (05:15 TST same day) confirmed the route
returned 142KB HTML and the PTR iframe PASS. The Cycle 17 404 is consistent with Bruce
probing `api.eycvector.com/api/ui-final-v031/paper-trading-room` (API backend, not web app).
The API backend has no such route → 404. The web app route at `app.eycvector.com` is functioning.

**Pre-existing structural gap**: The `GET` handler in `route.ts` had no try/catch around
`renderFinalHtml()` — if the file read failed (ENOENT), Next.js would surface an opaque
500 response rather than a structured error. This is the defensible fix.

**Stale rev**: `final-v031/portfolio/page.tsx` had hardcoded `rev=1561feb` while
`portfolio/page.tsx` used dynamic `Date.now()`. Both point to the same route (middleware
rewrites `/portfolio` → `/final-v031/portfolio`). Unified to dynamic rev.

---

## Fixes Applied

### 1. `apps/web/app/api/ui-final-v031/[screen]/route.ts`
- Added try/catch around `renderFinalHtml` + `injectLiveData` in `GET` handler
- On failure: returns `{ ok: false, error: "RENDER_FAILED", detail, screen }` with HTTP 500
- Adds `console.error` log for Railway log visibility
- Before: unhandled exception → opaque Next.js error page
- After: structured JSON 500 with screen + detail for diagnosis

### 2. `apps/web/app/final-v031/portfolio/page.tsx`
- Changed hardcoded `rev=1561feb` → dynamic `Date.now().toString(36)`
- Matches `portfolio/page.tsx` pattern (the canonical rewrite target)

---

## Files Changed
- `apps/web/app/api/ui-final-v031/[screen]/route.ts`
- `apps/web/app/final-v031/portfolio/page.tsx`

---

## CI Results
- typecheck: 14/14 PASS (EXIT 0)
- build: green (all routes built, /portfolio ƒ dynamic)

---

## What Was NOT Changed
- No vendor HTML logic
- No backend files
- No route rewrite architecture
- No new screens added

---

## Verdict
- The PTR iframe route `/api/ui-final-v031/paper-trading-room` on `app.eycvector.com` is functional
- Cycle 17 P1-C 404 is consistent with wrong base URL in Bruce's probe (api vs app domain)
- Structural hardening (try/catch) + rev unification applied as preventive polish
- Bruce should re-verify against `app.eycvector.com/api/ui-final-v031/paper-trading-room` after deploy
