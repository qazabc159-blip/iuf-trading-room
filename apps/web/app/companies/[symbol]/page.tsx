// /companies/[symbol]/page.tsx ??Server Component
// 9-panel company surface on top of live contracts-shape Company + OHLCV.
// HeroBar / OHLCV chart / CompanyInfo / Chips / Announcements / Financials bind
// to /api/v1. Panels without a production contract render BLOCKED, not mock data.
//
// HARD LINE: never import KGI SDK or call broker live submit path.

import Link from "next/link";

import { PageFrame } from "@/components/PageFrame";
import { getCompanies, getCompanyOhlcv, type OhlcvBar } from "@/lib/api";
import type { Company } from "@iuf-trading-room/contracts";
import {
  quoteFromOhlcvBars,
  type SourceStatus,
  toCompanyDetailView,
} from "@/lib/company-adapter";
import { industryLabel } from "@/lib/industry-i18n";

import { CompanyHeroBar }      from "./CompanyHeroBar";
import { CompanyInfoPanel }    from "./CompanyInfoPanel";
import { OhlcvCandlestickChart } from "./OhlcvCandlestickChart";
import { FinancialsPanel }     from "./FinancialsPanel";
import { ChipsPanel }          from "./ChipsPanel";
import { AnnouncementsPanel }  from "./AnnouncementsPanel";
import { PaperOrderPanel }     from "./PaperOrderPanel";
import { SourceStatusCard }    from "./SourceStatusCard";
import { DerivativesPanel }    from "./DerivativesPanel";
import { TickStreamPanel }     from "./TickStreamPanel";

function tone(value: number | null | undefined) {
  if (typeof value !== "number") return "muted";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "muted";
}

const tierLabel: Record<string, string> = {
  Core: "核心受惠",
  Direct: "直接受惠",
  Indirect: "間接受惠",
  Observation: "觀察",
};

function signed(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number") return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function companyTimestamp(company: Company) {
  const record = company as unknown as { updatedAt?: string; createdAt?: string };
  return record.updatedAt ?? record.createdAt ?? new Date().toISOString();
}

