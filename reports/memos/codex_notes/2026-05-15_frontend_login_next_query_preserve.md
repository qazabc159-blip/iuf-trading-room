# Frontend Codex sync - login next query preserve

Owner lane: apps/web frontend.

## Done

- Started the 09:00 next-step work after #505.
- Fixed the auth redirect gap that could drop AI recommendation handoff params before login.
- Middleware now stores `pathname + search` in `/login?next=...`.
- Login success now redirects to a sanitized same-origin internal `next` URL instead of always `/`.

## Verification

- Web typecheck passed.
- Local unauthenticated redirect smoke passed and preserves the full portfolio prefill query.

## Watch

- Bruce/Elva should run production owner-session QA to verify real login returns to the full handoff URL and the #505 trading-room prefill still hydrates.
