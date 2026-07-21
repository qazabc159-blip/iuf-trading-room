// 這是導覽列「市場情報」實際渲染的檔案（middleware.ts 的
// FINAL_V031_ROUTE_REWRITES 把每個已登入的 `/market-intel` 請求無聲 rewrite
// 到這裡；同款 shadow 說明見 apps/web/app/portfolio/page.tsx 開頭註解 /
// .claude/agent-memory/frontend-consume-jim/middleware_route_rewrite_shadow_
// trap_2026_07_15.md）。真正要改市場情報頁內容請改這支檔案，不是
// apps/web/app/market-intel/page.tsx。
//
// 2026-07-21：從舊 /api/ui-final-v031/market-intel iframe（v0.3.1 靜態稿 +
// hydration script 灌資料）換成真 React Server Component，房子樣式對齊
// 首頁／公司頁（PageFrame + parity-* 系統，見 components/PageFrame.tsx、
// app/globals.css 的 `PARITY LAYER` 區塊 — 那段註解本來就把 market-intel
// 列在目標清單）。資料來源不變：news-top10 / announcements / finmind status /
// twse heatmap / institutional-summary，映射邏輯搬到 app/market-intel/
// market-intel-data.ts（獨立於舊 lib/final-v031-live.ts，避免牽動其他三個
// final-v031 screen 的 hydration 管線）。
//
// 2026-07-21 效能急修：原版把 5 支來源全 await 完才回傳一顆 payload，SSR
// 首屏等於「跟最慢那支同步」——單一來源逾時（20s）就整頁卡 20 秒。改法
// 比照公司頁 #1312 的 Suspense 串流範式（見 app/companies/[symbol]/page.tsx
// 的 kbarPromise/KBarChartSection 寫法）：page 本體只「發射」5 支來源
// promise（不 await），殼（PageFrame/安全提示/下一步 CTA）立即 SSR 回；
// 5 個資料區（今日訊息統計列 / AI 精選清單 / 來源狀態 / 三大法人 / 產業
// 熱力圖）各自包一層 Suspense，各自 await 自己需要的來源子集——同一顆
// promise 可以被多個消費者各自 await，不會重複打上游。每支來源逾時從
// 20s 砍到 4s，逾時走既有「來源尚未可用」誠實降級分支，不讓任何一支慢源
// 拖住整頁首屏。
//
// 回退：git revert 本次改動即可，舊 /api/ui-final-v031/market-intel route +
// buildMarketIntelPayload() 完全未刪除、未動（現在沒有頁面連到它，是刻意保留
// 的孤兒端點，非本輪範圍——見 PR 交付報告）。
import Link from "next/link";
import { Suspense } from "react";

import { PageFrame, Panel } from "@/components/PageFrame";
import {
  startMarketIntelSources,
  resolveHeroStats,
  resolveFeedSection,
  resolveSourceStatusList,
  resolveHeatmap,
  resolveInstitutional,
  type MarketIntelFeedItem,
  type MarketIntelSources,
} from "@/app/market-intel/market-intel-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function toneClass(tone: "up" | "down" | "flat") {
  if (tone === "up") return "up";
  if (tone === "down") return "down";
  return "";
}

function FeedCard({ item }: { item: MarketIntelFeedItem }) {
  return (
    <div className="_mi-card">
      <div className="_mi-card-head">
        <span className="_mi-sym">{item.symbol}</span>
        {item.name && <span className="_mi-name">{item.name}</span>}
        <span className="_mi-tagpill">{item.topicLabel}</span>
        <span className="_mi-age">{item.age}</span>
      </div>
      <div className="_mi-title">{item.title}</div>
      <div className="_mi-why">{item.why}</div>
      <div className="_mi-foot">
        <span className="_mi-source">{item.source} / {item.tag}</span>
        <span className="_mi-links">
          <Link href={item.companyHref}>看公司</Link>
          <span className="_mi-sep">·</span>
          <Link href={item.recommendationHref}>看 AI 推薦</Link>
        </span>
      </div>
    </div>
  );
}

