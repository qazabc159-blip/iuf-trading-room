// 這是導覽列「市場情報」實際渲染的檔案（middleware.ts 的
// FINAL_V031_ROUTE_REWRITES 把每個已登入的 `/market-intel` 請求無聲 rewrite
// 到這裡；同款 shadow 說明見 apps/web/app/portfolio/page.tsx 開頭註解 /
// .claude/agent-memory/frontend-consume-jim/middleware_route_rewrite_shadow_
// trap_2026_07_15.md）。真正要改市場情報頁內容請改這支檔案，不是
// apps/web/app/market-intel/page.tsx。
//
// 2026-07-22：楊董退件「市場情報還是簡陋」，套用已核可的重設計稿 v1
// （reports/design_redesign_20260722/drafts/market_intel_redesign_v1.html +
// DESIGN_NOTES_20260722.md）——金色斜切 masthead + Hero band（情報脈動巨數字
// ‖ 三大法人分歧長條）+ 雜誌式新聞 wire（頭條放大 + 密列）+ 全寬磚格熱力圖。
// 這是版面美術重做：5 支資料來源、Suspense 串流架構、逾時降級分支全部原封
// 不動（2026-07-21 效能急修的教訓——SSR 絕不能等最慢那支）；只換呈現層。
// 不再用 <PageFrame>/<Panel>（那是給一般內頁的通用文字骨架，稿子明確要換成
// 首頁同源的斜切 masthead），改成本頁專屬的 scoped CSS + 小型 local
// component，沿用本頁既有 `_mi-*` class 前綴慣例（避免跟 globals.css 既有
// .panel/.bar/.tile/.item 等通用類別撞名——2026-07-21 window-gutter 教訓）。
// AppSidebar/HeaderDock/TickerTape 由 app/layout.tsx 全站共用渲染，這支檔案
// 從未、也不需要碰它們。
//
// 2026-07-22 楊董加碼三要求：①更有質感（真字體層級/hairline 規線/hover 微
// 互動） ②新聞標題可點擊跳原文全文 ③手機 390 同步（稿內建 RWD 逐區搬）。
//
// 新聞跳轉原文：NewsAiItem/CompanyAnnouncement 型別都有 url 欄位且後端
// news-ai-selector.ts 確有把來源 url 往下傳，但 2026-07-22 curl prod
// news-top10 實測 10 則全數沒有這個欄位（undefined，非空字串）——原文連結
// 目前沒有真資料可用。前端誠實處理：market-intel-data.ts 的 sourceUrl 有
// 值才顯示「看原文」連結，沒有值就不顯示、也不 fake 一個假連結，退回既有
// 「看公司」跳轉。此為已知後端缺口，已回報 Elva（見 PR 交付報告）。
//
// 三大法人：PR #1338（e7cb18fd）已修 resolveInstitutional() 的英文 enum
// 分類 bug，外資/投信/自營商三列現在皆為真實非零值——本次不動資料層，
// 只是把畫面從舊版簡單三欄改成分歧長條視覺。
//
// 回退：git revert 本次改動即可，舊 /api/ui-final-v031/market-intel route +
// buildMarketIntelPayload() 完全未刪除、未動（現在沒有頁面連到它，是刻意保留
// 的孤兒端點，非本輪範圍）。
import Link from "next/link";
import { Suspense } from "react";

import { MarketStateBanner } from "@/components/MarketStateBanner";
import { TaipeiClock } from "@/components/TaipeiClock";
import {
  startMarketIntelSources,
  resolveHeroStats,
  resolveFeedSection,
  resolveSourceStatusList,
  resolveHeatmap,
  resolveInstitutional,
  type MarketIntelFeedItem,
  type MarketIntelSource,
  type MarketIntelSources,
} from "@/app/market-intel/market-intel-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CoreSources = Pick<MarketIntelSources, "news" | "announcements" | "finMind">;

function yi(value: number): string {
  return (value / 1e8).toFixed(2);
}

function signedYi(value: number): string {
  return `${value >= 0 ? "+" : ""}${yi(value)}`;
}

function heatBucketClass(pct: number): string {
  const magnitude = Math.abs(pct);
  if (pct > 0) {
    if (magnitude >= 2.5) return "p3";
    if (magnitude >= 1.2) return "p2";
    if (magnitude >= 0.15) return "p1";
    return "";
  }
  if (pct < 0) {
    if (magnitude >= 1.2) return "n2";
    if (magnitude >= 0.15) return "n1";
    return "";
  }
  return "";
}

function dotClass(state: "ok" | "warn") {
  return state === "ok" ? "_mi-dot-ok" : "_mi-dot-warn";
}

