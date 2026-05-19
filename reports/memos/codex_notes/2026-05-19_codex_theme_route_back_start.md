# 2026-05-19 Codex Theme Route Back Fix Start

Latest state before editing:

- `origin/main`: `7496da8 fix(brain): AI analyst report - snake_case shape + market tools + 9-section prompt (#736)`
- Open PRs at start: `#733` EventLog/ToolCenter follow-up.
- P0 line: company/theme route chain must not leak to old/mobile route or send the user to the wrong product surface.

Chosen frontend-owned task:

Preserve the route origin when a user opens a theme from the company page's Theme Radar. Links from `/companies?tab=themes` should open `/themes/wiki/[name]?from=companies`, and the theme detail back action should return to `/companies?tab=themes` instead of always going to `/themes`.

Acceptance:

- Browser chain `/companies?tab=themes -> theme card -> back` returns to the company Theme Radar product surface.
- No `/m/*` route.
- No legacy/old company theme route.
