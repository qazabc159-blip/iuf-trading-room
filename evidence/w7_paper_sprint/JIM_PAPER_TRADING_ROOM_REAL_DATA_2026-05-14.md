# JIM — Paper Trading Room Real Data Wire
# Date: 2026-05-14
# Branch: fix/web-paper-trading-room-real-data-wire-2026-05-14

## Audit: Hardcoded Fake Data Sites in vendor HTML

| Site | Lines | Issue | Fix |
|---|---|---|---|
| Watchlist (wl-my) | 55-137 | Hardcoded prices (962, 288.5 etc) | Already wired by hydratePaper() #wl-my |
| Symbol head price/OHLC | 144-170 | Static 962.00, 956, 965 etc | Already wired by hydratePaper() |
| Position banner | 174-179 | Hardcoded "2,000 股", "945.50", "8 個交易日" | FIXED: id hooks + hydration wire |
| OHLCV legend | 200-204 | ohlc-o/h/l/c static | Already wired PR #431 |
| K-line chart | 637-653 | genSeries() fake random walk | FIXED: window.__IUF_OHLCV_DATA__ + getChartData() |
| Orderbook depth | 261-271 | Static bid/ask 963.0/962.5 etc | Already wired hydratePaper() |
| Recent ticks tape | 277-287 | Static 13:24:18/962.0 etc | Already wired PR #431 |
| Portfolio summary | 293-297 | Hardcoded 1,891,000 / +33,000 / 1 檔 / 2 筆 | FIXED: id hooks summary-mktval/pnl/poscount/fillcount |
| Orders table | 319-323 | Vendor fake orders | Already wired |
| Fills table | 331-339 | 04-12/PO-3174 fake fills | Already wired |
| Positions table | 347-351 | 2,000 stocks fake | Already wired |
| KGI table | 362-366 | Fake KGI positions | Already wired |
| Events table | 372-387 | @hung fake audit trail | FIXED: id="events-body" + real fills/orders synthesis |
| SYM_DATA JS | 541-550 | Hardcoded prices for pickRow() | FIXED: window.__IUF_SYM_DATA_LIVE__ override |
| updPreview() curPos | 623 | sym==='2330'?2000:0 hardcode | FIXED: window.__IUF_PORTFOLIO__ real portfolio |
| drawChart() | 637+ | genSeries() random walk | FIXED: getChartData() uses window.__IUF_OHLCV_DATA__ |
| wl-sig tab | 84-117 | Static fake ideas | FIXED: hydration replaces rows from live.ideas |
| wl-paper tab | 119-137 | Static fake paper candidates | FIXED: hydration replaces rows from allow-grade ideas |

## APIs Consumed

| Data | Endpoint | Key fields |
|---|---|---|
| K-line OHLCV | GET /api/v1/companies/{id}/ohlcv?interval=1d | open, high, low, close, volume |
| Bid/ask orderbook | GET /api/v1/kgi/quote/bidask?symbol= | ask_prices, bid_prices, ask_volumes, bid_volumes |
| Recent ticks | GET /api/v1/kgi/quote/ticks?symbol=&limit=16 | ticks[].price, .time, .volume |
| Paper fills | GET /api/v1/paper/fills | fillTime, symbol, side, fillPrice, fillQty, orderId |
| Paper orders | GET /api/v1/paper/orders | intent.{createdAt,symbol,side,price,qty,status,id} |
| Paper portfolio | GET /api/v1/paper/portfolio | positions[].{symbol,netQtyShares,avgCostPerShare,fillCount} |
| Strategy ideas | GET /api/v1/strategy/ideas | items[].{symbol,decision,score,confidence,signalCount} |
| Quote realtime | GET /api/v1/companies/{id}/quote/realtime | lastPrice, state, volume |

## Globals Exposed to Vendor JS

| Global | Purpose |
|---|---|
| window.__IUF_PORTFOLIO__ | updPreview() curPos calculation — real portfolio positions |
| window.__IUF_OHLCV_DATA__ | {sym, bars[]} — real K-line bars for drawChart() |
| window.__IUF_SYM_DATA_LIVE__ | {symbol: {nm,sec,price,open,high,low,prev,vol}} for pickRow() |
| window.__IUF_AVAIL_CASH__ | Available cash for order preview (existing, PR #431) |

## Fallback Behaviour (stream BLOCKED / no data)

- K-line: getChartData() returns [{o:100,h:100,l:100,c:100,v:0,placeholder:true}] — single flat bar, not random fake
- Bid/ask: #depth shows "—" not static fake 963.0
- Tape: #tape shows empty state "資料更新中" not static 13:24 fakes
- Position banner: hidden (display:none) when no portfolio position for selected symbol
- Portfolio summary: shows "—" for mktval/pnl when portfolio.length === 0
- Events: shows "目前沒有執行事件紀錄" when fills+orders both empty

## Files Changed

- `apps/web/public/ui-final-v031/paper_trading_room/index.html`
  - Position banner: id hooks (banner-qty, banner-avg, banner-days, banner-pnl), default display:none
  - Portfolio summary: id hooks (summary-mktval, summary-pnl, summary-poscount, summary-fillcount)
  - Events table tbody: id="events-body", static fake rows removed
  - SYM_DATA: replaced with null-price fallback + window.__IUF_SYM_DATA__ check
  - drawChart(): uses getChartData() which checks window.__IUF_OHLCV_DATA__
  - genSeries(): kept as last-resort but seed is null-safe
  - pickRow(): uses window.__IUF_SYM_DATA_LIVE__ merged with SYM_DATA, handles null prices gracefully
  - updPreview(): uses window.__IUF_PORTFOLIO__ for curPos (removed 2330?2000:0 hardcode)
  - Initial drawChart('2330') skipped if hydration present
  - wl-sig-group, wl-paper-group ids added

- `apps/web/lib/final-v031-live.ts`
  - hydratePaper(): expose window.__IUF_PORTFOLIO__, __IUF_OHLCV_DATA__, __IUF_SYM_DATA_LIVE__
  - Call vendor drawChart() after real OHLCV data is set
  - Position banner wire (banner-qty/avg/days/pnl)
  - Portfolio summary wire (summary-mktval/pnl/poscount/fillcount)
  - Events table synthesis from real fills + pending orders
  - wl-sig wiring from live.ideas (all ideas with signals)
  - wl-paper wiring from live.ideas (allow + review grade only)

## CI Results

- typecheck: EXIT 0 (npx tsc --noEmit)
- build: 3/3 successful (turbo build @iuf-trading-room/web)
- test: not run (no unit tests for vendor HTML hydration)
