// AI 投研晨報 — /ai-recommendations v2 重設計實作（2026-07-23, Jim）。
// 設計稿：reports/design_redesign_20260722/drafts/ai_rec_redesign_v2.html
// （楊董已 ACK 方向：頭版特稿 + 排印 box-score + 內頁欄目，5 檔全資訊直排零
// <details> 展開；禁 stat-tile 帶／meter 陣列／chip 列）。
// 欄位對照表：reports/design_redesign_20260722/AI_REC_IMPL_FIELD_MAP_20260723.md
//
// 資料層完全沿用既有 v3-view.ts（mapV3ItemToStockRecCard / isActionableV3Item /
// buildV3PanelState / getV3MarketScores / getOfficialAnnouncementSourceState）
// 與 StockRecCard.tsx 的 LinkageCtaRow / displaySource / displaySourceTrail /
// BUCKET_CONFIG — 只換版面呈現層，不重寫任何資料 mapping 邏輯（7/14 五輪退件
// 教訓：已打磨元件只 import 複用不重寫）。
//
// v1/v2「brain_react」分桶卡片格（BUCKETS/groupByBucket/RecommendationCard/
// QualityBadges）本輪整段移除——那正是楊董退件的「四不像」版式本體（stat-tile
// 帶 + chip 列）。v3 canonical 一直是本頁唯一正式來源，這裡拿掉的只是舊版才
// 會出現的備援分桶格，不是刪除任何資料來源。
//
// Suspense：masthead + lede（無資料依賴）立即 SSR 回；推薦內容與追蹤實績都
// 在同一顆 Suspense 邊界內串流出（AI 推薦本質上是單一主資料源，拆多顆邊界
// 只會增加複雜度而非縮短首屏——與 /market-intel 的 5 源並行拆分場景不同）。
import { Suspense } from "react";
import Link from "next/link";

import { MarketStateBanner } from "@/components/MarketStateBanner";
import { TaipeiClock } from "@/components/TaipeiClock";
import { getAiRecommendationsV3, getAiRecPerformance, type AiRecommendationV3Response } from "@/lib/api";
import { resolveBannerLastCloseDate } from "@/lib/index-snapshot-freshness";
import { getOfficialAnnouncementSourceState, getV3MarketScores, isActionableV3Item, mapV3ItemToStockRecCard } from "./v3-view";
import { MarketStateBadge, MarketStateBadgePlaceholder } from "./MarketStateBadge";
import { MorningBriefLead } from "./MorningBriefLead";
import { MorningBriefStory } from "./MorningBriefStory";
import { TrackRecordBox } from "./TrackRecordBox";
import { formatRecommendationTimestamp } from "./source-trail-time";
import {
  buildMarketRiskOffCopy,
  editionDateLabel,
  generationStatusLabel,
  officialAnnouncementLabel,
  parseReportMarkdownLines,
  resolveMorningBriefBodyMode,
} from "./morning-brief-copy";
import type { StockRecCardData } from "./StockRecCard";

export const dynamic = "force-dynamic";

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("403") || message.includes("forbidden_role")) {
    return "此帳號方案尚未開啟 AI 推薦，請到訂閱/權限頁確認。";
  }
  if (message.includes("401") || message.includes("unauthenticated")) {
    return "請先登入 IUF 帳號，再查看 AI 推薦。";
  }
  return "AI 推薦服務暫時無法讀取資料。";
}

async function loadRecommendationsV3(): Promise<{
  data: AiRecommendationV3Response | null;
  error: string | null;
}> {
  try {
    return { data: await getAiRecommendationsV3(), error: null };
  } catch (error) {
    return { data: null, error: safeMessage(error) };
  }
}

// ── 天頭 running head ────────────────────────────────────────────────────
function RunHead({ data, cardCount }: { data: AiRecommendationV3Response | null; cardCount: number }) {
  const generatedLabel = formatRecommendationTimestamp(data?.generatedAt);
  return (
    <div className="runhead">
      <div className="seg"><span className="k">版次</span><span className="v mono">{editionDateLabel(generatedLabel)}</span></div>
      <div className="seg"><span className="k">產生</span><span className="v mono">{generatedLabel || "--"}</span></div>
      <div className="seg"><span className="k">正式推薦</span><span className="v mono">{cardCount}/5 檔</span></div>
    </div>
  );
}

