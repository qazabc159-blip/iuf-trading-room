"use client";
/**
 * IdeaHandoff hook — sessionStorage shuttle.
 *
 * Producer (Dashboard / Ideas list): set() with the idea row when user clicks
 *   "帶去下單台" CTA. Then router.push("/portfolio").
 * Consumer (Portfolio OrderTicket): read() on mount, prefill form, clear()
 *   after first read so the next visit isn't sticky.
 */
import { useCallback, useEffect, useState } from "react";
import type { Idea, IdeaHandoff, OrderSide } from "@/lib/radar-types";
import { IDEA_HANDOFF_KEY } from "@/lib/types";

function ideaSideToOrderSide(s: Idea["side"]): OrderSide {
  switch (s) {
    case "LONG":  return "BUY";
    case "TRIM":  return "TRIM";
    case "EXIT":  return "SELL";
    case "SHORT": return "SELL";
  }
}

export function ideaToHandoff(i: Idea): IdeaHandoff {
  return {
    ideaId: i.id, symbol: i.symbol, side: ideaSideToOrderSide(i.side),
    rationale: i.rationale, themeCode: i.themeCode, emittedAt: i.emittedAt,
  };
}

export function setIdeaHandoff(h: IdeaHandoff) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(IDEA_HANDOFF_KEY, JSON.stringify(h));
}

export function useIdeaHandoff(): { handoff: IdeaHandoff | null; clear: () => void } {
  const [handoff, setHandoff] = useState<IdeaHandoff | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem(IDEA_HANDOFF_KEY);
    if (raw) {
      try { setHandoff(JSON.parse(raw) as IdeaHandoff); } catch {}
    }
  }, []);
  const clear = useCallback(() => {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(IDEA_HANDOFF_KEY);
    setHandoff(null);
  }, []);
  return { handoff, clear };
}
