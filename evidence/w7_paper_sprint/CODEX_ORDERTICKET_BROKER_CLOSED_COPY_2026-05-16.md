# CODEX OrderTicket Broker Closed Copy - 2026-05-16

## Scope
- Frontend-only wording patch for `apps/web/components/portfolio/OrderTicket.tsx`.
- Active trading-room order ticket copy only; no behavior changes.

## Change
- Replaced the post-preview success note:
  - from: `預檢通過。此送單只建立模擬委託，不會送往券商；凱基正式下單待 libCGCrypt.so 補齊後接上。`
  - to: `預檢通過。此送單只建立模擬委託，不會送往正式券商；正式券商寫入維持關閉，需產品與風控驗收後另行啟用。`

## Safety
- No backend files changed.
- No broker/risk/contracts files changed.
- No route, payload, preview, submit, or execution-mode behavior changed.
- Removes SDK-completion wording that could imply formal broker writes will open automatically.
- No `PAPER_LIVE` or formal-order promotion introduced.

## Verification
- `pnpm.cmd install --frozen-lockfile --prefer-offline` PASS
- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `git diff --check` PASS
- Current PR verification on branch `fix/web-orderticket-broker-closed-copy-2026-05-16-pr`:
  - `git diff --check origin/main..HEAD` PASS
  - `pnpm.cmd install --frozen-lockfile --prefer-offline` PASS
  - `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS
  - `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- Changed-file stale wording audit PASS:
  - no `libCGCrypt`
  - no `凱基正式下單`
  - no `PAPER_LIVE`
- New copy audit PASS:
  - `正式券商寫入維持關閉`
  - `產品與風控驗收後另行啟用`
  - `不會送往正式券商`

## Browser smoke
- Route smoke not run because `OrderTicketForm` is currently an export-only component in `apps/web`; `rg -n "OrderTicketForm" apps/web` shows only the component definition and no current route mount.
- Product-code static smoke was used instead: the changed component now contains the closed-broker-write copy and no longer contains the SDK-completion wording.
- No temporary route or harness was committed.

## Release status
- Promoted for PR on 2026-05-16 after #555 merged.
- Sync note: `reports/memos/codex_notes/2026-05-16_frontend_cycle_1301_orderticket_broker_closed_pr.md`