// ── 頭條 + 密列新聞卡（同一份真資料，兩種呈現密度）──────────────────────
function NewsLinks({ item }: { item: MarketIntelFeedItem }) {
  return (
    <span className="_mi-lk">
      {item.sourceUrl && (
        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
          看原文 →
        </a>
      )}
      <Link href={item.companyHref}>看公司 →</Link>
      <Link href={item.recommendationHref}>看 AI 推薦 →</Link>
    </span>
  );
}

function NewsHeadline({ item, className }: { item: MarketIntelFeedItem; className: string }) {
  if (item.sourceUrl) {
    return (
      <h3 className={className}>
        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
          {item.title}
        </a>
      </h3>
    );
  }
  return <h3 className={className}>{item.title}</h3>;
}

function LeadArticle({ item }: { item: MarketIntelFeedItem }) {
  return (
    <article className="_mi-lead">
      <div className="_mi-meta">
        <span className="_mi-code">{item.symbol}</span>
        {item.name && <span className="_mi-co">{item.name}</span>}
        <span className="_mi-tag">{item.tag}</span>
        <span className="_mi-ago">{item.age}</span>
      </div>
      <NewsHeadline item={item} className="_mi-lead-h" />
      <p className="_mi-why _mi-lead-why">{item.why}</p>
      <div className="_mi-foot">
        <span className="_mi-src">{item.source} · {item.topicLabel}</span>
        <NewsLinks item={item} />
      </div>
    </article>
  );
}

function NewsListItem({ item, index }: { item: MarketIntelFeedItem; index: number }) {
  return (
    <article className="_mi-newsitem">
      <div className="_mi-newsitem-idx">
        <span>{String(index).padStart(2, "0")}</span>
        {item.age}
      </div>
      <div className="_mi-newsitem-body">
        <div className="_mi-meta">
          <span className="_mi-code">{item.symbol}</span>
          {item.name && <span className="_mi-co">{item.name}</span>}
          <span className="_mi-ago">{item.age}</span>
        </div>
        <NewsHeadline item={item} className="_mi-newsitem-h" />
        <p className="_mi-why">{item.why}</p>
        <div className="_mi-foot">
          <span className="_mi-src">{item.source} · {item.topicLabel}</span>
          <NewsLinks item={item} />
        </div>
      </div>
    </article>
  );
}

