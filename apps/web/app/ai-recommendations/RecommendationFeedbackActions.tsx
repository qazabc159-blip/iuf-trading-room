"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, MinusCircle, ThumbsDown, ThumbsUp } from "lucide-react";

type Reaction = "like" | "dislike" | "skip" | "acted";
type Status = "idle" | "saved" | "failed";

const ACTIONS: Array<{
  reaction: Reaction;
  label: string;
  Icon: typeof ThumbsUp;
}> = [
  { reaction: "like", label: "有幫助", Icon: ThumbsUp },
  { reaction: "dislike", label: "不採用", Icon: ThumbsDown },
  { reaction: "skip", label: "略過", Icon: MinusCircle },
  { reaction: "acted", label: "已帶單", Icon: CheckCircle2 },
];

function statusText(status: Status, reaction: Reaction | null) {
  if (status === "saved" && reaction) {
    const item = ACTIONS.find((action) => action.reaction === reaction);
    return item ? `已記錄：${item.label}` : "已記錄";
  }
  if (status === "failed") return "回饋尚未寫入";
  return "等待回饋";
}

export function RecommendationFeedbackActions({ recommendationId }: { recommendationId: string }) {
  const [selected, setSelected] = useState<Reaction | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [isPending, startTransition] = useTransition();

  function send(reaction: Reaction) {
    setSelected(reaction);
    setStatus("idle");
    startTransition(async () => {
      try {
        const response = await fetch(`/api/recommendations/${encodeURIComponent(recommendationId)}/feedback`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reaction }),
        });
        setStatus(response.ok ? "saved" : "failed");
      } catch {
        setStatus("failed");
      }
    });
  }

  return (
    <div className="_rec-feedback" data-status={status}>
      <div role="group" aria-label="推薦回饋">
        {ACTIONS.map(({ reaction, label, Icon }) => (
          <button
            key={reaction}
            type="button"
            data-active={selected === reaction ? "true" : undefined}
            disabled={isPending}
            onClick={() => send(reaction)}
          >
            <Icon size={14} strokeWidth={1.9} />
            {label}
          </button>
        ))}
      </div>
      <span aria-live="polite">{isPending ? "寫入中" : statusText(status, selected)}</span>
    </div>
  );
}
