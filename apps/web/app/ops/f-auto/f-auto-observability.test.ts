import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(new URL("./FAutoSimPanel.tsx", import.meta.url), "utf8");
const navPanelSource = readFileSync(new URL("./FAutoNavPanel.tsx", import.meta.url), "utf8");
const connSource = readFileSync(new URL("./KgiConnectionLight.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const gateSource = readFileSync(new URL("./FAutoOwnerGate.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../../lib/fauto-sim-api.ts", import.meta.url), "utf8");
const sidebarSource = readFileSync(new URL("../../../components/Sidebar.tsx", import.meta.url), "utf8");
const canonicalSurfacesSource = readFileSync(new URL("../../../lib/canonical-surfaces.ts", import.meta.url), "utf8");

describe("F-AUTO S1 product observability", () => {
  it("uses the durable F-AUTO portfolio for positions and funds", () => {
    expect(panelSource).toContain("getFAutoPortfolio");
    expect(panelSource).toContain("portfolioPositionsState");
    expect(panelSource).toContain("portfolioFundsState");
    expect(panelSource).toContain("eodRows.get(position.symbol)");
    expect(panelSource).toContain("eod?.unrealizedPnlTwd");
    expect(panelSource).toContain("不把查不到即時券商資料誤顯示成零持倉");
  });

  it("maps the persisted order share count and Taipei timestamp", () => {
    expect(apiSource).toContain("row.shares");
    expect(apiSource).toContain("row.submitted_at_tst");
    expect(apiSource).toContain("KgiSimOrdersResult");
    expect(apiSource).toContain("normalizedReconciliation");
    expect(panelSource).toContain("已送出 / 成交待確認");
    expect(panelSource).toContain("券商回報");
    expect(panelSource).toContain("成交確認");
    expect(panelSource).toContain("等待券商回報");
    expect(panelSource).toContain("closureStateLabel");
  });

  it("normalizes daily smoke diagnostics into actionable product copy", () => {
    expect(apiSource).toContain("entry.overallStatus");
    expect(apiSource).toContain("entry.firedAt");
    expect(apiSource).toContain("entry.prodBrokerAuditCount");
    expect(apiSource).toContain("登入成功，但 KGI 行情 token 不可用");
    expect(apiSource).toContain("KGI gateway 無法連線");
    expect(panelSource).toContain('if (status === "partial") return "部分通過"');
    expect(panelSource).toContain('fmtDatetime(entry.date)');
  });

  it("gives owners a primary navigation entry", () => {
    expect(sidebarSource).toContain("OWNER_PRODUCT_SURFACES");
    expect(sidebarSource).toContain("OWNER_PRODUCT_NAV");
    expect(canonicalSurfacesSource).toContain('path: "/ops/f-auto"');
    expect(canonicalSurfacesSource).toContain("S1 持倉 / 損益");
  });

  // ── Auto-refresh polling ───────────────────────────────────────────────────

  it("defines intraday and off-hours poll interval constants", () => {
    // 45s intraday (09:00-13:30 TST session), 5min off-hours
    expect(panelSource).toContain("POLL_INTRADAY_MS = 45_000");
    expect(panelSource).toContain("POLL_OFFHOURS_MS = 5 * 60_000");
  });

  it("uses useAutoRefresh hook to drive all fetches via tick", () => {
    expect(panelSource).toContain("useAutoRefresh");
    expect(panelSource).toContain("const { tick, triggerRefresh, lastRefreshedAt } = useAutoRefresh()");
    // All primary fetches wired to tick
    expect(panelSource).toContain("useFetch(getFAutoPortfolio, tick)");
    expect(panelSource).toContain("useFetch(getKgiSimOrders, tick)");
    expect(panelSource).toContain("useFetch(getDailySmokeHistory, tick)");
    expect(panelSource).toContain("useFetch(getS1SimStatus, tick, false)");
    // EOD and basket effects also depend on tick
    expect(panelSource).toContain("}, [selectedDate, tick]);");
    expect(panelSource).toContain("}, [basketDate, tick]);");
  });

  it("pauses polling when tab is hidden and resumes immediately on visibility restore", () => {
    // visibilitychange listener wired
    expect(panelSource).toContain("visibilitychange");
    expect(panelSource).toContain("document.addEventListener");
    expect(panelSource).toContain("document.removeEventListener");
    // Checks document.hidden before firing refresh
    expect(panelSource).toContain("document.hidden");
    // On visible: immediate refresh then reschedule
    expect(panelSource).toContain("triggerRefresh()");
    expect(panelSource).toContain("scheduleNext()");
    // Timer cleanup on unmount
    expect(panelSource).toContain("clearTimeout");
  });

  it("shows last updated timestamp and manual refresh button", () => {
    // Last refreshed at display
    expect(panelSource).toContain("最後刷新");
    expect(panelSource).toContain("lastRefreshedAt");
    expect(panelSource).toContain("fmtTime(lastRefreshedAt)");
    expect(panelSource).toContain("頁面載入時");
    // Data as_of display
    expect(panelSource).toContain("資料截至");
    expect(panelSource).toContain("dataAsOf");
    // Interval info label
    expect(panelSource).toContain("45 秒自動刷新");
    expect(panelSource).toContain("5 分鐘自動刷新");
    // Manual refresh button
    expect(panelSource).toContain("_fauto-refresh-btn");
    expect(panelSource).toContain("手動重整所有面板");
    expect(panelSource).toContain("onClick={triggerRefresh}");
  });

  it("preserves last good data on poll failure (stale-data guard)", () => {
    // useFetch must keep lastGoodRef and suppress error/loading on background polls
    expect(panelSource).toContain("lastGoodRef");
    expect(panelSource).toContain("hadGoodData");
    expect(panelSource).toContain("silently keep last good data");
    // Same guard in EOD and basket effects
    expect(panelSource).toContain("eodLastGoodRef");
    expect(panelSource).toContain("basketLastGoodRef");
  });

  it("KgiConnectionLight accepts refreshTick prop and re-fetches on tick", () => {
    expect(connSource).toContain("refreshTick");
    expect(connSource).toContain("}, [refreshTick]);");
    // Also has stale-data guard
    expect(connSource).toContain("lastGoodRef");
    expect(connSource).toContain("hadGoodData");
    // Panel passes tick to it
    expect(panelSource).toContain("KgiConnectionLight refreshTick={tick}");
  });

  it("uses isKgiTradingHours to select poll interval", () => {
    expect(panelSource).toContain("isKgiTradingHours");
    expect(panelSource).toContain("POLL_INTRADAY_MS");
    expect(panelSource).toContain("POLL_OFFHOURS_MS");
    // Import from trading hours helper
    expect(panelSource).toContain('from "@/lib/kgi-trading-hours"');
  });

  // ── Display honesty (6/30 breakdown fix) ─────────────────────────────────────

  it("marks unpriced positions with 未計價 badge instead of showing null as zero", () => {
    // The badge appears in SimPositionsPanel for lastPrice == null
    expect(panelSource).toContain("未計價");
    expect(panelSource).toContain("_fauto-unpriced-badge");
    // API layer exposes the new field
    expect(apiSource).toContain("marketValueIsEstimated");
  });

  it("estimates market value from avg_cost when lastPrice is null", () => {
    // portfolioPositionsState must compute cost-estimated market value
    expect(panelSource).toContain("以成本估");
    expect(panelSource).toContain("_fauto-estimated-tag");
    // Logic: avgCost * shares when lastPrice is null
    expect(panelSource).toContain("avgCost * position.shares");
    expect(panelSource).toContain("marketValueIsEstimated");
  });

  it("shows dual-denominator PnL: vs 動用資金 (primary) and vs 本金 (secondary)", () => {
    expect(panelSource).toContain("動用資金");
    expect(panelSource).toContain("vs 動用資金");
    expect(panelSource).toContain("vs 本金");
    expect(panelSource).toContain("pnlVsCostPct");
    expect(panelSource).toContain("pnlVsCapitalPct");
    // costBasis is the denominator for 動用資金
    expect(panelSource).toContain("costBasis");
  });

  it("shows 曝險 (exposure %) and 現金水位 in summary", () => {
    expect(panelSource).toContain("曝險");
    expect(panelSource).toContain("exposurePct");
    expect(panelSource).toContain("現金水位");
  });

  it("shows 持有天數 from positions_date", () => {
    expect(panelSource).toContain("calcHoldingDays");
    expect(panelSource).toContain("holdingDays");
    expect(panelSource).toContain("開倉");
    expect(panelSource).toContain("fmtShortDate");
  });

  it("shows total assets as priced + estimated + cash breakdown", () => {
    expect(panelSource).toContain("totalAssetsEstimated");
    expect(panelSource).toContain("hasUnpricedPositions");
    expect(panelSource).toContain("pricedMV");
    expect(panelSource).toContain("estimatedMV");
    expect(panelSource).toContain("總資產（估）");
    expect(panelSource).toContain("_fauto-summary-breakdown");
  });

  it("surfaces persisted_close_fallback staleness notice in the UI", () => {
    expect(panelSource).toContain("persisted_close_fallback");
    expect(panelSource).toContain("_fauto-summary-staleness");
    expect(panelSource).toContain("hasPersistedFallback");
  });
});

describe("F-AUTO NAV Curve panel", () => {
  it("wires getFAutoNav into the main panel via useFetch and tick", () => {
    // Import declared
    expect(panelSource).toContain("getFAutoNav");
    expect(panelSource).toContain("FAutoNavPanel");
    expect(panelSource).toContain("useFetch<FAutoNavResponse>(getFAutoNav, tick)");
    // Passed to component
    expect(panelSource).toContain("<FAutoNavPanel");
    expect(panelSource).toContain("navState.phase");
  });

  it("defines getFAutoNav pointing at /api/v1/portfolio/f-auto/nav", () => {
    expect(apiSource).toContain("getFAutoNav");
    expect(apiSource).toContain("/api/v1/portfolio/f-auto/nav");
  });

  it("exports typed NavCurvePoint, NavWeekRow, FAutoNavResponse from api module", () => {
    expect(apiSource).toContain("NavCurvePoint");
    expect(apiSource).toContain("NavWeekRow");
    expect(apiSource).toContain("FAutoNavResponse");
    expect(apiSource).toContain("navDate");
    expect(apiSource).toContain("equityTwd");
    expect(apiSource).toContain("returnPct");
    expect(apiSource).toContain("weekNum");
    expect(apiSource).toContain("realizedPnlTwd");
    expect(apiSource).toContain("initialEquity");
    expect(apiSource).toContain("cumulativeReturnPct");
  });

  it("renders SVG equity curve with baseline and week markers", () => {
    // SVG component exists
    expect(navPanelSource).toContain("NavChart");
    expect(navPanelSource).toContain("polyline");
    expect(navPanelSource).toContain("polygon");
    // Baseline dashed line
    expect(navPanelSource).toContain("strokeDasharray");
    // Week markers (circles)
    expect(navPanelSource).toContain("weekMarkers");
    expect(navPanelSource).toContain("<circle");
    // Tooltip via SVG title
    expect(navPanelSource).toContain("<title>");
    // W label
    expect(navPanelSource).toContain("`W${weekNum}`");
  });

  it("shows y-mode toggle for 報酬% and 權益 TWD", () => {
    expect(navPanelSource).toContain("YMode");
    expect(navPanelSource).toContain("報酬 %");
    expect(navPanelSource).toContain("權益 TWD");
    expect(navPanelSource).toContain("_fnav-toggle-btn");
    expect(navPanelSource).toContain("_fnav-toggle-active");
    // Mode value
    expect(navPanelSource).toContain('"pct"');
    expect(navPanelSource).toContain('"equity"');
  });

  it("shows cumulative summary row with honest cost-inclusive return label", () => {
    expect(navPanelSource).toContain("起始本金");
    expect(navPanelSource).toContain("目前權益");
    expect(navPanelSource).toContain("累計報酬（含成本）");
    expect(navPanelSource).toContain("含手續費與證交稅");
    expect(navPanelSource).toContain("累計已實現損益");
    expect(navPanelSource).toContain("cumulativeReturnPct");
    expect(navPanelSource).toContain("totalRealizedPnlTwd");
  });

  it("shows weekly breakdown table with 6 columns", () => {
    expect(navPanelSource).toContain("NavWeekTable");
    expect(navPanelSource).toContain("逐週紀錄");
    expect(navPanelSource).toContain("重平衡日");
    expect(navPanelSource).toContain("部署成本");
    expect(navPanelSource).toContain("已實現損益");
    expect(navPanelSource).toContain("期末權益");
    expect(navPanelSource).toContain("現金剩餘");
    expect(navPanelSource).toContain("basketDate");
    expect(navPanelSource).toContain("basketCostTwd");
    expect(navPanelSource).toContain("equityAfterTwd");
  });

  it("honestly labels backfill segments and handles empty_ledger state", () => {
    // backfill detection
    expect(navPanelSource).toContain("isBackfillPoint");
    expect(navPanelSource).toContain("backfill_dry_run");
    expect(navPanelSource).toContain("歷史回補（依審計紀錄重建）");
    // empty_ledger empty state
    expect(navPanelSource).toContain("empty_ledger");
    expect(navPanelSource).toContain("帳本尚未建立");
  });

  it("wires pricingQuality degraded-pricing badges into both the curve annotation and weekly rows", () => {
    // NavCurvePoint carries the optional field from the backend (#1192)
    expect(apiSource).toContain("pricingQuality");
    expect(apiSource).toContain("mis_fallback_full");
    // Pure decision helpers live in a hook-free lib module (unit-tested directly there)
    expect(navPanelSource).toContain("@/lib/fauto-nav-pricing-quality");
    expect(navPanelSource).toContain("hasDegradedPricing");
    expect(navPanelSource).toContain("degradedPricingCount");
    expect(navPanelSource).toContain("weekHasDegradedPricing");
    // Curve-level annotation only renders when at least one point is degraded
    expect(navPanelSource).toContain("hasDegradedPricing(data.navCurve)");
    expect(navPanelSource).toContain("_fnav-pricing-note");
    // Weekly table row badge, per week
    expect(navPanelSource).toContain("weekHasDegradedPricing(w.weekNum, navCurve)");
    expect(navPanelSource).toContain("fnav-pricing-badge-week-");
    // Reuses DataStateBadge (four-state honest vocabulary), no raw enum literal in copy
    expect(navPanelSource).toContain("<DataStateBadge");
    expect(navPanelSource).toContain('state="delayed"');
    expect(navPanelSource).toContain("PRICING_QUALITY_REASON");
    // Chinese explanatory copy (not a raw enum literal) is what the badge's reason/title carries
    const libSource = readFileSync(
      new URL("../../../lib/fauto-nav-pricing-quality.ts", import.meta.url),
      "utf8",
    );
    expect(libSource).toContain("以驗證行情回退計算（非官方收盤）");
  });

  it("allows /api/v1/portfolio/f-auto/nav through the backend proxy GET allowlist", () => {
    // route.ts lives one level up from the test; read via fs if possible
    const routeSource = readFileSync(
      new URL("../../api/ui-final-v031/backend/route.ts", import.meta.url),
      "utf8",
    );
    // Pattern must match /nav subpath
    expect(routeSource).toContain("portfolio\\/f-auto(?:\\/nav)?");
  });

  // P1-7 (product critique 2026-07-10): "0/8 券商回報已對上" used to sit
  // quietly in a neutral-colored grid cell with only a small 10px pill as
  // signal. Escalate to a visible alert whenever any strategy-book order
  // still lacks a broker confirmation.
  it("escalates the reconciliation card to a visible alert state when orders are unconfirmed", () => {
    expect(panelSource).toContain("hasUnconfirmed");
    expect(panelSource).toContain("recon.unconfirmedCount > 0");
    expect(panelSource).toContain("_fauto-recon-card-alert");
    expect(panelSource).toContain("未經券商回報對帳，本頁及全站顯示的 F-AUTO 損益皆依內部委託紀錄重建");
  });

  // P1-1 (product critique 2026-07-10): this page's kv-list tables rendered
  // several raw backend enum values verbatim ("audit_log_fallback",
  // "weekly_tuesday_kgi_sim", "sideways", pending order status).
  it("translates raw backend enums instead of rendering them verbatim", () => {
    expect(panelSource).toContain("regimeLabel(state.data.regime)");
    expect(panelSource).toContain("schedulerModeLabel(state.data.automaticScheduler.mode)");
    expect(panelSource).toContain("capitalSourceLabel(state.data.capitalSource)");
    expect(panelSource).toContain('mode === "weekly_tuesday_kgi_sim"');
    expect(panelSource).toContain('regime === "sideways"');
    expect(panelSource).not.toContain("state.data.regime ?? \"--\"");
    expect(panelSource).not.toContain("state.data.capitalSource ?? \"--\"");
    expect(panelSource).not.toContain("state.data.automaticScheduler.mode ?? \"--\"");
    expect(panelSource).not.toContain("state.data.eodDataSource ?? \"--\"");
    expect(panelSource).not.toContain("state.data.dataSource ?? \"--\"");
  });

  it("translates the last SIM order status enum (pending|pass|fail) instead of leaking it raw", () => {
    expect(connSource).toContain("simOrderStatusLabel(state.data.last_sim_order_status)");
    expect(connSource).toContain('status === "pending"');
    expect(connSource).not.toContain("{state.data.last_sim_order_status}");
  });

  // P1-1: trading room used to unconditionally label every unreachable-KGI
  // moment "連線中斷"/故障, even during the EC2 gateway's normal weekday
  // 08:20-14:10 TST run window — unify to F-AUTO's "排程關機中，屬正常" wording.
  it("unifies the trading-room KGI-unreachable wording with F-AUTO's scheduled-off copy", () => {
    const liveHydration = readFileSync(
      new URL("../../../lib/final-v031-live.ts", import.meta.url),
      "utf8",
    );
    expect(liveHydration).toContain("isKgiGatewayScheduledOff");
    expect(liveHydration).toContain("KGI_GATEWAY_SCHEDULED_OFF_DETAIL");
    expect(liveHydration).toContain("目前在關機時段，屬正常狀態");
  });
});

// ── 2026-07-19 (Jim-4) three-finding fixup ──────────────────────────────────
//
// Bruce reproduced 3 issues on this owner-only page:
//  1. Header Taipei clock date frozen on a stale day (time visibly ticking).
//  2. Order-confirmation red card printed a raw backend error string
//     containing an internal EC2 IP and endpoint path.
//  3. Several kv-list/header rows leaked raw backend enum/free-text values
//     ("audit_log_fallback", "capital_source:latest_subscription
//     subscription:e5458bb0-... skipped_untradable...").

describe("F-AUTO page: dynamic rendering (finding #1 — frozen header clock)", () => {
  it("page.tsx is a Server Component that owns the dynamic route segment config", () => {
    // Root cause (2-layer): (a) this route had zero server-side dynamic API
    // usage (owner-gate ran entirely client-side via apiGetMe() in a
    // useEffect), so Next.js's automatic Static Rendering fully prerendered
    // it once at `next build` time into the Full Route Cache; AND (b) simply
    // adding `export const dynamic = "force-dynamic"` to the old "use client"
    // page.tsx was silently ignored by Next.js — route segment config is
    // only read from Server Component page files. Both were empirically
    // confirmed via `next build`: the route stayed "○ Static" (and
    // `.next/server/app/ops/f-auto.html` kept being emitted) even after the
    // export was added to the client file; only after splitting the client
    // logic into FAutoOwnerGate.tsx and moving the export onto a genuine
    // Server Component page.tsx did the build show "ƒ /ops/f-auto" — Dynamic
    // — and the static .html snapshot stopped being generated. This matches
    // the sibling /ops/page.tsx pattern, which is a Server Component and was
    // never affected.
    expect(pageSource).not.toContain('"use client"');
    expect(pageSource).toContain('export const dynamic = "force-dynamic"');
    expect(pageSource).toContain("FAutoOwnerGate");
  });

  it("moves all previous client-side owner-gate logic into FAutoOwnerGate.tsx unchanged", () => {
    expect(gateSource).toContain('"use client"');
    expect(gateSource).toContain("apiGetMe");
    expect(gateSource).toContain("FAutoSimPanel");
    expect(gateSource).toContain("驗證身份中");
  });

  it("does not render any date/time text that depends on a fixed build-time value", () => {
    // Neither the Server Component wrapper nor its client boundary computes
    // a date/time string itself — the only clock on this page must be the
    // shared, always-correct client-mounted <TaipeiClock /> owned by
    // PageFrame's header, not a page-local Date computation that could
    // re-introduce a bake-in vector.
    expect(pageSource).not.toContain("new Date(");
    expect(pageSource).not.toContain("toLocaleDateString");
    expect(gateSource).not.toContain("new Date(");
    expect(gateSource).not.toContain("toLocaleDateString");
  });
});

describe("F-AUTO SIM panel: no engineering dumps in the order confirmation card (finding #2)", () => {
  it("never interpolates the raw broker fetch-error source/message into the reconciliation card", () => {
    // This exact pattern used to render backend free text verbatim,
    // including an internal EC2 gateway IP + endpoint path
    // ("order_events: KGI gateway unreachable in http://43.213.204.233:8787/
    // events/... Request timed out after 5000ms...").
    expect(panelSource).not.toContain("${err.source}: ${err.message}");
    expect(panelSource).not.toContain("err.message");
    expect(panelSource).not.toContain("err.source");
    // Replacement copy is honest human wording, technical detail stays out
    // of the UI (kept in backend audit records per existing product voice).
    expect(panelSource).toContain("券商連線暫時中斷，委託以稽核帳本重建，待連線恢復後自動對帳");
    expect(panelSource).toContain("技術原因保留於後端稽核紀錄");
  });

  it("produces no IP address, raw URL, or engineering token in the reconciliation error render path — regression grep", () => {
    // Simulates the exact backend payload Bruce saw and asserts none of its
    // raw fragments can appear in the fixed render source.
    const simulatedBackendMessage =
      "order_events: KGI gateway unreachable in http://43.213.204.233:8787/events/abc Request timed out after 5000ms";
    for (const leak of ["43.213", "order_events", "http://", "8787"]) {
      expect(simulatedBackendMessage).toContain(leak); // sanity: fixture really contains the leak
      expect(panelSource).not.toContain(leak);
    }
  });
});

describe("F-AUTO SIM panel: raw enum / debug-note leaks removed (finding #3)", () => {
  it("routes every data_source render through fAutoDataSourceLabel instead of the raw enum", () => {
    // SIM-POS panel header sub-label used to print the raw data_source enum
    // (e.g. "audit_log_fallback") directly next to positions_date.
    expect(panelSource).not.toContain("${portfolioState.data.data_source} /");
    expect(panelSource).toContain(
      "`${fAutoDataSourceLabel(portfolioState.data.data_source)} / ${portfolioState.data.positions_date}`",
    );
    // SIM-FUND panel's constructed note also used to interpolate the raw enum.
    expect(panelSource).not.toContain("${state.data.data_source} / 部位日");
    expect(panelSource).toContain("${fAutoDataSourceLabel(state.data.data_source)} / 部位日");
  });

  it("routes the 配置資金（本金） capital_source display through capitalSourceLabel", () => {
    expect(panelSource).not.toContain('data?.capital_source ?? statusData?.capitalSource ?? "--"');
    expect(panelSource).toContain("capitalSourceLabel(data?.capital_source ?? statusData?.capitalSource)");
  });

  it("routes the 持倉狀態 (Col 6) data-source fallback through fAutoDataSourceLabel too", () => {
    // This fallback only shows when openDateLabel is null; it used to print
    // the raw eodData/data/statusData data_source enum directly.
    expect(panelSource).not.toContain(
      '(eodData?.dataSource ?? data?.data_source ?? statusData?.eodDataSource ?? "--")',
    );
    expect(panelSource).toContain(
      "fAutoDataSourceLabel(eodData?.dataSource ?? data?.data_source ?? statusData?.eodDataSource ?? null)",
    );
  });

  it("guards every raw failsafeNotes/note render site with safeNote()", () => {
    expect(panelSource).toContain("function safeNote(");
    expect(panelSource).toContain("RAW_ENGINEERING_TOKEN_RE");
    // No remaining direct (unguarded) interpolation of these backend
    // free-text fields — every occurrence must be wrapped in safeNote(...).
    expect(panelSource).not.toContain(">{state.data.failsafeNotes}<");
    expect(panelSource).not.toContain(">{state.data.note}<");
    expect(panelSource).toContain("safeNote(state.data.failsafeNotes)");
    expect(panelSource).toContain("safeNote(state.data.note)");
  });

  it("safeNote's engineering-token pattern catches the literal leaked string and passes through honest prose", () => {
    // Kept in sync with FAutoSimPanel.tsx's RAW_ENGINEERING_TOKEN_RE.
    const RAW_ENGINEERING_TOKEN_RE = /\b[a-z][a-z0-9_]*:[\w.-]+/;
    const leakedExample =
      "capital_source:latest_subscription subscription:e5458bb0-1234-5678-9abc-def012345678 skipped_untradable:2330,2454";
    expect(RAW_ENGINEERING_TOKEN_RE.test(leakedExample)).toBe(true);
    expect(RAW_ENGINEERING_TOKEN_RE.test("audit_log_fallback")).toBe(false); // no colon: caught by the label functions instead, not this guard
    // Honest Chinese narrative notes (no colon-separated engineering tokens) must pass through unchanged.
    expect(RAW_ENGINEERING_TOKEN_RE.test("部分收盤價取自前日或最近已知收盤，今日報價尚未更新")).toBe(false);
    expect(RAW_ENGINEERING_TOKEN_RE.test("S1 若干候選因流動性不足被排除")).toBe(false);
  });
});

