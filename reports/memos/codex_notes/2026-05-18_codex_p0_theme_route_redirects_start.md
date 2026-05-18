# Codex P0 Theme Route Redirects Start - 2026-05-18

Latest merged state:
- `origin/main` is `04bc534` (`#711 fix(web): clarify ai recommendation empty states`).
- Recent frontend P0 merges: `#706` market intel no-fake AI news states, `#709` portfolio trading room no-fake states, `#710` company page degraded states, `#711` AI recommendations empty states.
- `#711` production smoke passed on `/ai-recommendations`: no stale `#703` copy, one official empty state, endpoint/owner/next-action visible, no page errors.

Open PRs:
- None from `gh pr list` at cycle start.

Blocked items and owners:
- Owner-session-only data remains blocked for Codex dummy session on `/market-intel`, `/portfolio`, `/companies`, `/event-log`, and `/portfolio-snapshot`; Bruce/Elva must verify with owner session before declaring data absent.
- AI recommendations production still shows auth-blocked v3 and zero visible recommendations for dummy session; Elva/Jason own backend refresh/session gate, Bruce owns owner-session verification.

Chosen frontend-safe task:
- P0-7 theme/company route cleanup. Production smoke shows canonical `/themes/*` works, but legacy/mobile-like entry points `/mobile/themes/*`, `/companies/themes/*`, and `/company-themes/*` return 404. This matches Yang's route bug concern. I will add narrow redirects to canonical `/themes/:slug`, verify desktop/mobile and back navigation, and avoid UI rewrite or data changes.
