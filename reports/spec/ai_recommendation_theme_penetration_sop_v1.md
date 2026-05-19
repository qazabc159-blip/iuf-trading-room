# AI Recommendation Theme Penetration SOP v1

Source: owner-provided `deep-research-report (9).md`, received 2026-05-18.

This is the product policy for `/api/v1/ai-recommendations/v3`. It is not a demo prompt and not optional guidance. The AI recommendation engine must follow this decision order every trading day.

## Decision Order

1. Market state gate: `risk-off > event > trend > range`.
2. Theme penetration: demand side -> main equipment -> key components -> secondary components -> materials -> equipment -> process bottleneck -> Taiwan stocks not fully priced in.
3. Capital confirmation: foreign/investment trust/dealer, ETF proxy, margin, borrowing, relative strength.
4. Technical execution: BOS/CHoCH, OB/FVG, OTE, AVWAP, ATR, invalidation point.
5. Risk sizing: entry, stop, TP1, TP2, R ratio, NAV risk, market multiplier.

## Hard Risk-Off Gate

The system calculates:

`risk_off_score = 1[VIX>25] + 1[VIX 5d change>30%] + 1[DXY 60d z-score>1] + 1[10Y 20d rise>25bp] + 1[WTI 10d rise>10%] + 1[TAIEX<CEMA60]`

Rules:

- If `system_programmatic_risk_off_score >= 3`, the engine may return `RISK_OFF_FINAL_SKIP` and no stock cards.
- If `system_programmatic_risk_off_score < 3`, `RISK_OFF_FINAL_SKIP` and `RISK_OFF_SKIP` are forbidden. The engine must output at least 5 backed cards.
- Weak or unsafe names must be classified as `C high-risk exclusion`, not dropped.

## Scorecard

Total score is 100:

- Theme / supply-chain position: 20
- Revenue / financial validation: 15
- Institutional / ETF flow: 15
- Margin / securities borrowing / crowding: 15
- Relative strength / volume: 10
- Technical structure: 20
- Valuation / event risk: 5

Bucket rules:

- A+: 85-100, top pick, 0.8% NAV risk
- A: 75-84, actionable layout, 0.6% NAV risk
- B: 65-74, wait for pullback, 0.4% NAV risk
- C: below 65, high-risk exclusion, no new position

## Execution Rules

- Entry must be either breakout-retest hold or trend OTE pullback support.
- OTE is 0.618-0.705 and is valid only when it overlaps OB, FVG, EMA20/50, AVWAP, or a volume node.
- Stop must sit outside the structure invalidation point plus 0.5 ATR.
- If total risk exceeds 2.2 ATR or roughly 8%, reject the trade.
- Add only after +1R and a new BOS. Do not average down weak positions.
- Reduce at 1.5R, prior liquidity pool, or high-volume AVWAP breakdown.

## Product Acceptance

For a GREEN `/ai-recommendations` result:

- `status` must be `complete`.
- `itemCount` must be at least 5.
- `usedFallback` and `synthesisFallbackUsed` must be false.
- Every card must include ticker, company, bucket, score, entry, stop, TP1, TP2, reason, risk, source, and data completeness.
- C bucket cards are allowed only as explicit high-risk exclusions, never as buy recommendations.
