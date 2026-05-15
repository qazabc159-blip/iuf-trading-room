# CODEX_LOGIN_NEXT_QUERY_PRESERVE_2026-05-15

Branch: `fix/web-login-preserve-next-query-2026-05-15`

## Scope

- Preserve full query string when middleware redirects unauthenticated users to `/login`.
- Make login success return to the sanitized internal `next` URL instead of always pushing `/`.
- This protects the AI recommendation handoff flow:
  - `/portfolio?ticker=2330&prefill=true&from_rec=...&entry=...&stop=...&tp=...`

## Safety

- Frontend-only.
- No broker/risk/contracts edits.
- No KGI live broker write.
- `next` is constrained to same-origin internal paths and excludes `/login` and `/register`.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
  - PASS

- Local Next dev server:
  - `http://localhost:3021`

- Unauthenticated redirect smoke:
  - Request:
    - `/portfolio?ticker=2330&prefill=true&from_rec=rec-test&entry=865-870&stop=845&tp=920`
  - Response:
    - HTTP `307`
    - `Location: /login?next=%2Fportfolio%3Fticker%3D2330%26prefill%3Dtrue%26from_rec%3Drec-test%26entry%3D865-870%26stop%3D845%26tp%3D920`

## Residual

- Owner-session browser QA should still verify a real login posts successfully and lands back on the full portfolio handoff URL.
