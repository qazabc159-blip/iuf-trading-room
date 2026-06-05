# CODEX_COMPANY_DETAILS_AND_QUOTE_STREAM_PR_2026-06-05

## Scope

- Company page announcements detail UX.
- Trading room quote stream and browser merge correctness.

## Fixed

- Company announcement rows now expand when TWSE provides an official URL/source even if the body text is short or missing.
- Expanded detail now shows date, source, company, a useful official-source message, and a formal announcement CTA.
- Trading-room quote SSE no longer lets unlabeled KGI ticks override a valid company quote price.
- Trading-room change/changePct now prefer `lastPrice - prevClose` from the current symbol payload/quote.
- Browser live merge no longer inherits previous stock `selected` state after symbol changes.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/api typecheck` PASS.
- `pnpm.cmd exec node --import ./tests/setup-test-env.mjs --import tsx --test --test-name-pattern=COMPANY-ANN-DETAIL-UI-1 ./tests/ci.test.ts` PASS.
- `pnpm.cmd exec node --import ./tests/setup-test-env.mjs --import tsx --test --test-name-pattern=TRADING-ROOM-QUOTE-STREAM-1 ./tests/ci.test.ts` PASS.
- `git diff --check` PASS.

## Note

An accidental full `ci.test.ts` run also executed unrelated AI recommendation gates and exposed existing failures in `AI-REC-V3-FORMAT-ROOT-CAUSE-4..6`; the two new gates above passed when run with the correct Node option order.
