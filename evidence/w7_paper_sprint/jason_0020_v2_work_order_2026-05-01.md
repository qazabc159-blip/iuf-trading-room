# Jason Work Order - 0020 v2 Dedup Migration

Date: 2026-05-01
Owner: Jason
Audit source: Mike PR #39 P0 finding + Pete independent desk review
Status: BLOCKED until v2 patch + Mike audit PASS + Pete PASS/PASS_WITH_PATCH

## Decision

PR #39 / migration 0020 must not be promoted in its current form.

Operator ACK and pg_dump backup are not sufficient, because the current migration
can deterministically fail before the backup matters:

- `DELETE FROM companies` assumes child FK rows cascade.
- Current schema references to `companies(id)` do not declare `ON DELETE CASCADE`; Mike and Pete independently confirmed the PR comment is wrong.
- Transaction will hit `foreign_key_violation` and rollback.
- Non-FK references can also leave silent orphan data.
- The current T1-T4 tests are JS Map simulations, not a real SQL migration/FK test.

## Required v2 Behavior

Keep the dedup survivor rule if Mike/Pete still approve it:

1. Partition by `(workspace_id, ticker)`.
2. Keep survivor by highest relation count.
3. Tie-break by earliest `created_at`.
4. Protect known manual-curation exceptions before delete.

But replace the direct `DELETE FROM companies` with an explicit child-table plan
inside the same transaction.

## Required Child Handling

Preserve or reassign user research:

- `trade_plans.company_id`: update source company IDs to survivor.
- `company_notes.company_id`: update source company IDs to survivor.
- `signals.company_ids` jsonb: replace source IDs with survivor ID and de-duplicate, or emit an explicit audit table/report if not safely transformable.

Merge/rebuild curated graph data before deleting source rows:

- `company_theme_links`: merge distinct theme IDs onto survivor, then delete source links.
- `company_relations`: rebuild source/survivor relations following `apps/api/src/company-merge.ts` patterns. Both `company_id` and `target_company_id` references must be handled.
- `company_keywords`: merge distinct keywords onto survivor, then delete source keyword rows.

Handle non-FK market data explicitly:

- `companies_ohlcv.company_id`: reassign to survivor when row uniqueness allows it; otherwise delete source rows with an audit count. Do not leave orphan rows.

Patch the helper nit Pete found:

- `upsertCompanyOnConflict().set` must include `country`; second import currently would not update country.

Only after the above:

- delete source `companies` rows;
- add `UNIQUE(workspace_id, ticker)`.

## Reference Pattern

Use `apps/api/src/company-merge.ts` as the behavioral pattern, especially:

- merge set construction;
- theme link merge;
- relation delete/rebuild;
- keyword merge;
- trade plan reassignment;
- transaction boundary.

Do not copy it blindly: current PR #39 also needs explicit handling for
`company_notes`, `companies_ohlcv`, and `signals.company_ids`.

## Test Requirements

The current in-memory migration tests are not enough.

Add a Postgres-level test or staging verification that proves:

- migration succeeds with existing FK child rows;
- duplicate source company rows are removed;
- survivor remains;
- `trade_plans` and `company_notes` point to survivor;
- `company_theme_links`, `company_relations`, and `company_keywords` have no source IDs;
- `companies_ohlcv` has no source IDs;
- `signals.company_ids` has no source IDs;
- unique constraint exists after migration;
- migration is wrapped in one transaction.

## Governance

PR #39 remains BLOCKED until:

1. Jason ships v2 patch.
2. Mike audit returns PASS.
3. Pete desk review returns PASS or PASS_WITH_PATCH.
4. Operator backup ACK is completed before production run.

Pete review may continue, but Pete PASS alone cannot unblock this PR.