const MARKET_INTEL_CSS = `
._mi-hero-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 1px;
  background: rgba(220,228,240,0.09);
  border: 1px solid rgba(220,228,240,0.13);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 20px;
}
._mi-hero-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 24px 28px;
  background: rgba(8,11,16,0.86);
}
._mi-hero-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 22px;
  background: rgba(8,11,16,0.82);
}
._mi-hero-big {
  font-size: 46px;
  font-weight: 900;
  letter-spacing: -1.5px;
  line-height: 1;
  font-family: var(--mono, monospace);
  font-variant-numeric: tabular-nums;
  color: #e2b85c;
}
._mi-hero-val {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -1px;
  line-height: 1;
  font-family: var(--mono, monospace);
  font-variant-numeric: tabular-nums;
}
._mi-hero-lbl {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(145,160,181,0.65);
  font-family: var(--mono, monospace);
}
._mi-safety {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  margin-bottom: 20px;
  border: 1px solid rgba(200,148,63,0.34);
  border-left: 3px solid #c8943f;
  border-radius: 4px;
  background: rgba(200,148,63,0.06);
  font-size: 12px;
  line-height: 1.55;
  color: #c6d0de;
}
._mi-safety b { color: #e2b85c; }
._mi-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}
._mi-list {
  display: grid;
  gap: 10px;
}
._mi-card {
  padding: 14px 16px;
  border: 1px solid rgba(220,228,240,0.08);
  border-radius: 4px;
  background: rgba(8,11,16,0.58);
}
._mi-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
._mi-sym {
  font-family: var(--mono, monospace);
  font-weight: 800;
  font-size: 12px;
  color: #e2b85c;
  background: rgba(200,148,63,0.10);
  border: 1px solid rgba(200,148,63,0.30);
  padding: 2px 8px;
  border-radius: 3px;
}
._mi-name { font-size: 12px; color: rgba(220,228,240,0.75); }
._mi-tagpill {
  font-size: 10.5px;
  color: rgba(145,160,181,0.85);
  border: 1px solid rgba(220,228,240,0.14);
  border-radius: 3px;
  padding: 1px 7px;
}
._mi-age {
  margin-left: auto;
  font-size: 10.5px;
  font-family: var(--mono, monospace);
  color: rgba(145,160,181,0.5);
}
._mi-title {
  font-size: 14px;
  font-weight: 700;
  color: #e7ecf3;
  line-height: 1.4;
  margin-bottom: 4px;
}
._mi-why {
  font-size: 12px;
  color: rgba(145,160,181,0.75);
  line-height: 1.55;
  margin-bottom: 8px;
}
._mi-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid rgba(220,228,240,0.07);
  font-size: 11px;
}
._mi-source { color: rgba(145,160,181,0.55); }
._mi-links { display: flex; gap: 6px; }
._mi-links a { color: #e2b85c; text-decoration: none; }
._mi-links a:hover { text-decoration: underline; }
._mi-sep { color: rgba(145,160,181,0.35); }
._mi-rail {
  display: grid;
  gap: 12px;
}
._mi-src-tile {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(220,228,240,0.08);
  border-radius: 4px;
  background: rgba(8,11,16,0.58);
}
._mi-src-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
._mi-src-dot.ok { background: #4adb88; box-shadow: 0 0 6px rgba(46,204,113,0.55); }
._mi-src-dot.warn { background: #e2b85c; }
._mi-src-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
._mi-src-name { font-size: 12px; font-weight: 700; color: #c6d0de; }
._mi-src-label { font-size: 11px; color: rgba(145,160,181,0.6); overflow-wrap: anywhere; }
._mi-src-right { margin-left: auto; text-align: right; flex-shrink: 0; }
._mi-src-status { font-size: 11px; font-weight: 700; }
._mi-src-status.ok { color: #4adb88; }
._mi-src-status.warn { color: #e2b85c; }
._mi-src-fresh { font-size: 10px; color: rgba(145,160,181,0.45); font-family: var(--mono, monospace); }
._mi-heat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 6px;
}
._mi-heat-tile {
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid rgba(220,228,240,0.08);
  background: rgba(8,11,16,0.5);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
._mi-heat-nm { font-size: 11px; color: rgba(220,228,240,0.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
._mi-heat-pct { font-family: var(--mono, monospace); font-weight: 800; font-size: 13px; }
._mi-heat-cnt { font-size: 10px; color: rgba(145,160,181,0.5); }
/* 2026-07-21 教訓：Panel 元件的 --panel-gutter-x 在 1920px 是 56px 兩側，
   放進 300px 窄 rail 欄時內容區只剩 ~186px——固定 1fr 表格欄位在這個寬度會
   把「買進」「賣出」擠到 13px 逐字換行（見 wave2 CJK grid-squeeze 教訓：
   grid-template-columns Npx 1fr auto 在窄容器會把 CJK 欄擠爆，要用 flex/
   換行取代固定欄寬）。改成 flex-wrap 自然換行，不用固定表格欄位。 */
._mi-inst-block {
  padding: 8px 0;
  border-bottom: 1px solid rgba(220,228,240,0.06);
}
._mi-inst-name { font-size: 12px; font-weight: 800; color: #c6d0de; margin-bottom: 6px; }
._mi-inst-stats { display: flex; flex-wrap: wrap; gap: 14px; }
._mi-inst-stat { display: flex; flex-direction: column; gap: 2px; min-width: 44px; }
._mi-inst-stat .lbl { font-size: 10px; color: rgba(145,160,181,0.5); }
._mi-inst-stat .val { font-family: var(--mono, monospace); font-weight: 800; font-size: 12px; }
._mi-inst-stat .val.buy { color: #ff5b6b; }
._mi-inst-stat .val.sell { color: #4adb88; }
._mi-next {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 20px;
  padding: 14px 18px;
  border: 1px solid rgba(220,228,240,0.10);
  border-radius: 4px;
  background: rgba(8,11,16,0.5);
}
._mi-next-lbl { font-size: 11px; color: rgba(145,160,181,0.55); }
._mi-next-txt { font-size: 12px; color: #c6d0de; flex: 1 1 240px; }
._mi-next a {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 14px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
}
._mi-next a.primary { background: #c8943f; color: #0a0d12; }
._mi-next a.ghost { border: 1px solid rgba(220,228,240,0.16); color: #c6d0de; }
@media (max-width: 900px) {
  ._mi-layout { grid-template-columns: 1fr; }
  ._mi-hero-row { grid-template-columns: 1fr 1fr; }
  ._mi-hero-main { grid-column: 1 / -1; }
}
@media (max-width: 480px) {
  ._mi-hero-row { grid-template-columns: 1fr; }
  ._mi-hero-main { grid-column: auto; }
}
`;

