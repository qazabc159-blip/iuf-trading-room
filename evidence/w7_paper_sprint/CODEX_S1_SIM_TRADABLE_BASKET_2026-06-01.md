# S1 SIM tradable basket hardening - 2026-06-01

## Scope

- S1 SIM signal basket must contain only candidates that can submit at least one TW board lot when exposure is non-zero.
- Crisis/no-exposure regime keeps the basket empty instead of showing zero-share positions as usable candidates.
- This follows PR #887, which made S1 SIM observations durable through `audit_logs`.

## Production observations before this patch

- `GET /api/v1/internal/s1-sim/status` after PR #887 deploy:
  - `automatic_scheduler.enabled=true`
  - `configured_capital_twd=10000000`
  - `latest_basket=null` before signal catch-up
- Safe owner-only signal catch-up generated a 2026-06-01 basket:
  - `regime=sideways`
  - `exposure_weight=0.5`
  - `basket_size=8`
  - `generated_at_tst=2026-06-01T23:40:08+08:00`
- Audit durability verified:
  - `action=s1_sim.signal_generated`
  - `entityType=s1_sim`
  - `entityId=2026-06-01`
  - payload persisted at `2026-06-01T15:40:08.315Z`

## Defect found

- One generated basket item had `target_shares=0` because the board-lot cost exceeded the per-name target.
- That makes the UI/API look like S1 selected 8 usable names while automatic submit would skip one.

## Fix

- Walk the ranked cont_liq candidate list until the basket has 8 candidates with `target_shares > 0`.
- Record skipped zero-share candidates in `failsafe_notes` as `skipped_untradable_zero_share`.
- Record `tradable_basket_shortfall` if fewer than 8 tradable candidates remain.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` - PASS
- `pnpm.cmd test` - PASS, 477/477
