# BLOCK #8 Lane C — Company Page Sections [06]–[11] Implementation

- Date: 2026-05-07
- Lane: C — apps/web company page render
- Lane owner: Jim (frontend-consume)
- Branch: `feat/web-company-page-sections-06-11-block8-lane-c-2026-05-07`
- Source dispatch: BLOCK #8 Lane C escalation — sections [06]-[11]
- TCS impact: +3

## Scope

Add sections [06]-[11] to `apps/web/app/companies/[symbol]/page.tsx` consuming
the aggregated `GET /api/v1/companies/:id/full-profile` envelope shipped in
PR #259, plus the per-section announcements endpoint (PR #265 honest DEGRADED
state).

Sections rendered:

| # | Title | Source | Data |
|---|---|---|---|
| 06 | 財報 | `fundamentals.financialStatement` | EPS / 營收 / 營業利益 (latest snapshot + 4 期 trend) |
| 07 | 月營收 | `fundamentals.monthlyRevenue` | 12-month + YoY 年增率 |
| 08 | 法人籌碼 | `tradingFlow.institutional` | 30 日外資 / 投信 / 自營商 net + 10 日明細 |
| 09 | 融資融券 | `tradingFlow.marginShort` | 30 日 margin/short balance + Δ 變動 |
| 10 | 股利政策 | `marketIntel.dividend` (+ valuation 殖利率) | 5 年 history + 公告日 |
| 11 | 重大訊息 | `GET /announcements?days=30` | 30 日公告 + DEGRADED 顯示「資料源暫停（TWSE 維護）」 |

## Files Touched

| File | Action | Notes |
|---|---|---|
| `apps/web/app/companies/[symbol]/page.tsx` | edit | mount FullProfilePanels + section header band |
| `apps/web/app/companies/[symbol]/FullProfilePanels.tsx` | new | client component, 1 fetch /full-profile + 1 fetch /announcements |
| `apps/web/lib/api.ts` | edit | add FullProfileEnvelope types + getCompanyFullProfile() |
| `apps/web/app/globals.css` | edit | add `.full-profile-grid` responsive grid + 390px mobile fallbacks |

## Constraints Honored

- [x] Did not modify K-line cosmetic / chart cosmetic
- [x] Did not modify existing sections [01][02][03][04][05]:
  - HeroBar, Workbench (OHLCV+Paper), CompanyInfo all untouched
  - FinancialsPanel ([03]), ChipsPanel ([04]), AnnouncementsPanel ([05]) untouched
- [x] No mock / fake data — every section surfaces honest state when
      LIVE / STALE / EMPTY / BLOCKED / DEGRADED / ERROR
- [x] Did not touch paper submit / order desk
- [x] Did not import KGI SDK / broker live submit path
- [x] Did not connect TradingView as primary data source
- [x] No buy/sell/目標價/必賺/勝率/guaranteed return wording (only mentioned
      in hard-line comment)
- [x] Lane C scope only — no Lane A/B/D file touch

## State Badge Mapping

| State | Badge | Label |
|---|---|---|
| LIVE | green | 正常 |
| STALE | yellow | 資料過期 |
| EMPTY | yellow | 無資料 |
| DEGRADED | yellow | 降級 |
| FALLBACK | yellow | 回退 |
| MOCK | yellow | 示意 |
| CLOSED | blue | 暫停接入 |
| BLOCKED | red | 暫停 |
| ERROR | red | 錯誤 |

## Empty / Blocked Behavior

- Each section renders `StateOnly` panel (badge + datasetKey + updatedAt + 中文 reason)
  when `state ∉ {LIVE, STALE}`.
- Section [11] announcements detect upstream pause (TWSE / FinMind /
  maintenance / 維護 / degrade in error message) and surface
  「資料源暫停（TWSE 維護）」prefix.
- STALE rows still display latest known data with an inline 「{datasetKey} 已超過新鮮度上限」 note.

## Mobile 390px

- `.full-profile-grid` collapses to 1-column at ≤1180px.
- Metric tile grid collapses to 1-column at ≤760px.
- Tables use `.table-scroll` with `overflow-x: auto` so wide tables (e.g.
  margin/short with 5 columns) don't break layout — they horizontal-scroll.
- Announcements row collapses to 3-cell at ≤760px (date / category / title)
  to avoid CTA wrap.

## Verify

### Typecheck

```
pnpm --filter @iuf-trading-room/web typecheck
> tsc -p tsconfig.json --noEmit
EXIT=0
```

PASS — no errors.

### Backend contract

`GET /api/v1/companies/:id/full-profile` → envelope shape per
`apps/api/src/server.ts` lines 5224-5621 (PR #259):

```jsonc
{
  "data": {
    "company": { "id", "ticker", "name", "market", "country" },
    "fundamentals": {
      "monthlyRevenue":     { "state", "latest", "history", "updatedAt", "sourceTrail" },
      "financialStatement": { "state", "latest", "history", "updatedAt", "sourceTrail" },
      "cashFlow":           { "state", "latest", "history", "updatedAt", "sourceTrail" },
      "balanceSheet":       { "state", "latest", "history", "updatedAt", "sourceTrail" }
    },
    "tradingFlow": {
      "institutional":   { "state", "latest", "history", "updatedAt", "sourceTrail" },
      "marginShort":     { "state", "latest", "history", "updatedAt", "sourceTrail" },
      "shareholding":    { "state", "latest", "history", "updatedAt", "sourceTrail" }
    },
    "marketIntel": {
      "dividend":        { "state", "latest", "history", "updatedAt", "sourceTrail" },
      "marketValue":     { "state", "latest", "history", "updatedAt", "sourceTrail" },
      "valuation":       { "state", "latest", "history", "updatedAt", "sourceTrail" },
      "news":            { "state", "latest", "history", "updatedAt", "sourceTrail", "experimental": true }
    }
  }
}
```

Client `FullProfileEnvelope` in `apps/web/lib/api.ts` mirrors this exactly.

### no-fake-green grep

```
grep -E "mock|fake|目標價|必賺|勝率|guaranteed" \
  apps/web/app/companies/\[symbol\]/FullProfilePanels.tsx
```

Only matches: HARD LINES comment block (forbidden-phrase list, not used).

## Followups (out of Lane C scope)

- shareholding ([tradingFlow.shareholding]) and marketValue
  ([marketIntel.marketValue]) and news ([marketIntel.news, experimental])
  are present in the envelope but not surfaced in [06]-[11] — the dispatch
  asked specifically for these 6, and the existing ChipsPanel ([04]) already
  shows shareholding. If楊董 wants those 3 surfaced they'd be a future
  iteration.
- Existing `AnnouncementsPanel` ([05]) and new section [11] both fetch
  `/announcements?days=30` — that's a duplicate fetch by design (dispatch
  said preserve existing 4 sections + add [06]-[11]). A future cleanup
  could consolidate.