// ── 5 個 Suspense 資料區（各自 await 自己需要的來源子集，慢源不拖垮殼）──

type CoreSources = Pick<MarketIntelSources, "news" | "announcements" | "finMind">;

async function HeroStatsRow({ sources }: { sources: CoreSources }) {
  const stats = await resolveHeroStats(sources);
  return (
    <div className="_mi-hero-row">
      <div className="_mi-hero-main">
        <span className="_mi-hero-big">{stats.total}</span>
        <span className="_mi-hero-lbl">今日訊息</span>
      </div>
      <div className="_mi-hero-cell">
        <span className="_mi-hero-val" style={{ color: stats.aiSelected > 0 ? "#e2b85c" : "#566276" }}>
          {stats.aiSelected}
        </span>
        <span className="_mi-hero-lbl">AI 精選</span>
      </div>
      <div className="_mi-hero-cell">
        <span className="_mi-hero-val" style={{ color: stats.sourceOk === stats.sourceTotal ? "#4adb88" : "#e2b85c" }}>
          {stats.sourceOk} <small style={{ fontSize: 14, color: "rgba(145,160,181,0.5)" }}>/ {stats.sourceTotal}</small>
        </span>
        <span className="_mi-hero-lbl">來源正常</span>
      </div>
      <div className="_mi-hero-cell">
        <span className="_mi-hero-val" style={{ fontSize: 16, color: "#c6d0de" }}>{stats.nextRefresh}</span>
        <span className="_mi-hero-lbl">下次抓取</span>
      </div>
    </div>
  );
}

