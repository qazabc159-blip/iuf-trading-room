---
name: Bruce W5b Verify Harness Closeout
description: 8-item verify harness + auto-merge eligibility checklist + 15-stop-line audit + DRAFT blocker checklist
type: verify_harness
date: 2026-04-29
sprint: W5b
main_head: 49deb87
verdict: VERIFY_HARNESS_FILED_AUTO_MERGE_GATE_DOCUMENTED
prepared_by: Bruce (via Elva W5b dispatch)
---

# Bruce W5b Verify Harness Closeout (2026-04-29)

W5b Lane D deliverable. Establishes the **auto-merge gate** for W5b cosmetic / test-only / docs-only PRs and documents the **DRAFT blocker checklist** for any PR that attempts auto-merge but trips a stop-line.

Bruce has **hard veto** on auto-merge per W5b H16. Any PR that fails any of W9.1-W9.7 below cannot squash-merge; it must convert to DRAFT and await 楊董 review.

---

## §W9.1 — No-order grep (re-run on each candidate PR)

**Patterns** (case-insensitive where appropriate):
```
placePaperOrder
place_order
submit_order
createOrder
\.post\(["'].*order
\/order\/create
\/api\/v1\/trading\/orders
```

**Targets**: `apps/web/`, `apps/api/src/`, any added test files in PR diff.

**Exemption**: existing 4 baseline `/api/v1/trading/orders` declarations in `apps/web/lib/api.ts` (unreachable per D1+D2). PR diff MUST NOT add to this count.

**PASS criterion**: 0 NEW hits in PR diff.
**FAIL action**: BLOCK auto-merge; convert to DRAFT.

---

## §W9.2 — Frontend visual smoke (build + typecheck)

**Commands**:
```powershell
cd apps/web
pnpm typecheck
pnpm build
```

**PASS criteria**:
- `pnpm typecheck` exits 0
- `pnpm build` exits 0
- 17/17 page count maintained (no page lost)
- 0 errors in build output

**FAIL action**: BLOCK auto-merge.

---

## §W9.3 — Backend read-only route diff audit

**Method**:
```powershell
git diff main..HEAD -- services/kgi-gateway/app.py apps/api/src/server.ts
```

**PASS criteria**:
- 0 new public route added in apps/api server.ts
- 0 new route added in services/kgi-gateway/app.py
- 0 modification to `/order/create` handler (gateway 409 unchanged)
- 0 modification to apps/api `/order/*` (still 404)
- 0 modification to auth middleware

**FAIL action**: BLOCK auto-merge — convert to DRAFT for 楊董 review.

---

## §W9.4 — Wording audit

**Forbidden strings** (any hit blocks auto-merge):
```
paper-ready
paper ready
live-ready
live ready
production-ready
production ready
production-trading-ready
auto-trading-ready
auto-trading ready
order-path-ready
TR-approved
broker-execution-ready
broker execution ready
approved-strategy
approved strategy
```

**Method**: grep PR diff for any of the above.

**PASS criterion**: 0 hits in PR diff.
**FAIL action**: BLOCK auto-merge.

---

## §W9.5 — Secret / redaction audit

**Forbidden patterns**:
```
^[A-Z][0-9]{9}$        (raw person_id)
<REDACTED:KGI_ACCOUNT>   (known account number — must be REDACTED in tests/fixtures)
KGI_LOGIN_PASSWORD      (literal password env var content, not just the name)
\.pfx                   (cert file content — file references OK if redacted)
sk-[a-zA-Z0-9]{40,}     (OpenAI key)
ghp_[a-zA-Z0-9]{36}     (GitHub token)
xoxb-                   (Slack bot token)
RAILWAY_TOKEN           (literal token value, not just var name)
```

**Method**: grep PR diff.

**PASS criterion**: 0 hits in PR diff. `<REDACTED_*>` placeholders OK.
**FAIL action**: BLOCK auto-merge — surface as Yellow zone immediately.

---

## §W9.6 — Public route behavior audit (post-build)

**Method**: For each PR that touches apps/api or services/kgi-gateway:
1. Confirm app starts (smoke):
   ```powershell
   cd apps/api; pnpm build; node dist/server.js  # background
   curl http://127.0.0.1:3000/health             # expect 200
   curl -X POST http://127.0.0.1:3000/api/order/create -d '{}' # expect 404
   ```
2. Confirm gateway behavior unchanged (if gateway code touched):
   ```powershell
   cd services/kgi-gateway; pytest -q  # expect 45/45 PASS in <2s
   ```

**PASS criteria**:
- `/health` 200
- `/api/order/create` → 404
- pytest 45/45 PASS (or higher if new tests added — never lower)

**FAIL action**: BLOCK auto-merge.

**Note**: For docs-only / evidence-only / test-only PRs that do NOT touch route handlers, this section is N/A.

---

## §W9.7 — Auto-merge eligibility checklist (composite gate)

A PR is **auto-merge eligible** if ALL of the following are true:

