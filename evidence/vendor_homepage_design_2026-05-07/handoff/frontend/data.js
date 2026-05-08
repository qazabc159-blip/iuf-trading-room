// IUF 戰情台 — 共用模擬資料(只在 UI 層,不假裝是 live API)
// 所有 timestamp 以 2026-05-06 20:51 (台北) 為基準

// 台股報價 — 為 v3 跑馬燈使用 · 因「市場資料」狀態為 EMPTY,所有報價標示為「示意值」
window.IUF_QUOTES = {
  sourceState: "empty",
  sourceLabel: "市場資料 · 無資料 / 顯示為示意",
  indices: [
    { sym: "TWII",   name: "加權指數",   price: 22847.32, chg: -132.45, pct: -0.58 },
    { sym: "OTC",    name: "櫃買指數",    price: 270.18,   chg: -1.92,   pct: -0.71 },
    { sym: "TX",     name: "台指期",      price: 22810,    chg: -150,    pct: -0.65 },
    { sym: "USDTWD", name: "美元台幣",    price: 32.485,   chg: 0.012,   pct: 0.04 },
    { sym: "VIX",    name: "VIX",        price: 18.42,    chg: 0.93,    pct: 5.32 },
  ],
  flows: [
    { sym: "外資",  name: "外資買賣超", price: -8842, unit: "百萬" },
    { sym: "投信",  name: "投信買賣超", price: 412,   unit: "百萬" },
    { sym: "自營",  name: "自營買賣超", price: -1290, unit: "百萬" },
  ],
  stocks: [
    { sym: "2330", name: "台積電",   price: 1085,   chg: -10,   pct: -0.91 },
    { sym: "2317", name: "鴻海",     price: 207.5,  chg: 1.5,   pct: 0.73 },
    { sym: "2454", name: "聯發科",   price: 1340,   chg: -20,   pct: -1.47 },
    { sym: "2308", name: "台達電",   price: 412,    chg: 4,     pct: 0.98 },
    { sym: "2412", name: "中華電",   price: 124.5,  chg: 0,     pct: 0 },
    { sym: "2882", name: "國泰金",   price: 68.9,   chg: -0.4,  pct: -0.58 },
    { sym: "2881", name: "富邦金",   price: 92.6,   chg: -0.8,  pct: -0.86 },
    { sym: "2603", name: "長榮",     price: 218,    chg: 3.5,   pct: 1.63 },
    { sym: "3034", name: "聯詠",     price: 615,    chg: -5,    pct: -0.81 },
    { sym: "3008", name: "大立光",   price: 2210,   chg: -25,   pct: -1.12 },
    { sym: "1301", name: "台塑",     price: 67.8,   chg: -0.5,  pct: -0.73 },
    { sym: "0050", name: "元大台灣50", price: 215.3, chg: -1.2,  pct: -0.55 },
    { sym: "00878", name: "國泰永續高股息", price: 23.45, chg: 0.05, pct: 0.21 },
    { sym: "2002", name: "中鋼",     price: 22.1,   chg: -0.15, pct: -0.67 },
    { sym: "2891", name: "中信金",   price: 36.4,   chg: -0.2,  pct: -0.55 },
    { sym: "2303", name: "聯電",     price: 47.85,  chg: -0.4,  pct: -0.83 },
    { sym: "2382", name: "廣達",     price: 305,    chg: 4.5,   pct: 1.50 },
    { sym: "3231", name: "緯創",     price: 119,    chg: 2.5,   pct: 2.14 },
  ],
};