function buildSourceStatus(company: Company, bars: OhlcvBar[], ohlcvReason: string): SourceStatus[] {
  const lastBar = bars.at(-1);
  const lastBarTime = lastBar ? new Date(`${lastBar.dt}T13:30:00+08:00`).toISOString() : new Date().toISOString();
  const priceSource = lastBar?.source === "tej" ? "FinMind/TEJ 正式 K 線" : lastBar?.source === "kgi" ? "KGI 唯讀報價" : null;

  return [
    {
      id: "company-master",
      label: "公司主檔",
      state: "live",
      summary: "工作區公司資料",
      lastSeen: companyTimestamp(company),
      detail: "已在登入工作區找到這檔股票。",
      queueDepth: 0,
    },
    {
      id: "ohlcv",
      label: "K 線",
      state: lastBar && priceSource ? "live" : "error",
      summary: priceSource ?? "尚無正式 K 線",
      lastSeen: lastBarTime,
      detail: lastBar
        ? `已讀取 ${bars.length} 根正式 K 線；最新來源 ${lastBar.source}。`
        : ohlcvReason,
      queueDepth: 0,
    },
    {
      id: "twse-announcements",
      label: "重大訊息",
      state: "stale",
      summary: "個股公告與新聞線索",
      lastSeen: new Date().toISOString(),
      detail: "重大訊息欄會自行顯示正常、無資料或暫停。",
      queueDepth: 0,
    },
    {
      id: "kgi-ticks",
      label: "逐筆資料",
      state: "error",
      summary: "等待凱基唯讀逐筆資料",
      lastSeen: new Date().toISOString(),
      detail: "目前不顯示假逐筆；待唯讀資料接上後啟用。",
      queueDepth: 0,
    },
  ];
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "(unset)";
  const wsSlug  = process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_SLUG ?? "primary-desk";

  let companies: Company[] = [];
  let fetchErrorMsg: string | null = null;
  try {
    const res = await getCompanies();
    companies = res.data ?? [];
  } catch (err) {
    fetchErrorMsg = err instanceof Error ? err.message : String(err);
    console.error("[company-detail] getCompanies failed", { symbol, err: fetchErrorMsg });
  }

  if (fetchErrorMsg !== null) {
    return (
      <PageFrame
        code="03-ERR"
        title={symbol.toUpperCase()}
        sub="公司資料暫時無法讀取"
        note={`公司板 / ${symbol} / 暫停`}
      >
        <div style={{ padding: "32px 24px", fontFamily: "var(--mono, monospace)", fontSize: 12, lineHeight: 1.7 }}>
          <div style={{ color: "var(--tw-up-bright, #e63946)", marginBottom: 16, fontSize: 14 }}>
            {symbol.toUpperCase()} 公司資料暫時無法讀取
          </div>
          <div className="dim" style={{ marginBottom: 16 }}>
            目前登入工作區或後端公司資料服務沒有回應；請稍後重試，或由 Elva/Jason 檢查 API 與登入狀態。
          </div>
          <details className="dim" style={{ marginBottom: 16 }}>
            <summary>工程診斷</summary>
            <div style={{ marginTop: 8 }}>API_BASE: <b>{apiBase}</b></div>
            <div>WORKSPACE: <b>{wsSlug}</b></div>
            <pre style={{ background: "rgba(255,0,0,0.08)", padding: 12, marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-all", maxWidth: 800 }}>{fetchErrorMsg}</pre>
          </details>
          <Link href="/companies" className="btn-sm">返回公司列表</Link>
        </div>
      </PageFrame>
    );
  }

  const needle = symbol.toLowerCase();
  const company = companies.find((c) => c.ticker.toLowerCase() === needle) ?? null;

  if (!company) {
    console.warn("[company-detail] ticker not found in workspace", {
      symbol,
      workspaceSize: companies.length,
      sample: companies.slice(0, 5).map((c) => c.ticker),
    });
    return (
      <PageFrame
        code="03-NF"
        title={symbol.toUpperCase()}
        sub="查無此股票"
        note={`公司板 / ${symbol} / 無資料`}
      >
        <div style={{ padding: "32px 24px", fontFamily: "var(--mono, monospace)", fontSize: 12 }}>
          <div style={{ color: "var(--tw-up-bright, #e63946)", marginBottom: 12 }}>
            查無 {symbol.toUpperCase()}
          </div>
          <div className="dim" style={{ marginBottom: 16 }}>
            目前工作區有 {companies.length} 檔公司資料，但沒有符合代號 <b>{symbol}</b> 的股票。
          </div>
          {companies.length > 0 && (
            <div className="dim" style={{ marginBottom: 16 }}>
              可用範例：{companies.slice(0, 8).map((c) => c.ticker).join(" / ")}
            </div>
          )}
          <Link href="/companies" className="btn-sm">返回公司列表</Link>
        </div>
      </PageFrame>
    );
  }

  let ohlcvErrorMsg: string | null = null;
  const from = new Date();
  from.setFullYear(from.getFullYear() - 3);
  const rawBars: OhlcvBar[] = await getCompanyOhlcv(company.id, { interval: "1d", from: from.toISOString().slice(0, 10) }).catch((err) => {
    ohlcvErrorMsg = err instanceof Error ? err.message : String(err);
    console.warn("[company-detail] getCompanyOhlcv failed", { id: company.id, err });
    return [];
  });
  const bars = rawBars.filter((bar) => bar.source !== "mock");
  const ohlcvState = ohlcvErrorMsg ? "BLOCKED" : bars.length > 0 ? "LIVE" : "EMPTY";
  const ohlcvReason = ohlcvErrorMsg
    ? `K 線資料暫時無法讀取：${ohlcvErrorMsg}`
    : "此股票目前沒有可用的正式 K 線資料。";

  const detail = toCompanyDetailView(company, symbol);
  const quote = quoteFromOhlcvBars(bars);
  const sources = buildSourceStatus(company, bars, ohlcvReason);

  return (
    <PageFrame
      code={`03-${company.ticker}`}
      title={company.ticker}
      sub={`${company.name} / ${company.market}`}
      note={`公司板 / ${company.ticker} / ${industryLabel(company.chainPosition)} / ${tierLabel[company.beneficiaryTier] ?? company.beneficiaryTier}`}
    >
      <div style={{ marginBottom: 8 }}>
        <Link
          href="/companies"
          className="btn-sm"
          style={{ fontFamily: "var(--mono, monospace)", fontSize: 11 }}
        >
          返回公司列表
        </Link>
      </div>

      <CompanyHeroBar company={detail} quote={quote} />

      <div className="company-detail-layout">
        <div className="company-main-column">
          <OhlcvCandlestickChart bars={bars} symbol={company.ticker} sourceState={ohlcvState} sourceReason={ohlcvReason} />
          <CompanyInfoPanel company={company} />
        </div>

        <aside className="company-side-column">
          <PaperOrderPanel symbol={company.ticker} />
          <SourceStatusCard sources={sources} />
        </aside>
      </div>

      <div className="company-kpi-strip">
        <div>
          <span className="tg soft">分數</span>
          <b className="num">{detail.scorePct ?? "--"}</b>
        </div>
        <div>
          <span className="tg soft">動能</span>
          <b className={`tg ${tone(detail.intradayChgPct)}`}>{detail.momentum}</b>
        </div>
        <div>
          <span className="tg soft">外資5日</span>
          <b className={`num ${tone(detail.fiiNetBn5d)}`}>{signed(detail.fiiNetBn5d)} 十億</b>
        </div>
        <div>
          <span className="tg soft">盤中</span>
          <b className={`num ${tone(detail.intradayChgPct)}`}>{signed(detail.intradayChgPct)}%</b>
        </div>
        <div>
          <span className="tg soft">主題</span>
          <b className="tg gold">{detail.themes.join(" / ") || "--"}</b>
        </div>
      </div>

      <div className="company-tabs-band">
        <span className="tg gold">公司資料面板</span>
        <span className="tg soft">價格 / 財報 / 籌碼 / 重大訊息 / 逐筆</span>
      </div>

      <div className="company-panels-grid">
        <FinancialsPanel companyId={company.id} />
        <ChipsPanel companyId={company.id} />
        <AnnouncementsPanel companyId={company.id} />
        <DerivativesPanel />
        <TickStreamPanel />
      </div>
    </PageFrame>
  );
}
