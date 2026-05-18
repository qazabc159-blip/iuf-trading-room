// =============================================================================
// TWSE Industry zh-TW label normalize utility
// Converts companies.chain_position (Yahoo Finance English) → zh-TW display label.
// Used by:
//   - /api/v1/market/heatmap/twse — tiles.industry
//   - /api/v1/market-data/overview — heatmap[].sector
// =============================================================================

export const TWSE_INDUSTRY_ZH_TW: Record<string, string> = {
  // zh-TW short-name aliases (already-Chinese inputs that need canonical long-form)
  "半導體": "半導體業",
  // Semiconductors / Electronics
  "semiconductors": "半導體業",
  "semiconductor": "半導體業",
  "semiconductor equipment & materials": "半導體設備與材料",
  "semiconductor equipment": "半導體設備",
  "foundry": "晶圓代工",
  "electronic components": "電子零組件",
  "electronics & computer distribution": "電子通路",
  "electronics distribution": "電子通路",
  "other electronics": "其他電子",
  "consumer electronics": "消費電子",
  "computer hardware": "電腦及週邊設備",
  "industrial computing": "工業電腦",
  "optical components": "光學元件",
  "scientific & technical instruments": "科學儀器",
  // Communications / Software
  "communication equipment": "通信網路",
  "telecom services": "通信網路",
  "information technology services": "資訊服務",
  "software - application": "應用軟體",
  "software - infrastructure": "基礎軟體",
  "internet content & information": "網路內容",
  "internet retail": "電商",
  // Financial
  "banks": "金融保險",
  "banks - diversified": "金融保險",
  "banks - regional": "金融保險",
  "capital markets": "金融保險",
  "asset management": "金融保險",
  "insurance - life": "金融保險",
  "insurance - property & casualty": "金融保險",
  "financial data & stock exchanges": "金融保險",
  // Industrial / Machinery
  "specialty industrial machinery": "特用機械",
  "industrial distribution": "工業通路",
  "electrical equipment & parts": "電機設備",
  "metal fabrication": "金屬加工",
  "tools & accessories": "工具配件",
  "engineering & construction": "工程營建",
  "pollution & treatment controls": "環保處理",
  "security & protection services": "安全防護",
  "ground transportation": "陸路運輸",
  "conglomerates": "綜合企業",
  "consulting services": "顧問服務",
  "business equipment & supplies": "商用設備",
  // Chemicals / Materials
  "steel": "鋼鐵工業",
  "specialty chemicals": "化學工業",
  "chemicals": "化學工業",
  "building materials": "建材營造",
  "building products & equipment": "建材營造",
  "paper & paper products": "紙類",
  "copper": "有色金屬",
  "aluminum": "有色金屬",
  "gold": "黃金",
  "other industrial metals & mining": "其他金屬",
  "lumber & wood production": "木材",
  // Auto / Transport
  "auto manufacturers": "汽車整車",
  "auto parts": "車用零組件",
  "auto & truck dealerships": "汽車經銷",
  // Biotech / Medical
  "biotechnology": "生技醫療",
  "medical devices": "生技醫療",
  "pharmaceuticals": "生技醫療",
  "drug manufacturers - general": "生技醫療",
  "drug manufacturers - specialty & generic": "生技醫療",
  "health information services": "生技醫療",
  // Real Estate / Construction
  "real estate": "建材營造",
  "real estate - development": "不動產開發",
  "real estate - services": "不動產服務",
  "real estate - diversified": "不動產",
  "residential construction": "住宅營建",
  "construction": "建材營造",
  // Consumer / Food
  "packaged foods": "食品工業",
  "food distribution": "食品工業",
  "beverages - non-alcoholic": "食品工業",
  "beverages - brewers": "食品工業",
  "household & personal products": "民生消費",
  "textile manufacturing": "紡織纖維",
  // Transport / Shipping
  "shipping & ports": "航運業",
  "marine shipping": "航運業",
  "airlines": "航運業",
  "airports & air services": "航運業",
  // Energy
  "oil & gas refining & marketing": "石化能源",
  "oil & gas integrated": "石化能源",
  "utilities - regulated electric": "電力公用",
  "utilities - regulated gas": "電力公用",
  "utilities - diversified": "電力公用",
  // Other
  "aerospace & defense": "航太國防",
  "packaging & containers": "包材容器",
  "rental & leasing services": "租賃服務",
  "staffing & employment services": "人力派遣",
  "specialty business services": "特殊商業",
  "waste management": "廢棄物處理",
  "leisure": "休閒娛樂",
  "entertainment": "休閒娛樂",
  "gambling": "休閒娛樂",
  "shell companies": "空殼公司",
};

/**
 * Normalize a raw industry/sector string (English from Yahoo Finance / chainPosition)
 * into zh-TW display label.
 *
 * Pass-through rule: if raw already contains non-ASCII (Chinese), return as-is.
 */
export function normalizeTwseIndustryZhTw(raw: string): string {
  if (!raw) return "其他產業";
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const direct = TWSE_INDUSTRY_ZH_TW[key];
  if (direct) return direct;
  // substring fallbacks for long/variant spellings
  if (key.includes("semiconductor")) return "半導體業";
  if (key.includes("computer") || key.includes("hardware")) return "電腦及週邊設備";
  if (key.includes("bank") || key.includes("insurance") || key.includes("financial")) return "金融保險";
  if (key.includes("electronic")) return "電子類股";
  if (key.includes("communication") || key.includes("telecom") || key.includes("network")) return "通信網路";
  if (key.includes("steel")) return "鋼鐵工業";
  if (key.includes("chemical")) return "化學工業";
  if (key.includes("shipping") || key.includes("marine") || key.includes("airline")) return "航運業";
  if (key.includes("auto") || key.includes("vehicle")) return "車用零組件";
  if (key.includes("biotech") || key.includes("medical") || key.includes("pharma")) return "生技醫療";
  if (key.includes("real estate") || key.includes("construction")) return "建材營造";
  if (key.includes("machinery")) return "機械設備";
  if (key.includes("textile")) return "紡織纖維";
  // If already Chinese (non-ASCII), return as-is
  if (/[^\x00-\x7F]/.test(raw)) return raw;
  return "其他產業";
}
