# PR #267 Re-Review (Blocker #2 only) — Pete 2026-05-07

## Scope of this re-review
Original review found 2 blockers:
- Blocker #1: 0024 rename conflict → resolved by Jason rebase (force-push round 4)
- Blocker #2: R02/R03 rule name "三大法人" but SQL only checked `foreign_investors_buy_net` (single-column drift) → Jason rewrote with CTE pattern

This re-review verifies only blocker #2 fix. All other findings from the original review stand.

---

## Blocker #2 Re-verification

### What Jason changed

Old (broken): single-column HAVING on `foreign_investors_buy_net`.

New: CTE `daily_net` decomposes each day into three conditional sums, then outer query uses:

```sql
COUNT(*) FILTER (WHERE foreign_net > 0 AND trust_net > 0 AND dealer_net > 0) >= 5
```

R02 (buy): `foreign_net > 0 AND trust_net > 0 AND dealer_net > 0`
R03 (sell): `foreign_net < 0 AND trust_net < 0 AND dealer_net < 0`

Rule name updated to "三大法人連5日同向買進" / "三大法人連5日同向賣出" in both `name` field and `ruleName` in returned events. Matches spec.

### LIKE pattern analysis — NEW BLOCKER FOUND

The CTE decomposition uses:

```sql
SUM(CASE WHEN name LIKE '%外資%' THEN (buy - sell) ELSE 0 END) AS foreign_net,
SUM(CASE WHEN name = '投信'      THEN (buy - sell) ELSE 0 END) AS trust_net,
SUM(CASE WHEN name LIKE '%自營%'  THEN (buy - sell) ELSE 0 END) AS dealer_net
```

Cross-referencing against the actual schema and production code:

- `finmind-client.ts` line 114 comment: `// 外陸資, 投信, 自營商`
- `server.ts` line 4783: `// FinMind uses 外陸資/投信/自營商 labels; 自營商 splits into 自營商(自行買賣) + 自營商(避險)`
- `server.ts` lines 4789-4791 (existing production aggregation):
  ```
  if (name.includes("外") || name.includes("陸")) foreignNet += net;
  else if (name.includes("投信")) trustNet += net;
  else if (name.includes("自營")) dealerNet += net;
  ```

**Critical mismatch:** The actual FinMind `name` value for foreign institutional investors stored in DB is `外陸資` — NOT `外資及陸資` and NOT any string containing the substring `外資`.

`外陸資` does NOT contain the substring `外資`. The LIKE pattern `'%外資%'` will match nothing against `外陸資`.

SQL test: `'外陸資' LIKE '%外資%'` → FALSE (the sequence 外→資 does not appear in 外→陸→資).

Result: `foreign_net` will be 0 for every row in every stock. The HAVING clause `foreign_net > 0 AND trust_net > 0 AND dealer_net > 0` will never fire. R02 will return 0 events in production.

R03 is symmetric: `foreign_net < 0` also never fires. R03 will return 0 events in production.

The fix is correct in structure but wrong in the LIKE predicate for the foreign investor lane.

**Correct pattern** (matching the existing server.ts production logic):
```sql
SUM(CASE WHEN name LIKE '%外%' OR name LIKE '%陸%' THEN (buy - sell) ELSE 0 END) AS foreign_net,
```
Or more precisely:
```sql
SUM(CASE WHEN name LIKE '%外陸%' THEN (buy - sell) ELSE 0 END) AS foreign_net,
```

`投信` exact match is correct.
`LIKE '%自營%'` will match both `自營商(自行買賣)` and `自營商(避險)` — correct.

### Conflict status (blocker #1)

`gh pr view 267 --json mergeable,mergeStateStatus` returns `DIRTY / CONFLICTING`.

The rebase did not resolve the conflict. The 0024 rename conflict is still present.

---

## IUF Blocker Checklist (re-check scope)

- [A] Kill-switch / real-order: N/A — event engine is read-only; no order submission paths touched. PASS
- [B] Auth: GET /api/v1/alerts checks `c.var.session` with 401 guard. POST /ack same. SSE same. Owner-only dispatch endpoint checks role. PASS
- [B] Secret hygiene: no new secrets introduced. PASS
- [C] Migration: 0025 remains DRAFT (not promoted). PASS. 0024 conflict still present. FAIL (still blocking merge)
- [D] PR hygiene: base branch = main. Title follows conventional commits. PASS

---

## Findings

### 🔴 Blockers

1. **R02/R03 `name LIKE '%外資%'` does not match actual FinMind value `外陸資`**
   - Location: `openalice-event-rule-engine.ts` lines 148, 195
   - Root cause: FinMind API returns `name = '外陸資'` for foreign institutional investors. The substring `外資` does not appear in `外陸資`. The CTE `foreign_net` column will always be 0, making the HAVING clause never fire. Both R02 and R03 will produce zero events in production.
   - Correct fix: change LIKE to `name LIKE '%外%'` or `name LIKE '%外陸%'` — matching the existing server.ts pattern at line 4789.
   - Suggested fix owner: Jason

2. **0024 rename conflict still present**
   - `gh pr view 267 --json mergeable,mergeStateStatus` → `DIRTY / CONFLICTING`
   - Jason's force-push did not resolve the 0024 conflict. Another rebase against current main is needed.
   - Suggested fix owner: Jason

### ✅ Praise

- CTE decomposition pattern is architecturally correct. Decomposing into `(foreign_net, trust_net, dealer_net)` per day and then FILTER-COUNT is the right approach for a long-table schema. Three-component AND in the HAVING is exactly "三大法人" semantics.
- R03 symmetry (all three `< 0`) is correct for sell direction.
- Rule `name` and `ruleName` fields in returned events now match the spec label "三大法人連5日同向買進/賣出".
- The CTE correctly handles the `自營商` split (matching `%自營%` catches both `自行買賣` and `避險` sub-rows).

---

## Verdict

**NEEDS_FIX** — 2 blockers remain.

Blocker #1 (0024 conflict): mechanical rebase, no logic change needed.
Blocker #2 (LIKE pattern mismatch): 1-line fix per rule (2 lines total).

After both fixed: functional logic is sound. No further re-review needed from Pete — both fixes are verifiable by grep.

---

Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Day 7
Original review: `evidence/w7_paper_sprint/PETE_PR267_DESK_REVIEW_2026-05-07.md`
