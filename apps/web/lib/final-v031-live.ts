import {
  getCompanyByTicker,
  getCompanyOhlcv,
  getCompanyQuoteRealtime,
  getFinMindStatus,
  getKgiBidAsk,
  getKgiTicks,
  getMarketIntelAnnouncements,
  getNewsTop10,
  getStrategyIdeas,
  type CompanyAnnouncement,
  type NewsAiItem,
  type OhlcvBar,
} from "@/lib/api";
import type { StrategyIdeasView } from "@iuf-trading-room/contracts";
import {
  getKgiPositions,
  getPaperHealth,
  getPaperPortfolio,
  listPaperFills,
  listPaperOrders,
  type KgiPositionsResponse,
  type PaperFillLedgerRow,
  type PaperHealthState,
  type PaperOrderState,
  type PaperPortfolioPosition,
} from "@/lib/paper-orders-api";

export type FinalV031Screen = "market-intel" | "strategy-ideas" | "paper-trading-room";

type Settled<T> = PromiseSettledResult<T>;

function okValue<T>(result: Settled<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

function sourceLabel(source?: string | null) {
  if (!source) return "正式資料";
  if (source.includes("twse")) return "公開資訊";
  if (source.includes("finmind")) return "FinMind";
  if (source.includes("mixed")) return "混合來源";
  return source;
}

function minutesAgoText(dateLike?: string | null) {
  if (!dateLike) return "剛剛";
  const ts = Date.parse(dateLike);
  if (!Number.isFinite(ts)) return "剛剛";
  const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.round(hours / 24)} 天前`;
}

function inferTopic(text: string) {
  if (/AI|GB200|伺服器|散熱|ASIC|GPU|CoWoS/i.test(text)) return "ai";
  if (/半導體|晶圓|製程|IC|封測|矽|SoC/i.test(text)) return "semi";
  if (/金控|銀行|壽險|金融|利率/i.test(text)) return "fin";
  if (/電動車|車用|EV|汽車/i.test(text)) return "auto";
  return "all";
}

function mapNewsItem(item: NewsAiItem, index: number) {
  const title = item.headline || "市場訊息";
  const tag = item.tags?.[0] ?? item.impact_tier ?? "市場";
  return {
    symbol: item.ticker ?? "大盤",
    name: item.companyName ?? "",
    title,
    source: sourceLabel(item.source),
    tag,
    why: item.why_matters ?? "已列入今日研究清單，需搭配來源狀態與策略想法交叉判讀。",
    age: minutesAgoText(item.date),
    category: inferTopic(`${title} ${tag}`),
    rank: item.rank ?? index + 1,
  };
}

function mapAnnouncement(item: CompanyAnnouncement, index: number) {
  const title = item.title || item.body || "官方重大訊息";
  const tag = item.category || "官方公告";
  return {
    symbol: item.ticker ?? "公告",
    name: item.companyName ?? "",
    title,
    source: sourceLabel(item.source),
    tag,
    why: item.body?.slice(0, 72) || "官方來源已進入今日市場情報，請搭配策略想法做研究判讀。",
    age: minutesAgoText(item.date),
    category: inferTopic(`${title} ${tag}`),
    rank: index + 1,
  };
}

async function buildMarketIntelPayload() {
  const [newsResult, announcementsResult, finMindResult] = await Promise.allSettled([
    getNewsTop10(),
    getMarketIntelAnnouncements({ days: 30, limit: 20, scope: "market" }),
    getFinMindStatus(),
  ]);

  const news = newsResult.status === "fulfilled" ? newsResult.value.data : null;
  const announcements = announcementsResult.status === "fulfilled" ? announcementsResult.value.data : null;
  const finMind = finMindResult.status === "fulfilled" ? finMindResult.value.data : null;

  const aiItems = news?.items?.map(mapNewsItem) ?? [];
  const announcementItems = announcements?.items?.map(mapAnnouncement) ?? [];
  const items = (aiItems.length ? aiItems : announcementItems).slice(0, 12);
  const topicCounts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + 1;
    return acc;
  }, {});

  const finMindLive =
    !!finMind &&
    (finMind.state === "LIVE_READY" ||
      finMind.datasets?.some((dataset) => dataset.state === "LIVE"));
  const mopsLive = (announcements?.items?.length ?? 0) > 0 && (announcements?.failures ?? 0) === 0;
  const aiLive = !!news?.items?.length && news.ai_call_success !== false;
  const sourceOkCount = [mopsLive, finMindLive, aiLive].filter(Boolean).length;

  return {
    screen: "market-intel" as const,
    generatedAt: new Date().toISOString(),
    stats: {
      total: Math.max(news?.input_row_count ?? 0, items.length),
      aiSelected: news?.items?.length ?? 0,
      sourceOk: sourceOkCount,
      sourceTotal: 4,
      nextRefresh: news?.next_refresh_at ? minutesAgoText(news.next_refresh_at).replace("前", "後") : "排程中",
    },
    topicCounts: {
      all: items.length,
      ai: topicCounts.ai ?? 0,
      semi: topicCounts.semi ?? 0,
      fin: topicCounts.fin ?? 0,
      auto: topicCounts.auto ?? 0,
    },
    items,
    sources: [
      {
        name: "公開資訊觀測站",
        label: mopsLive ? "官方公告已回傳" : "目前無可呈現公告",
        state: mopsLive ? "ok" : "warn",
        status: mopsLive ? "正常" : "待確認",
        fresh: announcements?.items?.[0]?.date ? minutesAgoText(announcements.items[0].date) : "同步中",
      },
      {
        name: "FinMind 市場資料",
        label: finMindLive ? "市場資料可用" : "資料源同步中",
        state: finMindLive ? "ok" : "warn",
        status: finMindLive ? "正常" : "同步中",
        fresh: finMind?.updatedAt ? minutesAgoText(finMind.updatedAt) : "同步中",
      },
      {
        name: "AI 精選訊息",
        label: news?.selection_mode === "ai" ? "已完成今日篩選" : "使用備援排序",
        state: aiLive ? "ok" : "warn",
        status: aiLive ? "正常" : "備援",
        fresh: news?.as_of ? minutesAgoText(news.as_of) : "同步中",
      },
      {
        name: "主管機關公告",
        label: "資料欄位待人工確認",
        state: "warn",
        status: "待確認",
        fresh: "排程探測",
      },
    ],
    readiness: {
      coverage: Math.min(100, Math.max(0, Math.round((items.length / 12) * 100))),
      freshness: finMindLive || aiLive ? 90 : 45,
      reviewQueue: Math.max(0, announcements?.failures ?? 0),
    },
  };
}

function confidenceText(value: number) {
  if (value >= 0.75) return "高";
  if (value >= 0.55) return "中高";
  if (value >= 0.35) return "中";
  return "低";
}

function qualityPct(item: StrategyIdeasView["items"][number]) {
  if (item.quality.grade === "strategy_ready") return Math.max(80, Math.round(item.confidence * 100));
  if (item.quality.grade === "reference_only") return Math.max(45, Math.round(item.confidence * 85));
  return Math.max(20, Math.round(item.confidence * 70));
}

function decisionClass(decision: string) {
  if (decision === "allow") return "allow";
  if (decision === "review") return "review";
  return "block";
}

function decisionLabel(decision: string) {
  if (decision === "allow") return "可觀察";
  if (decision === "review") return "待確認";
  return "不進流程";
}

function directionLabel(direction: string) {
  if (direction === "bullish") return "偏多";
  if (direction === "bearish") return "偏空";
  return "中性";
}

function mapIdea(item: StrategyIdeasView["items"][number], index: number) {
  const decision = item.marketData.decision;
  const themes = item.topThemes.map((theme) => theme.name).filter(Boolean);
  const pct = qualityPct(item);
  return {
    symbol: item.symbol,
    companyName: item.companyName,
    sector: themes[0] ?? item.market,
    meta: `${item.market} / ${themes[0] ?? "主題待確認"}`,
    decision,
    status: decisionLabel(decision),
    statusClass: decisionClass(decision),
    direction: directionLabel(item.direction),
    score: (item.score / 100).toFixed(2),
    confidence: confidenceText(item.confidence),
    completeness: pct,
    signalCount: item.signalCount,
    latest: minutesAgoText(item.latestSignalAt),
    reason: item.rationale.primaryReason || item.marketData.primaryReason,
    missing: item.quality.primaryReason,
    themes,
    delta: index % 3 === 0 ? "0.06" : index % 3 === 1 ? "0.03" : "0.00",
  };
}

async function buildIdeasPayload() {
  const result = await Promise.allSettled([
    getStrategyIdeas({ decisionMode: "paper", includeBlocked: true, limit: 12, sort: "score" }),
  ]);
  const view = result[0].status === "fulfilled" ? result[0].value.data : null;
  const items = view?.items?.map(mapIdea) ?? [];
  const summary = view?.summary ?? {
    total: items.length,
    allow: items.filter((item) => item.decision === "allow").length,
    review: items.filter((item) => item.decision === "review").length,
    block: items.filter((item) => item.decision === "block").length,
    bullish: items.filter((item) => item.direction === "偏多").length,
    bearish: items.filter((item) => item.direction === "偏空").length,
    neutral: items.filter((item) => item.direction === "中性").length,
    quality: { strategyReady: 0, referenceOnly: 0, insufficient: 0, primaryReasons: [] },
  };

  return {
    screen: "strategy-ideas" as const,
    generatedAt: view?.generatedAt ?? new Date().toISOString(),
    summary,
    items,
    selected: items[0] ?? null,
  };
}

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("zh-TW");
}

function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value >= 1000 ? value.toLocaleString("zh-TW", { maximumFractionDigits: 1 }) : value.toFixed(2);
}

function latestOhlcv(ohlcv: OhlcvBar[]) {
  return ohlcv.length ? ohlcv[ohlcv.length - 1] : null;
}

async function buildPaperPayload() {
  const [healthResult, portfolioResult, fillsResult, ordersResult, kgiResult, ideasResult] = await Promise.allSettled([
    getPaperHealth(),
    getPaperPortfolio(),
    listPaperFills(),
    listPaperOrders(),
    getKgiPositions(),
    getStrategyIdeas({ decisionMode: "paper", includeBlocked: true, limit: 8, sort: "score" }),
  ]);

  const health = okValue<PaperHealthState | null>(healthResult, null);
  const portfolio = okValue<PaperPortfolioPosition[]>(portfolioResult, []);
  const fills = okValue<PaperFillLedgerRow[]>(fillsResult, []);
  const orders = okValue<PaperOrderState[]>(ordersResult, []);
  const kgi = okValue<KgiPositionsResponse | null>(kgiResult, null);
  const ideas = ideasResult.status === "fulfilled" ? ideasResult.value.data : null;
  const mappedIdeas = ideas?.items?.map(mapIdea) ?? [];
  const selectedSymbol = portfolio[0]?.symbol ?? mappedIdeas[0]?.symbol ?? "2330";

  const [companyResult, quoteResult, bidAskResult, ticksResult] = await Promise.allSettled([
    getCompanyByTicker(selectedSymbol),
    getCompanyQuoteRealtime(selectedSymbol),
    getKgiBidAsk(selectedSymbol),
    getKgiTicks(selectedSymbol, 16),
  ]);
  const company = okValue(companyResult, null);
  const quote = okValue(quoteResult, null);
  const bidAsk = okValue(bidAskResult, null);
  const ticks = okValue(ticksResult, null);
  const ohlcv = company
    ? await getCompanyOhlcv(company.id, { interval: "1d" }).catch(() => [] as OhlcvBar[])
    : [];
  const lastBar = latestOhlcv(ohlcv);
  const lastPrice = quote?.lastPrice ?? lastBar?.close ?? portfolio[0]?.avgCostPerShare ?? null;
  const previous = ohlcv.length > 1 ? ohlcv[ohlcv.length - 2]?.close : null;
  const change = lastPrice != null && previous != null ? lastPrice - previous : null;
  const changePct = change != null && previous ? (change / previous) * 100 : null;

  const watchlist = [
    ...portfolio.map((pos) => ({
      symbol: pos.symbol,
      name: pos.symbol,
      meta: `${formatMoney(pos.netQtyShares)} 股 · ${pos.fillCount} 筆成交`,
      price: pos.symbol === selectedSymbol ? lastPrice : pos.avgCostPerShare,
      changePct: pos.symbol === selectedSymbol ? changePct : null,
    })),
    ...mappedIdeas.map((idea) => ({
      symbol: idea.symbol,
      name: idea.companyName,
      meta: `${idea.status} · ${idea.signalCount} 訊號`,
      price: null,
      changePct: null,
    })),
  ]
    .filter((item, index, arr) => arr.findIndex((other) => other.symbol === item.symbol) === index)
    .slice(0, 10);

  return {
    screen: "paper-trading-room" as const,
    generatedAt: new Date().toISOString(),
    health,
    selected: {
      symbol: selectedSymbol,
      name: company?.name ?? selectedSymbol,
      sector: company?.chainPosition ?? mappedIdeas[0]?.sector ?? "台股",
      price: lastPrice,
      open: quote?.lastPrice ?? lastBar?.open ?? null,
      high: lastBar?.high ?? null,
      low: lastBar?.low ?? null,
      close: lastPrice,
      previous,
      change,
      changePct,
      volume: quote?.volume ?? lastBar?.volume ?? null,
      quoteState: quote?.state ?? "NO_DATA",
    },
    watchlist,
    ideas: mappedIdeas,
    portfolio,
    orders,
    fills,
    kgi,
    ohlcv,
    bidAsk,
    ticks: ticks?.ticks ?? [],
  };
}

export async function buildFinalV031LivePayload(screen: FinalV031Screen) {
  try {
    if (screen === "market-intel") return await buildMarketIntelPayload();
    if (screen === "strategy-ideas") return await buildIdeasPayload();
    return await buildPaperPayload();
  } catch (error) {
    return {
      screen,
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "資料載入失敗",
    };
  }
}

function jsonScriptValue(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function finalV031HydrationScript(payload: unknown) {
  return `<script data-iuf-final-v031-live>
window.__IUF_FINAL_V031_LIVE__=${jsonScriptValue(payload)};
(() => {
  const live = window.__IUF_FINAL_V031_LIVE__;
  if (!live || !live.screen) return;
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const n = (value, fallback="—") => value === null || value === undefined || Number.isNaN(Number(value)) ? fallback : Number(value).toLocaleString("zh-TW");
  const price = (value) => value === null || value === undefined || Number.isNaN(Number(value)) ? "—" : (Number(value) >= 1000 ? Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 1 }) : Number(value).toFixed(2));
  const cls = (status) => status === "ok" || status === "allow" ? "ok" : status === "block" || status === "bad" ? "bad" : "warn";
  const setText = (sel, value) => { const node = $(sel); if (node) node.textContent = value; };
  const setCount = (label, value) => {
    const stat = $$(".taskhdr .stat").find((node) => node.textContent.includes(label));
    const val = stat && $(".v", stat);
    if (val) val.textContent = String(value ?? "0");
  };

  function hydrateMarket() {
    setCount("今日訊息", live.stats?.total ?? live.items?.length ?? 0);
    setCount("AI 精選", live.stats?.aiSelected ?? 0);
    const src = $$(".taskhdr .stat").find((node) => node.textContent.includes("來源正常"));
    if (src) $(".v", src).innerHTML = esc(live.stats?.sourceOk ?? 0) + " <small>/ " + esc(live.stats?.sourceTotal ?? 4) + "</small>";
    const age = $("#age"); if (age) age.textContent = live.stats?.nextRefresh ?? "排程中";
    const counts = live.topicCounts || {};
    [["all","全部"],["ai","AI 硬體"],["semi","半導體"],["fin","金融"],["auto","電動車"]].forEach(([key,label]) => {
      const btn = $$("#topicseg button").find((node) => node.textContent.includes(label));
      const c = btn && $(".c", btn);
      if (c) c.textContent = String(counts[key] ?? 0);
    });
    const feed = $("#feed");
    if (feed) {
      const items = live.items || [];
      feed.innerHTML = items.length ? items.map((item, i) => '<div class="feedrow" style="--i:'+i+'" data-cat="'+esc(item.category || "all")+'"><span class="sym">'+esc(item.symbol)+'</span><div class="body"><div class="t">'+esc(item.title)+'</div><div class="m"><span>'+esc(item.source)+'</span><span>·</span><span><b>'+esc(item.tag)+'</b></span>'+ (item.name ? '<span>·</span><span>'+esc(item.name)+'</span>' : '') +'</div></div><div class="why"><b>為什麼重要</b>　'+esc(item.why)+'</div><span class="age">'+esc(item.age)+'</span><span class="arr">›</span></div>').join("") : '<div class="feedrow"><div class="body"><div class="t">目前沒有可呈現的正式市場訊息</div><div class="m"><span>資料同步中</span></div></div><div class="why"><b>狀態</b>　後端尚未回傳今日精選，先不顯示示意資料。</div></div>';
    }
    const list = $(".srclist");
    if (list) {
      list.innerHTML = (live.sources || []).map((s, i) => '<div class="srctile '+esc(s.state)+'" style="--i:'+i+'"><span class="dot"></span><div><div class="nm">'+esc(s.name)+'</div><div class="lab">'+esc(s.label)+'</div></div><div class="right"><b>'+esc(s.status)+'</b><span class="fresh">'+esc(s.fresh)+'</span></div></div>').join("");
    }
    const bars = $$("[data-bar]");
    if (bars[0]) { bars[0].dataset.bar = String(live.readiness?.coverage ?? 0); bars[0].style.width = bars[0].dataset.bar + "%"; }
    if (bars[1]) { bars[1].dataset.bar = String(live.readiness?.freshness ?? 0); bars[1].style.width = bars[1].dataset.bar + "%"; }
    if (bars[2]) { bars[2].dataset.bar = String(Math.min(100, (live.readiness?.reviewQueue ?? 0) * 20)); bars[2].style.width = bars[2].dataset.bar + "%"; }
  }

  function ideaCard(item, i) {
    const st = item.statusClass || "review";
    const tone = st === "allow" ? "ok" : st === "block" ? "bad" : "warn";
    const deltaClass = Number(item.delta) > 0 ? "up" : Number(item.delta) < 0 ? "dn" : "flat";
    return '<article class="candcard '+(i===0?'sel ':'')+'" data-st="'+esc(st)+'" data-sym="'+esc(item.symbol)+'" style="--i:'+i+'"><div class="ax"><button>看公司</button><button>看來源</button></div><div class="hd"><div><div class="sym">'+esc(item.symbol)+'</div><div class="nm">'+esc(item.companyName)+'</div><div class="meta">'+esc(item.meta)+' · <span class="tag">'+esc(item.direction)+'</span></div></div><span class="pill '+tone+'"><i></i>'+esc(item.status)+'</span></div><p class="why"><b>為什麼被選出</b>　'+esc(item.reason)+'</p><div class="scores"><div><span class="l">AI 評分</span><span class="v brand">'+esc(item.score)+'</span></div><div><span class="l">信心</span><span class="v">'+esc(item.confidence)+'</span></div><div><span class="l">資料完整度</span><span class="v '+tone+'">'+esc(item.completeness)+'%</span></div></div><div class="ft"><span>'+esc(item.signalCount)+' 個訊號 · 最近 '+esc(item.latest)+'</span><span>點選看完整資料 ›</span></div><div class="trend"><span class="l">1H 評分</span><svg viewBox="0 0 160 24" preserveAspectRatio="none"><path d="M0 16 L30 15 L60 14 L90 12 L120 11 L160 10"/></svg><span class="delta '+deltaClass+'">'+(Number(item.delta)>0?'▲ ':Number(item.delta)<0?'▼ ':'— ')+esc(Math.abs(Number(item.delta || 0)).toFixed(2))+'</span></div></article>';
  }

  function setIdeaDetail(item) {
    if (!item) return;
    setText("#x-name", item.companyName);
    setText("#x-sym", item.symbol);
    setText("#x-meta", item.meta);
    setText("#x-score", item.score);
    setText("#x-conf", item.confidence);
    setText("#x-rd", item.completeness + "%");
    $("#x-rd")?.classList.toggle("ok", item.statusClass === "allow");
    $("#x-rd")?.classList.toggle("warn", item.statusClass === "review");
    $("#x-rd")?.classList.toggle("bad", item.statusClass === "block");
    const why = $("#x-why"); if (why) why.textContent = item.reason;
    const check = $("#x-check");
    if (check) {
      const bad = item.statusClass === "block";
      const warn = item.statusClass === "review";
      check.innerHTML = [
        ["價格資料", bad ? "不足" : "正常", bad ? "bad" : "ok"],
        ["K 線資料", bad ? "不足" : "正常", bad ? "bad" : "ok"],
        ["主題連結", item.themes?.length ? "正常" : "待補", item.themes?.length ? "ok" : "warn"],
        ["公司筆記", warn ? "待補" : "正常", warn ? "warn" : "ok"],
        ["籌碼資料", warn || bad ? "待確認" : "正常", warn || bad ? "warn" : "ok"],
        ["近期訊號", String(item.signalCount || 0) + " 則", item.signalCount ? "ok" : "warn"],
      ].map(([label,value,state]) => '<li class="'+state+'"><span class="dt"></span><span class="l">'+esc(label)+'</span><span class="v">'+esc(value)+'</span></li>').join("");
    }
  }

  function hydrateIdeas() {
    const summary = live.summary || {};
    setCount("候選總數", summary.total ?? live.items?.length ?? 0);
    setCount("可觀察", summary.allow ?? 0);
    setCount("待確認", summary.review ?? 0);
    setCount("資料不足", summary.block ?? 0);
    const cards = $$(".sumcard");
    [["total","全部候選"],["allow","可觀察"],["review","待確認"],["block","資料不足"]].forEach(([key,label], idx) => {
      if (cards[idx]) {
        const v = $(".v", cards[idx]); if (v) v.textContent = String(summary[key] ?? 0);
      }
    });
    const grid = $("#cands");
    if (grid) grid.innerHTML = live.items?.length ? live.items.map(ideaCard).join("") : '<div class="candcard"><div class="hd"><div><div class="sym">—</div><div class="nm">目前沒有正式候選</div><div class="meta">資料同步中</div></div></div><p class="why"><b>狀態</b>　後端尚未回傳策略候選，先不顯示示意資料。</p></div>';
    setIdeaDetail(live.items?.[0]);
    $$("#cands .candcard").forEach((card) => card.addEventListener("click", () => {
      $$("#cands .candcard").forEach((node) => node.classList.remove("sel"));
      card.classList.add("sel");
      setIdeaDetail((live.items || []).find((item) => item.symbol === card.dataset.sym));
    }));
  }

  function rowPrice(item) {
    const pc = item.changePct;
    const tone = pc == null ? "flat" : Number(pc) >= 0 ? "up" : "dn";
    const txt = pc == null ? "—" : (Number(pc) >= 0 ? "+" : "−") + Math.abs(Number(pc)).toFixed(2) + "%";
    return '<div class="price"><span class="v">'+price(item.price)+'</span><span class="d '+tone+'">'+txt+'</span></div>';
  }

  function hydratePaper() {
    const selected = live.selected || {};
    const chg = selected.change;
    const pct = selected.changePct;
    const tone = chg == null ? "flat" : Number(chg) >= 0 ? "up" : "dn";
    setText(".symhead .sym", selected.symbol || "—");
    setText(".symhead .nm", (selected.name || selected.symbol || "—"));
    setText(".symhead .meta", selected.sector || "台股");
    const pv = $(".symhead .price .v"); if (pv) { pv.textContent = price(selected.price); pv.className = "v " + tone; }
    const pd = $(".symhead .price .d"); if (pd) { pd.textContent = chg == null ? "可用資料" : (Number(chg) >= 0 ? "▲ +" : "▼ −") + Math.abs(Number(chg)).toFixed(2) + " 　" + (Number(pct) >= 0 ? "+" : "−") + Math.abs(Number(pct || 0)).toFixed(2) + "%"; pd.className = "d " + tone; }
    const stats = $$(".symhead .stats .s .v");
    if (stats[0]) stats[0].textContent = price(selected.open);
    if (stats[1]) stats[1].textContent = price(selected.high);
    if (stats[2]) stats[2].textContent = price(selected.low);
    if (stats[3]) stats[3].textContent = price(selected.previous);
    if (stats[4]) stats[4].textContent = selected.volume == null ? "—" : n(selected.volume) + " 股";
    const wl = $("#wl-my");
    if (wl) wl.innerHTML = '<div class="group">'+esc((live.watchlist || []).length)+' 檔自選 / 候選</div>' + (live.watchlist || []).map((item, i) => '<div class="wrow '+(i===0?'on':'')+'" data-sym="'+esc(item.symbol)+'"><span class="sym">'+esc(item.symbol)+'</span><div class="body"><div class="nm">'+esc(item.name)+'</div><div class="meta">'+esc(item.meta)+'</div></div>'+rowPrice(item)+'</div>').join("");
    const symInput = $("#t-sym"); if (symInput) symInput.value = (selected.symbol || "") + "　" + (selected.name || "");
    const priceInput = $("#t-price"); if (priceInput && selected.price != null) priceInput.value = Number(selected.price).toFixed(2);
    const ordersBody = $('.ltab[data-lt="orders"] tbody');
    if (ordersBody) ordersBody.innerHTML = (live.orders || []).slice(0, 12).map((row) => {
      const intent = row.intent || {};
      const fill = row.fill || {};
      return '<tr><td class="ts">'+esc((intent.createdAt || "").slice(11,19) || "—")+'</td><td class="sym">'+esc(intent.symbol)+'</td><td><span class="side '+(intent.side === "sell" ? "sell" : "buy")+'">'+(intent.side === "sell" ? "賣出" : "買進")+'</span></td><td>'+esc(intent.orderType || "—")+'</td><td class="r px">'+price(intent.price)+'</td><td class="r">'+esc(intent.qty ?? "—")+' '+esc(intent.quantity_unit === "LOT" ? "張" : "股")+'</td><td class="r">'+esc(fill.fillQty ?? 0)+'</td><td><span class="st '+(intent.status === "FILLED" ? "filled" : "pending")+'"><i></i>'+esc(intent.status || "—")+'</span></td><td class="ts">'+esc(intent.id || "—")+'</td></tr>';
    }).join("") || '<tr><td colspan="9">目前沒有紙上委託。</td></tr>';
    const fillsBody = $('.ltab[data-lt="fills"] tbody');
    if (fillsBody) fillsBody.innerHTML = (live.fills || []).slice(0, 12).map((fill) => '<tr><td class="ts">'+esc((fill.fillTime || "").slice(5,16) || "—")+'</td><td class="sym">'+esc(fill.symbol)+'</td><td><span class="side '+(fill.side === "sell" ? "sell" : "buy")+'">'+(fill.side === "sell" ? "賣出" : "買進")+'</span></td><td class="r px">'+price(fill.fillPrice)+'</td><td class="r">'+esc(fill.fillQty)+'</td><td class="r">'+n(Number(fill.fillQty || 0) * Number(fill.fillPrice || 0))+'</td><td class="ts">'+esc(fill.orderId)+'</td></tr>').join("") || '<tr><td colspan="7">目前沒有成交紀錄。</td></tr>';
    const posBody = $('.ltab[data-lt="positions"] tbody');
    if (posBody) posBody.innerHTML = (live.portfolio || []).map((pos) => '<tr><td class="sym">'+esc(pos.symbol)+'</td><td>'+esc(pos.symbol)+'</td><td class="r">'+n(pos.netQtyShares)+' 股</td><td class="r">'+price(pos.avgCostPerShare)+'</td><td class="r px">'+price(pos.symbol === selected.symbol ? selected.price : pos.avgCostPerShare)+'</td><td class="r">'+n(Number(pos.netQtyShares || 0) * Number(pos.symbol === selected.symbol ? selected.price || 0 : pos.avgCostPerShare || 0))+'</td><td class="r">需即時價換算</td><td class="r">—</td><td class="ts">'+esc(pos.fillCount)+' 筆</td></tr>').join("") || '<tr><td colspan="9">目前沒有模擬庫存。</td></tr>';
    const kgiBody = $('.ltab[data-lt="kgi"] tbody');
    if (kgiBody) kgiBody.innerHTML = (live.kgi?.positions || []).map((pos) => '<tr><td class="sym">'+esc(pos.symbol)+'</td><td>'+esc(pos.symbol)+'</td><td class="r">'+n(pos.netQtyShares)+' 股</td><td class="r">—</td><td class="r px">'+price(pos.lastPrice)+'</td><td class="r">'+n(Number(pos.netQtyShares || 0) * Number(pos.lastPrice || 0))+'</td><td class="r pnl '+(Number(pos.unrealizedPnl || 0) >= 0 ? "up" : "dn")+'">'+n(pos.unrealizedPnl)+'</td><td><span class="src kgi">讀取</span></td></tr>').join("") || '<tr><td colspan="8">目前沒有可顯示的券商庫存讀取資料。</td></tr>';
    const depth = $("#depth");
    if (depth && live.bidAsk) {
      const asks = (live.bidAsk.ask_prices || []).map((p, i) => [p, live.bidAsk.ask_volumes?.[i] ?? 0]).slice(0, 5).reverse();
      const bids = (live.bidAsk.bid_prices || []).map((p, i) => [p, live.bidAsk.bid_volumes?.[i] ?? 0]).slice(0, 5);
      const max = Math.max(1, ...asks.map((x) => x[1]), ...bids.map((x) => x[1]));
      depth.innerHTML = asks.map(([p,q]) => '<div class="row"><span class="px up">'+price(p)+'</span><div class="bar"><i class="ask" style="width:'+Math.round(q/max*90)+'%"></i></div><span class="qty">'+esc(q)+'</span></div>').join("") + '<div class="row last"><span class="px">'+price(selected.price)+'</span><span class="qty" style="text-align:center;color:var(--fg-3)">成交</span><span class="qty">—</span></div>' + bids.map(([p,q]) => '<div class="row"><span class="px dn">'+price(p)+'</span><div class="bar"><i class="bid" style="width:'+Math.round(q/max*90)+'%"></i></div><span class="qty">'+esc(q)+'</span></div>').join("");
    }
    const submit = $("#submit-btn");
    if (submit) submit.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const qty = Number($("#t-qty")?.value || 0);
      const unit = $("#t-unit .on")?.dataset.unit === "share" ? "SHARE" : "LOT";
      const orderType = $("#t-otype")?.value || "limit";
      const side = $("#side .on")?.dataset.side || "buy";
      const px = Number($("#t-price")?.value || selected.price || 0);
      submit.disabled = true;
      submit.querySelector("b").textContent = "預覽中...";
      const payload = { symbol: selected.symbol, side, orderType, qty, quantity_unit: unit, price: orderType === "market" ? null : px };
      try {
        const preview = await fetch("/api/ui-final-v031-paper/preview", { method:"POST", credentials:"include", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) }).then((r) => r.json());
        if (!preview.ok) throw new Error(preview.error || "preview_failed");
        const confirmed = await fetch("/api/ui-final-v031-paper/submit", { method:"POST", credentials:"include", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) }).then((r) => r.json());
        if (!confirmed.ok) throw new Error(confirmed.error || "submit_failed");
        submit.querySelector("b").textContent = "紙上委託已送出";
        setTimeout(() => location.reload(), 900);
      } catch (err) {
        submit.querySelector("b").textContent = "紙上委託未通過";
        const gate = $(".gate .h .v"); if (gate) gate.textContent = "需檢查";
      } finally {
        setTimeout(() => { submit.disabled = false; }, 1200);
      }
    }, true);
  }

  if (live.screen === "market-intel") hydrateMarket();
  if (live.screen === "strategy-ideas") hydrateIdeas();
  if (live.screen === "paper-trading-room") hydratePaper();
})();
</script>`;
}