window.IUF_HEATMAP = [
  { sym: "2330", name: "台積電",   pct: -0.91, mcap: 28140 },
  { sym: "2317", name: "鴻海",     pct: 0.73,  mcap: 2880 },
  { sym: "2454", name: "聯發科",   pct: -1.47, mcap: 2150 },
  { sym: "2412", name: "中華電",   pct: 0,     mcap: 965 },
  { sym: "2882", name: "國泰金",   pct: -0.58, mcap: 940 },
  { sym: "2308", name: "台達電",   pct: 0.98,  mcap: 1075 },
  { sym: "2881", name: "富邦金",   pct: -0.86, mcap: 935 },
  { sym: "1303", name: "南亞",     pct: -0.41, mcap: 480 },
  { sym: "1301", name: "台塑",     pct: -0.73, mcap: 432 },
  { sym: "2891", name: "中信金",   pct: -0.55, mcap: 720 },
  { sym: "2303", name: "聯電",     pct: -0.83, mcap: 595 },
  { sym: "2603", name: "長榮",     pct: 1.63,  mcap: 460 },
  { sym: "3008", name: "大立光",   pct: -1.12, mcap: 295 },
  { sym: "3034", name: "聯詠",     pct: -0.81, mcap: 374 },
  { sym: "2002", name: "中鋼",     pct: -0.67, mcap: 348 },
  { sym: "2884", name: "玉山金",   pct: -0.39, mcap: 410 },
  { sym: "2886", name: "兆豐金",   pct: -0.25, mcap: 590 },
  { sym: "1216", name: "統一",     pct: 0.32,  mcap: 462 },
  { sym: "2207", name: "和泰車",   pct: -0.55, mcap: 345 },
  { sym: "3711", name: "日月光",   pct: -1.22, mcap: 605 },
  { sym: "2887", name: "台新金",   pct: -0.44, mcap: 285 },
  { sym: "2885", name: "元大金",   pct: -0.31, mcap: 350 },
  { sym: "1101", name: "台泥",     pct: -0.91, mcap: 232 },
  { sym: "2357", name: "華碩",     pct: 0.78,  mcap: 358 },
  { sym: "2382", name: "廣達",     pct: 1.50,  mcap: 1180 },
  { sym: "2379", name: "瑞昱",     pct: -0.62, mcap: 290 },
  { sym: "3231", name: "緯創",     pct: 2.14,  mcap: 348 },
  { sym: "1326", name: "台化",     pct: -0.48, mcap: 210 },
  { sym: "5880", name: "合庫金",   pct: 0.18,  mcap: 365 },
  { sym: "2880", name: "華南金",   pct: -0.52, mcap: 280 },
];

window.IUF_TWII_INTRADAY = (() => {
  const arr = [22980];
  for (let i = 1; i < 60; i++) arr.push(arr[i-1] + (Math.random() - 0.55) * 18);
  arr.push(22847.32);
  return arr;
})();

window.IUF_BREADTH = { up: 412, flat: 87, down: 1148, total: 1647 };

window.IUF_AGENDA = [
  { time: "09:00", label: "開盤",          state: "done" },
  { time: "10:30", label: "FinMind 抓批",  state: "done" },
  { time: "13:30", label: "收盤",          state: "done" },
  { time: "14:30", label: "策略候選掃描",   state: "done" },
  { time: "15:00", label: "OpenAlice 簡報", state: "doing" },
  { time: "17:00", label: "Audit 對帳",    state: "todo" },
  { time: "20:51", label: "現在",          state: "now" },
  { time: "23:30", label: "次日計畫鎖定",   state: "todo" },
];

