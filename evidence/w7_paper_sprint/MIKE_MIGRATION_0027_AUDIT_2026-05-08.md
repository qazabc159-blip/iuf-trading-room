# Migration 0027 Audit — Mike 2026-05-08

## 1. Migration Intent

- Schema change: Add GIN functional index `daily_briefs_sections_fts_idx` on `daily_briefs.sections` JSONB column to accelerate full-text search via `to_tsvector('simple', ...)`.
- Corresponding sprint task: P3 brief history search endpoint (handoff row "brief 歷史搜尋 endpoint", Jason BG 1h).
- PR branch: `feat/api-brief-search-endpoint-2026-05-08` (PR #325)
- Forward + down pair: PRESENT

---

## 2. Schema Changes Summary

- New tables: none
- New columns: none
- New FKs: none
- New indexes: `daily_briefs_sections_fts_idx` ON `daily_briefs` USING GIN (functional expression on sections JSONB)
- Drops: none (down.sql only)
- Data changes: none

---

## 3. IUF Audit Checklist (§A-G)

| Section | Item | Result |
|---------|------|--------|
| A | Forward file present | PASS |
| A | Down file present (`0027_brief_search_index.down.sql`) | PASS |
| A | Down uses reverse-dependency order (index drop only, no tables) | PASS |
| A | Down uses `DROP INDEX IF EXISTS` | PASS |
| A | Forward → down → forward leaves no orphan state | PASS |
| B | FK cascade — N/A (index-only migration) | N/A |
| C | Idempotency — `CREATE INDEX IF NOT EXISTS` guard present | PASS |
| C | UNIQUE constraint — N/A (not a uniqueness index) | N/A |
| D | Index coverage — GIN index on sections FTS expression | SEE §4 |
| D | Duplicate index check — no overlap with existing `daily_briefs_workspace_date_idx` | PASS |
| D | PK unchanged | PASS |
| E | NOT NULL / DEFAULT / backfill — N/A (no column changes) | N/A |
| F | No DROP DATABASE / TRUNCATE | PASS |
| F | No production-only changes in generic migration | PASS |
| F | No data mutation | PASS |
| F | No secret / token in SQL | PASS |
| G | Numbering: 0027 is the next sequential number after 0026 in main | SEE §4 BLOCKER |
| G | File name describes intent clearly (`brief_search_index`) | PASS |
| G | Migration comment present with purpose | PASS |
| G | Sprint label in comment (W7 / date) | FAIL (comment says no sprint label) |

---

## 4. Findings — Priority Ranked

### BLOCKER

**[NUMBERING CONFLICT — 0027 RESERVED FOR kgi_orders]**

My schema topology (recorded 2026-05-07, confirmed against current main) documents:

> `0027 | kgi_orders | NOT YET WRITTEN — design spec in runbook §D | pending Jason DRAFT after 楊董 ack`

Jason's KGI live trade runbook (`evidence/w7_paper_sprint/MIKE_KGI_5_12_SHELF_READY_RUNBOOK_2026-05-07.md §D`) pre-assigned 0027 to `kgi_orders`, 0028 to `kgi_fills`, 0029 to `kgi_positions`, 0030 to `kgi_reconciliation`.

This PR uses `0027_brief_search_index.sql`. If merged as-is, when Jason later writes the KGI migration it will collide on number 0027, causing `migrate.ts` to either skip or re-apply the wrong migration depending on sort order.

- File: `packages/db/migrations/0027_brief_search_index.sql`
- Risk: Migration numbering collision — `migrate.ts` applies files in sorted order; a second `0027_*.sql` will cause non-deterministic promotion order or duplicate-apply error
- Fix: Renumber this migration to 0027_brief_search_index does NOT have a reserved slot — Jason must confirm whether the KGI runbook's 0027-0030 reservation is still live (楊董 has not acked KGI write-side as of 5/8 stop-line). If KGI 0027-0030 reservation is still intended, Jason renames this file to `0028_brief_search_index.sql` (and its down pair). If KGI reservation is released, document that explicitly and keep 0027 for this migration.

**Escalation note**: This is a coordination blocker between Jason's brief-search work and the KGI live trade migration sequence. Elva must arbitrate before promotion.

---

### YELLOW — Index Expression May Not Be Used by Planner

**[GIN FUNCTIONAL INDEX WITH CORRELATED SUBQUERY — Postgres planner matching risk]**

The index expression and the WHERE clause predicate in `server.ts:2284-2292` are textually equivalent after whitespace normalization. However, both use a correlated subquery over `jsonb_array_elements(sections)`. Postgres functional index matching works at the expression parse-tree level, but correlated subquery expressions inside a functional index are a known edge case: the planner must see the exact same expression tree in the WHERE clause as in the index definition.

Spot-check of the expression in the index vs the WHERE clause:

```
-- index definition:
to_tsvector('simple', COALESCE((SELECT string_agg(COALESCE(s->>'heading', '') || ' ' || COALESCE(s->>'body', ''), ' ') FROM jsonb_array_elements(sections) AS s), ''))

-- WHERE clause in server.ts:
to_tsvector('simple', COALESCE((SELECT string_agg(COALESCE(s->>'heading','') || ' ' || COALESCE(s->>'body',''), ' ') FROM jsonb_array_elements(sections) AS s), ''))
```

The expressions are semantically identical. Whitespace inside function argument lists is not significant in Postgres SQL parsing; both produce the same parse tree. This is NOT a blocker.

However, the GIN index on a functional expression involving a correlated subquery is a non-standard pattern. Postgres documentation states GIN indexes support functional expressions, but the Postgres query planner will only use the index if it can prove at planning time that the WHERE expression is the stored index expression. For correlated subqueries this proof is unreliable in Postgres 14-16. The index may be created successfully but silently fall back to sequential scan.

- File: `packages/db/migrations/0027_brief_search_index.sql`
- Risk: Index created, no error, but planner uses seq scan — the 7-row table makes this invisible today; it becomes a silent performance regression at 200+ briefs
- Recommendation: Jason should verify post-promotion with `EXPLAIN (ANALYZE, BUFFERS)` against the endpoint. A safer pattern would be a generated column `sections_fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', ...)) STORED` with a GIN index on that column (standard, unambiguous planner target). This is a schema design change — bring to Elva to decide if post-promotion or new migration is warranted.
- For now: YELLOW. The ILIKE fallback in server.ts means this is a performance degradation, not a correctness failure.

---

### NITs

1. **Sprint label missing in forward migration comment header**: The comment block does not include `-- W7 Day1 — ...` sprint label per IUF migration hygiene rule (§G item 4). Low risk but deviates from convention. Jason can address in next cleanup pass.

2. **CONCURRENTLY not used**: `CREATE INDEX IF NOT EXISTS` without `CONCURRENTLY` will hold a ShareLock on `daily_briefs` during build. At 7 rows this is sub-millisecond. Flag only for future awareness when table exceeds ~50k rows.

---

## 5. Rollback Dry-Run Plan

If this migration runs in production and must be rolled back:

1. Elva or Bruce runs down.sql: `DROP INDEX IF EXISTS daily_briefs_sections_fts_idx;`
2. `migrate.ts` does not track applied migrations in a table (file-sorted apply) — confirm this is safe by verifying no migration state table records 0027 as applied (check Railway DB logs post-promote)
3. After drop, `GET /api/v1/briefs/search` automatically falls back to ILIKE (handler already handles FTS failure gracefully via try/catch)
4. No data loss possible — this is an index-only migration; no column or row changes

Estimated rollback time: under 1 second (single DROP INDEX on 7-row table).
Data loss risk: ZERO.

---

## 6. Verdict

- [ ] APPROVED
- [x] NEEDS_FIX — 1 blocker (numbering collision with KGI 0027-0030 reservation)
- [ ] BLOCKED

**VERDICT: NEEDS_FIX**

Blocker count: 1 (§G numbering collision)
Yellow notes: 1 (GIN correlated subquery planner risk — non-blocking, monitor post-promote)
Nits: 2 (sprint label, CONCURRENTLY)

The forward+down SQL itself is structurally correct, idempotent, and reversible. The blocker is coordination: Jason must resolve the 0027 number slot against the KGI migration reservation before this can be promoted.

---

## 7. Re-audit Required

YES — after Jason renames migration to resolved number (0027 or 0028 depending on Elva/Jason KGI reservation decision). Re-audit scope is numbering check only; SQL content can be PASS-carry-forward.

---

Auditor: Mike
Date: 2026-05-08
Migration: 0027_brief_search_index.sql + 0027_brief_search_index.down.sql
PR: #325 (feat/api-brief-search-endpoint-2026-05-08)
