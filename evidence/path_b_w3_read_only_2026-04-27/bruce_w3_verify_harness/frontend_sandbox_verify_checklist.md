---
name: W3 Frontend Sandbox Verify Checklist
description: Lane C 接通後可跑的 verify checklist；Jim v0.7.0 sandbox W3 increment；含 sandbox-only proof / wording lock / typecheck-build / no order button grep
type: verify_checklist
date: 2026-04-27
sprint: W3
lane: C
runner: Bruce (verifier-release-bruce)
sandbox_root: evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/
depends_on: Jim sandbox closeout doc + Lane B2 K-bar shape locked
---

# W3 Frontend Sandbox Verify Checklist

## §0. Pre-conditions

- [ ] Jim sandbox closeout doc exists: `evidence/design_handoff_2026-04-26/v0.7.0_work/v0.7.0_package/jim_w3_sandbox_closeout_2026-04-27.md`
- [ ] Lane B2 K-bar shape locked (`{ time, open, high, low, close, volume }`)
- [ ] Sandbox dir exists: `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/`

---

## §1. Sandbox-Only Proof (0 Production Touch)

**Success criterion**: W3 Lane C changes are 100% inside sandbox dir. Zero diff to `apps/web/`.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| S1.1 | apps/web has 0 modifications | `git diff HEAD -- apps/web/` | Zero output (no production web changes) | |
| S1.2 | apps/api has 0 modifications from Jim | `git diff HEAD -- apps/api/src/` (attribute to Jim scope) | Zero output for files Jim is responsible for | |
| S1.3 | Sandbox file list in closeout | Read closeout doc — "Touched scope list" section | All touched files are under `evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/**/*` | |
| S1.4 | 0 production import in sandbox new code | `grep -rn "from.*apps/web\|import.*apps/web\|require.*apps/web" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/` | Zero matches | |
| S1.5 | 0 production API BASE hardcoded (must be env-driven) | `grep -rn "api\.eycvector\.com\|railway\.app\|localhost:3000" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/` | Zero hardcoded production URL (only `process.env.NEXT_PUBLIC_API_BASE` or similar) | |

---

## §2. Wording Lock — Containment + Locked Banner

**Success criterion**: OrderLockedBanner and position containment badge have correct wording. No paper-ready / live-ready / production-ready labeling.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| S2.1 | OrderLockedBanner exists | `ls evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/components/chart/OrderLockedBanner.tsx` | File exists | |
| S2.2 | OrderLockedBanner has 0 order button | `grep -n "<button\|onClick.*order\|<a.*order\|href.*order" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/components/chart/OrderLockedBanner.tsx` | Zero interactive elements pointing to order actions | |
| S2.3 | OrderLockedBanner wording comment confirms read-only | `grep -n "0 wording\|0 button\|read.?only\|locked" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/components/chart/OrderLockedBanner.tsx` | Comment(s) affirming containment intent present | |
| S2.4 | Position containment component exists | `ls evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/components/` (search for containment) | Position containment or equivalent placeholder present | |
| S2.5 | No paper-ready/live-ready label in rendered text | `grep -rni "paper.?ready\|live.?ready\|production.?ready\|paper.?trading\|live.?trading" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/` | Zero matches in rendered UI text (negative-context comments acceptable — see wording_audit.md) | |

---

## §3. No Order Button Grep

