# Company Announcements TWSE IIH Rescue - 2026-06-05

## Problem

Company important announcements were still empty after the cache-first fix because the local
`tw_announcements` cache had no rows for many symbols, and the broad TWSE market fallback only
returns a short market-wide feed.

## Fix

- Keep the formal company announcements route cache-first.
- Add the official TWSE IIH single-company events endpoint as the next fallback:
  `https://www.twse.com.tw/rwd/zh/IIH/company/events?code={ticker}`.
- Normalize ROC dates to ISO dates.
- Surface official `news`, `fina`, and `conference` rows as company announcements.
- Keep the old deprecated per-ticker fetch behind the internal legacy route only.

## Expected production acceptance

- `/api/v1/companies/2330/announcements?days=365` returns LIVE rows from `twse_iih_company_events`
  when the cache is empty.
- Same for non-2330 symbols such as 6202 and 2603.
- Empty state is only shown when all official sources truly return no rows.
