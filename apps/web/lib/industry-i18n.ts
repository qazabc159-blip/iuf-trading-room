// Yahoo Finance 風格產業英文 → 繁中對照。
// My-TW-Coverage 的 industry 欄位是英文，前端顯示時套這個表；
// 未命中的保留原文（fallback safe）。

const INDUSTRY_LABEL: Record<string, string> = {
  // Semiconductors / Electronics
  "Semiconductors": "半導體",
  "Semiconductor Equipment & Materials": "半導體設備/材料",
  "Electronic Components": "電子零組件",
  "Electronics & Computer Distribution": "電子通路",
  "Consumer Electronics": "消費電子",
  "Scientific & Technical Instruments": "科學/測量儀器",

  // Computer / Hardware
  "Computer Hardware": "電腦硬體",
  "Communication Equipment": "通訊設備",
  "Information Technology Services": "資訊服務",
  "Software - Application": "應用軟體",
  "Software - Infrastructure": "基礎軟體",
  "Internet Content & Information": "網路內容",
  "Internet Retail": "電商",

  // Industrial / Machinery
  "Specialty Industrial Machinery": "特用機械",
  "Industrial Distribution": "工業通路",
  "Electrical Equipment & Parts": "電機設備/零件",
  "Metal Fabrication": "金屬加工",
  "Tools & Accessories": "工具/配件",
  "Business Equipment & Supplies": "商用設備",
  "Engineering & Construction": "工程/營建",
  "Pollution & Treatment Controls": "汙染/廢處理",
  "Security & Protection Services": "安全防護",

  // Chemicals / Materials
  "Specialty Chemicals": "特用化學",
  "Chemicals": "化學",
  "Building Materials": "建材",
  "Building Products & Equipment": "建築產品/設備",
  "Paper & Paper Products": "紙/紙製品",
  "Steel": "鋼鐵",
  "Copper": "銅",
  "Silver": "銀",
  "Aluminum": "鋁",
  "Gold": "黃金",
  "Other Industrial Metals & Mining": "其他工業金屬",

  // Auto / Transport
  "Auto Manufacturers": "汽車整車",
  "Auto Parts": "汽車零件",
  "Auto & Truck Dealerships": "汽車經銷",
  "Airlines": "航空",
  "Marine Shipping": "航運",
  "Integrated Freight & Logistics": "物流",
  "Railroads": "鐵路",
  "Trucking": "貨運",

  // Energy / Utilities
  "Solar": "太陽能",
  "Oil & Gas E&P": "油氣上游",
  "Oil & Gas Equipment & Services": "油氣設備/服務",
  "Oil & Gas Refining & Marketing": "煉油/油品行銷",
  "Oil & Gas Midstream": "油氣中游",
  "Oil & Gas Integrated": "油氣整合",
  "Thermal Coal": "動力煤",
  "Uranium": "鈾",
  "Utilities - Regulated Electric": "電力公用",
  "Utilities - Renewable": "再生能源",

  // Health / Medical
  "Medical Devices": "醫療器材",
  "Medical Instruments & Supplies": "醫療儀器/耗材",
  "Medical Distribution": "醫療通路",
  "Medical Care Facilities": "醫療服務",
  "Diagnostics & Research": "診斷/研究",
  "Biotechnology": "生技",
  "Drug Manufacturers - General": "藥廠（大型）",
  "Drug Manufacturers - Specialty & Generic": "藥廠（特用/學名）",
  "Pharmaceutical Retailers": "藥品零售",

  // Consumer
  "Apparel Manufacturing": "成衣",
  "Apparel Retail": "服飾零售",
  "Footwear & Accessories": "鞋類/配件",
  "Textile Manufacturing": "紡織",
  "Packaged Foods": "食品加工",
  "Beverages - Non-Alcoholic": "飲料（非酒精）",
  "Beverages - Wineries & Distilleries": "酒類",
  "Tobacco": "菸草",
  "Farm Products": "農產品",
  "Agricultural Inputs": "農用原料",
  "Food Distribution": "食品通路",
  "Grocery Stores": "食品零售",
  "Restaurants": "餐飲",
  "Specialty Retail": "特殊零售",
  "Discount Stores": "量販折扣",
  "Luxury Goods": "精品",
  "Household & Personal Products": "家用/個人用品",
  "Furnishings": "家具/居家",
  "Leisure": "休閒用品",
  "Personal Services": "個人服務",
  "Travel Services": "旅遊服務",
  "Lodging": "住宿/旅館",
  "Gambling": "博弈",
  "Entertainment": "娛樂",
  "Publishing": "出版",
  "Electronic Gaming & Multimedia": "遊戲/多媒體",

  // Financial
  "Banks - Diversified": "綜合銀行",
  "Banks - Regional": "區域銀行",
  "Asset Management": "資產管理",
  "Credit Services": "信貸服務",
  "Insurance - Life": "壽險",
  "Insurance - Property & Casualty": "產險",
  "Insurance - Diversified": "綜合保險",

  // Real Estate
  "Real Estate - Development": "不動產開發",
  "Real Estate - Services": "不動產服務",
  "Real Estate - Diversified": "綜合不動產",
  "Residential Construction": "住宅營建",

  // Services
  "Rental & Leasing Services": "租賃服務",
  "Staffing & Employment Services": "人力派遣",
  "Specialty Business Services": "特殊商業服務",
  "Telecom Services": "電信服務",
  "Waste Management": "廢棄物處理",

  // Other
  "Aerospace & Defense": "航太國防",
  "Packaging & Containers": "包材/容器",
  "Shell Companies": "空殼公司",

  // Unknown / placeholder
  "Unknown": "未分類",
  "": "未分類"
};

export function industryLabel(raw: string | null | undefined): string {
  if (!raw) return "未分類";
  return INDUSTRY_LABEL[raw] ?? raw;
}

export const INDUSTRY_LABEL_MAP = INDUSTRY_LABEL;
