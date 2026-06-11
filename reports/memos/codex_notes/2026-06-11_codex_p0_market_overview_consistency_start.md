# Codex P0 sync - market overview consistency

- Latest merged state: `origin/main` is `d122235b` (#1048). #1044 SWR, #1045 MIS index source, #1047 official previous-close logic, and #1048 five-level quote fallback are already merged.
- Open PRs: none at cycle start.
- Production blocker: `/api/v1/market/overview/twse` can return a contradictory TAIEX tuple (`43225.54 / -1 / +3.31%`). The live TWSE `MI_INDEX` payload contains comma-formatted change points and an already-signed percentage; the parser truncates `1,478.90` to `1` and flips `-3.31` to positive. In-memory cache/LKG layers then retain the malformed tuple.
- Owner coordination: Codex owns this bounded API consistency fix. Elva/Jason should avoid concurrent edits to `twse-openapi-client.ts` and the OpenAlice market source-pack path until this PR lands. No broker, risk, contracts, migration, Quant Lab, or real-order paths are in scope.
- Chosen task: preserve #1044 SWR, add one shared index consistency gate to parsing plus cache/LKG read/write paths, apply the same gate to the OpenAlice source pack, test the real comma/signed payload, deploy, then verify ten production reads and one regenerated brief/source pack.
