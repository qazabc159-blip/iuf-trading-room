export interface ThemeQualityCandidate {
  name: string;
  slug?: string | null;
  priority?: number | null;
}

const NON_PRODUCTION_THEME_PATTERN =
  /(^|\s)\[(?:BROKEN(?:-\d+)?|DEPRECATED|ORPHAN)\]|\bplaceholder\b|\bto\s+fix\b/i;

export function isProductionThemeCandidate(theme: ThemeQualityCandidate): boolean {
  const priority = typeof theme.priority === "number" ? theme.priority : null;
  if (priority !== null && priority <= 0) return false;

  const searchable = `${theme.name} ${theme.slug ?? ""}`;
  return !NON_PRODUCTION_THEME_PATTERN.test(searchable);
}

export function filterProductionThemeCandidates<T extends ThemeQualityCandidate>(
  rows: readonly T[]
): T[] {
  return rows.filter(isProductionThemeCandidate);
}
