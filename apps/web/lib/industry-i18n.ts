// Yahoo Finance 風格產業英文 → 繁中對照。
// My-TW-Coverage 的 industry 欄位是英文，前端顯示時套這個表；
// 未命中的保留原文（fallback safe）。

const INDUSTRY_LABEL: Record<string, string> = {
  // Internal slugs from our company master data.
  "building-materials": "建材",
  "semiconductors": "半導體",
  "electronics": "電子",
  "finance": "金融",
  "shipping": "航運",
  "steel": "鋼鐵",
  "plastics": "塑化",
  "biotech": "生技醫療",
  "materials": "原物料",
  "Materials": "原物料",

  // Semiconductors / Electronics
  "Semiconductors": "半導體",
  "Semiconductor Equipment & Materials": "半導體設備/材料",
  "Semiconductor Equipment": "半導體設備",
  "Semiconductor Materials": "半導體材料",
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
  "Electronics Distribution": "電子通路",
  "Other Electronics": "其他電子",
  "Optical Components": "光學元件",
  "EML laser chip maker": "EML 雷射晶片",
  "Electronic Components -> Utilities": "電子零組件 → 公用事業",
  "Industrial Computing": "工業電腦",

  // Industrial / Machinery
  "Specialty Industrial Machinery": "特用機械",
  "Industrial Distribution": "工業通路",
  "Electrical Equipment & Parts": "電機設備/零件",
  "Metal Fabrication": "金屬加工",
  "[[Meta]]l Fabrication": "金屬加工",
  "Tools & Accessories": "工具/配件",
  "Business Equipment & Supplies": "商用設備",
  "Engineering & Construction": "工程/營建",
  "Pollution & Treatment Controls": "汙染/廢處理",
  "Security & Protection Services": "安全防護",
  "Ground Transportation": "陸路運輸",
  "Conglomerates": "綜合企業",
  "Consulting Services": "顧問服務",

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
  "Other Industrial [[Meta]]ls & Mining": "其他工業金屬",
  "Lumber & Wood Production": "木材/木製品",

  // Auto / Transport
  "Auto Manufacturers": "汽車整車",
  "Auto Parts": "汽車零件",
  "Auto & Truck Dealerships": "汽車經銷",
  "Airlines": "航空",
  "Marine Shipping": "航運",
  "Integrated Freight & Logistics": "物流",
  "Railroads": "鐵路",
  "Trucking": "貨運",
  "Recreational Vehicles": "休旅車/露營車",

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
  "Utilities - Regulated Gas": "天然氣公用",
  "Utilities - Regulated Water": "水務公用",
  "Utilities - Renewable": "再生能源",

  // Health / Medical
  "Health Information Services": "醫療資訊服務",
  "Biotech - Therapeutics": "生技治療",
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
  "Furnishings, Fixtures & Appliances": "家具/裝修/家電",
  "Leisure": "休閒用品",
  "Personal Services": "個人服務",
  "Travel Services": "旅遊服務",
  "Lodging": "住宿/旅館",
  "Gambling": "博弈",
  "Entertainment": "娛樂",
  "Publishing": "出版",
  "Electronic Gaming & Multimedia": "遊戲/多媒體",
  "Advertising Agencies": "廣告代理",
  "Broadcasting": "廣播電視",
  "Department Stores": "百貨零售",
  "Education & Training Services": "教育訓練",
  "Home Improvement Retail": "居家修繕零售",

  // Financial
  "Banks": "銀行",
  "Banks - Diversified": "綜合銀行",
  "Banks - Regional": "區域銀行",
  "Asset Management": "資產管理",
  "Capital Markets": "資本市場",
  "Credit Services": "信貸服務",
  "Insurance - Life": "壽險",
  "Insurance - Property & Casualty": "產險",
  "Insurance - Diversified": "綜合保險",
  "Insurance - Reinsurance": "再保險",
  "Insurance Brokers": "保險經紀",
  "Financial Conglomerates": "金融控股/綜合金融",

  // Real Estate
  "Real Estate - Development": "不動產開發",
  "Real Estate - Services": "不動產服務",
  "Real Estate Services": "不動產服務",
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
  "Aerospace Defense": "航太國防",
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
