"use client";
/** Send-to-portfolio CTA · stashes IdeaHandoff and routes to /portfolio. */
import { useRouter } from "next/navigation";
import type { Idea } from "@/lib/radar-types";
import { ideaToHandoff, setIdeaHandoff } from "@/lib/radar-handoff";

export function SendToTicketButton({ idea, compact }: { idea: Idea; compact?: boolean }) {
  const router = useRouter();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setIdeaHandoff(ideaToHandoff(idea));
        router.push("/portfolio#order-ticket");
      }}
      style={{
        background: "transparent",
        border: "1px solid var(--gold)",
        color: "var(--gold-bright)",
        fontFamily: "var(--mono)",
        fontSize: compact ? 9.5 : 10.5,
        letterSpacing: "0.20em",
        padding: compact ? "3px 7px" : "4px 9px",
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
      title="Stash this idea and jump to /portfolio"
    >↘ 帶去下單台</button>
  );
}
