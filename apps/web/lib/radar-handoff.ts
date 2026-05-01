"use client";

import { useCallback, useEffect, useState } from "react";

export const IDEA_HANDOFF_KEY = "iuf:idea-handoff:v2";

export type IdeaHandoffSide = "BUY" | "SELL" | "TRIM";

export type IdeaHandoff = {
  ideaId: string;
  symbol: string;
  side: IdeaHandoffSide;
  rationale: string;
  themeCode: string;
  emittedAt: string | null;
};

export type IdeaHandoffInput = {
  id?: string;
  companyId?: string;
  symbol: string;
  side?: "LONG" | "SHORT" | "TRIM" | "EXIT";
  direction?: "bullish" | "bearish" | "neutral";
  rationale?: string | { primaryReason?: string };
  themeCode?: string | null;
  topThemes?: Array<{ name?: string | null; themeId?: string | null }>;
  emittedAt?: string | null;
  latestSignalAt?: string | null;
};

function inputSideToOrderSide(input: IdeaHandoffInput): IdeaHandoffSide {
  if (input.side === "LONG") return "BUY";
  if (input.side === "TRIM") return "TRIM";
  if (input.side === "SHORT" || input.side === "EXIT") return "SELL";
  if (input.direction === "bearish") return "SELL";
  return "BUY";
}

function inputRationale(input: IdeaHandoffInput) {
  if (typeof input.rationale === "string") return input.rationale;
  return input.rationale?.primaryReason ?? "Strategy idea handoff from live frontend data.";
}

function inputTheme(input: IdeaHandoffInput) {
  return input.themeCode ?? input.topThemes?.[0]?.name ?? input.topThemes?.[0]?.themeId ?? "paper-strategy";
}

export function ideaToHandoff(input: IdeaHandoffInput): IdeaHandoff {
  return {
    ideaId: input.id ?? input.companyId ?? input.symbol,
    symbol: input.symbol,
    side: inputSideToOrderSide(input),
    rationale: inputRationale(input),
    themeCode: inputTheme(input),
    emittedAt: input.emittedAt ?? input.latestSignalAt ?? null
  };
}

export function setIdeaHandoff(handoff: IdeaHandoff) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(IDEA_HANDOFF_KEY, JSON.stringify(handoff));
}

export function useIdeaHandoff(): { handoff: IdeaHandoff | null; clear: () => void } {
  const [handoff, setHandoff] = useState<IdeaHandoff | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem(IDEA_HANDOFF_KEY);
    if (!raw) return;
    try {
      setHandoff(JSON.parse(raw) as IdeaHandoff);
    } catch {
      sessionStorage.removeItem(IDEA_HANDOFF_KEY);
    }
  }, []);

  const clear = useCallback(() => {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(IDEA_HANDOFF_KEY);
    setHandoff(null);
  }, []);

  return { handoff, clear };
}
