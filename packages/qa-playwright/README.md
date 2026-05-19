# IUF Playwright P0 Acceptance Runner

Production-facing acceptance checks for the P0 product rescue board.

## Required environment

```powershell
$env:IUF_QA_OWNER_EMAIL="owner@example.com"
$env:IUF_QA_OWNER_PASSWORD="..."
$env:IUF_QA_WEB_BASE_URL="https://app.eycvector.com"
$env:IUF_QA_API_BASE_URL="https://api.eycvector.com"
pnpm qa:playwright
```

`SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` are also accepted for CI.

## Commands

- `pnpm qa:playwright` runs the full five-route acceptance suite on desktop and mobile.
- `pnpm qa:playwright:smoke` runs the CI-safe market-intel smoke lane on desktop only.

Screenshots are written to `reports/qa_playwright_<timestamp>/`.
