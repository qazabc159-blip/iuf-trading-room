export const DAILY_BRIEF_CONTRACT_HEADINGS = [
  "市場總覽",
  "AI 精選重點",
  "產業與主題",
  "風險觀察",
  "資料來源狀態",
] as const;

const LEGACY_HEADING_PATTERN = /Market Overview|Theme Summaries|Company Notes|Technical Analysis|Risk Alert|Strategy Observation|Summary/i;
const RAW_DUMP_PATTERN = /Theme:\s|Lifecycle:\s|Market State:\s|Linked Companies|Observation\]|Priority:\s/i;

export type BriefQualityInput = {
  sections: Array<{ heading: string; body: string }>;
};

export function evaluateBriefQuality(brief: BriefQualityInput): {
  displayable: boolean;
  missingHeadings: string[];
  hasLegacyHeading: boolean;
  hasRawDump: boolean;
} {
  const headings = brief.sections.map((section) => section.heading);
  const bodies = brief.sections.map((section) => section.body);
  const missingHeadings = DAILY_BRIEF_CONTRACT_HEADINGS.filter((heading) =>
    headings.every((candidate) => !candidate.includes(heading))
  );
  const hasLegacyHeading = headings.some((heading) => LEGACY_HEADING_PATTERN.test(heading));
  const hasRawDump = bodies.some((body) => RAW_DUMP_PATTERN.test(body));

  return {
    displayable: missingHeadings.length === 0 && !hasLegacyHeading && !hasRawDump,
    missingHeadings,
    hasLegacyHeading,
    hasRawDump,
  };
}
