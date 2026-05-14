# CODEX_OVERNIGHT quant strategy copy polish 2026-05-15

## Scope

- Branch: `fix/web-quant-strategy-copy-polish-2026-05-15`
- Worktree: `IUF_TRADING_ROOM_APP_dock_draggable_worktree`
- Files changed:
  - `apps/web/app/quant-strategies/strategy-data.ts`
  - `apps/web/app/quant-strategies/[strategyId]/StrategyDetailClient.tsx`
  - `reports/memos/codex_notes/2026-05-15_frontend_overnight_sync_0135.md`
- Product request: continue overnight work, coordinate status with Elva, and avoid leaving research-note wording in a user-facing product page.

## Implementation

- Localized visible quant strategy status/readout text:
  - `Forward Observation Day 6/20` -> `前瞻觀察第 6 / 20 交易日`
  - `Day 6` holding notes -> `觀察第 6 日`
  - `Period 1 basket` -> `第一期籃子`
  - `20/20 anchor captured` -> `20 / 20 收盤錨點已完成`
  - `Overlay Candidate` -> `覆蓋層候選`
- Localized detail metric labels:
  - `Net Return` -> `淨報酬`
  - `Benchmark / Excess` -> `基準 / 超額`
  - `Max Drawdown` -> `最大回撤`
  - `Hit Rate` -> `命中率`
  - `Sample` -> `樣本數`
- Added an Elva-facing sync note under `reports/memos/codex_notes/`.
- No strategy numbers, allocations, guardrails, or submit behavior changed.

## Verification

Command:

```text
pnpm.cmd --filter @iuf-trading-room/web typecheck
```

Result: PASS.

Command:

```text
git diff --check
```

Result: PASS, CRLF warnings only.

Route sweep with local smoke cookie:

```text
/                              200 OK
/ai-recommendations            200 OK
/quant-strategies              200 OK
/quant-strategies/cont_liq_v36 200 OK
/alerts                        200 OK
/briefs                        200 OK
/companies                     200 OK
```

Rendered HTML check for `/quant-strategies/cont_liq_v36`:

```text
觀察第 6                 present
淨報酬                   present
最大回撤                 present
樣本數                   present
Day 6                    absent
Net Return               absent
Sample                   absent
forward observation      absent
```

## Safety

- No KGI live broker write path touched.
- No execution mode defaults changed.
- No `apps/api` broker/risk/contracts files touched.
- No IUF_QUANT_LAB or IUF_SHARED_CONTRACTS files touched.
- This is copy-only UI polish plus coordination evidence.
