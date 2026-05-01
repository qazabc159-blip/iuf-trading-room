"use client";

import { useRouter } from "next/navigation";

import type { IdeaHandoffInput } from "@/lib/radar-handoff";
import { ideaToHandoff, setIdeaHandoff } from "@/lib/radar-handoff";

export function SendToTicketButton({ idea, compact }: { idea: IdeaHandoffInput; compact?: boolean }) {
  const router = useRouter();

  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        setIdeaHandoff(ideaToHandoff(idea));
        router.push("/portfolio#order-ticket");
      }}
      style={{
        background: "transparent",
        border: "1px solid var(--gold)",
        color: "var(--gold-bright)",
        fontFamily: "var(--mono)",
        fontSize: compact ? 9.5 : 10.5,
        letterSpacing: "0.16em",
        padding: compact ? "3px 7px" : "4px 9px",
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap"
      }}
      title="Stash this live idea into the paper ticket"
      type="button"
    >
      PAPER TICKET
    </button>
  );
}
