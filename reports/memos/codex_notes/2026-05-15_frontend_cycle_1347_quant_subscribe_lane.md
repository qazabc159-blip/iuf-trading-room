# Frontend Codex sync - 2026-05-15 13:47 TST

## Latest merged state
- `origin/main` at `6304d2e` with #528 companies 公司+主題合併 view, #526 quant strategies "我的訂閱" sub-tab, #527 AI handoff acted feedback, and #525 backend quant-strategy subscribe real logic.
- #525 backend contract is now available: `POST /api/v1/quant-strategies/:id/subscribe` and `GET /api/v1/quant-strategies/:id/subscriptions/my`.

## Open PRs
- #529 `feat(api): GET /api/v1/themes/index` - API lane, green checks, not frontend-owned.
- #530 `fix(api): relax openalice reviewer` - API lane, green checks, not frontend-owned.

## Blockers / owner
- Jason/backend ownership: keep #525 subscription endpoint as source of truth for SIM-only strategy subscription records.
- Frontend risk found: `/quant-strategies/[strategyId]` still calls `submitKgiSimOrder()` from the detail subscription panel, which bypasses #525 and can submit per-stock KGI SIM orders instead of creating a strategy subscription record.
- Frontend integration risk found: `QuantSubsPanel` fetches `NEXT_PUBLIC_API_BASE_URL` directly from the browser instead of using a same-origin web proxy, so owner-session cookies/CORS can be fragile.

## Chosen frontend-safe task this cycle
Normalize the quant-strategy subscription lane:
- Add same-origin web proxy routes under `apps/web/app/api/quant-strategies/...`.
- Update strategy detail "subscribe" action to call #525 SIM-only backend subscribe endpoint, not direct KGI SIM basket orders.
- Update "我的訂閱" panel to read through same-origin proxy.
- Preserve SIM-only wording and do not expose any real/live execution path.
