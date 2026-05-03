const knownEnglishCopy: Array<{ pattern: RegExp; text: string }> = [
  {
    pattern: /silicon wafer supply tightens|globalwafers expects price recovery/i,
    text: "矽晶圓供給轉緊，SiC 與 AI 基板需求回溫，環球晶庫存去化速度優於預期。",
  },
  {
    pattern: /tsmc kumamoto phase 2|arizona n2/i,
    text: "台積電熊本二期與亞利桑那 N2 進度延續，先進製程擴產支撐長期營收能見度。",
  },
  {
    pattern: /ai cowos demand drives tsmc n3/i,
    text: "AI 與 CoWoS 需求推升台積電 N3 利用率，先進封裝與晶圓代工仍是主軸。",
  },
  {
    pattern: /ai server demand drives tsmc advanced node/i,
    text: "AI 伺服器需求支撐台積電先進節點稼動率，需同步觀察估值與資金面。",
  },
  {
    pattern: /eml laser yield improvement/i,
    text: "聯亞 EML 雷射良率改善，後續需觀察量產穩定度與客戶拉貨。",
  },
  {
    pattern: /co-packaged optics .* next bottleneck|silicon photonics capacity/i,
    text: "CPO 與矽光子成為 AI 資料中心擴張瓶頸，台廠供應鏈可追蹤但仍需驗證。",
  },
  {
    pattern: /audit verification theme/i,
    text: "稽核驗證主題，用於追蹤資料品質與操作紀錄，不納入投資判斷。",
  },
  {
    pattern: /high bandwidth memory/i,
    text: "HBM 受 AI 伺服器需求帶動，供應鏈需同時觀察價格、產能與客戶集中度。",
  },
  {
    pattern: /ajinomoto build-up film/i,
    text: "ABF 載板為高階 IC 封裝材料，需觀察 AI、伺服器與庫存循環。",
  },
];

const knownTradePlanCopy: Array<{ pattern: RegExp; text: string }> = [
  {
    pattern: /^.*buy\s+([\w.]+)\s+at\s+([0-9]+(?:\.[0-9]+)?(?:-[0-9]+(?:\.[0-9]+)?)?)\s+on pullback to\s+([0-9]+)ma.*scale in\s+([0-9/]+).*$/i,
    text: "買進 $1；參考區間 $2；回測至 $3 日均線附近時分批 $4 建立部位。",
  },
  {
    pattern: /^.*hit t1 at\s+([0-9]+(?:\.[0-9]+)?).*sold\s+([0-9/]+)\s+position.*breakeven stop.*$/i,
    text: "已觸及第一目標 $1；賣出 $2 部位；其餘部位以損益兩平作為停損參考。",
  },
];

const corruptMarkers = /�|Ã|Â|嚙|undefined|null/i;

export function hasCorruptText(value: string | null | undefined) {
  if (!value) return false;
  return corruptMarkers.test(value);
}

export function isEnglishHeavy(value: string | null | undefined) {
  if (!value) return false;
  const latin = value.match(/[A-Za-z]/g)?.length ?? 0;
  const cjk = value.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return latin >= 16 && latin > Math.max(8, cjk * 2);
}

function applyKnownCopy(value: string) {
  for (const item of knownEnglishCopy) {
    if (item.pattern.test(value)) return item.text;
  }
  return null;
}

function replaceKnownSourceTerms(value: string) {
  return value
    .replace(/\bAudit Trail Live Check\b/g, "稽核軌跡即時檢查")
    .replace(/\bAudit Trail\b/gi, "稽核軌跡")
    .replace(/\bAudit verification theme\b/gi, "稽核驗證主題")
    .replace(/\bAI Optics\s*\(->\s*CPO\)/g, "AI 光通訊與 CPO")
    .replace(/\bAI Optics\b/g, "AI 光通訊")
    .replace(/\bBalanced\b/g, "平衡")
    .replace(/\bBROKEN\b/g, "待修")
    .replace(/\bDEPRECATED\b/gi, "退役");
}

export function cleanExternalHeadline(
  value: string | null | undefined,
  fallback = "消息文字尚未完成中文整理；保留來源紀錄，不納入正式判讀。"
) {
  const raw = value?.trim();
  if (!raw || hasCorruptText(raw)) return fallback;
  const known = applyKnownCopy(raw);
  if (known) return known;
  const replaced = replaceKnownSourceTerms(raw);
  if (replaced !== raw) return replaced;
  if (isEnglishHeavy(raw)) return fallback;
  return raw;
}

export function cleanNarrativeText(
  value: string | null | undefined,
  fallback = "段落尚未完成中文整理；保留來源紀錄，不納入正式判讀。"
) {
  const raw = value?.trim();
  if (!raw || hasCorruptText(raw)) return fallback;
  const known = applyKnownCopy(raw);
  if (known) return known;
  const replaced = replaceKnownSourceTerms(raw);
  if (replaced !== raw) return replaced;
  if (isEnglishHeavy(raw)) return fallback;
  return raw;
}

export function cleanTradePlanText(
  value: string | null | undefined,
  fallback = "交易計畫文字尚未完成中文整理；保留來源紀錄，不自動轉為委託。"
) {
  const raw = value?.trim();
  if (!raw || hasCorruptText(raw)) return fallback;
  for (const item of knownTradePlanCopy) {
    if (item.pattern.test(raw)) return raw.replace(item.pattern, item.text);
  }
  return cleanNarrativeText(raw, fallback);
}

export function cleanRiskRewardText(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw || hasCorruptText(raw)) return "--";
  const match = raw.match(/risk\s*([0-9.]+%?)\s*\/\s*reward\s*([0-9.]+%?)\s*=\s*([0-9.]+:1)/i);
  if (match) return `風險 ${match[1]} / 報酬 ${match[2]} / 風報比 ${match[3]}`;
  return cleanNarrativeText(raw, "--");
}

export function cleanThemeThesis(slug: string | null | undefined, thesis: string | null | undefined) {
  const key = slug?.toLowerCase() ?? "";
  const bySlug: Record<string, string> = {
    "orphan-audit-trail": "稽核軌跡檢查主題，保留作為資料品質與流程驗證，不納入正式選股判讀。",
    "orphan-ai-optics": "AI 光通訊與 CPO 供應鏈仍有結構性需求，但需等待資料驗證後才納入正式主題。",
    "5g": "5G 相關供應鏈以通訊設備、射頻與基礎建設為主，後續需補齊公司池與資料來源。",
    abf: "ABF 載板受高階封裝與伺服器需求影響，需觀察庫存循環與報價回升。",
    ai: "AI 伺服器與加速運算供應鏈仍是台股主軸，需分辨基本面與短線情緒。",
    apple: "蘋果供應鏈需觀察新品週期、庫存與匯率影響。",
    cowos: "CoWoS 先進封裝產能仍是 AI 供應鏈重點，需追蹤擴產與交期變化。",
    cpo: "CPO 與矽光子是高速傳輸瓶頸題材，需等待公司資料與訂單驗證。",
    euv: "EUV 與先進製程設備供應鏈需觀察台積電資本支出節奏。",
    hbm: "HBM 高頻寬記憶體受 AI 伺服器需求帶動，需追蹤價格、產能與客戶集中度。",
  };
  if (bySlug[key]) return bySlug[key];
  return cleanNarrativeText(thesis, "主題說明待整理；目前保留來源主檔與公司池，不作自動解讀。");
}