// ── 頭版/內頁 band 狀態列 ────────────────────────────────────────────────
function BandStatus({ data, cardCount }: { data: AiRecommendationV3Response | null; cardCount: number }) {
  const usedFallback = data?.usedFallback === true || data?.synthesisFallbackUsed === true || data?.fullAiReportParsed === false;
  const officialState = getOfficialAnnouncementSourceState(data);
  return (
    <div className="status">
      <span>正式推薦 <b>{cardCount}</b>／5 檔</span>
      <span>生成 <b className="g">{generationStatusLabel(data?.status)}</b></span>
      <span>備援補牌 <b className={usedFallback ? undefined : "g"}>{usedFallback ? "有使用" : "未使用"}</b></span>
      <span>官方公告 {officialAnnouncementLabel(officialState.state)}</span>
    </div>
  );
}

function EmptyState({ error, itemCount }: { error: string | null; itemCount: number }) {
  return (
    <div className="amb-empty">
      <b>{error ? "AI 推薦目前無法讀取" : "今日沒有可行動的 AI 推薦"}</b>
      <p>
        {error
          ? error
          : itemCount > 0
            ? `後端回傳 ${itemCount} 筆候選，但都未達可行動門檻（B 級以上）；系統不會把排除名單包裝成推薦。`
            : "推薦引擎尚未回傳可用候選；此頁不會補假股票。"}
      </p>
    </div>
  );
}

// market_risk_off 專屬狀態——這是楊董 SOP 的保護性跳過（見
// morning-brief-copy.ts 頂部註解），不是 EmptyState 講的「還沒有資料」。
// 照常渲染後端真實 finalReportMarkdown（解析成乾淨段落，不逐字秀 "##"/"-"
// 這種 markdown 語法），不是空態。
function MarketRiskOffState({ data }: { data: AiRecommendationV3Response | null }) {
  const copy = buildMarketRiskOffCopy(data?.marketRiskOffScore ?? null);
  const reportLines = parseReportMarkdownLines(data?.finalReportMarkdown);

  return (
    <div className="amb-riskoff">
      <b>{copy.title}</b>
      <p>{copy.subtitle}</p>
      {reportLines.length > 0 && (
        <div className="amb-riskoff-report">
          {reportLines.map((line, index) => {
            if (line.kind === "heading") return <h3 key={index}>{line.text}</h3>;
            if (line.kind === "bullet") return <p key={index} className="rb-bullet">{line.text}</p>;
            return <p key={index}>{line.text}</p>;
          })}
        </div>
      )}
    </div>
  );
}

async function MorningBriefBody() {
  const [v3Result, perf] = await Promise.all([loadRecommendationsV3(), getAiRecPerformance()]);
  const data = v3Result.data;
  const rawItems = data?.items ?? [];
  const itemCount = data?.itemCount ?? rawItems.length;
  const cards = rawItems
    .filter(isActionableV3Item)
    .map((item) => mapV3ItemToStockRecCard(item, data))
    .filter((card): card is StockRecCardData => Boolean(card))
    .slice(0, 5);

  const marketScores = getV3MarketScores(rawItems, data);
  const bodyMode = resolveMorningBriefBodyMode({
    status: data?.status,
    error: v3Result.error,
    cardCount: cards.length,
  });
  const lead = cards[0];
  const stories = cards.slice(1);
  const leftStories = stories.filter((_, idx) => idx % 2 === 0);
  const rightStories = stories.filter((_, idx) => idx % 2 === 1);

  return (
    <>
      <RunHead data={data} cardCount={cards.length} />

      {marketScores ? <MarketStateBadge scores={marketScores} /> : <MarketStateBadgePlaceholder />}

      <TrackRecordBox perf={perf} />

      {bodyMode === "risk_off" ? (
        <>
          <div className="band">
            <span className="ord">頭版</span>
            <h2>今日主推</h2>
            <span className="en">Lead Pick</span>
          </div>
          <MarketRiskOffState data={data} />
        </>
      ) : bodyMode === "empty" ? (
        <>
          <div className="band">
            <span className="ord">頭版</span>
            <h2>今日主推</h2>
            <span className="en">Lead Pick</span>
          </div>
          <EmptyState error={v3Result.error} itemCount={itemCount} />
        </>
      ) : (
        <>
          <div className="band">
            <span className="ord">頭版</span>
            <h2>今日主推</h2>
            <span className="en">Lead Pick</span>
            <BandStatus data={data} cardCount={cards.length} />
          </div>

          <MorningBriefLead rec={lead} />

          {stories.length > 0 && (
            <>
              <div className="band">
                <span className="ord">內頁</span>
                <h2>其餘候選</h2>
                <span className="en">Inside · Candidates</span>
                <div className="status"><span>依總分序位 <b>2</b>–<b>{cards.length}</b></span></div>
              </div>

              <div className="spread">
                <div className="col">
                  {leftStories.map((rec) => {
                    const idx = stories.indexOf(rec);
                    return <MorningBriefStory key={rec.ticker} rec={rec} index={idx + 1} />;
                  })}
                </div>
                <div className="col">
                  {rightStories.map((rec) => {
                    const idx = stories.indexOf(rec);
                    return <MorningBriefStory key={rec.ticker} rec={rec} index={idx + 1} />;
                  })}
                </div>
              </div>
            </>
          )}
        </>
      )}

      <footer className="colophon">
        <span className="mark">IUF·TR</span>
        <span className="txt">
          AI 投研晨報僅呈現正式推薦 API 回傳，<b>不以候選或假資料冒充</b>；分數、進場、停損、部位皆須再經交易室 SIM 流程與風控確認。此為事後績效追蹤，非未來報酬保證。
        </span>
        <span className="src">來源 · AI 推薦引擎 正式資料</span>
      </footer>
    </>
  );
}

