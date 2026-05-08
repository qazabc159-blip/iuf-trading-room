# AUDIT-STATS SILENT ZERO — ROOT CAUSE REPORT
Bruce | 2026-05-08 | READ-ONLY

## Status
VERDICT: ROOT_CAUSE_FOUND

---

## A. True Cause

**`db.execute()` result shape mismatch — `.rows` property does not exist on `postgres-js` driver output.**

The audit-stats endpoint casts `db.execute(drizzleSql\`...\`)` result as
`{ rows?: Array<{ action?: string; cnt?: number | string }> }` and then reads `rows.rows ?? []`.

With `drizzle-orm/postgres-js` (the driver in use per `packages/db/src/client.ts`),
`db.execute()` returns a **flat array** — there is no `.rows` wrapper property.
So `rows.rows` is always `undefined`, which falls through to `[]`, producing zero counts
for every metric on every query window (1h / 6h / 12h / 24h / 48h).

This affects all three sub-queries in the endpoint:
1. `rows` (GROUP BY action → main counts)
2. `rejRows` (paper_submit_rejected COUNT)
3. `adversarialRows` (adversarial severityScore >= 7 COUNT)

All three read `.rows?.[0]` or iterate `rows.rows ?? []` — all zero.

---

## B. Evidence

### Driver confirmed
```
packages/db/src/client.ts:1  import { drizzle } from "drizzle-orm/postgres-js";
```

### Buggy cast pattern in audit-stats (server.ts lines 9243, 9254, 9266)
```ts
) as { rows?: Array<{ action?: string; cnt?: number | string }> };
...
for (const row of rows.rows ?? []) { ... }           // rows.rows = undefined → []
Number(rejRows.rows?.[0]?.cnt ?? 0)                  // rejRows.rows = undefined → 0
Number(adversarialRows.rows?.[0]?.cnt ?? 0)           // adversarialRows.rows = undefined → 0
```

### Correct defensive pattern already used elsewhere (server.ts lines 4083-4084)
```ts
const r = (result as { rows?: Record<string, unknown>[] })?.rows?.[0]
  ?? (Array.isArray(result) ? result[0] : result);
```

### SQL action strings: CORRECT (not the root cause)
```
PR #292 introduced audit-stats with correct 'content_draft.*' prefix strings.
PR #296 added paper_submit.
PR #298 added ai_yellow_held + JSONB severityScore subquery.
Action strings in IN() clause match what openalice-ai-reviewer.ts writes.
```

### Raw data confirmed present
`/api/v1/audit-logs?limit=10` returns 10 entries:
- `content_draft.ai_yellow_held` (5) + `content_draft.adversarial_audit` (5)
These use `listAuditLogEntries()` which uses Drizzle ORM query builder (not raw execute),
returning correctly-shaped results. That is why audit-logs endpoint works but audit-stats does not.

### Timezone / workspace_id filter: NOT the cause
- `since` = `new Date(Date.now() - N*3600000).toISOString()` → UTC ISO → correct with `::timestamptz`
- audit-stats SQL has no `workspace_id` filter, but that would over-count not under-count
- `db_available: true` in response = DB is reachable, query runs without exception,
  result is an empty-looking object due to shape mismatch (not a SQL error)

---

## C. Minimal Fix (1 line per query, Jason to apply)

Replace all three `db.execute()` result reads to use the defensive array pattern:

**Query 1** (main GROUP BY, line ~9269):
```ts
// OLD:
for (const row of rows.rows ?? []) {
// NEW:
for (const row of (Array.isArray(rows) ? rows : (rows as any).rows ?? []) as Array<{ action?: string; cnt?: number | string }>) {
```

**Query 2** (rejRows, line ~9274):
```ts
// OLD:
Number(rejRows.rows?.[0]?.cnt ?? 0)
// NEW:
Number((Array.isArray(rejRows) ? rejRows[0] : (rejRows as any).rows?.[0])?.cnt ?? 0)
```

**Query 3** (adversarialRows, line ~9280):
```ts
// OLD:
Number(adversarialRows.rows?.[0]?.cnt ?? 0)
// NEW:
Number((Array.isArray(adversarialRows) ? adversarialRows[0] : (adversarialRows as any).rows?.[0])?.cnt ?? 0)
```

Alternatively Jason can create a typed helper `execRows<T>(result: unknown): T[]`
using the same `?? Array.isArray` pattern already proven at line 4083-4084,
and call it from all three sites (cleaner, avoids triple repetition).

---

## Deploy Impact
- No migration needed
- No schema change
- Server restart sufficient after deploy
- PR #298 SQL is otherwise correct — only the result-read pattern is broken

## Recommended Owner
Jason (server.ts functional lane)

## Can Deploy Without Fix?
audit-stats endpoint will continue returning all-zero until fixed. Non-blocking for trading operations. No stop-line triggered.
