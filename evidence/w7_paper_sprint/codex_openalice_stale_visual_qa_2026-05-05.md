# Codex OpenAlice stale data visual QA - 2026-05-05

Status: PARTIAL PUBLIC ROUTE SMOKE
Owner: Codex frontend product owner lane
Timezone: Asia/Taipei

## Scope

Local Next dev server:

- `http://127.0.0.1:3189`
- `NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com`

Routes probed:

- `/briefs`
- `/ops`

## Result

- `/briefs`: HTTP 200, no horizontal overflow, no browser console errors.
- `/ops`: HTTP 200, no horizontal overflow, no browser console errors.

## Important limitation

Both routes require an authenticated session in normal production use. Without a session, this local browser check is only a public route stability/overflow smoke. It does not prove the authenticated OpenAlice stale-state panels are visually final.

No password was written into a script, committed, uploaded, or stored.

## Next QA

- Use Bruce/Jason-approved authenticated smoke path or browser session handoff.
- Capture `/briefs` and `/ops` authenticated screenshots after PR #178 deploy preview or merge.
- Verify red `過期` appears when latest formal brief date is not today's Taipei date.
- Verify OpenAlice worker/sweep status is visible and no token is displayed.