window.IUF_DATA = {
  meta: {
    operator: "IUF-01",
    mode: "模擬模式 / 風控守門",
    market: "盤面 / 真實資料",
    nowText: "2026/05/06 20:51:45 台北",
    formalOrder: { state: "blocked", reason: "KGI 正式下單仍鎖在 libCGCrypt.so 之外" },
  },

  // 7 個資料來源
  sources: [
    { key: "finmind",   name: "FinMind",     short: "FinMind",   desc: "台股日線 / 基本面",  status: "live",  updated: "05/06 20:51", note: "今日資料", staleness: 1, detail: "Sponsor 999 token 存在;6,000/小時 quota 中已使用 346 次。" },
    { key: "kline",     name: "K 線資料",     short: "K 線",      desc: "TaiwanStockPriceAdj", status: "live",  updated: "05/06 20:51", note: "今日資料", staleness: 1, detail: "今日 18 檔個股的還原日線已抓取完成,K 線可繪製。" },
    { key: "company",   name: "公司資料",     short: "公司",      desc: "個股基本 / 財報",   status: "live",  updated: "05/06 20:51", note: "今日資料", staleness: 1, detail: "公司基本資料、最新月營收與財報指標已更新。" },
    { key: "openalice", name: "OpenAlice",   short: "OpenAlice", desc: "每日簡報引擎",      status: "review", updated: "05/06 20:51", note: "AI 審核中", staleness: 1, detail: "Runner / Dispatcher healthy;Queue 608,但今日簡報尚未發布,等待 AI 審核完成。", cta: "開啟今日簡報 ›" },
    { key: "topic",     name: "主題資料",     short: "主題",      desc: "資料庫主題",         status: "stale", updated: "04/23 02:34", note: "過期 13 天", days: 13, staleness: 13*1440, detail: "資料庫主題上一次回灌為 04/23 02:34,已過期 13 天,不放入今日戰情判讀。下一步:重跑主題回灌批次。", cta: "查看主題板 ›" },
    { key: "strategy",  name: "策略想法",     short: "策略",      desc: "策略候選池",         status: "live",  updated: "05/06 20:51", note: "今日資料", staleness: 1, detail: "策略候選池只顯示候選,不等於下單建議。今日有 5 檔候選,中性訊號為主。" },
    { key: "signal",    name: "訊號證據",     short: "訊號",      desc: "內部測試訊號",       status: "stale", updated: "04/21 12:03", note: "過期 15 天", days: 15, staleness: 15*1440, detail: "內部測試訊號上一次更新為 04/21 12:03,已過期 15 天,不放入今日戰情判讀。" },
    { key: "news",      name: "重大訊息",     short: "重大訊息",   desc: "公開資訊觀測",       status: "empty", updated: "—",          note: "尚未接入", staleness: 21600, detail: "公開資訊觀測 (MOPS) 來源尚未接入,目前無法顯示重大訊息;首頁不出現假資料。" },
  ],

  // FinMind 資料健康
  finmind: {
    sponsor: "Sponsor 999",
    tokenPresent: true,         // 存在,但「不顯示 token 值」
    quotaTotal: 6000,
    quotaUsed: 346,
    datasets: { ok: 0, downgraded: 4, blocked: 0 },
    recentRequest: { name: "TaiwanStockPriceAdj", at: "05/06 20:51", status: "ok" },
    requests: [
      { name: "TaiwanStockPriceAdj",       at: "05/06 20:51:38", ms: 412, ok: true },
      { name: "TaiwanStockInfo",            at: "05/06 20:51:21", ms: 287, ok: true },
      { name: "TaiwanStockMonthRevenue",    at: "05/06 20:50:55", ms: 631, ok: true },
      { name: "TaiwanStockShareholding",    at: "05/06 20:50:12", ms: 1902, ok: false, why: "降級:rate limit / 60s 後重試" },
      { name: "TaiwanStockHoldingSharesPer",at: "05/06 20:48:44", ms: 538, ok: true },
    ],
  },

  // OpenAlice 每日簡報
  openalice: {
    runner: "healthy",
    runnerHb: "05/06 20:51",
    dispatcher: "healthy",
    dispatcherScan: "05/06 20:51",
    queue: { queued: 608, running: 0, review: 0 },
    publishedToday: 0,
    sourceTrail: { complete: false, missing: ["主題資料(過期 13 天)", "訊號證據(過期 15 天)"] },
    aiReview: { state: "review", waiting: 0, note: "尚無待審 — 因 source trail 不完整,今日簡報未進入 AI 審核" },
    notice: "簡報屬於 source trail,不是投資建議",
    pipeline: [
      { id: 1, name: "資料拉取",   state: "ok",    note: "FinMind / 公司資料 已就緒" },
      { id: 2, name: "Source 拼接", state: "warn", note: "主題、訊號 過期,以「尚未可用」標示" },
      { id: 3, name: "草稿生成",   state: "wait",  note: "等待 source trail 補齊" },
      { id: 4, name: "AI 審核",    state: "wait",  note: "未啟動" },
      { id: 5, name: "已發布",     state: "wait",  note: "今日 0 則" },
    ],
  },

  // Paper E2E (六段)
  paperE2E: [
    { id: 1, name: "Preview",      desc: "委託預覽",       state: "ok",     count: 4,  note: "4 筆預覽就緒" },
    { id: 2, name: "Risk Check",   desc: "風控檢查",       state: "ok",     count: 4,  note: "全部通過 / 0 阻擋" },
    { id: 3, name: "Order Draft",  desc: "委託草稿",       state: "ok",     count: 2,  note: "2 筆待提交" },
    { id: 4, name: "Paper Submit", desc: "紙上送出",       state: "wait",   count: 0,  note: "等待操作員確認" },
    { id: 5, name: "Simulated Fill",desc: "模擬成交",      state: "idle",   count: 0,  note: "—" },
    { id: 6, name: "Audit Log",    desc: "稽核軌跡",       state: "ok",     count: 12, note: "今日 12 筆" },
  ],

  // Portfolio readiness
  portfolio: {
    cash: 1_000_000,
    positions: 0,
    readiness: "preview-only",   // 永不可推真實券商
    note: "紙上預覽,不連真實券商",
  },

  // 策略候選 (策略想法)
  strategyIdeas: [
    { sym: "3081.TW", name: "聯亞",     stance: "中性", confidence: 11.3, gate: "blocked", reason: "訊號證據過期" },
    { sym: "2330",    name: "台積電",   stance: "中性", confidence: 10.8, gate: "blocked", reason: "訊號證據過期" },
    { sym: "1438",    name: "三地開發", stance: "中性", confidence:  2.7, gate: "blocked", reason: "訊號證據過期" },
    { sym: "2250",    name: "IKKA-KY",  stance: "中性", confidence:  2.7, gate: "blocked", reason: "訊號證據過期" },
  ],

  // 今日交易工作流(動線)
  workflow: [
    { id: "w1", title: "查 2330 公司頁",     desc: "K 線、FinMind、紙上 preview 均已同頁", cta: "進入公司頁", state: "ok",    href: "#company/2330" },
    { id: "w2", title: "紙上交易投組",       desc: "preview / risk / order draft 就緒", cta: "開啟 Paper E2E", state: "ok", href: "#paper" },
    { id: "w3", title: "Portfolio readiness",desc: "預覽模式,不連真實券商",            cta: "查看部位",   state: "ok",    href: "#portfolio" },
    { id: "w4", title: "每日簡報",           desc: "等 OpenAlice source trail 補齊",     cta: "查看 trail", state: "wait",  href: "#openalice" },
    { id: "w5", title: "營運監控",           desc: "資料佇列與工作心跳",                 cta: "進入監控",   state: "ok",    href: "#ops" },
  ],

  // 待處理(尚未可用)
  blocked: [
    { name: "重大訊息",   why: "尚未接入公開資訊觀測站",       next: "等接入 + 排程", icon: "news" },
    { name: "訊號證據",   why: "內部測試訊號過期 15 天",        next: "等 ETL 重跑", icon: "signal" },
    { name: "量化研究",   why: "策略批次目前沒有產出紀錄",     next: "等待批次排程", icon: "lab" },
    { name: "正式下單",   why: "KGI 通道仍鎖在 libCGCrypt.so", next: "解鎖前永遠 BLOCKED", icon: "lock" },
  ],
};

// 狀態語意 → 顏色 / 中文
window.IUF_STATUS = {
  live:    { label: "LIVE",          zh: "正常",     cls: "live"    },
  empty:   { label: "EMPTY",         zh: "無資料",   cls: "empty"   },
  stale:   { label: "STALE",         zh: "過期",     cls: "stale"   },
  blocked: { label: "BLOCKED",       zh: "阻擋",     cls: "blocked" },
  error:   { label: "ERROR",         zh: "錯誤",     cls: "error"   },
  review:  { label: "AI_REVIEWING",  zh: "AI 審核中",cls: "review"  },
  missing: { label: "MISSING_SOURCE",zh: "缺少來源", cls: "missing" },
  ok:      { label: "OK",            zh: "通過",     cls: "live"    },
  warn:    { label: "WARN",          zh: "待補",     cls: "stale"   },
  wait:    { label: "WAIT",          zh: "等待中",   cls: "missing" },
  idle:    { label: "IDLE",          zh: "閒置",     cls: "empty"   },
};
