# Codex Evidence - AI Quality Source Labels

Date: 2026-05-18
Branch: fix/web-ai-source-quality-labels-2026-05-18
Scope: apps/web AI recommendations list/detail UI labels only.

## Shipped

- Localized the AI recommendation data-quality penalty label from `Penalty` to `信心折減`.
- Localized the source trail disclosure/heading from `sourceTrail` / `SOURCE TRAIL` to `資料來源`.
- Localized the source timestamp aria label to `資料來源時間 ...`.

## Safety

- Frontend-only change under `apps/web/app/ai-recommendations`.
- No broker, KGI live write, execution-mode, contracts, shared contracts, or API risk/broker paths touched.
- No fake score or fake data added; existing recommendation payload shape is unchanged.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- `rg -n "Penalty|sourceTrail|SOURCE TRAIL|source timestamp" apps/web/app/ai-recommendations -g "*.tsx"` found no remaining visible/template labels; only code identifiers remain where the payload field is named `sourceTrail`.
- Browser smoke with local mock recommendation API and owner-session cookie:
  - `/ai-recommendations` desktop 1366x900 returned 200.
  - `/ai-recommendations/rec-2330-quality-smoke` desktop 1366x900 returned 200.
  - `/ai-recommendations` mobile 390x844 returned 200.
  - Required visible labels found: `信心折減`, `資料來源`.
  - Forbidden visible labels absent: `Penalty`, `sourceTrail`, `SOURCE TRAIL`.
  - Console errors, page errors, failed requests, and >=400 responses: none.

## Screenshots

- `evidence/w7_paper_sprint/ai-quality-source-labels-list-1366x900.png`
- `evidence/w7_paper_sprint/ai-quality-source-labels-detail-1366x900.png`
- `evidence/w7_paper_sprint/ai-quality-source-labels-list-mobile-390x844.png`

## Known External Blocker

- Deploy to Railway remains blocked by missing GitHub Actions secrets `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD`.
- Owner: Jason / repo admin.
- This PR only needs normal web CI; it does not require touching deploy secrets.