function MorningBriefBodyFallback() {
  return (
    <div className="amb-loading">
      <span className="dot" />
      AI 推薦內容載入中…
    </div>
  );
}

// Pete PR #1353 review 🟡#2: pass a server-resolved lastCloseDate into
// MarketStateBanner (as the pre-#1353 page did) instead of letting the
// client component fall back to its own client-side getMarketDataOverview()
// fetch, which duplicates a request TickerTape already makes elsewhere on
// the page. Isolated in its own Suspense boundary (fallback = the same
// no-prop MarketStateBanner) so this SSR fetch cannot block the masthead's
// first paint the way the pre-redesign page's single top-level await did.
async function MarketStateBannerResolved() {
  const lastCloseDate = await resolveBannerLastCloseDate().catch(() => null);
  return <MarketStateBanner lastCloseDate={lastCloseDate} />;
}

export default function AiRecommendationsPage() {
  return (
    <main className="page-frame amb-shell">
      <style>{AMB_CSS}</style>

      <header className="nameplate">
        <div className="np-chip"><b>IUF·TR</b><span>TRADING ROOM</span></div>
        <div className="np-title">
          <h1>AI 投研晨報</h1>
          <div className="en">Morning Research · 今日投研助理</div>
        </div>
        <div className="np-clock">
          <TaipeiClock />
        </div>
      </header>

      <Suspense fallback={<MarketStateBanner />}>
        <MarketStateBannerResolved />
      </Suspense>

      <p className="lede">
        <span className="mark">研究模式</span>
        <span>
          本報只呈現研究與模擬交易前置資訊；<em>正式券商寫入仍關閉</em>。所列分數、進場、停損、部位皆須再經交易室 SIM 流程與風控確認後才可動作，非可直接執行之委託。
        </span>
      </p>

      <Suspense fallback={<MorningBriefBodyFallback />}>
        <MorningBriefBody />
      </Suspense>

      <div className="amb-cta">
        <div className="txt">看完今日主推？<b>前往交易室</b>用 SIM 模式演練。</div>
        <div className="acts">
          <Link className="btn" href="/market-intel">市場情報</Link>
          <Link className="btn gold" href="/desk-exact">交易室 →</Link>
        </div>
      </div>
    </main>
  );
}

