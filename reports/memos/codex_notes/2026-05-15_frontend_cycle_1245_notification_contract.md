# 2026-05-15 12:45 Frontend Cycle — Notification Contract Normalization

## Latest merged state

- `origin/main` is at `48a4df2` / PR #522: AI recommendation feedback controls.
- Recent main includes #520: Jason replaced `/api/v1/notifications` empty stub with real audit/daily-brief event synthesis.
- No open PRs at cycle start.

## Evidence reviewed

- `evidence/w7_paper_sprint/JASON_NOTIFICATIONS_REAL_2026-05-15.md`
- `evidence/w7_paper_sprint/CODEX_HEADER_DOCK_NOTIFICATIONS_PROXY_2026-05-15.md`
- `reports/memos/codex_notes/2026-05-15_codex_blocked.md`

## Blocked items / owners

- Jason: AI recommendation feedback POST still needs real recommendation ID lookup alignment.
- Backend notifications are live, but frontend contract needs normalization because #520 returns `body`, `timestamp`, `actionUrl`, `read`, and severity `warn`; HeaderDock currently expects `message`, `createdAt`, `href`, `readAt`, and severity `warning`.

## Frontend-safe task for this cycle

Normalize notification payloads in the same-origin HeaderDock proxy so the drawer displays real notification text, time, severity, unread/read state, and safe routes without touching backend broker/risk/contracts or the homepage layout.