| # | Gate | Source |
|---|---|---|
| 1 | W9.1 no-order grep PASS | this doc |
| 2 | W9.2 typecheck + build PASS | this doc |
| 3 | W9.3 route diff PASS | this doc |
| 4 | W9.4 wording audit PASS | this doc |
| 5 | W9.5 secret audit PASS | this doc |
| 6 | W9.6 public route behavior PASS | this doc |
| 7 | PR is one of: docs-only / evidence-only / test-only / wording-only / frontend cosmetic-only / backend test-helper-only | W5b directive §A2 |
| 8 | PR adds 0 dependencies (no pnpm-lock.yaml or package.json `dependencies` change) | H17 |
| 9 | PR adds 0 new public routes | H17 / W9.3 |
| 10 | PR does NOT modify auth | W9.3 |
| 11 | PR does NOT modify D1 or D2 gates | H14 |
| 12 | PR does NOT touch `/order/create` or `/api/v1/trading/orders` enabling-direction | H4 / W9.1 |
| 13 | PR does NOT mutate `IUF_SHARED_CONTRACTS` | H1 |
| 14 | GHA CI on PR HEAD = success | H15 |

**ALL 14 gates PASS** → auto-merge via `gh pr merge --squash --delete-branch=false`.
**ANY gate FAIL** → BLOCK; convert to DRAFT; surface to 楊董.

---

## §W9.8 — DRAFT blocker checklist (force DRAFT-only)

A PR MUST be DRAFT-only (no auto-merge possible) if ANY of the following is true:

| # | DRAFT trigger |
|---|---|
| 1 | Adds new public API route |
| 2 | Modifies existing route behavior (status code, response shape, auth requirement) |
| 3 | Implements T7 whitelist fail-closed change |
| 4 | Implements `/freshness` endpoint |
| 5 | Implements `/order/*` structured envelope (any handler addition) |
| 6 | Modifies WS `/events/order/attach` behavior beyond passive listening |
| 7 | Adds any dependency (pnpm-lock.yaml diff non-trivial, package.json deps change) |
| 8 | Touches authentication middleware |
| 9 | Modifies feature-flags.ts default values |
| 10 | Modifies `services/kgi-gateway/config.py` defaults |
| 11 | Touches Railway env var requirements (README of any deploy scope) |
| 12 | Production UI behavior beyond cosmetic polish |

If any trigger fires, Bruce blocks auto-merge regardless of other gates passing. PR is converted to DRAFT and awaits 楊董 review.

---

## §W9.9 — 15-stop-line live audit

These are continuously monitored by Bruce during W5b. Any trigger → immediate Yellow surface to Elva → Yellow surface to 楊董 → halt sprint.

| # | Stop-line | Detection method |
|---|---|---|
| 1 | `/order/create` touched in enabling direction | W9.3 + W9.6 |
| 2 | Active order submit appears in frontend | W9.1 |
| 3 | Default UI calls `/api/v1/trading/orders` | W9.1 |
| 4 | Default UI calls `/order/create` | W9.1 |
| 5 | paper/live wording appears | W9.4 |
| 6 | production-trading-ready wording appears | W9.4 |
| 7 | Contracts mutation needed | grep `IUF_SHARED_CONTRACTS` HEAD reference |
| 8 | Secret / account raw / token in diff | W9.5 |
| 9 | Gateway restart needed | manual surface |
| 10 | KGI relogin needed | manual surface |
| 11 | Deployment beyond standard CI | manual surface |
| 12 | Test failure not resolved within scope | W9.2 / W9.6 |
| 13 | Public route behavior change attempts to auto-merge | W9.7 gate 9 + W9.8 trigger 2 |
| 14 | New dependency attempts to auto-merge | W9.7 gate 8 + W9.8 trigger 7 |
| 15 | Athena lab-side task drafted by Elva | manual cross-check (Lane G) |

**Status this round**: 0/15 triggered.

---

## §W9.10 — W5b auto-merge gate decision (current state)

For W5b candidate PRs (none yet opened):
- **Jim Lane C cosmetic PR** (when opened): expected to PASS all 14 gates W9.7. Auto-merge eligible.
- **Jason Lane B test-only freshness utility PR** (if opened): expected to PASS all 14 gates if scoped to extract-only with tests. Auto-merge eligible.
- **Jason Lane B route behavior PRs** (T7 whitelist impl, `/freshness` endpoint, etc.): MUST be DRAFT per W9.8 triggers 1-3. NO auto-merge.

**Bruce stance**: ready to verify on demand. Will not pre-emptively run gates against non-existent PRs. Any PR opened triggers full W9.1-W9.7 sweep.

---

## §W9.11 — Hard lines (Lane D aggregate)

- 17/17 W5b hard-lines monitored
- 0/15 stop-lines triggered at this filing
- Bruce has hard veto on auto-merge (per H16)
- 0 PR auto-merged this filing (none opened yet)
- 0 production code edited by Bruce
- 0 secrets read by Bruce
- 0 KGI login attempted by Bruce

---

## §W9.12 — Verdict

**VERIFY_HARNESS_FILED_AUTO_MERGE_GATE_DOCUMENTED**

Bruce Lane D delivers 7 verify checklists (W9.1-W9.7) + 1 DRAFT blocker checklist (W9.8) + 15-stop-line audit (W9.9). Auto-merge gate is **active and ready** for any candidate PR. No PR has been opened in W5b yet — when one is opened (Jim cosmetic or Jason freshness test-only), Bruce will run full gate.

Bruce will NOT auto-merge any PR that fails any gate. Any failure surfaces as Yellow zone to Elva → 楊董.

---

— Bruce (via Elva W5b dispatch), 2026-04-29
**Verdict**: VERIFY_HARNESS_FILED_AUTO_MERGE_GATE_DOCUMENTED. 7 verify checklists + 1 DRAFT blocker + 15 stop-lines. 0/15 triggered. 0 PR auto-merged this filing.