// ── Hero left: intel pulse + compact source strip ──────────────────────────
async function HeroPulsePanel({ sources }: { sources: CoreSources }) {
  const [stats, sourceList] = await Promise.all([
    resolveHeroStats(sources),
    resolveSourceStatusList(sources),
  ]);
  return (
    <div className="_mi-panel _mi-pulse">
      <div className="_mi-eyebrow">
        <span className="_mi-tab">Intel Pulse</span>
        <span className="_mi-crumb">今日情報脈動</span>
      </div>
      <div className="_mi-pulse-nums">
        <div className="_mi-pulse-big">
          <span className="_mi-n">{stats.total}</span>
          <span className="_mi-l">今日訊息 · 其中 <b>{stats.aiSelected}</b> 則 AI 精選</span>
        </div>
        <div className="_mi-pulse-sub">
          <div className="_mi-prow">
            <span className="_mi-pv" style={{ color: stats.sourceOk === stats.sourceTotal ? "var(--tw-dn-bright)" : "var(--gold-bright)" }}>
              {stats.sourceOk}
            </span>
            <span className="_mi-pt">/ {stats.sourceTotal} 來源正常</span>
          </div>
          <div className="_mi-prow">
            <span className="_mi-pv" style={{ fontSize: 15 }}>{stats.nextRefresh}</span>
            <span className="_mi-pt">下次抓取</span>
          </div>
        </div>
      </div>
      <div className="_mi-srcstrip">
        {sourceList.map((source) => (
          <div className="_mi-srccell" key={source.name}>
            <div className="_mi-srchd">
              <i className={dotClass(source.state)} />
              {source.name}
            </div>
            <div className="_mi-srcst">{source.status} · {source.fresh}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroPulsePanelFallback() {
  return (
    <div className="_mi-panel _mi-pulse">
      <div className="_mi-eyebrow">
        <span className="_mi-tab">Intel Pulse</span>
        <span className="_mi-crumb">今日情報脈動</span>
      </div>
      <div className="_mi-pulse-nums">
        <div className="_mi-pulse-big">
          <span className="_mi-n" style={{ color: "var(--night-soft)" }}>--</span>
          <span className="_mi-l">載入中</span>
        </div>
      </div>
    </div>
  );
}

// ── Hero right: institutional divergence bars (三大法人) ───────────────────
async function InstitutionalPanel({ sources }: { sources: Pick<MarketIntelSources, "institutional"> }) {
  const institutional = await resolveInstitutional(sources);
  if (!institutional) return null;
  const rows = [
    { name: "外資", en: "FOREIGN", line: institutional.foreign },
    { name: "投信", en: "INV TRUST", line: institutional.invest },
    { name: "自營商", en: "DEALER", line: institutional.dealer },
  ];
  const maxGross = Math.max(1, ...rows.map((r) => Math.max(r.line?.buy ?? 0, r.line?.sell ?? 0)));
  return (
    <div className="_mi-panel _mi-instpanel">
      <div className="_mi-insthd">
        <div className="_mi-eyebrow">
          <span className="_mi-tab">Institutional</span>
          <span className="_mi-crumb">三大法人 · 今日買賣超</span>
        </div>
        <span className="_mi-unit">單位 億元 · 紅買綠賣</span>
      </div>
      <div className="_mi-instrows">
        {rows.map(({ name, en, line }) => (
          <div className="_mi-instrow" key={name}>
            <div className="_mi-instwho">
              {name}
              <small>{en}</small>
            </div>
            <div className="_mi-instbarwrap">
              <div className="_mi-instbar">
                <span className="_mi-instzero" />
                {line && (
                  <>
                    <span
                      className="_mi-instfill sell"
                      style={{ width: `${Math.min(50, (line.sell / maxGross) * 50)}%` }}
                    />
                    <span
                      className="_mi-instfill buy"
                      style={{ width: `${Math.min(50, (line.buy / maxGross) * 50)}%` }}
                    />
                  </>
                )}
              </div>
              <div className="_mi-instdetail">
                {line ? (
                  <>買 {yi(line.buy)} 億<span>·</span>賣 {yi(line.sell)} 億</>
                ) : (
                  <span className="_mi-pending"><i />同步中</span>
                )}
              </div>
            </div>
            <div className="_mi-instnet">
              <div className={`_mi-nn ${line && line.net >= 0 ? "up" : line ? "down" : ""}`}>
                {line ? signedYi(line.net) : "--"}
              </div>
              <div className="_mi-nntag">NET 億</div>
            </div>
          </div>
        ))}
      </div>
      <div className="_mi-instfoot">
        依 FinMind 收盤結算 · 自營商已加總自行買賣與避險分項；外資含外資自營。
      </div>
    </div>
  );
}

// ── News wire ────────────────────────────────────────────────────────────
async function FeedPanel({ sources }: { sources: CoreSources }) {
  const { items, feedState } = await resolveFeedSection(sources);
  const lead = items[0];
  const rest = items.slice(1);
  return (
    <div className="_mi-panel _mi-wire">
      <div className="_mi-panelhd">
        <span className="_mi-tab">AI 精選</span>
        <span className="_mi-ttl">今日重點</span>
        <span className="_mi-sub">{feedState.summary}</span>
        <span className="_mi-rt">{feedState.live ? "AI CURATED" : "備援排序"}</span>
      </div>
      {lead ? (
        <>
          <LeadArticle item={lead} />
          {rest.map((item, idx) => (
            <NewsListItem key={item.id} item={item} index={idx + 2} />
          ))}
        </>
      ) : (
        <div className="_mi-empty">
          <span className="_mi-tag ai">{feedState.label}</span> {feedState.detail}
        </div>
      )}
    </div>
  );
}

function FeedPanelFallback() {
  return (
    <div className="_mi-panel _mi-wire">
      <div className="_mi-panelhd">
        <span className="_mi-tab">AI 精選</span>
        <span className="_mi-ttl">今日重點</span>
        <span className="_mi-sub">載入中</span>
      </div>
      <div className="_mi-empty">
        <span className="_mi-tag ai">載入中</span> 今日重點整理中，稍候即會顯示。
      </div>
    </div>
  );
}

// ── Right rail: source status tiles + next-fetch countdown ─────────────────
function SourceIcon({ name }: { name: string }) {
  if (name.includes("公開資訊")) return <>◉</>;
  if (name.includes("FinMind")) return <>◈</>;
  return <>✦</>;
}

async function RightRailPanel({ sources }: { sources: CoreSources }) {
  const [list, stats] = await Promise.all([
    resolveSourceStatusList(sources),
    resolveHeroStats(sources),
  ]);
  return (
    <div className="_mi-rail">
      <div className="_mi-panel">
        <div className="_mi-panelhd"><span className="_mi-ttl" style={{ fontSize: 14 }}>資料來源狀態</span><span className="_mi-sub">每輪排程巡檢</span></div>
        <div className="_mi-srclist">
          {list.map((source: MarketIntelSource) => (
            <div className="_mi-srcitem" key={source.name}>
              <div className="_mi-ico"><SourceIcon name={source.name} /></div>
              <div className="_mi-info">
                <b>{source.name}</b>
                <span>{source.label}</span>
              </div>
              <span className={`_mi-badge ${source.state}`}>{source.status}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="_mi-panel">
        <div className="_mi-panelhd"><span className="_mi-ttl" style={{ fontSize: 14 }}>下次抓取</span><span className="_mi-sub">排程倒數</span></div>
        <div className="_mi-fetch">
          <div className="_mi-ring">{stats.nextRefresh}</div>
          <div className="_mi-fetchinfo"><b>下一輪巡檢</b><br /><span>AI 精選與來源狀態同步</span></div>
        </div>
      </div>
    </div>
  );
}

function RightRailPanelFallback() {
  return (
    <div className="_mi-rail">
      <div className="_mi-panel">
        <div className="_mi-panelhd"><span className="_mi-ttl" style={{ fontSize: 14 }}>資料來源狀態</span></div>
        <div className="_mi-empty">同步中</div>
      </div>
    </div>
  );
}

// ── Heatmap ──────────────────────────────────────────────────────────────
async function HeatmapPanel({ sources }: { sources: Pick<MarketIntelSources, "heatmap"> }) {
  const heatmap = await resolveHeatmap(sources);
  return (
    <div className="_mi-panel _mi-heatwrap">
      <div className="_mi-panelhd">
        <span className="_mi-tab">產業熱力圖</span>
        <span className="_mi-ttl">TWSE 公開資料</span>
        <span className="_mi-sub">今日收盤 · 依變動幅度排序</span>
        {heatmap.length > 0 && (
          <span className="_mi-legend">
            <span>跌</span>
            <span className="_mi-sw n2" /><span className="_mi-sw n1" /><span className="_mi-sw p1" /><span className="_mi-sw p3" />
            <span>漲</span>
          </span>
        )}
      </div>
      {heatmap.length > 0 ? (
        <div className="_mi-heatgrid">
          {heatmap.map((tile) => (
            <div className={`_mi-heattile ${heatBucketClass(tile.avgChangePct)}`} key={tile.industry}>
              <span className="_mi-heat-nm">{tile.industry}</span>
              <span className={`_mi-heat-pct ${tile.tone}`}>{tile.label}</span>
              <span className="_mi-heat-cnt">{tile.gainerCount} 漲 / {tile.loserCount} 跌 · {tile.stockCount} 檔</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="_mi-empty">
          <span className="_mi-tag ai">同步中</span> 產業熱力圖資料尚未回傳。
        </div>
      )}
    </div>
  );
}

function HeatmapPanelFallback() {
  return (
    <div className="_mi-panel _mi-heatwrap">
      <div className="_mi-panelhd">
        <span className="_mi-tab">產業熱力圖</span>
        <span className="_mi-ttl">TWSE 公開資料</span>
        <span className="_mi-sub">載入中</span>
      </div>
      <div className="_mi-empty">
        <span className="_mi-tag ai">載入中</span> 產業熱力圖同步中。
      </div>
    </div>
  );
}

export default function FinalV031MarketIntelPage() {
  // 只「發射」5 支來源 promise，不 await——殼（masthead/safebar/CTA）立即
  // SSR 回，各資料區各自用 Suspense 消費自己需要的子集。
  const sources = startMarketIntelSources();

  return (
    <main className="page-frame _mi-shell">
      <style>{MARKET_INTEL_CSS}</style>

      <header className="_mi-mast">
        <div className="_mi-mast-brand"><b>IUF·TR</b><span>TRADING ROOM</span></div>
        <div className="_mi-mast-seg obs"><span className="k">Mode</span><span className="v"><i />OBSERVE</span></div>
        <div className="_mi-mast-seg"><span className="k">Page</span><span className="v">市場情報</span></div>
        <div className="_mi-mast-seg"><span className="k">Source</span><span className="v">正式資料</span></div>
        <div className="_mi-mast-seg"><span className="k">Scope</span><span className="v">觀察與研究</span></div>
        <div className="_mi-mast-spacer" />
        <div className="_mi-mast-seg r clk"><span className="k">Taipei · UTC+8</span><span className="v"><TaipeiClock /></span></div>
      </header>

      <MarketStateBanner />

      <div className="_mi-subline">
        <b>市場情報</b><span className="_mi-sep">/</span>正式資料<span className="_mi-sep">·</span>只做研究判讀，不下單、不顯示目標價或勝率<span className="_mi-sep">·</span>看完今日重點請前往 AI 推薦
      </div>

      <div className="_mi-safety">
        <b>研究模式</b>
        <span>本頁僅供研究判讀，看完今日重點後請前往 <Link href="/ai-recommendations" className="_mi-goldlink">AI 推薦</Link> 決定觀察或動作。</span>
      </div>

      <section className="_mi-hero">
        <Suspense fallback={<HeroPulsePanelFallback />}>
          <HeroPulsePanel sources={sources} />
        </Suspense>
        <Suspense fallback={null}>
          <InstitutionalPanel sources={sources} />
        </Suspense>
      </section>

      <section className="_mi-magazine">
        <Suspense fallback={<FeedPanelFallback />}>
          <FeedPanel sources={sources} />
        </Suspense>
        <Suspense fallback={<RightRailPanelFallback />}>
          <RightRailPanel sources={sources} />
        </Suspense>
      </section>

      <Suspense fallback={<HeatmapPanelFallback />}>
        <HeatmapPanel sources={sources} />
      </Suspense>

      <div className="_mi-cta">
        <div className="_mi-ctatxt">看完今日重點？<b>前往 AI 推薦</b>查看已挑出的候選清單。</div>
        <div className="_mi-ctaacts">
          <Link className="_mi-btn" href="/themes">主題板</Link>
          <Link className="_mi-btn gold" href="/ai-recommendations">AI 推薦 →</Link>
        </div>
      </div>
    </main>
  );
}

const MARKET_INTEL_CSS = `
._mi-shell { --mi-pos: var(--tw-up-bright); --mi-neg: var(--tw-dn-bright); }

/* ---------- masthead (gold skew, 同源首頁 mast) ---------- */
._mi-mast {
  display: flex; align-items: stretch; margin-bottom: 14px;
  border: 1px solid var(--night-rule-strong); border-radius: 4px;
  background: linear-gradient(90deg, var(--night-1), var(--night)); overflow: hidden; flex-wrap: wrap;
}
._mi-mast-brand {
  position: relative; background: linear-gradient(105deg, #1c1608, #0d0a05);
  padding: 12px 30px 12px 18px; display: flex; flex-direction: column; justify-content: center;
  clip-path: polygon(0 0, 100% 0, calc(100% - 16px) 100%, 0 100%); min-width: 168px;
}
._mi-mast-brand b { color: var(--gold-bright); font-family: var(--mono); font-size: 15px; letter-spacing: .06em; font-weight: 700; }
._mi-mast-brand span { color: var(--gold); opacity: .7; font-family: var(--mono); font-size: 8.5px; letter-spacing: .3em; }
._mi-mast-seg { padding: 9px 20px; display: flex; flex-direction: column; justify-content: center; border-left: 1px solid var(--night-rule); min-width: 0; }
._mi-mast-seg .k { font-family: var(--mono); font-size: 8.5px; letter-spacing: .18em; color: var(--night-soft); text-transform: uppercase; }
._mi-mast-seg .v { color: var(--night-ink); font-size: 13px; font-weight: 600; white-space: nowrap; }
._mi-mast-seg.obs .v { color: var(--gold-bright); display: flex; align-items: center; gap: 7px; }
._mi-mast-seg.obs .v i { width: 7px; height: 7px; border-radius: 50%; background: var(--gold-bright); box-shadow: 0 0 7px var(--gold-bright); }
._mi-mast-spacer { flex: 1; border-left: 1px solid var(--night-rule); min-width: 12px; }
._mi-mast-seg.r { text-align: right; align-items: flex-end; }
._mi-mast-seg.clk .v { font-size: 14px; color: var(--night-ink); font-family: var(--mono); letter-spacing: .02em; }

._mi-subline { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; color: var(--night-soft); font-size: 11.5px; padding: 9px 2px 0; font-family: var(--mono); }
._mi-subline b { color: var(--gold); font-weight: 600; }
._mi-sep { color: var(--night-faint); }

._mi-safety {
  display: flex; align-items: center; gap: 10px; padding: 10px 16px; margin: 12px 0 0;
  border-left: 3px solid var(--gold); border-radius: 0 4px 4px 0;
  background: linear-gradient(90deg, rgba(200,148,63,0.08), transparent 60%);
  font-size: 12px; line-height: 1.55; color: var(--night-mid);
}
._mi-safety b { color: var(--gold-bright); }
._mi-goldlink { color: var(--gold-bright); }

._mi-panel { background: var(--night-1); border: 1px solid var(--night-rule); border-radius: 4px; }
._mi-eyebrow { display: flex; align-items: baseline; gap: 9px; }
._mi-tab {
  font-family: var(--mono); font-size: 9.5px; letter-spacing: .16em; color: var(--gold); text-transform: uppercase;
  padding-left: 11px; position: relative;
}
._mi-tab::before { content: ""; position: absolute; left: 0; top: 1px; bottom: 1px; width: 4px; background: var(--gold); clip-path: polygon(0 0, 100% 0, 100% 100%, 35% 100%); }
._mi-crumb { font-size: 11px; color: var(--night-soft); }

/* ---------- hero band ---------- */
._mi-hero { display: grid; grid-template-columns: 1.05fr 1.35fr; gap: 14px; margin-top: 14px; }
._mi-pulse { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
._mi-pulse-nums { display: flex; align-items: flex-end; gap: 26px; flex-wrap: wrap; }
._mi-pulse-big { display: flex; flex-direction: column; }
._mi-pulse-big ._mi-n { font-family: var(--mono); font-size: 52px; line-height: .86; color: var(--night-ink); font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
._mi-pulse-big ._mi-l { font-size: 11.5px; color: var(--night-soft); margin-top: 8px; }
._mi-pulse-big ._mi-l b { color: var(--gold-bright); }
._mi-pulse-sub { display: flex; flex-direction: column; gap: 10px; padding-bottom: 5px; }
._mi-prow { display: flex; align-items: baseline; gap: 8px; }
._mi-pv { font-family: var(--mono); font-size: 18px; color: var(--night-ink); font-variant-numeric: tabular-nums; }
._mi-pt { font-size: 11px; color: var(--night-soft); }
._mi-srcstrip { display: flex; gap: 0; border-top: 1px solid var(--night-rule); padding-top: 12px; flex-wrap: wrap; }
._mi-srccell { flex: 1 1 30%; min-width: 130px; padding: 0 12px; }
._mi-srccell + ._mi-srccell { border-left: 1px solid var(--night-rule); }
._mi-srchd { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--night-ink); }
._mi-srchd i { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
._mi-dot-ok { background: var(--tw-dn-bright); box-shadow: 0 0 6px var(--tw-dn-bright); }
._mi-dot-warn { background: var(--gold-bright); box-shadow: 0 0 6px var(--gold-bright); }
._mi-srcst { font-family: var(--mono); font-size: 9.5px; color: var(--night-soft); margin-top: 3px; }

/* institutional */
._mi-instpanel { padding: 16px 20px 18px; display: flex; flex-direction: column; gap: 12px; }
._mi-insthd { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 6px; }
._mi-unit { font-family: var(--mono); font-size: 9.5px; color: var(--night-faint); letter-spacing: .08em; }
._mi-instrows { display: flex; flex-direction: column; gap: 13px; }
._mi-instrow { display: grid; grid-template-columns: 62px minmax(0, 1fr) 88px; gap: 12px; align-items: center; }
._mi-instwho { font-size: 12.5px; color: var(--night-ink); font-weight: 600; }
._mi-instwho small { display: block; font-family: var(--mono); font-size: 8.5px; color: var(--night-faint); letter-spacing: .08em; font-weight: 400; }
._mi-instbarwrap { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
._mi-instbar { position: relative; height: 20px; background: var(--night-2); border: 1px solid var(--night-rule); border-radius: 2px; overflow: hidden; }
._mi-instzero { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--night-rule-strong); }
._mi-instfill { position: absolute; top: 0; bottom: 0; opacity: .82; }
._mi-instfill.buy { left: 50%; background: linear-gradient(90deg, var(--tw-up), var(--tw-up-faint)); }
._mi-instfill.sell { right: 50%; background: linear-gradient(270deg, var(--tw-dn), var(--tw-dn-faint)); }
._mi-instdetail { font-family: var(--mono); font-size: 9.5px; color: var(--night-soft); display: flex; gap: 6px; }
._mi-pending { color: var(--night-faint); font-family: var(--mono); font-size: 10px; display: inline-flex; align-items: center; gap: 5px; }
._mi-pending i { width: 5px; height: 5px; border-radius: 50%; background: var(--night-faint); }
._mi-instnet { text-align: right; font-family: var(--mono); }
._mi-nn { font-size: 15px; }
._mi-nn.up { color: var(--tw-up-bright); }
._mi-nn.down { color: var(--tw-dn-bright); }
._mi-nntag { font-size: 8.5px; color: var(--night-faint); letter-spacing: .1em; }
._mi-instfoot { border-top: 1px solid var(--night-rule); padding-top: 8px; font-size: 10.5px; color: var(--night-soft); }

/* ---------- magazine ---------- */
._mi-magazine { display: grid; grid-template-columns: minmax(0, 1fr) 336px; gap: 14px; margin-top: 14px; align-items: start; }
._mi-panelhd { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 13px 18px 11px; border-bottom: 1px solid var(--night-rule); }
._mi-ttl { font-size: 15px; color: var(--night-ink); font-weight: 700; }
._mi-sub { font-size: 11px; color: var(--night-soft); font-style: italic; }
._mi-rt { margin-left: auto; font-family: var(--mono); font-size: 9px; color: var(--night-faint); letter-spacing: .14em; }

._mi-wire { padding: 4px 0 6px; }
._mi-lead { padding: 16px 18px; border-bottom: 1px solid var(--night-rule); background: linear-gradient(180deg, var(--night-2), transparent); }
._mi-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-bottom: 7px; }
._mi-code { font-family: var(--mono); font-size: 11px; color: var(--gold-bright); border: 1px solid var(--gold-deep); border-radius: 2px; padding: 1px 5px; letter-spacing: .03em; }
._mi-co { font-size: 12px; color: var(--night-ink); font-weight: 600; }
._mi-tag { font-family: var(--mono); font-size: 9px; letter-spacing: .08em; color: var(--night-soft); border: 1px solid var(--night-rule-strong); border-radius: 2px; padding: 1px 5px; }
._mi-tag.ai { color: var(--gold-bright); border-color: var(--gold-deep); }
._mi-ago { margin-left: auto; font-family: var(--mono); font-size: 9.5px; color: var(--night-faint); }
._mi-lead-h { font-size: 17px; color: var(--night-ink); font-weight: 700; line-height: 1.35; margin: 0 0 7px; }
._mi-lead-h a, ._mi-newsitem-h a { color: inherit; text-decoration: none; }
._mi-lead-h a:hover, ._mi-newsitem-h a:hover { color: var(--gold-bright); text-decoration: underline; }
._mi-why { font-size: 12.5px; color: var(--night-mid); line-height: 1.55; border-left: 2px solid var(--gold-deep); padding-left: 10px; margin: 0; }
._mi-lead-why { font-size: 12.5px; }
._mi-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin-top: 9px; font-family: var(--mono); font-size: 10px; color: var(--night-soft); }
._mi-src { letter-spacing: .02em; }
._mi-lk { margin-left: auto; display: flex; gap: 12px; flex-wrap: wrap; }
._mi-lk a { color: var(--gold); letter-spacing: .02em; }
._mi-lk a:hover { color: var(--gold-bright); }
._mi-newsitem { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 0; border-bottom: 1px solid var(--night-rule); }
._mi-newsitem:last-child { border-bottom: 0; }
._mi-newsitem-idx { padding: 14px 0 0; text-align: center; border-right: 1px solid var(--night-rule); font-family: var(--mono); font-size: 9px; color: var(--night-faint); }
._mi-newsitem-idx span { display: block; color: var(--night-soft); font-size: 12px; margin-bottom: 3px; }
._mi-newsitem-body { padding: 12px 18px; }
._mi-newsitem-h { font-size: 13.5px; color: var(--night-ink); font-weight: 600; line-height: 1.4; margin: 0 0 6px; }
._mi-newsitem ._mi-why { font-size: 12px; }
._mi-newsitem:hover { background: rgba(255,255,255,0.015); }
._mi-empty { padding: 18px; color: var(--night-soft); font-size: 12px; line-height: 1.7; }

/* right rail */
._mi-rail { display: flex; flex-direction: column; gap: 14px; }
._mi-srclist { padding: 6px 14px 12px; }
._mi-srcitem { display: flex; align-items: center; gap: 11px; padding: 12px 0; border-bottom: 1px solid var(--night-rule); }
._mi-srcitem:last-child { border-bottom: 0; }
._mi-ico { width: 30px; height: 30px; border: 1px solid var(--night-rule-strong); border-radius: 4px; display: grid; place-items: center; color: var(--night-soft); font-size: 13px; flex-shrink: 0; }
._mi-info { flex: 1; min-width: 0; }
._mi-info b { font-size: 12.5px; color: var(--night-ink); display: block; }
._mi-info span { font-family: var(--mono); font-size: 9.5px; color: var(--night-soft); overflow-wrap: anywhere; }
._mi-badge { font-family: var(--mono); font-size: 9px; padding: 2px 7px; border-radius: 2px; letter-spacing: .04em; white-space: nowrap; flex-shrink: 0; }
._mi-badge.ok { color: var(--tw-dn-bright); border: 1px solid var(--tw-dn-faint); background: rgba(46,204,113,0.08); }
._mi-badge.warn { color: var(--gold-bright); border: 1px solid var(--gold-deep); background: rgba(200,148,63,0.08); }
._mi-fetch { padding: 14px; display: flex; align-items: center; gap: 12px; }
._mi-ring { width: 60px; height: 44px; border-radius: 6px; border: 1px solid var(--gold-deep); display: grid; place-items: center; font-family: var(--mono); font-size: 10px; color: var(--gold-bright); text-align: center; padding: 0 4px; flex-shrink: 0; }
._mi-fetchinfo b { color: var(--night-ink); font-size: 13px; }
._mi-fetchinfo span { font-size: 11px; color: var(--night-soft); }

/* ---------- heatmap ---------- */
._mi-heatwrap { margin-top: 14px; }
._mi-heatgrid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; padding: 14px 18px 18px; }
._mi-heattile { border: 1px solid var(--night-rule); border-radius: 4px; padding: 10px 11px; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
._mi-heat-nm { font-size: 12.5px; color: var(--night-ink); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
._mi-heat-pct { font-family: var(--mono); font-size: 16px; font-weight: 600; }
._mi-heat-pct.up { color: var(--tw-up-bright); }
._mi-heat-pct.down { color: var(--tw-dn-bright); }
._mi-heat-cnt { font-family: var(--mono); font-size: 9.5px; color: var(--night-soft); }
._mi-heattile.p3 { background: linear-gradient(180deg, rgba(230,57,70,0.18), rgba(230,57,70,0.07)); border-color: rgba(230,57,70,0.33); }
._mi-heattile.p2 { background: linear-gradient(180deg, rgba(230,57,70,0.12), rgba(230,57,70,0.04)); border-color: rgba(230,57,70,0.22); }
._mi-heattile.p1 { background: linear-gradient(180deg, rgba(230,57,70,0.06), transparent); border-color: rgba(230,57,70,0.15); }
._mi-heattile.n1 { background: linear-gradient(180deg, rgba(46,204,113,0.09), transparent); border-color: rgba(46,204,113,0.2); }
._mi-heattile.n2 { background: linear-gradient(180deg, rgba(46,204,113,0.16), rgba(46,204,113,0.06)); border-color: rgba(46,204,113,0.33); }
._mi-legend { display: flex; align-items: center; gap: 4px; margin-left: auto; font-family: var(--mono); font-size: 9px; color: var(--night-faint); }
._mi-sw { width: 16px; height: 9px; border-radius: 1px; }
._mi-sw.n2 { background: var(--tw-dn); } ._mi-sw.n1 { background: rgba(46,204,113,0.3); }
._mi-sw.p1 { background: rgba(230,57,70,0.3); } ._mi-sw.p3 { background: var(--tw-up); }

/* ---------- CTA ---------- */
._mi-cta { margin-top: 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 15px 20px; border: 1px solid var(--night-rule); border-radius: 4px; background: linear-gradient(90deg, var(--night-1), var(--night)); }
._mi-ctatxt { font-size: 13px; color: var(--night-mid); }
._mi-ctatxt b { color: var(--night-ink); }
._mi-ctaacts { margin-left: auto; display: flex; gap: 10px; flex-wrap: wrap; }
._mi-btn { font-size: 12.5px; padding: 8px 16px; border-radius: 4px; border: 1px solid var(--night-rule-strong); color: var(--night-mid); font-family: var(--mono); letter-spacing: .03em; text-decoration: none; display: inline-flex; align-items: center; }
._mi-btn:hover { border-color: var(--night-faint); color: var(--night-ink); }
._mi-btn.gold { background: linear-gradient(180deg, var(--gold-bright), var(--gold)); color: #1a1206; border-color: var(--gold-bright); font-weight: 600; }
._mi-btn.gold:hover { filter: brightness(1.08); }

/* ---------- responsive ---------- */
@media (max-width: 1180px) {
  ._mi-hero { grid-template-columns: 1fr; }
  ._mi-magazine { grid-template-columns: 1fr; }
  ._mi-heatgrid { grid-template-columns: repeat(4, 1fr); }
}
@media (max-width: 900px) {
  ._mi-mast { flex-wrap: wrap; }
  ._mi-mast-brand { clip-path: none; min-width: 0; flex: 1 0 100%; }
  ._mi-mast-seg { flex: 1 1 42%; }
  ._mi-mast-seg .v { white-space: normal; }
  ._mi-mast-spacer { display: none; }
  ._mi-mast-seg.r { flex: 1 1 42%; }
  ._mi-instrow { grid-template-columns: 52px minmax(0, 1fr) 74px; }
  ._mi-pulse-big ._mi-n { font-size: 42px; }
}
@media (max-width: 560px) {
  ._mi-heatgrid { grid-template-columns: repeat(2, 1fr); gap: 5px; }
  ._mi-pulse-nums { gap: 16px; }
  ._mi-cta { flex-wrap: wrap; }
  ._mi-ctaacts { margin-left: 0; width: 100%; }
  ._mi-ctaacts ._mi-btn { flex: 1; justify-content: center; }
  ._mi-srccell { flex: 1 1 100%; border-left: 0 !important; padding: 8px 0 0; border-top: 1px solid var(--night-rule); }
  ._mi-srccell:first-child { border-top: 0; padding-top: 0; }
}
@media (prefers-reduced-motion: reduce) { ._mi-shell * { animation: none !important; } }
`;
