const knownEnglishCopy: Array<{ pattern: RegExp; text: string }> = [
  {
    pattern: /silicon wafer supply tightens|globalwafers expects price recovery/i,
    text: "矽晶圓供給吃緊，SiC 與 AI 基板需求回溫；來源指出環球晶預期下半年庫存去化加快。",
  },
  {
    pattern: /tsmc kumamoto phase 2|arizona n2/i,
    text: "台積電熊本二期與亞利桑那 N2 進度維持；產能擴充支撐長期營收能見度。",
  },
  {
    pattern: /ai cowos demand drives tsmc n3/i,
    text: "AI CoWoS 需求推升台積電 N3 產能利用率，先進封裝訂單能見度延續。",
  },
  {
    pattern: /ai server demand drives tsmc advanced node/i,
    text: "AI 伺服器需求帶動台積電先進製程利用率維持高檔。",
  },
  {
    pattern: /聯亞 eml laser yield improvement|eml laser yield improvement/i,
    text: "聯亞 EML 雷射良率改善至 68%。",
  },
  {
    pattern: /co-packaged optics .* next bottleneck|silicon photonics capacity/i,
    text: "CPO 共同封裝光學可能成為 AI 資料中心擴張的下一個瓶頸；台積電與封測供應鏈的矽光子產能值得追蹤。",
  },
  {
    pattern: /audit verification theme/i,
    text: "內部稽核主題；保留來源軌跡，不作自動交易判讀。",
  },
  {
    pattern: /high bandwidth memory/i,
    text: "HBM 高頻寬記憶體；追蹤 AI 加速器與先進封裝供應鏈。",
  },
  {
    pattern: /ajinomoto build-up film/i,
    text: "ABF 載板與高階 IC 封裝基板供應鏈。",
  },
];

const knownTradePlanCopy: Array<{ pattern: RegExp; text: string }> = [
  {
    pattern: /^.*buy\s+([\w.]+)\s+at\s+([0-9]+(?:\.[0-9]+)?(?:-[0-9]+(?:\.[0-9]+)?)?)\s+on pullback to\s+([0-9]+)ma.*scale in\s+([0-9/]+).*$/i,
    text: "買進 $1；參考區間 $2；回測至 $3 日均線附近時分批 $4 建立部位。",
  },
  {
    pattern: /^.*hit t1 at\s+([0-9]+(?:\.[0-9]+)?).*sold\s+([0-9/]+)\s+position.*breakeven stop.*$/i,
    text: "達成第一目標價 $1；已賣出 $2 部位；剩餘部位以損益兩平停利停損管理。",
  },
];

export function hasCorruptText(value: string | null | undefined) {
  if (!value) return false;
  return /�|Ã|Â|undefined|null/i.test(value);
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
    .replace(/\bAudit Trail Live Check\b/g, "稽核軌跡檢查")
    .replace(/\bAudit Trail\b/gi, "稽核軌跡")
    .replace(/\bAudit verification theme\b/gi, "稽核驗證題材")
    .replace(/\bAI Optics\s*\(->\s*CPO\)/g, "AI 光通訊 / CPO")
    .replace(/\bAI Optics\b/g, "AI 光通訊")
    .replace(/\bBalanced\b/g, "平衡")
    .replace(/\bBROKEN\b/g, "待修")
    .replace(/\bDEPRECATED\b/gi, "退役");
}

export function cleanExternalHeadline(
  value: string | null | undefined,
  fallback = "內容尚未完成中文整理；保留來源紀錄，不納入正式判讀。"
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
  const replaced = replaceKnownSourceTerms(raw);
  if (replaced !== raw) return replaced;
  return cleanExternalHeadline(raw, fallback);
}

export function cleanTradePlanText(
  value: string | null | undefined,
  fallback = "交易紀錄尚未完成中文整理；保留來源紀錄，不自動轉單。"
) {
  const raw = value?.trim();
  if (!raw || hasCorruptText(raw)) return fallback;
  for (const item of knownTradePlanCopy) {
    if (item.pattern.test(raw)) return raw.replace(item.pattern, item.text);
  }
  return cleanExternalHeadline(raw, fallback);
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
    "orphan-audit-trail": "內部稽核軌跡檢查；目前只作資料品質與治理追蹤，不作交易判讀。",
    "orphan-ai-optics": "AI 光通訊與 CPO 封裝題材；等待來源主檔補齊後再納入正式主題判讀。",
    "5g": "5G 通訊與基地台供應鏈；目前主題資料尚未補齊正式投資論點。",
    abf: "ABF 載板與高階 IC 封裝基板供應鏈。",
    ai: "AI 訓練與推論伺服器供應鏈，從晶片到系統組裝成熟。",
    apple: "蘋果公司台灣供應鏈成員。",
    cowos: "台積電 CoWoS 先進封裝與 AI 晶片供應鏈。",
    cpo: "CPO 光通訊與共同封裝光學供應鏈。",
    euv: "先進製程關鍵微影設備與材料供應鏈。",
    hbm: "HBM 高頻寬記憶體與 AI 加速器供應鏈。",
  };
  if (bySlug[key]) return bySlug[key];
  return cleanNarrativeText(thesis, "主題說明待整理；目前保留來源主檔與公司池，不作自動解讀。");
}
