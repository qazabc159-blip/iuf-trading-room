# 2026-05-18 Codex blocker - deploy seed owner secrets

Owner: Jason / repo admin

## What happened

- PR #648 (`fix(web): localize market heatmap industries`) merged to `main` at `7bea36e`.
- PR CI was green:
  - validate: PASS
  - W6 No-Real-Order Audit: PASS
  - Secret Regression Check (A2): PASS
- Local frontend verification was green:
  - `pnpm.cmd --filter @iuf-trading-room/web typecheck`
  - browser smoke for direct `/api/ui-final-v031/market-intel`
  - browser smoke for authenticated `/market-intel` shell iframe

## Blocker

The deploy workflow failed in the API post-deploy migration verification step, before the production verification could complete.

Failure text from deploy run `25998279145`:

```text
SEED_OWNER_EMAIL or SEED_OWNER_PASSWORD secret not set - cannot verify migrations.
Root cause: 2026-05-18 silent migration failure caused prod schema drift. Route B (skip) permanently removed.
```

This is the same blocker that failed the prior `650cd77` deploy from PR #647. The API health endpoint returned `status=ok`, but the workflow intentionally exits because the required owner credentials are not available to GitHub Actions.

## Impact

- Frontend code is merged to main.
- Production deploy status is failed until the missing GitHub Actions secrets are configured or Jason adjusts the verification path.
- This is not caused by the `/market-intel` heatmap label code.

## Next action

Jason / repo admin:

- Add `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` to GitHub Actions secrets, or change the post-deploy migration verification to use a non-secret-safe probe mechanism approved by Bruce.
- Re-run deploy for `main` after the secret/config fix.

Codex frontend:

- Do not touch API migration verification or secrets.
- Continue frontend-owned QA/productization tasks while marking production deploy verification blocked by Jason/repo admin.