function HeroStatsRowFallback() {
  return (
    <div className="_mi-hero-row">
      <div className="_mi-hero-main">
        <span className="_mi-hero-big" style={{ color: "#566276" }}>--</span>
        <span className="_mi-hero-lbl">今日訊息</span>
      </div>
      <div className="_mi-hero-cell">
        <span className="_mi-hero-val" style={{ color: "#566276" }}>--</span>
        <span className="_mi-hero-lbl">AI 精選</span>
      </div>
      <div className="_mi-hero-cell">
        <span className="_mi-hero-val" style={{ color: "#566276" }}>--</span>
        <span className="_mi-hero-lbl">來源正常</span>
      </div>
      <div className="_mi-hero-cell">
        <span className="_mi-hero-val" style={{ fontSize: 16, color: "#566276" }}>載入中</span>
        <span className="_mi-hero-lbl">下次抓取</span>
      </div>
    </div>
  );
}

async function FeedPanel({ sources }: { sources: CoreSources }) {
  const { items, feedState } = await resolveFeedSection(sources);
  return (
    <Panel
      code="INT-01"
      title="AI 精選 · 今日重點"
      sub={feedState.summary}
      right={feedState.live ? "AI 篩選" : "備援排序"}
    >
      {items.length > 0 ? (
        <div className="_mi-list">
          {items.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="terminal-note">
          <span className="tg gold">{feedState.label}</span> {feedState.detail}
        </div>
      )}
    </Panel>
  );
}

function FeedPanelFallback() {
  return (
    <Panel code="INT-01" title="AI 精選 · 今日重點" sub="載入中" right="">
      <div className="terminal-note">
        <span className="tg gold">載入中</span> 今日重點整理中，稍候即會顯示。
      </div>
    </Panel>
  );
}

async function SourceStatusPanel({ sources }: { sources: CoreSources }) {
  const list = await resolveSourceStatusList(sources);
  return (
    <Panel code="INT-SRC" title="資料來源狀態" sub="每輪排程巡檢">
      <div className="_mi-rail">
        {list.map((source) => (
          <div className="_mi-src-tile" key={source.name}>
            <span className={`_mi-src-dot ${source.state}`} />
            <div className="_mi-src-body">
              <span className="_mi-src-name">{source.name}</span>
              <span className="_mi-src-label">{source.label}</span>
            </div>
            <div className="_mi-src-right">
              <div className={`_mi-src-status ${source.state}`}>{source.status}</div>
              <div className="_mi-src-fresh">{source.fresh}</div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SourceStatusPanelFallback() {
  return (
    <Panel code="INT-SRC" title="資料來源狀態" sub="每輪排程巡檢">
      <div className="terminal-note">
        <span className="tg gold">載入中</span> 來源狀態同步中。
      </div>
    </Panel>
  );
}

async function InstitutionalPanel({ sources }: { sources: Pick<MarketIntelSources, "institutional"> }) {
  const institutional = await resolveInstitutional(sources);
  if (!institutional) return null;
  return (
    <Panel code="INT-INS" title="三大法人" sub="今日買賣超（張）">
      {[
        { name: "外資", line: institutional.foreign },
        { name: "投信", line: institutional.invest },
        { name: "自營商", line: institutional.dealer },
      ].map(({ name, line }) => (
        <div className="_mi-inst-block" key={name}>
          <div className="_mi-inst-name">{name}</div>
          <div className="_mi-inst-stats">
            <div className="_mi-inst-stat">
              <span className="lbl">買進</span>
              <span className="val buy">{line ? line.buy.toLocaleString("zh-TW") : "--"}</span>
            </div>
            <div className="_mi-inst-stat">
              <span className="lbl">賣出</span>
              <span className="val sell">{line ? line.sell.toLocaleString("zh-TW") : "--"}</span>
            </div>
            <div className="_mi-inst-stat">
              <span className="lbl">淨額</span>
              <span className="val" style={{ color: line ? (line.net >= 0 ? "#ff5b6b" : "#4adb88") : undefined }}>
                {line ? line.net.toLocaleString("zh-TW") : "--"}
              </span>
            </div>
          </div>
        </div>
      ))}
    </Panel>
  );
}

async function HeatmapPanel({ sources }: { sources: Pick<MarketIntelSources, "heatmap"> }) {
  const heatmap = await resolveHeatmap(sources);
  return (
    <Panel code="INT-HEAT" title="產業熱力圖" sub="TWSE 公開資料 / 今日收盤" right="依變動幅度排序">
      {heatmap.length > 0 ? (
        <div className="_mi-heat-grid">
          {heatmap.map((tile) => (
            <div className="_mi-heat-tile" key={tile.industry}>
              <span className="_mi-heat-nm">{tile.industry}</span>
              <span className={`_mi-heat-pct ${toneClass(tile.tone)}`}>{tile.label}</span>
              <span className="_mi-heat-cnt">{tile.gainerCount} 漲 / {tile.loserCount} 跌 · {tile.stockCount} 檔</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="terminal-note">
          <span className="tg gold">同步中</span> 產業熱力圖資料尚未回傳。
        </div>
      )}
    </Panel>
  );
}

function HeatmapPanelFallback() {
  return (
    <Panel code="INT-HEAT" title="產業熱力圖" sub="TWSE 公開資料 / 今日收盤" right="依變動幅度排序">
      <div className="terminal-note">
        <span className="tg gold">載入中</span> 產業熱力圖同步中。
      </div>
    </Panel>
  );
}

export default function FinalV031MarketIntelPage() {
  // 只「發射」5 支來源 promise，不 await——殼 (PageFrame/安全提示/下一步
  // CTA) 立即 SSR 回，5 個資料區各自用 Suspense 消費自己需要的子集。
  const sources = startMarketIntelSources();

  return (
    <PageFrame
      code="INT"
      title="市場情報"
      sub="今日重點、來源狀態與 AI 精選訊息"
      note="市場情報 / 正式資料；只做研究判讀，不下單、不顯示目標價或勝率。看完重點請前往 AI 推薦。"
    >
      <style>{MARKET_INTEL_CSS}</style>

      <div className="_mi-safety">
        <b>研究模式</b>
        <span>本頁僅供研究判讀，看完今日重點後請前往 <Link href="/ai-recommendations" style={{ color: "#e2b85c" }}>AI 推薦</Link> 決定觀察或動作。</span>
      </div>

      <Suspense fallback={<HeroStatsRowFallback />}>
        <HeroStatsRow sources={sources} />
      </Suspense>

      <div className="_mi-layout">
        <Suspense fallback={<FeedPanelFallback />}>
          <FeedPanel sources={sources} />
        </Suspense>

        <div className="_mi-rail">
          <Suspense fallback={<SourceStatusPanelFallback />}>
            <SourceStatusPanel sources={sources} />
          </Suspense>

          <Suspense fallback={null}>
            <InstitutionalPanel sources={sources} />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<HeatmapPanelFallback />}>
        <HeatmapPanel sources={sources} />
      </Suspense>

      <div className="_mi-next">
        <span className="_mi-next-lbl">下一步</span>
        <span className="_mi-next-txt">看完今日重點？前往 AI 推薦查看已挑出的候選清單。</span>
        <Link className="primary" href="/ai-recommendations">AI 推薦 →</Link>
        <Link className="ghost" href="/themes">主題板</Link>
      </div>
    </PageFrame>
  );
}
