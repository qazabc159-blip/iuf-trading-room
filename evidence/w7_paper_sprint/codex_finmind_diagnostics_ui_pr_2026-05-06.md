# Codex FinMind Diagnostics UI PR - 2026-05-06 02:36 Taipei

Status: READY FOR PR

Trade Capability Score: +1

Workflow improved:
- Operator can verify whether FinMind Sponsor 999 is actually connected and how much quota is used, instead of reading a misleading fixed limit or stale red dataset state.
- Dashboard dataset chips now render all FinMind datasets and keep READY / DEGRADED / BLOCKED semantics distinct.

Files changed:
- `apps/web/app/page.tsx`
- `apps/web/lib/api.ts`

Sources / endpoints:
- `GET /api/v1/data-sources/finmind/status`
- `GET /api/v1/diagnostics/finmind`

Behavior:
- Accepts backend `DEGRADED` state for FinMind source and dataset status.
- Displays quota as `used / limit / hour`, so Sponsor 999 can show real 6,000/hour capacity without exposing token values.
- Counts ready / pending / blocked datasets from the same UI state used by dataset chips.
- Shows all dataset chips instead of truncating at 14, preventing the operator from missing blocked or pending datasets.

Checks:
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- `git diff --check` PASS with CRLF warnings only.

No-token / no-fake / no-order:
- PASS. This patch displays token presence only; it does not display, log, or write any token.
- PASS. It does not convert missing/degraded data into live success.
- PASS. No broker, order route, KGI write-side, paper fill, risk, migration, or DB write path touched.

Next:
- Open PR and wait for CI / policy review.
- After deploy, run production dashboard smoke and confirm Sponsor quota, READY chips, and no token text on the page.
