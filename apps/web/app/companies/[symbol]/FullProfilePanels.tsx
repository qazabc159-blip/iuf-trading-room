// /companies/[symbol]/FullProfilePanels.tsx — BLOCK #8 Lane C [06]-[11].
//
// Renders the 6 remaining sections out of the 11-dataset FinMind product surface
// off /api/v1/companies/:id/full-profile (PR #259), one fetch shared by all
// six sub-panels.  Every sub-panel surfaces:
//   - heading (numbered ASCII bracket)
//   - sourceStatus badge (LIVE / STALE / EMPTY / BLOCKED / DEGRADED / ERROR)
//   - updatedAt (Asia/Taipei)
//   - data render (table / metric tiles / mini history list)
//   - empty / blocked / degraded honest copy — never green-paint missing data
//
// Sections covered here:
//   06 financials       fundamentals.financialStatement (EPS / revenue / opIncome + history)
//   07 monthly revenue  fundamentals.monthlyRevenue     (12-month + YoY)
//   08 institutional    tradingFlow.institutional       (last 30d foreign / trust / dealer)
//   09 margin / short   tradingFlow.marginShort         (last 30d margin & short balance + delta)
//   10 dividend         marketIntel.dividend            (5y history + announcement / yield)
//   11 announcements    GET /announcements?days=30      (DEGRADED state honest)
//
// HARD LINES (per BLOCK #8 Lane C dispatch + repo no-fake-data rule):
//   - never display fabricated rows; missing data → EMPTY/BLOCKED/DEGRADED state badge
//   - never display buy/sell/目標價/必賺/勝率/guaranteed return wording
//   - K-line / chart cosmetic untouched; sections [01]-[05] not modified
//   - Mobile 390px must not overflow (max-content tables horizontally scroll, lists wrap)

"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getCompanyAnnouncements,
  getCompanyFullProfile,
  type CompanyAnnouncement,
  type FullProfileEnvelope,
  type FullProfileSection,
  type FullProfileSourceState,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

// ----------------------------------------------------------------------------- //
// state
// ----------------------------------------------------------------------------- //

type EnvelopeState =
  | { status: "loading" }
  | { status: "blocked"; reason: string; fetchedAt: string }
  | { status: "live"; envelope: FullProfileEnvelope; fetchedAt: string };

type AnnouncementsState =
  | { status: "loading" }
  | { status: "blocked"; reason: string; fetchedAt: string }
  | { status: "empty"; reason: string; fetchedAt: string }
  | { status: "live"; items: CompanyAnnouncement[]; fetchedAt: string };

// ----------------------------------------------------------------------------- //
// helpers
// ----------------------------------------------------------------------------- //

