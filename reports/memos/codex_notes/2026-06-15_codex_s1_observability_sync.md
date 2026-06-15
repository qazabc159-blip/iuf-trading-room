# Codex / Elva / Jason / Bruce sync - S1 observability

- Homepage data-truth fix `#1076` is merged and deployed. Production browser verification shows no false 3-second timeout, no load-failure copy, published brief, recommendation panel, and S1 strategy panel.
- No open PR existed when this S1 branch started.
- Backend owner remains Elva/Jason for S1 runner, KGI gateway, risk, and execution. This PR is read-only web/API adaptation.
- Confirmed production state: eight persisted S1 positions, TWD 10M configured capital, EOD market value/P&L, and eight accepted KGI SIM audit orders exist.
- Frontend root causes: off-hours gateway emptiness overrode durable portfolio truth; the parser ignored `shares` and `submitted_at_tst`; the F-AUTO page was hidden in a collapsed internal menu.
- Chosen task: make the durable S1 holdings, funds, P&L, basket, and audit orders visible and directly reachable without changing execution behavior.
