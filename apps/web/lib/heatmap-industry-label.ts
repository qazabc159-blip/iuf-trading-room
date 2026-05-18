import { industryLabel } from "./industry-i18n";

const HEATMAP_INDUSTRY_LABELS: Record<string, string> = {
  semiconductors: "半導體",
  semiconductor: "半導體",
  "semiconductor equipment & materials": "半導體設備與材料",
  "electronic components": "電子零組件",
  "electronics & computer distribution": "電子通路",
  "consumer electronics": "消費電子",
  "computer hardware": "電腦及週邊設備",
  "communication equipment": "通信網路",
  "telecom services": "通信網路",
  banks: "金融保險",
  "banks - diversified": "金融保險",
  "banks - regional": "金融保險",
  "capital markets": "金融保險",
  "asset management": "金融保險",
  "insurance - life": "金融保險",
  "insurance - property & casualty": "金融保險",
  steel: "鋼鐵工業",
  "specialty chemicals": "化學工業",
  chemicals: "化學工業",
  "auto parts": "車用與汽車零組件",
  biotechnology: "生技醫療",
  "medical devices": "生技醫療",
  "real estate": "建材營造",
  construction: "建材營造",
  "building materials": "建材營造",
  "packaged foods": "食品工業",
  "textile manufacturing": "紡織纖維",
  "shipping & ports": "航運業",
  "marine shipping": "航運業",
  airlines: "航運業",
};

const ASCII_LABEL = /^[\x00-\x7F]+$/;

function normalizedKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function heatmapIndustryLabel(raw: string | null | undefined): string {
  const value = raw?.trim();
  if (!value) return "其他產業";

  const direct = HEATMAP_INDUSTRY_LABELS[normalizedKey(value)];
  if (direct) return direct;

  const canonical = industryLabel(value).trim();
  if (canonical && canonical !== value && !ASCII_LABEL.test(canonical)) return canonical;

  const normalized = normalizedKey(value);
  if (normalized.includes("semiconductor")) return "半導體";
  if (normalized.includes("computer") || normalized.includes("hardware")) return "電腦及週邊設備";
  if (normalized.includes("bank") || normalized.includes("financial") || normalized.includes("insurance")) return "金融保險";
  if (normalized.includes("electronic")) return "電子類股";
  if (normalized.includes("communication") || normalized.includes("telecom") || normalized.includes("network")) return "通信網路";
  if (normalized.includes("steel")) return "鋼鐵工業";
  if (normalized.includes("chemical")) return "化學工業";
  if (normalized.includes("shipping") || normalized.includes("marine") || normalized.includes("airline")) return "航運業";
  if (normalized.includes("auto") || normalized.includes("vehicle")) return "車用與汽車零組件";
  if (normalized.includes("biotech") || normalized.includes("medical")) return "生技醫療";
  if (normalized.includes("real estate") || normalized.includes("construction")) return "建材營造";

  return ASCII_LABEL.test(value) ? "其他產業" : value;
}
