# 2026-06-15 Codex / Elva / Jason / Bruce sync - KGI SIM quote and fill closure

## Latest merged state

- `origin/main` is at PR #1084 (`d6979063`).
- PR #1084 stops the expected `KGI_QUOTE_AUTH_UNAVAILABLE` condition from paging as a critical daily failure, but does not restore KGI quote authentication or prove fills.
- PRs #1079-#1081 already expose durable S1 holdings, EOD valuation, audit history, and Chinese smoke diagnostics.

## Open PRs

- None at cycle start.

## Blocked items and owner

- KGI SIM trade/account login works, but the installed KGI SDK receives no market-data token. Historical gateway logs also show the quote login endpoint returning HTTP 502 while trade login continued.
- The current trade smoke treats any successful `/trades` response as an order report, without matching the submitted trade ID, symbol, side, quantity, or status. It therefore cannot prove accepted, partial fill, fill, cancellation, or rejection.
- KGI market-data entitlement remains an external KGI/account capability. Codex owns retry/self-heal and the official TWSE MIS product fallback. Elva/Jason own broker credentials and account entitlement escalation.

## Chosen bounded task

- Add a bounded KGI quote-auth repair path for transient SDK failures while keeping TWSE MIS as the honest product quote provider when KGI entitlement is absent.
- Replace the false-positive trade report check with matched trade/deal reconciliation.
- Surface submitted, accepted, partially filled, filled, cancelled, rejected, and unconfirmed states on the existing F-AUTO observation page.
- Do not touch real-order paths, KGI live writes, migrations, contracts, Quant Lab, heatmap, recommendations, or company AI pages.

## Completion update

- Implemented product quote fallback through TWSE MIS for daily SIM health. KGI quote auth remains reported as a broker capability, but product quote health now requires a real KGI tick or MIS snapshot.
- Implemented KGI order reconciliation across recent order events, trades, and deals. A generic `/trades` 200 no longer proves the submitted order; evidence must match trade id or, when no id exists, exact symbol/side/quantity.
- Updated S1/F-AUTO holdings and EOD reconstruction so accepted-only orders are not counted as positions. Only filled or partially filled orders create holdings.
- Updated `/ops/f-auto` order display to show requested vs filled quantity, average fill price, confirmation source, and confirmation time.
- Verification: package builds, API/web typecheck, full Node CI test suite, and KGI gateway pytest all pass. Evidence: `evidence/w7_paper_sprint/CODEX_KGI_SIM_QUOTE_FILL_CLOSURE_2026-06-16.md`.
