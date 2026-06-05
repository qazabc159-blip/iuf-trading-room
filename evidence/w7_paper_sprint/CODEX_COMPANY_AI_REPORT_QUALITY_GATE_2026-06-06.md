# Codex Company AI Report Quality Gate - 2026-06-06

## Scope

This PR tightens the company-page AI analyst report product gate. It prevents shallow, repetitive "資料不足" reports from rendering as formal customer-facing analysis.

## Shipped

- Added minimum report substance gates:
  - At least 3 verifiable numeric facts.
  - At least 3 source-type mentions.
  - No more than 5 repetitive data-gap sentences.
- Strengthened the company AI analyst prompt so the model must produce product-readable analysis or clearly degrade.
- Added UI copy for `low_substance` reports, with a clear regenerate path instead of displaying a weak report.
- Cleaned subscription entitlement copy surfaced by the future paid product page:
  - `已包含` instead of `已開啟`.
  - `價格待設定` instead of `價格待定`.
  - Shortened customer-facing Owner label to `Owner 後台`.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web test app/companies/[symbol]/ai-analyst-report-panel.test.ts lib/subscription-entitlements.test.ts app/settings/subscription/subscription-settings-entitlements.test.ts` - PASS, 41/41
- `pnpm.cmd --filter @iuf-trading-room/web test` - PASS, 318/318

## Known Local Verification Limits

- `pnpm.cmd --filter @iuf-trading-room/web build` is blocked locally by sandboxed Google Fonts network access (`next/font` EACCES to Google Fonts). This is an environment/network block, not a TypeScript failure.
- `pnpm.cmd test` currently has 2 recommendation-engine fixture failures unrelated to this PR:
  - `REC10` expected 4 candidates, received 8.
  - `REC-LOWER-THRESHOLD-1` expected 1 recommendation, received 7.

## Product Effect

Company pages no longer treat a report that is structurally complete but substantively empty as acceptable. A weak report is blocked with customer-readable copy and a regenerate action, while real reports must include numbers, sources, and the fixed 9-section structure.
