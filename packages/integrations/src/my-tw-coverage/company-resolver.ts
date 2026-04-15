import type { Company } from "@iuf-trading-room/contracts";

const CORPORATE_SUFFIXES = [
  "股份有限公司",
  "有限公司",
  "控股",
  "建材實業",
  "便利商店",
  "科技",
  "電子",
  "光電",
  "電信",
  "電機",
  "工業",
  "實業",
  "海運",
  "航運",
  "汽車",
  "鋼鐵",
  "塑膠",
  "石化",
  "精密",
  "資訊",
  "金控",
  "國際",
  "旅遊",
  "材料",
  "半導體",
  "電工",
  "化學",
  "製藥",
  "生醫",
  "集團"
] as const;

type IndexedCompany = {
  company: Company;
  normalizedName: string;
  canonicalName: string;
};

export type CompanyReferenceMatch = {
  company: Company;
  strategy: "ticker" | "exact_name" | "canonical_name" | "near_prefix";
};

export type CompanyReferenceIndex = {
  companies: IndexedCompany[];
  byTicker: Map<string, Company>;
  byExactName: Map<string, Company | null>;
  byCanonicalName: Map<string, Company | null>;
};

export function normalizeCompanyReferenceLabel(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/\[\[([^\]]+)\]\]/gu, "$1")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "");
}

export function stripCorporateSuffixes(value: string) {
  let current = value;
  let changed = true;

  while (changed) {
    changed = false;

    for (const suffix of CORPORATE_SUFFIXES) {
      const normalizedSuffix = normalizeCompanyReferenceLabel(suffix);
      if (
        normalizedSuffix &&
        current.endsWith(normalizedSuffix) &&
        current.length - normalizedSuffix.length >= 2
      ) {
        current = current.slice(0, current.length - normalizedSuffix.length);
        changed = true;
        break;
      }
    }
  }

  return current;
}

function extractTicker(value: string | undefined) {
  const match = (value ?? "").match(/\b\d{4}\b/u);
  return match ? match[0] : null;
}

function setUniqueCompany(map: Map<string, Company | null>, key: string, company: Company) {
  if (!key) {
    return;
  }

  const existing = map.get(key);
  if (!existing) {
    map.set(key, company);
    return;
  }

  if (existing.id !== company.id) {
    map.set(key, null);
  }
}

export function buildCompanyReferenceIndex(companies: Company[]): CompanyReferenceIndex {
  const byTicker = new Map<string, Company>();
  const byExactName = new Map<string, Company | null>();
  const byCanonicalName = new Map<string, Company | null>();

  const indexedCompanies = companies.map((company) => {
    const normalizedName = normalizeCompanyReferenceLabel(company.name);
    const canonicalName = stripCorporateSuffixes(normalizedName);

    byTicker.set(company.ticker, company);
    setUniqueCompany(byExactName, normalizedName, company);
    setUniqueCompany(byCanonicalName, canonicalName, company);

    return {
      company,
      normalizedName,
      canonicalName
    };
  });

  return {
    companies: indexedCompanies,
    byTicker,
    byExactName,
    byCanonicalName
  };
}

export function resolveCompanyReference(
  index: CompanyReferenceIndex,
  label: string
): CompanyReferenceMatch | null {
  const ticker = extractTicker(label);
  if (ticker) {
    const company = index.byTicker.get(ticker);
    if (company) {
      return { company, strategy: "ticker" };
    }
  }

  const normalizedLabel = normalizeCompanyReferenceLabel(label);
  if (!normalizedLabel) {
    return null;
  }

  const exactNameMatch = index.byExactName.get(normalizedLabel);
  if (exactNameMatch) {
    return { company: exactNameMatch, strategy: "exact_name" };
  }

  const canonicalLabel = stripCorporateSuffixes(normalizedLabel);
  const canonicalNameMatch = index.byCanonicalName.get(canonicalLabel);
  if (canonicalNameMatch) {
    return { company: canonicalNameMatch, strategy: "canonical_name" };
  }

  const nearMatches = index.companies.filter((candidate) => {
    const pairings = [
      [normalizedLabel, candidate.normalizedName],
      [normalizedLabel, candidate.canonicalName],
      [canonicalLabel, candidate.normalizedName],
      [canonicalLabel, candidate.canonicalName]
    ] as const;

    return pairings.some(([left, right]) => {
      if (!left || !right || left === right) {
        return false;
      }

      const shorter = left.length <= right.length ? left : right;
      const longer = shorter === left ? right : left;
      const delta = longer.length - shorter.length;

      return shorter.length >= 2 && delta > 0 && delta <= 2 && longer.startsWith(shorter);
    });
  });

  if (nearMatches.length === 1) {
    return { company: nearMatches[0].company, strategy: "near_prefix" };
  }

  return null;
}