function formatTaipei(value: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTaipeiDate(value: string | null | undefined) {
  if (!value) return "--";
  // The backend returns YYYY-MM-DD or full ISO; keep raw if it already looks like a date.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });
}

function stateBadgeClass(state: FullProfileSourceState) {
  if (state === "LIVE") return "badge-green";
  if (state === "STALE") return "badge-yellow";
  if (state === "EMPTY") return "badge-yellow";
  if (state === "DEGRADED") return "badge-yellow";
  if (state === "FALLBACK") return "badge-yellow";
  if (state === "MOCK") return "badge-yellow";
  if (state === "CLOSED") return "badge-blue";
  return "badge-red"; // BLOCKED / ERROR
}

function stateLabel(state: FullProfileSourceState) {
  if (state === "LIVE") return "正常";
  if (state === "STALE") return "資料過期";
  if (state === "EMPTY") return "無資料";
  if (state === "DEGRADED") return "降級";
  if (state === "FALLBACK") return "回退";
  if (state === "MOCK") return "示意";
  if (state === "CLOSED") return "暫停接入";
  if (state === "BLOCKED") return "暫停";
  return "錯誤"; // ERROR
}

function emptyReason(state: FullProfileSourceState, datasetKey: string, degradedReason: string | null) {
  if (state === "EMPTY") return `${datasetKey} 沒有可用列；不補假資料。`;
  if (state === "BLOCKED") return `${datasetKey} 暫停讀取${degradedReason ? `：${degradedReason}` : ""}。`;
  if (state === "DEGRADED") return `${datasetKey} 降級讀取${degradedReason ? `：${degradedReason}` : "（資料源暫停或維護）"}。`;
  if (state === "ERROR") return `${datasetKey} 後端讀取錯誤${degradedReason ? `：${degradedReason}` : ""}。`;
  if (state === "STALE") return `${datasetKey} 已超過新鮮度上限；下方為最後一筆已知資料。`;
  if (state === "FALLBACK") return `${datasetKey} 回退到備援資料；下方僅為最後一筆已知資料。`;
  if (state === "MOCK") return `${datasetKey} 為示意資料，不可作為決策依據。`;
  if (state === "CLOSED") return `${datasetKey} 目前不接入；不顯示資料。`;
  return "";
}

function num(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  return value.toLocaleString("zh-TW", { maximumFractionDigits: digits });
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 兆`;
  if (abs >= 100_000_000) return `${(value / 100_000_000).toLocaleString("zh-TW", { maximumFractionDigits: 2 })} 億`;
  if (abs >= 10_000) return `${(value / 10_000).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 萬`;
  return value.toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

function lots(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("zh-TW")} 張`;
}

function pct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function tone(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "muted";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

// ----------------------------------------------------------------------------- //
// shared sub-components
// ----------------------------------------------------------------------------- //

function SectionHeader({
  index,
  title,
  hint,
}: {
  index: string;
  title: string;
  hint?: string;
}) {
  return (
    <h3 className="ascii-head">
      <span className="ascii-head-bracket">{index}</span> {title}
      {hint ? <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>{hint}</span> : null}
    </h3>
  );
}

function SourceLine({
  state,
  datasetKey,
  updatedAt,
  recordCount,
  source,
}: {
  state: FullProfileSourceState;
  datasetKey: string;
  updatedAt: string;
  recordCount?: number;
  source?: string;
}) {
  return (
    <div className="source-line">
      <span className={`badge ${stateBadgeClass(state)}`}>{stateLabel(state)}</span>
      <span className="tg soft">來源：{source ?? "FinMind"} / {datasetKey}</span>
      {typeof recordCount === "number" ? <span className="tg soft">筆數：{recordCount}</span> : null}
      <span className="tg soft">更新：{formatTaipei(updatedAt)}</span>
    </div>
  );
}

function StateOnly({
  section,
  source,
}: {
  section: FullProfileSection<unknown>;
  source?: string;
}) {
  return (
    <div className="state-panel">
      <span className={`badge ${stateBadgeClass(section.state)}`}>{stateLabel(section.state)}</span>
      <span className="tg soft">來源：{source ?? "FinMind"} / {section.sourceTrail.datasetKey}</span>
      <span className="tg soft">更新：{formatTaipei(section.updatedAt)}</span>
      <span className="state-reason">{emptyReason(section.state, section.sourceTrail.datasetKey, section.sourceTrail.degradedReason)}</span>
    </div>
  );
}

function MetricTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="metric-tile">
      <span className="tg soft">{label}</span>
      <strong>{value}</strong>
      {hint ? <span className="tg soft">{hint}</span> : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- //
// [06] Financials
// ----------------------------------------------------------------------------- //

function FinancialsSection({ section }: { section: FullProfileEnvelope["fundamentals"]["financialStatement"] }) {
  const showData = section.state === "LIVE" || section.state === "STALE";
  const latest = section.latest;
  // Build a compact period-grouped history for trend display (latest 4 distinct dates).
  const trend = useMemo(() => {
    if (!showData) return [] as Array<{ date: string; eps: number | null; revenue: number | null; opIncome: number | null }>;
    const EPS_KEYS = new Set(["EPS", "EarningsPerShare", "BasicEPS"]);
    const REV_KEYS = new Set(["Revenue", "OperatingRevenue", "NetRevenue"]);
    const OP_KEYS = new Set(["OperatingIncome", "OperatingIncomeLoss"]);
    const byDate = new Map<string, { eps: number | null; revenue: number | null; opIncome: number | null }>();
    for (const row of section.history) {
      if (!row?.date) continue;
      if (!byDate.has(row.date)) byDate.set(row.date, { eps: null, revenue: null, opIncome: null });
      const slot = byDate.get(row.date)!;
      if (EPS_KEYS.has(row.type) && slot.eps === null) slot.eps = row.value;
      if (REV_KEYS.has(row.type) && slot.revenue === null) slot.revenue = row.value;
      if (OP_KEYS.has(row.type) && slot.opIncome === null) slot.opIncome = row.value;
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 4)
      .map(([date, v]) => ({ date, ...v }));
  }, [section.history, showData]);

  return (
    <section className="panel hud-frame company-intel-panel">
      <SectionHeader index="[06]" title="財報" hint="FinMind 財報季度（EPS / 營收 / 營業利益）" />
      {showData ? (
        <div className="market-intel-list">
          <SourceLine
            state={section.state}
            datasetKey={section.sourceTrail.datasetKey}
            updatedAt={section.updatedAt}
            recordCount={section.sourceTrail.recordCount}
          />
          {latest ? (
            <div className="metric-grid compact-metric-grid">
              <MetricTile label="期別" value={latest.date ?? "--"} />
              <MetricTile label="EPS" value={num(latest.eps)} hint="元" />
              <MetricTile label="營收" value={money(latest.revenue)} />
              <MetricTile label="營業利益" value={money(latest.operatingIncome)} />
            </div>
          ) : null}
          {trend.length > 0 ? (
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table className="data-table company-data-table-fit">
                <thead>
                  <tr>
                    <th><span>期別</span></th>
                    <th><span>EPS</span></th>
                    <th><span>營收</span></th>
                    <th><span>營業利益</span></th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((row) => (
                    <tr key={row.date}>
                      <td><span>{row.date}</span></td>
                      <td className="num"><span>{num(row.eps)}</span></td>
                      <td className="num"><span>{money(row.revenue)}</span></td>
                      <td className="num"><span>{money(row.opIncome)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {section.state === "STALE" ? (
            <div className="tg soft" style={{ marginTop: 8 }}>
              {emptyReason(section.state, section.sourceTrail.datasetKey, section.sourceTrail.degradedReason)}
            </div>
          ) : null}
        </div>
      ) : (
        <StateOnly section={section} />
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------- //
// [07] Monthly Revenue
// ----------------------------------------------------------------------------- //

function RevenueSection({ section }: { section: FullProfileEnvelope["fundamentals"]["monthlyRevenue"] }) {
  const showData = section.state === "LIVE" || section.state === "STALE";
  const latest = section.latest;

  return (
    <section className="panel hud-frame company-intel-panel">
      <SectionHeader index="[07]" title="月營收" hint="FinMind 月營收 12 月 + 年增率" />
      {showData ? (
        <div className="market-intel-list">
          <SourceLine
            state={section.state}
            datasetKey={section.sourceTrail.datasetKey}
            updatedAt={section.updatedAt}
            recordCount={section.history.length}
          />
          {latest ? (
            <div className="metric-grid compact-metric-grid">
              <MetricTile
                label="最新月份"
                value={`${latest.revenue_year}/${String(latest.revenue_month).padStart(2, "0")}`}
              />
              <MetricTile label="當月營收" value={money(latest.revenue)} />
              <MetricTile
                label="年增率"
                value={pct(latest.yoyGrowth)}
                hint={typeof latest.yoyGrowth === "number" ? "去年同月對比" : "需要 ≥ 1 年資料"}
              />
            </div>
          ) : null}
          {section.history.length > 0 ? (
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table className="data-table company-data-table-fit">
                <thead>
                  <tr>
                    <th><span>月份</span></th>
                    <th><span>營收</span></th>
                  </tr>
                </thead>
                <tbody>
                  {section.history.slice(0, 12).map((row) => (
                    <tr key={`${row.stock_id}-${row.date}`}>
                      <td><span>{row.revenue_year}/{String(row.revenue_month).padStart(2, "0")}</span></td>
                      <td className="num"><span>{money(row.revenue)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : (
        <StateOnly section={section} />
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------- //
// [08] Institutional
// ----------------------------------------------------------------------------- //

function InstitutionalSection({ section }: { section: FullProfileEnvelope["tradingFlow"]["institutional"] }) {
  const showData = section.state === "LIVE" || section.state === "STALE";
  const latest = section.latest;
  // Aggregated 30d net (sum of history)
  const totals = useMemo(() => {
    if (!showData) return null;
    let f = 0;
    let t = 0;
    let d = 0;
    for (const row of section.history) {
      f += Number.isFinite(row.foreign) ? row.foreign : 0;
      t += Number.isFinite(row.investmentTrust) ? row.investmentTrust : 0;
      d += Number.isFinite(row.dealer) ? row.dealer : 0;
    }
    return { foreign: f, trust: t, dealer: d, total: f + t + d };
  }, [section.history, showData]);

  return (
    <section className="panel hud-frame company-intel-panel">
      <SectionHeader index="[08]" title="法人籌碼" hint="近 30 日 外資 / 投信 / 自營商買賣超" />
      {showData ? (
        <div className="market-intel-list">
          <SourceLine
            state={section.state}
            datasetKey={section.sourceTrail.datasetKey}
            updatedAt={section.updatedAt}
            recordCount={section.history.length}
          />
          {totals ? (
            <div className="metric-grid compact-metric-grid">
              <MetricTile label="外資 30 日" value={lots(totals.foreign)} />
              <MetricTile label="投信 30 日" value={lots(totals.trust)} />
              <MetricTile label="自營商 30 日" value={lots(totals.dealer)} />
              <MetricTile label="三大法人合計" value={lots(totals.total)} />
            </div>
          ) : null}
          {latest ? (
            <div className="tg soft" style={{ marginTop: 6 }}>
              最新交易日 {latest.date}：外資 {lots(latest.foreign)} / 投信 {lots(latest.investmentTrust)} / 自營商 {lots(latest.dealer)}。
            </div>
          ) : null}
          {section.history.length > 0 ? (
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table className="data-table company-data-table-fit">
                <thead>
                  <tr>
                    <th><span>日期</span></th>
                    <th><span>外資</span></th>
                    <th><span>投信</span></th>
                    <th><span>自營商</span></th>
                    <th><span>合計</span></th>
                  </tr>
                </thead>
                <tbody>
                  {section.history.slice(0, 10).map((row) => (
                    <tr key={row.date}>
                      <td><span>{row.date}</span></td>
                      <td className={`num ${tone(row.foreign)}`}><span>{lots(row.foreign)}</span></td>
                      <td className={`num ${tone(row.investmentTrust)}`}><span>{lots(row.investmentTrust)}</span></td>
                      <td className={`num ${tone(row.dealer)}`}><span>{lots(row.dealer)}</span></td>
                      <td className={`num ${tone(row.totalNetBuy)}`}><span>{lots(row.totalNetBuy)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : (
        <StateOnly section={section} />
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------- //
// [09] Margin / Short
// ----------------------------------------------------------------------------- //

function MarginShortSection({ section }: { section: FullProfileEnvelope["tradingFlow"]["marginShort"] }) {
  const showData = section.state === "LIVE" || section.state === "STALE";
  const latest = section.latest;

  return (
    <section className="panel hud-frame company-intel-panel">
      <SectionHeader index="[09]" title="融資融券" hint="近 30 日 融資餘額 / 融券餘額 + 變動" />
      {showData ? (
        <div className="market-intel-list">
          <SourceLine
            state={section.state}
            datasetKey={section.sourceTrail.datasetKey}
            updatedAt={section.updatedAt}
            recordCount={section.history.length}
          />
          {latest ? (
            <div className="metric-grid compact-metric-grid">
              <MetricTile
                label="融資餘額"
                value={num(latest.marginBalance)}
                hint={typeof latest.marginChange === "number" ? `較前日 ${latest.marginChange >= 0 ? "+" : ""}${num(latest.marginChange)}` : "暫無變動量"}
              />
              <MetricTile
                label="融券餘額"
                value={num(latest.shortBalance)}
                hint={typeof latest.shortChange === "number" ? `較前日 ${latest.shortChange >= 0 ? "+" : ""}${num(latest.shortChange)}` : "暫無變動量"}
              />
              <MetricTile label="最新交易日" value={latest.date ?? "--"} />
            </div>
          ) : null}
          {section.history.length > 0 ? (
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table className="data-table company-data-table-fit">
                <thead>
                  <tr>
                    <th><span>日期</span></th>
                    <th><span>融資餘額</span></th>
                    <th><span>融資變動</span></th>
                    <th><span>融券餘額</span></th>
                    <th><span>融券變動</span></th>
                  </tr>
                </thead>
                <tbody>
                  {section.history.slice(0, 10).map((row) => (
                    <tr key={row.date}>
                      <td><span>{row.date}</span></td>
                      <td className="num"><span>{num(row.marginBalance)}</span></td>
                      <td className={`num ${tone(row.marginChange)}`}>
                        <span>{typeof row.marginChange === "number" ? `${row.marginChange >= 0 ? "+" : ""}${num(row.marginChange)}` : "--"}</span>
                      </td>
                      <td className="num"><span>{num(row.shortBalance)}</span></td>
                      <td className={`num ${tone(row.shortChange)}`}>
                        <span>{typeof row.shortChange === "number" ? `${row.shortChange >= 0 ? "+" : ""}${num(row.shortChange)}` : "--"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : (
        <StateOnly section={section} />
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------- //
// [10] Dividend
// ----------------------------------------------------------------------------- //

function DividendSection({
  section,
  valuation,
}: {
  section: FullProfileEnvelope["marketIntel"]["dividend"];
  valuation: FullProfileEnvelope["marketIntel"]["valuation"];
}) {
  const showData = section.state === "LIVE" || section.state === "STALE";
  const latest = section.latest;
  const yieldLatest = valuation.latest?.dividendYield ?? null;

  return (
    <section className="panel hud-frame company-intel-panel">
      <SectionHeader index="[10]" title="股利政策" hint="近 5 年股利 + 最新殖利率" />
      {showData ? (
        <div className="market-intel-list">
          <SourceLine
            state={section.state}
            datasetKey={section.sourceTrail.datasetKey}
            updatedAt={section.updatedAt}
            recordCount={section.history.length}
          />
          {latest ? (
            <div className="metric-grid compact-metric-grid">
              <MetricTile label="最新股利年度" value={String(latest.year)} />
              <MetricTile label="現金股利" value={num(latest.cashDividend)} hint="元 / 股" />
              <MetricTile label="股票股利" value={num(latest.stockDividend)} hint="元 / 股" />
              <MetricTile label="總股利" value={num(latest.totalDividend)} hint="元 / 股" />
              <MetricTile
                label="公告日"
                value={formatTaipeiDate(latest.announcementDate)}
              />
              <MetricTile
                label="最新殖利率"
                value={typeof yieldLatest === "number" ? `${yieldLatest.toFixed(2)}%` : "--"}
                hint={
                  valuation.state === "LIVE" || valuation.state === "STALE"
                    ? `估值資料來源：FinMind / ${valuation.sourceTrail.datasetKey}`
                    : `${stateLabel(valuation.state)} - 估值資料`
                }
              />
            </div>
          ) : null}
          {section.history.length > 0 ? (
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table className="data-table company-data-table-fit">
                <thead>
                  <tr>
                    <th><span>年度</span></th>
                    <th><span>現金股利</span></th>
                    <th><span>股票股利</span></th>
                    <th><span>總股利</span></th>
                    <th><span>公告日</span></th>
                  </tr>
                </thead>
                <tbody>
                  {section.history.slice(0, 5).map((row) => (
                    <tr key={`${row.year}-${row.announcementDate ?? "na"}`}>
                      <td><span>{row.year}</span></td>
                      <td className="num"><span>{num(row.cashDividend)}</span></td>
                      <td className="num"><span>{num(row.stockDividend)}</span></td>
                      <td className="num"><span>{num(row.totalDividend)}</span></td>
                      <td><span>{formatTaipeiDate(row.announcementDate)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : (
        <StateOnly section={section} />
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------- //
// [11] Announcements (independent endpoint with DEGRADED honest)
// ----------------------------------------------------------------------------- //

function announcementBadge(category: string) {
  if (/dividend|cash dividend|stock dividend|股利|除權|除息/i.test(category)) return "badge-yellow";
  if (/financial|revenue|eps|earnings|財報|營收|獲利|盈餘/i.test(category)) return "badge-green";
  if (/material|announcement|重大|公告|董事會/i.test(category)) return "badge-blue";
  return "badge";
}

function AnnouncementsSection({ companyId }: { companyId: string }) {
  const [state, setState] = useState<AnnouncementsState>({ status: "loading" });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const fetchedAt = new Date().toISOString();
    getCompanyAnnouncements(companyId, { days: 30 })
      .then((response) => {
        if (!active) return;
        const items = response.data ?? [];
        if (items.length === 0) {
          setState({
            status: "empty",
            fetchedAt,
            reason: "近 30 天沒有重大訊息可顯示。",
          });
        } else {
          setState({ status: "live", items, fetchedAt });
        }
      })
      .catch((error) => {
        if (!active) return;
        const message = friendlyDataError(error, "重大訊息資料暫時無法讀取。");
        // PR #265 ships state field DEGRADED honest — surface the upstream pause copy.
        const isUpstream = /TWSE|FinMind|upstream|maintenance|維護|degrade/i.test(
          error instanceof Error ? error.message : String(error ?? ""),
        );
        setState({
          status: "blocked",
          fetchedAt,
          reason: isUpstream ? `資料源暫停（TWSE 維護）：${message}` : message,
        });
      });
    return () => {
      active = false;
    };
  }, [companyId]);

  return (
    <section className="panel hud-frame company-intel-panel">
      <SectionHeader index="[11]" title="重大訊息" hint="近 30 日 TWSE 公告 + 新聞線索" />
      {state.status === "loading" ? (
        <div className="state-panel">
          <span className="badge badge-blue">讀取中</span>
          <span className="tg soft">正在讀取近 30 天重大訊息。</span>
        </div>
      ) : null}
      {state.status === "blocked" ? (
        <div className="state-panel">
          <span className="badge badge-red">暫停</span>
          <span className="tg soft">來源：TWSE 公告 / FinMind 新聞</span>
          <span className="tg soft">更新：{formatTaipei(state.fetchedAt)}</span>
          <span className="state-reason">{state.reason}</span>
        </div>
      ) : null}
      {state.status === "empty" ? (
        <div className="state-panel">
          <span className="badge badge-yellow">無資料</span>
          <span className="tg soft">來源：TWSE 公告 / FinMind 新聞</span>
          <span className="tg soft">更新：{formatTaipei(state.fetchedAt)}</span>
          <span className="state-reason">{state.reason}</span>
        </div>
      ) : null}
      {state.status === "live" ? (
        <div className="market-intel-list">
          <div className="source-line">
            <span className="badge badge-green">正常</span>
            <span className="tg soft">來源：TWSE 公告 / FinMind 新聞</span>
            <span className="tg soft">筆數：{state.items.length}</span>
            <span className="tg soft">更新：{formatTaipei(state.fetchedAt)}</span>
          </div>
          {state.items.slice(0, 12).map((item) => {
            const expanded = expandedId === item.id;
            const hasBody = Boolean(item.body?.trim());
            return (
              <div className="market-intel-row" key={item.id}>
                {hasBody ? (
                  <button
                    type="button"
                    className="market-intel-button"
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                    aria-expanded={expanded}
                  >
                    <span className="tg soft">{item.date || "--"}</span>
                    <span className={`badge ${announcementBadge(item.category)}`}>{item.category || "重大訊息"}</span>
                    <span className="market-intel-title">{item.title || "未命名公告"}</span>
                    <span className="tg soft">{expanded ? "收合" : "詳情"}</span>
                  </button>
                ) : (
                  <div className="market-intel-button market-intel-static">
                    <span className="tg soft">{item.date || "--"}</span>
                    <span className={`badge ${announcementBadge(item.category)}`}>{item.category || "重大訊息"}</span>
                    <span className="market-intel-title">{item.title || "未命名公告"}</span>
                    <span className="tg soft">公告</span>
                  </div>
                )}
                {expanded && hasBody ? <div className="market-intel-body">{item.body}</div> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// ----------------------------------------------------------------------------- //
// outer panel
// ----------------------------------------------------------------------------- //

export function FullProfilePanels({ companyId }: { companyId: string }) {
  const [state, setState] = useState<EnvelopeState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const fetchedAt = new Date().toISOString();
    getCompanyFullProfile(companyId)
      .then((response) => {
        if (!active) return;
        if (!response?.data) {
          setState({
            status: "blocked",
            fetchedAt,
            reason: "公司全資料 API 未回傳資料；請稍後再試。",
          });
          return;
        }
        setState({ status: "live", envelope: response.data, fetchedAt });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          status: "blocked",
          fetchedAt,
          reason: friendlyDataError(error, "公司全資料 API 暫時無法讀取。"),
        });
      });
    return () => {
      active = false;
    };
  }, [companyId]);

  if (state.status === "loading") {
    return (
      <div className="full-profile-grid">
        <section className="panel hud-frame company-intel-panel">
          <h3 className="ascii-head">
            <span className="ascii-head-bracket">[06]-[11]</span> 完整資料區
            <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>FinMind 11 資料集 — 載入中</span>
          </h3>
          <div className="state-panel">
            <span className="badge badge-blue">載入中</span>
            <span className="tg soft">正在讀取財報、月營收、法人、融資券、股利、重大訊息資料。</span>
          </div>
        </section>
      </div>
    );
  }

  if (state.status === "blocked") {
    return (
      <div className="full-profile-grid">
        <section className="panel hud-frame company-intel-panel">
          <h3 className="ascii-head">
            <span className="ascii-head-bracket">[06]-[11]</span> 完整資料區
            <span className="dim" style={{ fontSize: 10, marginLeft: 8 }}>FinMind 11 資料集</span>
          </h3>
          <div className="state-panel">
            <span className="badge badge-red">暫停</span>
            <span className="tg soft">公司全資料 API</span>
            <span className="tg soft">更新：{formatTaipei(state.fetchedAt)}</span>
            <span className="state-reason">{state.reason}</span>
          </div>
        </section>
        <AnnouncementsSection companyId={companyId} />
      </div>
    );
  }

  const env = state.envelope;
  return (
    <div className="full-profile-grid">
      <FinancialsSection section={env.fundamentals.financialStatement} />
      <RevenueSection section={env.fundamentals.monthlyRevenue} />
      <InstitutionalSection section={env.tradingFlow.institutional} />
      <MarginShortSection section={env.tradingFlow.marginShort} />
      <DividendSection section={env.marketIntel.dividend} valuation={env.marketIntel.valuation} />
      <AnnouncementsSection companyId={companyId} />
    </div>
  );
}
