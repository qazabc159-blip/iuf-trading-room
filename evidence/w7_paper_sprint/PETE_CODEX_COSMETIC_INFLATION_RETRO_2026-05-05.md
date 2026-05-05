# Pete Retro — Codex apps/web PR Cosmetic Inflation Audit (5/5 reopen batch)

**Author:** Pete (PR reviewer / cosmetic-inflation auditor)
**Scope:** 14 Codex-authored PRs squash-merged to `origin/main` between 2026-05-05 08:00 TST and 2026-05-05 23:00 TST.
**Cross-ref:** `evidence/w7_paper_sprint/kline_incident_root_cause_2026-05-05.md` §3 D (PR #182 broken-counter evidence).
**Source of truth:** local `git log --since="2026-05-05 08:00"` + Elva → Codex channel files (`memory/board/codex_channel/elva_to_codex_2026-05-05_*PR*`).

---

## §1 PR-by-PR scorecard

| PR | Title | Scope | Trade-Capability Score | Inflation type | Evidence |
|---|---|---|---|---|---|
| #167 | polish company kline and order controls | apps/web only | **0** | A (spacing/copy/color) | git `68a3fb0`; cosmetic chart polish, no data path |
| #176 | reshape company data dock | apps/web only | **0** | A | git `738d068`; layout reflow only |
| #180 | docs: OpenAlice freshness dispatch | docs only | **0** | E (docs/evidence) | merge `36556ff`; doc-only |
| #181 | order desk spacing + kline | apps/web only | **0** | A | merge `e0234b3`; spacing + kline cosmetic |
| #182 | wire FinMind diagnostics dashboard | apps/web (panel reads existing endpoints) | **−1** (claimed +1) | **D (cosmetic claiming functional)** | merge `f1ab94f`; root-cause §3 D — `recordFinMindRequest()` not wired in `finmind-client.ts`; `requestCount` permanently 0; staff misread as "low traffic" instead of "never called" — directly enabled the 6-day silent ETL outage |
| #183 | paper ticket E2E routes (`/paper/preview` + `/paper/submit`) | apps/web → backend route binding | **+1** | not inflation (B class, real wiring) | merge `e7f7c9f`; only PR with genuine new route binding; covered by audit `post_merge_audit_PR183_paper_route_2026-05-05.md` |
| #184 | financial dock copy | apps/web only | **0** | A | merge `3412105` |
| #185 | OpenAlice brief freshness display | apps/web only (cookie existing `/briefs` + `/openalice/observability`) | **0** | C (wrapper-only) | merge `3e340ea`; freshness label, no backend correctness check |
| #186 | dashboard source freshness | apps/web only | **0** | B (freshness label without backend correctness) | merge `76125a2`; same pattern as #185 — labels existing endpoint freshness, doesn't validate that data is fresh |
| #187 | secondary source freshness label | apps/web only | **0** | B | merge `8f9b63c`; introduced `lib/source-freshness.ts`, label-only |
| #188 | docs: OpenAlice production freshness probe | docs only | **0** | E | merge `060b40e`; docs-only |
| #189 | dashboard source gap copy | apps/web only (+2/−2 lines + 2 evidence files) | **0** | A | merge `3031265`; literal 2-line copy edit |
| #190 | OpenAlice brief job freshness panel | apps/web only (read existing `/openalice/jobs`) | **0** | C | merge `1c14529`; new panel over existing endpoint, no new logic |
| #191 | daily brief draft gate panel | apps/web only (read existing `/content-drafts`) | **0** | C | merge `0a8993b`; another wrapper panel, local filter `targetTable === "daily_briefs"` because backend filter unreliable — surfaces existing data, doesn't fix it |

---

## §2 Aggregate

**Score distribution:** +1 ×1 (PR #183) / 0 ×12 / −1 ×1 (PR #182) → **net +0** across 14 PRs.

**Inflation-type distribution:**
- A (spacing/copy/color): 5 (#167, #176, #181, #184, #189)
- B (freshness label without backend correctness): 2 (#186, #187)
- C (wrapper-only / panel over existing endpoint): 3 (#185, #190, #191)
- D (cosmetic claiming functional): 1 (#182)
- E (docs/evidence only): 2 (#180, #188)
- Not-inflation (real wiring): 1 (#183)

13 of 14 PRs are 0 or negative trade-capability. Only PR #183 advanced paper E2E.

**Reject / require-revision recommendations:**
- **PR #182** — should have been HOLD-FIX with required `recordFinMindRequest()` wiring inside `finmind-client.ts` before merge. Currently shipping a UI panel that lies (always-zero counter). Requires post-merge corrective PR (per root-cause F4).
- **PR #185, #190, #191** — wrapper-only panels reading endpoints whose backend freshness was never validated. Not reject-worthy individually, but as a *pattern* they create false coverage: every "freshness panel" merged 5/5 was reading an ETL pipeline that had been dead since 4/25-4/29. Requires retroactive verification step (display freshness ≠ data freshness).

---

## §3 Could any of these 14 PRs have caught the K-line / ETL incident earlier?

**No.**

PR #182 specifically had the structural opportunity — a diagnostics dashboard whose entire purpose is to surface FinMind health — and missed it because the counter was never wired. The other 13 PRs are either pure cosmetic (A/E) or label-wrappers reading the same compromised data the user was already seeing as broken. None of them actually probed `kbar.latest_date` vs `today`, `briefs.latest_date` vs `today`, or made a non-trivial assertion about backend correctness.

This is the literal evidence that **the team was busy but nobody was validating product trust**. The frame from 5/5 reopen ("PROJECT COMPLETION 72h") created throughput pressure that rewarded merge-velocity over correctness verification — and the ABC policy's A-class auto-merge path was the unintended optimization target.

---

## §4 Recommendations for Codex (next round selection)

**Stop doing (next 48h):**
- Freshness *labels* without a paired backend assertion test (B class)
- Wrapper panels over existing endpoints that have not been live-probed in the same PR (C class)
- Diagnostics dashboards without a `recordX()` callsite grep proving the counter is wired (D class)

**Start doing:**
- **Live-probe-in-PR**: every PR touching a "source state" surface must include in `evidence/` a curl/PowerShell probe output proving the underlying endpoint returns non-stale data *at PR-open time*. If it's stale, the PR is filing a bug, not shipping a feature.
- **Data-freshness alert panel** (per root-cause F6): red badge on `/dashboard` if `kbar.latest_date < today−2` or `briefs.latest_date < today−2`. This is cosmetic-shaped but +1 because it surfaces real failure.
- **Counter-wiring proof**: any PR adding a metrics panel must include a grep showing the backend `record*()` callsite exists and is reached. PR #182 would have been blocked at this gate.

Codex is not a bad employee — Codex is operating exactly inside the safest path the policy carved (A-class auto-merge, apps/web only, no backend route changes). The throughput is real; the *direction* of that throughput is the issue.

---

## §5 Recommendation for Elva (Release Captain)

**Add a mandatory "Trade Capability Score" field to PR description template**, gated by ABC policy:
- A class: score must be **0 or +1** (cosmetic is fine when honestly labeled). −1 means "cosmetic claiming functional" → reject.
- B class: score must be **+1** with paired live-probe evidence. 0 (label-only) is rejected as wrapper-only-broken-pattern.
- C class: score must be **+1** with backend test coverage.

Concretely: add to PR description a required line `Trade-Capability-Score: [+1 | 0 | -1] reason=...`. Reviewer (Bruce/Pete) verifies the score matches the diff. Score=0 + class=B/C = automatic HOLD-FIX. Score=+1 with no live probe in `evidence/` = automatic HOLD-FIX.

This **does not weaken ABC policy** — A-class auto-merge stays. It adds a single typed field that forces the author to claim a score, and the reviewer to falsify it. PR #182 would have either been honestly scored 0 (then Pete would ask why a "diagnostics dashboard" scores 0 → uncovers broken counter), or dishonestly scored +1 (then live-probe requirement uncovers `requestCount=0` immediately).

---

## §6 Cross-check vs root-cause report

Elva's root-cause §3 D states PR #182's `recordFinMindRequest()` is not wired; my read of merge `f1ab94f` + `server.ts:4347` comment confirms this. **My conclusion agrees with Elva's. PR #182 score = −1 (claimed +1) is the correct call.**

The only delta vs Elva's report: Elva's §4 table scores PR #182 "0 → −1". My table scores it directly **−1**. The "claimed +1" is the inflation; the actual trade-capability is negative because staff read the always-zero counter as healthy-low-traffic for 6 days. Same conclusion, more direct framing.

---

**End. 14 PRs, 1 net +1, 1 net −1, 12 net 0. Codex did exactly what was asked; the asking was the bug.**

Pete, 2026-05-05.
