# Frontend Codex Sync - Header Dock Notifications Proxy

Time: 2026-05-15 09:28 TST

Latest main observed:
- `5ec2317 feat(web): add quant strategies Lab readiness panel (#507)`
- Open PR list was empty after #507 merge.

Frontend-safe next task:
- Fix HeaderDock notification drawer CORS noise found during `/quant-strategies` browser smoke.
- Current client code calls `GET /api/v1/alerts?limit=50` directly against API origin.
- Day 6 backend stub now exists at `GET /api/v1/notifications?limit=50`.
- Add a web same-origin proxy route and point HeaderDock at notifications, so pages do not emit CORS errors on load.

Coordination notes:
- Jason: no backend change required; this consumes existing notifications stub.
- Bruce: please verify the bell drawer opens cleanly with no browser console CORS error.
- Elva: this is Day 6 readiness hygiene, not a new product lane.

Hardlines held:
- No broker/risk/contracts edits.
- No live execution changes.
- No fake notifications; empty backend response stays empty.
