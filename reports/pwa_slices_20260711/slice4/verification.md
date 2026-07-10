# PWA Slice 4 Verification Evidence

## Active event-source evidence

Read-only authenticated request made on 2026-07-10 (Asia/Taipei):

```text
GET https://api.eycvector.com/api/v1/iuf-events?limit=20
STATUS=200
COUNT=20
R_OPENALICE_DECISION | warning | 2026-07-09 23:58:30.871+00
R08_AI_BRIEF_PUBLISHED | info | 2026-07-09 23:41:30.953+00
R_OPENALICE_DECISION | info | 2026-07-09 01:10:58.402+00
R08_AI_BRIEF_PUBLISHED | info | 2026-07-09 01:02:58.363+00
R_OPENALICE_DECISION | info | 2026-07-07 23:58:58.103+00
```

The response proves that `R08_AI_BRIEF_PUBLISHED` from the selected OpenAlice event-rule engine was producing real events within the current Taipei calendar day. Only event type, severity, and timestamp were retained; payloads and authentication state were not printed or stored.

## Local verification

```text
pnpm test
tests 1645 | pass 1644 | fail 0 | skipped 1

pnpm --filter @iuf-trading-room/web test
Test Files 69 passed | Tests 564 passed

pnpm typecheck
Tasks 15 successful, 15 total

pnpm run build:web
Compiled successfully | Generating static pages 31/31

pnpm run build:api
Tasks 5 successful, 5 total

python scripts/audit/secret_regression_check.py
PASS — 0 potential secret patterns found

python scripts/audit/w6_no_real_order_audit.py
AUDIT PASS — 6 checks green
```

The root test command was run in a child process with local `FINMIND_API_TOKEN` and `FINMIND_TOKEN` removed so the repository's existing missing-token tests exercised their declared precondition. No environment value was printed.
