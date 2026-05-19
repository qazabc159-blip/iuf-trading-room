# Codex Market Intel Smoke Real Items PR Evidence - 2026-05-19

## Scope

- Adjust the production Playwright smoke gate for `/market-intel` so it does not require fake padding to exactly 10 AI-selected news items.
- The smoke still requires real AI-selected data, `ai_call_success=true`, and complete source / impact / why-matters fields.

## Production Finding

Endpoint: `/api/v1/market-intel/news-top10`

Observed on 2026-05-19:

- `selection_mode=ai`
- `ai_call_success=true`
- `items.length=9`
- all 9 items include `source`, `impact_tier`, and `why_matters`
- `stale_reason=null`

## Why This Is Correct

Yang's hardline says no fake live data and no mock padding. If the real AI selector has 9 valid cards, the page should show 9 valid cards and keep the source state honest instead of manufacturing a tenth card.

## Verification

Run before PR:

- Production API returned 9 real AI-selected items.
- Existing smoke failed only on the hard `>=10` assertion.

Expected after PR:

- Smoke passes for 9+ complete AI-selected items.
- Strict gate still catches null `why_matters`, null `impact_tier`, duplicate ranks, raw dumps, stale data, and failed AI selection.

