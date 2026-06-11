# P0 market overview consistency evidence

## Product failure

Production returned:

```json
{
  "value": 43225.54,
  "change": -1,
  "changePct": 3.31
}
```

That tuple is mathematically impossible: `change / (value - change) * 100` is approximately `-0.002%`, not `+3.31%`.

The real TWSE `MI_INDEX` row was:

```json
{
  "收盤指數": "43225.54",
  "漲跌": "-",
  "漲跌點數": "1,478.90",
  "漲跌百分比": "-3.31"
}
```

The old parser used `parseFloat("1,478.90")`, producing `1`, and multiplied an already-signed percentage by `-1`, producing positive `3.31`.

## Fix

- Parse TWSE numeric fields after removing thousands separators.
- Treat the direction field as the sign for absolute point change.
- Derive percentage from close and point change instead of applying a second sign to the upstream percentage.
- Add a shared consistency rule:

```text
abs(change / (value - change) * 100 - changePct) <= 0.15
```

- Enforce the rule on parser output, short cache reads/writes, SWR reads, LKG reads/writes, and OpenAlice market source-pack/prompt input.
- Correct the LKG documentation: the current LKG is process-local, not persistent across deploys. Deploy restart clears the old process value; the new read gates evict any malformed in-process value.
- Preserve the #1044 stale-while-revalidate structure.

## Local behavior verification

Direct TWSE fetch with the patched code returned:

```json
{
  "value": 43149.46,
  "change": -76.08,
  "changePct": -0.18,
  "ts": "2026-06-11T13:30:00+08:00",
  "consistent": true
}
```

## Tests

- `pnpm.cmd --filter @iuf-trading-room/api typecheck`: PASS.
- `twse-market-overview.test.ts`: 10/10 PASS, including the exact comma/signed production payload and poisoned-LKG eviction.
- Focused OpenAlice source-pack tests: 2/2 PASS, including rejection of the contradictory production tuple.
- Root test suite: 546 PASS, 2 existing unrelated recommendation-fixture assertions fail (`REC10`, `REC-LOWER-THRESHOLD-1`), both already documented in the handoff.
- Full `openalice-pipeline.test.ts`: the new source-pack tests pass; one existing unrelated wording assertion expects `盤前劇本` while current main says `市場劇本`.

## Production acceptance after deploy

Pending:

1. Call `/api/v1/market/overview/twse` ten times after the new API deployment.
2. Verify each non-null TAIEX tuple reconstructs previous close within 0.1%.
3. Regenerate one daily brief/source pack within the existing LLM budget.
4. Verify the brief input and rendered market direction agree with the validated endpoint.
