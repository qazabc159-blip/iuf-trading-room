import type { Theme } from "@iuf-trading-room/contracts";

const LEGACY_THEME_LIFECYCLE_MAP: Record<string, Theme["lifecycle"]> = {
  discovery: "Discovery",
  incubation: "Discovery",
  early: "Discovery",
  watch: "Discovery",
  validation: "Validation",
  monitoring: "Validation",
  monitor: "Validation",
  expansion: "Expansion",
  active: "Expansion",
  growth: "Expansion",
  crowded: "Crowded",
  maturity: "Crowded",
  mature: "Crowded",
  distribution: "Distribution",
  contraction: "Distribution",
  paused: "Distribution",
  retired: "Distribution",
  stale: "Distribution"
};

export function normalizeThemeLifecycleForRead(value: unknown): Theme["lifecycle"] {
  if (typeof value !== "string") return "Discovery";
  const direct = LEGACY_THEME_LIFECYCLE_MAP[value.trim().toLowerCase()];
  return direct ?? "Discovery";
}