**Success criterion**: Sandbox has 0 order submission buttons wired to any live or mock /order/create endpoint.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| S3.1 | No /order/create URL in sandbox | `grep -rn "/order/create" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/` | Zero matches | |
| S3.2 | submitOrder only routes to /api/orders (mock path) | `grep -n "submitOrder\|/api/orders\|post.*order" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/api.ts` | `submitOrder` posts to `/api/orders` (mock fallback); NOT to `/order/create` or `/api/v1/kgi/order/create` | |
| S3.3 | OrderTicket component note: submit disabled in sandbox | `grep -n "disabled\|sandbox\|read.?only\|mockSubmit\|submitDisabled" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/components/portfolio/OrderTicket.tsx` | Submit gated (`submitDisabled` flag or equivalent) OR routed through mock-only path | |
| S3.4 | No direct href to /order/* navigation | `grep -rni "href.*\/order\|to.*\/order\|navigate.*\/order\|push.*\/order" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/` | Zero matches | |

**Note (W3 sprint open baseline)**: As of W3 open, `api.ts:143` routes `submitOrder` to `/api/orders` (mock-backed). `OrderTicket.tsx:120` calls this path. No direct /order/create wiring observed. This remains acceptable for sandbox (mock-only path) — flag only if it routes to KGI backend.

---

## §4. K-bar Integration Verification (sandbox)

**Success criterion**: Sandbox K-bar adapter uses correct KBar shape; mock data matches Lane B2 shape; WS subscribe path is sandboxed.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| S4.1 | kbar-adapter.ts exists | `ls evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/kbar-adapter.ts` | File exists | |
| S4.2 | KBar shape in adapter matches B2 shape | `grep -n "time.*open.*high.*low.*close.*volume\|KBar" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/kbar-adapter.ts` | Shape = `{ time, open, high, low, close, volume }` — same as B2 spec | |
| S4.3 | K-bar adapter has no-order guarantee comment | `grep -n "NO order\|0.*order\|read.?only" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/kbar-adapter.ts` | Negative guarantee comment present | |
| S4.4 | mock-kbar.ts data shape correct | `grep -n "time\|open\|high\|low\|close\|volume" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/mock-kbar.ts \| head -10` | Same 6 fields; no extra broker fields | |
| S4.5 | Endpoint unavailable → mock fallback, not crash | `grep -n "catch\|fallback\|mock\|error.*kbar\|fail" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/kbar-adapter.ts` | try/catch or fallback-to-mock on fetch failure | |
| S4.6 | subscribe_kbar WS not wired to production side | `grep -n "subscribe.*kbar\|kbar.*subscribe\|wss://\|ws://" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/lib/kbar-adapter.ts` | No production WS endpoint hardcoded; uses env var or mock | |

---

## §5. Typecheck + Build (sandbox)

**Success criterion**: Sandbox typecheck and build EXIT 0.

| # | Check | Command | Expected | Result |
|---|---|---|---|---|
| S5.1 | Sandbox typecheck EXIT 0 | `cd evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs && npx tsc --noEmit` | EXIT 0; 0 TS errors | |
| S5.2 | Sandbox build EXIT 0 | `cd evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs && npx next build` | EXIT 0 | |
| S5.3 | Production web typecheck still EXIT 0 | `pnpm --filter @iuf-trading-room/web typecheck` | EXIT 0 (Jim changes must not break production typecheck) | |
| S5.4 | Production web build still EXIT 0 | `pnpm --filter @iuf-trading-room/web build` | EXIT 0 | |

---

## §6. UI State Verification (static analysis)

**Success criterion**: Jim sandbox handles fresh / stale / no_data states; BidAsk 5 levels; tick tape; mock/live indicator.

| # | Check | Method | Expected | Result |
|---|---|---|---|---|
| S6.1 | Fresh/stale/no_data 3-state handling | `grep -rn "fresh\|stale\|no_data\|noData\|NO_DATA" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/` | All 3 states handled in FreshnessBadge or equivalent | |
| S6.2 | BidAsk 5-level display | `grep -n "5.*level\|bid.*5\|ask.*5\|BidAsk\|BidAskLadder" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/components/chart/BidAskLadder.tsx` | 5-level bid/ask present | |
| S6.3 | Mock/live source indicator | `grep -rn "DataSourceBadge\|mock.*indicator\|live.*indicator\|source.*badge" evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/src/` | DataSourceBadge or equivalent present | |
| S6.4 | Screenshots submitted (per Jim closeout) | Read closeout doc — screenshots section | fresh/stale/no_data + containment + order locked screenshots attached | |

---

## §7. Overall Frontend Sandbox Verify Verdict Template

```
Frontend Sandbox (Lane C) Verify Verdict
===
Date: <ISO>
Runner: Bruce
Sandbox: evidence/design_handoff_2026-04-26/v0.7.0_work/nextjs/

§1 Sandbox-only proof:    <PASS/FAIL — apps/web diff: 0 lines>
§2 Wording lock:          <PASS/FAIL>
§3 No order button:       <PASS/FAIL>
§4 K-bar integration:     <PASS/FAIL/PARTIAL>
§5 Typecheck + build:     <PASS/FAIL — sandbox EXIT X / prod EXIT X>
§6 UI state verification: <PASS/FAIL/PARTIAL>

Overall: <PASS / PARTIAL / BLOCKED>
Stop-line triggered: <Y/N + which>
Wording audit: <CLEAN / N findings (see wording_audit.md)>
Redaction audit: <CLEAN / N findings (see redaction_v1_audit.md)>
Surface to: Elva
```

— Bruce, 2026-04-27 (W3 frontend sandbox verify harness)