const AMB_CSS = `
.amb-shell {
  --amb-rulefaint: rgba(220, 228, 240, 0.06);
  --amb-goldsoft: rgba(200, 148, 63, 0.1);
  --amb-goldline: rgba(200, 148, 63, 0.3);
}
.amb-shell * { box-sizing: border-box; }

/* ---------- nameplate ---------- */
.amb-shell .nameplate { display: flex; align-items: stretch; margin-top: 4px; border-top: 2px solid var(--gold); border-bottom: 1px solid var(--night-rule-strong); }
.amb-shell .np-chip { background: linear-gradient(105deg, #1c1608, #0d0a05); padding: 14px 30px 14px 4px; display: flex; flex-direction: column; justify-content: center; clip-path: polygon(0 0, 100% 0, calc(100% - 18px) 100%, 0 100%); min-width: 150px; margin-right: 6px; }
.amb-shell .np-chip b { color: var(--gold-bright); font-family: var(--mono); font-size: 15px; letter-spacing: .06em; font-weight: 700; }
.amb-shell .np-chip span { color: var(--gold); opacity: .72; font-family: var(--mono); font-size: 8px; letter-spacing: .32em; margin-top: 2px; }
.amb-shell .np-title { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 8px 0; }
.amb-shell .np-title h1 { font-family: var(--serif-tc); color: var(--night-ink); font-size: 32px; font-weight: 700; letter-spacing: .05em; line-height: 1.08; margin: 0; }
.amb-shell .np-title .en { font-family: var(--sans-tc); font-size: 9.5px; letter-spacing: .38em; color: var(--night-soft); text-transform: uppercase; margin-top: 5px; }
.amb-shell .np-clock { display: flex; align-items: center; padding: 8px 0 8px 20px; }
.amb-shell .np-clock b { font-family: var(--mono); font-size: 15px; color: var(--night-ink); letter-spacing: .02em; white-space: nowrap; }

/* ---------- runhead ---------- */
.amb-shell .runhead { display: flex; flex-wrap: wrap; align-items: center; gap: 0; border-bottom: 1px solid var(--night-rule); font-family: var(--sans-tc); padding-top: 10px; }
.amb-shell .runhead .seg { padding: 8px 20px 8px 0; margin-right: 20px; border-right: 1px solid var(--night-rule); display: flex; align-items: baseline; gap: 8px; }
.amb-shell .runhead .seg:last-child { border-right: 0; margin-right: 0; }
.amb-shell .runhead .k { font-size: 9px; letter-spacing: .16em; color: var(--night-faint); text-transform: uppercase; }
.amb-shell .runhead .v { font-family: var(--serif-tc); font-size: 13px; color: var(--night-ink); font-weight: 600; }
.amb-shell .runhead .v.mono { font-family: var(--mono); font-size: 14px; }

/* ---------- lede ---------- */
.amb-shell .lede { display: flex; gap: 12px; padding: 12px 0 0; color: var(--night-mid); font-size: 12.5px; line-height: 1.6; font-family: var(--sans-tc); margin: 0; }
.amb-shell .lede .mark { flex: 0 0 auto; font-family: var(--mono); font-size: 9px; letter-spacing: .14em; color: var(--gold); border: 1px solid var(--amb-goldline); padding: 3px 8px; height: fit-content; background: var(--amb-goldsoft); }
.amb-shell .lede em { font-style: normal; color: var(--night-ink); }

/* ---------- track-box ---------- */
.amb-shell .track-box { margin-top: 16px; border: 1px solid var(--night-rule); background: var(--night-1); }
.amb-shell .track-box .tb-hd { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; padding: 9px 16px; border-bottom: 1px solid var(--night-rule); }
.amb-shell .track-box .tb-hd h3 { font-family: var(--serif-tc); font-size: 14px; color: var(--night-ink); font-weight: 700; letter-spacing: .04em; margin: 0; }
.amb-shell .track-box .caveat { font-family: var(--sans-tc); font-size: 10.5px; color: var(--gold-bright); letter-spacing: .02em; }
.amb-shell .track-box .base { margin-left: auto; font-family: var(--mono); font-size: 9px; color: var(--night-faint); letter-spacing: .1em; }
.amb-shell .track-row { display: flex; flex-wrap: wrap; }
.amb-shell .track-row .m { flex: 1 1 0; min-width: 150px; padding: 12px 16px; border-right: 1px solid var(--night-rule); display: flex; align-items: baseline; gap: 10px; }
.amb-shell .track-row .m:last-child { border-right: 0; }
.amb-shell .track-row .k { font-family: var(--sans-tc); font-size: 11px; color: var(--night-soft); line-height: 1.35; display: flex; flex-direction: column; }
.amb-shell .track-row .n { font-family: var(--mono); font-size: 20px; color: var(--night-ink); font-weight: 500; letter-spacing: -.01em; }
.amb-shell .track-row .n.up { color: var(--tw-up-bright); }
.amb-shell .track-row .s { font-family: var(--mono); font-size: 9px; color: var(--night-faint); display: block; margin-top: 2px; }
.amb-shell .track-foot { padding: 8px 16px; border-top: 1px solid var(--night-rule); font-family: var(--sans-tc); font-size: 11px; color: var(--night-soft); line-height: 1.55; }

/* ---------- band ---------- */
.amb-shell .band { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 26px; padding-bottom: 8px; border-bottom: 2px solid var(--night-rule-strong); }
.amb-shell .band .ord { font-family: var(--serif-tc); font-size: 14px; color: var(--gold-bright); font-weight: 700; letter-spacing: .1em; border: 1px solid var(--amb-goldline); padding: 2px 11px; background: var(--amb-goldsoft); }
.amb-shell .band h2 { font-family: var(--serif-tc); font-size: 20px; color: var(--night-ink); font-weight: 700; letter-spacing: .06em; margin: 0; }
.amb-shell .band .en { font-family: var(--sans-tc); font-size: 9px; letter-spacing: .26em; color: var(--night-faint); text-transform: uppercase; }
.amb-shell .band .status { margin-left: auto; display: flex; flex-wrap: wrap; gap: 5px 16px; font-family: var(--sans-tc); font-size: 10.5px; color: var(--night-soft); }
.amb-shell .band .status b { color: var(--night-ink); font-family: var(--mono); font-style: normal; }
.amb-shell .band .status b.g { color: var(--gold-bright); }

/* ---------- lead article ---------- */
.amb-shell .lead { margin-top: 18px; }
.amb-shell .lead-head { display: grid; grid-template-columns: auto 1fr auto; gap: 20px; align-items: flex-end; padding-bottom: 14px; border-bottom: 1px solid var(--night-rule); }
.amb-shell .lh-name { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.amb-shell .lh-name .co { font-family: var(--serif-tc); font-size: 36px; color: var(--night-ink); font-weight: 700; letter-spacing: .02em; line-height: 1; }
.amb-shell .lh-name .code { font-size: 20px; color: var(--gold-bright); letter-spacing: .02em; }
.amb-shell .lh-name .lvl { font-family: var(--mono); font-size: 12px; font-weight: 700; letter-spacing: .04em; padding: 3px 10px; border: 1px solid var(--gold-bright); color: var(--gold-bright); background: var(--amb-goldsoft); }
.amb-shell .lh-name .rank { font-family: var(--serif-tc); font-size: 12px; color: var(--night-soft); letter-spacing: .1em; }
.amb-shell .lh-metrics { display: flex; gap: 26px; justify-content: flex-end; }
.amb-shell .lh-metrics .m { text-align: right; }
.amb-shell .lh-metrics .k { font-family: var(--sans-tc); font-size: 10px; color: var(--night-soft); letter-spacing: .06em; }
.amb-shell .lh-metrics .v { font-family: var(--mono); font-size: 20px; color: var(--night-ink); line-height: 1.1; }
.amb-shell .lh-metrics .m.conf .v { color: var(--gold-bright); }
.amb-shell .lead-body { display: grid; grid-template-columns: minmax(0, 1.62fr) minmax(0, 1fr); gap: 0; margin-top: 22px; }
.amb-shell .lb-main { padding: 16px 30px 6px 0; border-right: 1px solid var(--night-rule); }
.amb-shell .lb-aside { padding: 16px 0 6px 30px; }
.amb-shell .colhd { font-family: var(--sans-tc); font-size: 10px; letter-spacing: .2em; color: var(--gold); text-transform: uppercase; font-weight: 600; padding-bottom: 9px; margin-bottom: 12px; border-bottom: 1px solid var(--amb-rulefaint); }
.amb-shell .prose p { font-family: var(--serif-tc); font-size: 14.5px; line-height: 1.8; color: var(--night-mid); margin: 0 0 12px; text-align: justify; }
.amb-shell .prose p:last-child { margin-bottom: 0; }
.amb-shell .prose-empty { font-family: var(--sans-tc); font-size: 12.5px; color: var(--night-soft); }
.amb-shell .risk-block { margin-top: 20px; }
.amb-shell .rh { font-family: var(--serif-tc); font-size: 15px; color: var(--tw-up-bright); font-weight: 700; letter-spacing: .06em; padding-bottom: 8px; margin-bottom: 11px; border-bottom: 1px solid var(--amb-rulefaint); display: flex; align-items: baseline; gap: 9px; }
.amb-shell .rh .en { font-family: var(--sans-tc); font-size: 8.5px; letter-spacing: .22em; color: var(--night-faint); text-transform: uppercase; }
.amb-shell .risk-list { list-style: none; padding: 0; margin: 0; }
.amb-shell .risk-list li { position: relative; padding: 0 0 10px 20px; font-family: var(--serif-tc); font-size: 13.5px; line-height: 1.72; color: var(--night-mid); }
.amb-shell .risk-list li::before { content: "\\2014"; position: absolute; left: 0; top: 0; color: var(--tw-up-bright); font-family: var(--mono); }

/* box-score + plan tables */
.amb-shell .boxscore, .amb-shell .plan { width: 100%; border-collapse: collapse; font-family: var(--sans-tc); margin-bottom: 18px; }
.amb-shell .boxscore caption, .amb-shell .plan caption { text-align: left; font-family: var(--sans-tc); font-size: 10px; letter-spacing: .2em; color: var(--gold); text-transform: uppercase; font-weight: 600; padding-bottom: 9px; }
.amb-shell .boxscore td { padding: 6px 0; border-bottom: 1px solid var(--amb-rulefaint); vertical-align: baseline; }
.amb-shell .boxscore td.dim { font-family: var(--serif-tc); font-size: 13.5px; color: var(--night-mid); }
.amb-shell .boxscore td.sc { text-align: right; font-family: var(--mono); font-size: 13.5px; color: var(--night-ink); width: 66px; }
.amb-shell .boxscore tr.tot td { border-bottom: 0; border-top: 1.5px solid var(--night-rule-strong); padding-top: 9px; }
.amb-shell .boxscore tr.tot td.dim { color: var(--gold-bright); font-weight: 700; font-size: 14.5px; }
.amb-shell .boxscore tr.tot td.sc { color: var(--gold-bright); font-size: 16px; }
.amb-shell .plan td { padding: 7px 0; border-bottom: 1px solid var(--amb-rulefaint); }
.amb-shell .plan td.k { font-family: var(--serif-tc); font-size: 13px; color: var(--night-soft); }
.amb-shell .plan td.v { text-align: right; font-family: var(--mono); font-size: 14.5px; color: var(--night-ink); }
.amb-shell .plan td.v.up { color: var(--tw-up-bright); } .amb-shell .plan td.v.down { color: var(--tw-dn-bright); } .amb-shell .plan td.v.g { color: var(--gold-bright); }
.amb-shell .plan .entry-row td { border-bottom: 0; padding-bottom: 2px; }
.amb-shell .plan .entry-val { font-size: 18px; color: var(--gold-bright); }
.amb-shell .plan .entry-note td { border-bottom: 1px solid var(--night-rule-strong); padding: 0 0 12px; }
.amb-shell .plan .entry-note .n { font-family: var(--serif-tc); font-size: 12px; color: var(--night-soft); line-height: 1.6; text-align: justify; }

/* byline */
.amb-shell .byline, .amb-shell .st-byline { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--night-rule); display: flex; flex-wrap: wrap; align-items: center; gap: 8px 22px; }
.amb-shell .st-byline { margin-top: 13px; padding-top: 10px; }
.amb-shell .byline .src, .amb-shell .st-byline .src { font-family: var(--sans-tc); font-size: 11px; color: var(--night-soft); line-height: 1.5; flex: 1 1 auto; min-width: 200px; }
.amb-shell .byline .src b, .amb-shell .st-byline .src b { color: var(--night-mid); font-weight: 600; }
.amb-shell .byline .pos, .amb-shell .st-byline .pos { font-family: var(--mono); font-size: 12px; color: var(--night-mid); }
.amb-shell .byline .pos b, .amb-shell .st-byline .pos b { color: var(--gold-bright); font-style: normal; }
.amb-shell .byline .acts, .amb-shell .st-byline .acts { margin-left: auto; }

/* CTA row reuse override (LinkageCtaRow renders ._src-cta-*; restyle to fit newspaper byline) */
.amb-shell .acts ._src-cta-row { border-top: 0; padding-top: 0; gap: 8px; }
.amb-shell .acts ._src-cta-btn { border-radius: 0; font-family: var(--sans-tc); font-size: 11.5px; padding: 0 13px; min-height: 30px; border-color: var(--night-rule-strong); background: transparent; color: var(--night-mid); }
.amb-shell .acts ._src-cta-btn:hover:not(:disabled) { border-color: var(--gold); color: var(--night-ink); background: var(--amb-goldsoft); }

/* ---------- inner spread ---------- */
.amb-shell .spread { display: grid; grid-template-columns: 1fr 1fr; column-gap: 40px; margin-top: 20px; position: relative; }
.amb-shell .spread::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 20px; width: 1px; background: var(--night-rule); transform: translateX(-.5px); }
.amb-shell .col { min-width: 0; display: flex; flex-direction: column; }
.amb-shell .story { padding: 22px 0; border-bottom: 1px solid var(--night-rule); }
.amb-shell .col .story:first-child { padding-top: 0; }
.amb-shell .col .story:last-child { border-bottom: 0; }
.amb-shell .st-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; padding-bottom: 10px; border-bottom: 1px solid var(--amb-rulefaint); }
.amb-shell .st-head .rank { font-family: var(--serif-tc); font-size: 13px; color: var(--gold-bright); font-weight: 700; letter-spacing: .08em; }
.amb-shell .st-head .co { font-family: var(--serif-tc); font-size: 21px; color: var(--night-ink); font-weight: 700; letter-spacing: .02em; line-height: 1; }
.amb-shell .st-head .code { font-size: 13px; color: var(--gold-bright); }
.amb-shell .st-head .lvl { font-family: var(--mono); font-size: 10px; font-weight: 700; padding: 2px 8px; border: 1px solid var(--night-rule-strong); color: var(--night-mid); letter-spacing: .04em; }
.amb-shell .st-head .spr { flex: 1; }
.amb-shell .st-head .conf, .amb-shell .st-head .tot { text-align: right; }
.amb-shell .st-head .conf .v { font-size: 15px; color: var(--gold-bright); }
.amb-shell .st-head .tot .v { font-size: 15px; color: var(--night-ink); }
.amb-shell .st-head .k { font-family: var(--sans-tc); font-size: 9px; color: var(--night-soft); letter-spacing: .04em; }

.amb-shell .st-scores { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; background: var(--amb-rulefaint); border: 1px solid var(--amb-rulefaint); margin: 12px 0; }
.amb-shell .st-scores .s { background: var(--night-1); padding: 7px 4px; text-align: center; }
.amb-shell .st-scores .v { font-size: 12.5px; color: var(--night-ink); line-height: 1.1; }
.amb-shell .st-scores .l { font-family: var(--sans-tc); font-size: 9px; color: var(--night-soft); margin-top: 3px; }

.amb-shell .st-plan { display: flex; flex-wrap: wrap; border: 1px solid var(--amb-rulefaint); background: var(--night-1); margin-bottom: 12px; }
.amb-shell .st-plan .p { flex: 1 1 0; min-width: 64px; padding: 8px 10px; border-right: 1px solid var(--amb-rulefaint); }
.amb-shell .st-plan .p:last-child { border-right: 0; }
.amb-shell .st-plan .k { font-family: var(--sans-tc); font-size: 9px; color: var(--night-soft); letter-spacing: .04em; }
.amb-shell .st-plan .v { font-size: 13.5px; color: var(--night-ink); margin-top: 2px; }
.amb-shell .st-plan .p.up .v { color: var(--tw-up-bright); } .amb-shell .st-plan .p.down .v { color: var(--tw-dn-bright); } .amb-shell .st-plan .p.g .v { color: var(--gold-bright); }
.amb-shell .st-entry { font-family: var(--serif-tc); font-size: 12.5px; color: var(--night-soft); line-height: 1.6; margin: 0 0 10px; text-align: justify; }
.amb-shell .st-entry .rng { font-size: 13px; color: var(--gold-bright); }
.amb-shell .st-body p { font-family: var(--serif-tc); font-size: 13.5px; line-height: 1.76; color: var(--night-mid); margin: 0 0 10px; text-align: justify; }
.amb-shell .st-sub { font-family: var(--serif-tc); font-size: 13px; color: var(--tw-up-bright); font-weight: 700; letter-spacing: .05em; margin: 14px 0 8px; padding-bottom: 5px; border-bottom: 1px solid var(--amb-rulefaint); }
.amb-shell .st-risk { list-style: none; padding: 0; margin: 0; }
.amb-shell .st-risk li { position: relative; padding: 0 0 8px 18px; font-family: var(--serif-tc); font-size: 13px; line-height: 1.66; color: var(--night-mid); }
.amb-shell .st-risk li::before { content: "\\2014"; position: absolute; left: 0; top: 0; color: var(--tw-up-bright); font-family: var(--mono); }

/* ---------- colophon ---------- */
.amb-shell .colophon { margin-top: 40px; padding-top: 14px; border-top: 2px solid var(--gold); display: flex; flex-wrap: wrap; gap: 6px 20px; align-items: baseline; font-family: var(--sans-tc); }
.amb-shell .colophon .mark { font-family: var(--mono); font-size: 11px; color: var(--gold-bright); letter-spacing: .1em; }
.amb-shell .colophon .txt { font-size: 11px; color: var(--night-soft); line-height: 1.6; flex: 1; min-width: 240px; }
.amb-shell .colophon .txt b { color: var(--night-mid); font-weight: 600; }
.amb-shell .colophon .src { font-family: var(--mono); font-size: 9.5px; color: var(--night-faint); letter-spacing: .06em; }

/* ---------- empty / loading ---------- */
.amb-shell .amb-empty { padding: 26px 4px; color: var(--night-soft); }
.amb-shell .amb-empty b { display: block; color: var(--night-ink); font-family: var(--serif-tc); font-size: 16px; margin-bottom: 8px; }
.amb-shell .amb-empty p { margin: 0; font-family: var(--sans-tc); font-size: 12.5px; line-height: 1.65; max-width: 620px; }
.amb-shell .amb-loading { display: flex; align-items: center; gap: 9px; padding: 40px 4px; color: var(--night-soft); font-family: var(--sans-tc); font-size: 12.5px; }
.amb-shell .amb-loading .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--gold); box-shadow: 0 0 7px var(--gold); flex-shrink: 0; }

/* ---------- risk-off report state ---------- */
.amb-shell .amb-riskoff { padding: 20px 18px; border: 1px solid rgba(230, 57, 70, 0.3); border-left: 3px solid rgba(230, 57, 70, 0.6); background: rgba(230, 57, 70, 0.05); color: var(--night-soft); }
.amb-shell .amb-riskoff b { display: block; color: var(--night-ink); font-family: var(--serif-tc); font-size: 17px; margin-bottom: 8px; }
.amb-shell .amb-riskoff > p { margin: 0; font-family: var(--sans-tc); font-size: 12.5px; line-height: 1.65; max-width: 680px; }
.amb-shell .amb-riskoff-report { margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(230, 57, 70, 0.22); }
.amb-shell .amb-riskoff-report h3 { margin: 0 0 8px; font-family: var(--serif-tc); font-size: 13.5px; color: var(--night-ink); font-weight: 700; }
.amb-shell .amb-riskoff-report p { margin: 0 0 6px; font-family: var(--sans-tc); font-size: 12px; line-height: 1.6; color: var(--night-soft); }
.amb-shell .amb-riskoff-report p.rb-bullet { padding-left: 14px; position: relative; }
.amb-shell .amb-riskoff-report p.rb-bullet::before { content: "\\2014"; position: absolute; left: 0; top: 0; color: var(--tw-dn-bright); font-family: var(--mono); }

/* ---------- CTA band ---------- */
.amb-shell .amb-cta { margin-top: 22px; display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 15px 20px; border: 1px solid var(--night-rule); border-radius: 4px; background: linear-gradient(90deg, var(--night-1), var(--night)); }
.amb-shell .amb-cta .txt { font-size: 13px; color: var(--night-mid); font-family: var(--sans-tc); }
.amb-shell .amb-cta .txt b { color: var(--night-ink); }
.amb-shell .amb-cta .acts { margin-left: auto; display: flex; gap: 10px; flex-wrap: wrap; }
.amb-shell .amb-cta .btn { font-size: 12.5px; padding: 8px 16px; border-radius: 4px; border: 1px solid var(--night-rule-strong); color: var(--night-mid); font-family: var(--mono); letter-spacing: .03em; text-decoration: none; display: inline-flex; align-items: center; }
.amb-shell .amb-cta .btn:hover { border-color: var(--night-faint); color: var(--night-ink); }
.amb-shell .amb-cta .btn.gold { background: linear-gradient(180deg, var(--gold-bright), var(--gold)); color: #1a1206; border-color: var(--gold-bright); font-weight: 600; }

/* ---------- responsive ---------- */
@media (max-width: 1180px) {
  .amb-shell .lead-body { grid-template-columns: 1fr; }
  .amb-shell .lb-main { border-right: 0; border-bottom: 1px solid var(--night-rule); padding: 16px 0 20px; }
  .amb-shell .lb-aside { padding: 20px 0 6px; }
  .amb-shell .spread { grid-template-columns: 1fr; column-gap: 0; }
  .amb-shell .spread::before { display: none; }
  .amb-shell .col .story:last-child { border-bottom: 1px solid var(--night-rule); }
}
@media (max-width: 820px) {
  .amb-shell .nameplate { flex-wrap: wrap; }
  .amb-shell .np-chip { clip-path: none; min-width: 0; margin-right: 0; flex: 1 0 100%; padding: 12px 16px; }
  .amb-shell .np-title { flex: 1 1 60%; padding: 12px 0 12px 4px; }
  .amb-shell .np-title h1 { font-size: 24px; }
  .amb-shell .np-clock { flex: 1 1 30%; padding: 12px 0; }
  .amb-shell .runhead .seg { padding: 7px 14px 7px 0; margin-right: 14px; }
  .amb-shell .lead-head { grid-template-columns: 1fr; gap: 12px; }
  .amb-shell .lh-metrics { justify-content: flex-start; flex-wrap: wrap; gap: 18px; }
  .amb-shell .lh-metrics .m { text-align: left; }
  .amb-shell .track-row .m { flex-basis: 50%; min-width: 0; }
}
@media (max-width: 440px) {
  .amb-shell .lh-name .co { font-size: 28px; }
  .amb-shell .st-scores { grid-template-columns: repeat(4, 1fr); }
  .amb-shell .track-row .m { flex-basis: 100%; border-right: 0; }
  .amb-shell .band { flex-wrap: wrap; }
  .amb-shell .band .status { margin-left: 0; flex-basis: 100%; }
}
@media (prefers-reduced-motion: reduce) { .amb-shell * { animation: none !important; } }
`;
