"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { CheckCircle2, MinusCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  emitRecommendationFeedbackSnapshot,
  readRecommendationFeedbackSnapshot,
  RECOMMENDATION_FEEDBACK_EVENT,
  type RecommendationFeedbackReaction,
  type RecommendationFeedbackSnapshot,
  type RecommendationFeedbackSnapshotStatus,
} from "./recommendation-feedback-state";

type Reaction = RecommendationFeedbackReaction;
type Status = "idle" | RecommendationFeedbackSnapshotStatus | "failed";

const ACTIONS: Array<{
  reaction: Reaction;
  label: string;
  Icon: typeof ThumbsUp;
}> = [
  { reaction: "like", label: "有幫助", Icon: ThumbsUp },
  { reaction: "dislike", label: "不採用", Icon: ThumbsDown },
  { reaction: "skip", label: "略過", Icon: MinusCircle },
  { reaction: "acted", label: "已帶入 SIM", Icon: CheckCircle2 },
];

function statusText(status: Status, reaction: Reaction | null, failureMessage: string | null) {
  if (status === "queued" && reaction) {
    const item = ACTIONS.find((action) => action.reaction === reaction);
    return item ? `已送出：${item.label}` : "已送出";
  }
  if (status === "saved" && reaction) {
    const item = ACTIONS.find((action) => action.reaction === reaction);
    return item ? `已記錄：${item.label}` : "已記錄";
  }
  if (status === "failed") return failureMessage ?? "回饋尚未寫入";
  return "等待回饋";
}

async function feedbackFailureText(response: Response) {
  let upstreamCode = "";
  try {
    const body = await response.json() as { error?: unknown; message?: unknown };
    upstreamCode = typeof body.error === "string"
      ? body.error
      : typeof body.message === "string"
        ? body.message
        : "";
  } catch {
    upstreamCode = "";
  }

  const normalizedCode = upstreamCode.toLowerCase();
  if (response.status === 401 || response.status === 403) return "Owner session 未通過，回饋暫未寫入。";
  if (response.status === 404 || normalizedCode.includes("not_found")) return "推薦版本已更新，這筆回饋暫未寫入。";
  if (normalizedCode.includes("api_base")) return "資料服務尚未設定，回饋暫未寫入。";
  if (response.status === 400) return "回饋格式未通過，暫未寫入。";
  return "回饋服務同步中，暫未寫入。";
}

export function RecommendationFeedbackActions({ recommendationId }: { recommendationId: string }) {
  const statusId = useId();
  const [selected, setSelected] = useState<Reaction | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selectedAction = selected ? ACTIONS.find((action) => action.reaction === selected) : null;
  const liveStatus = isPending
    ? selectedAction
      ? `正在寫入：${selectedAction.label}`
      : "寫入中"
    : statusText(status, selected, failureMessage);

  useEffect(() => {
    const snapshot = readRecommendationFeedbackSnapshot(recommendationId);
    if (snapshot) {
      setSelected(snapshot.reaction);
      setStatus(snapshot.status);
      setFailureMessage(null);
    }

    function handleFeedbackEvent(event: Event) {
      const detail = (event as CustomEvent<RecommendationFeedbackSnapshot>).detail;
      if (!detail || detail.recommendationId !== recommendationId) return;
      setSelected(detail.reaction);
      setStatus(detail.status);
      setFailureMessage(null);
    }

    window.addEventListener(RECOMMENDATION_FEEDBACK_EVENT, handleFeedbackEvent);
    return () => window.removeEventListener(RECOMMENDATION_FEEDBACK_EVENT, handleFeedbackEvent);
  }, [recommendationId]);

  function send(reaction: Reaction) {
    setSelected(reaction);
    setStatus("idle");
    setFailureMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/recommendations/${encodeURIComponent(recommendationId)}/feedback`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reaction }),
        });
        if (response.ok) {
          setStatus("saved");
          emitRecommendationFeedbackSnapshot(recommendationId, reaction, "saved");
          return;
        }
        setFailureMessage(await feedbackFailureText(response));
        setStatus("failed");
      } catch {
        setFailureMessage("回饋服務連線失敗，請稍後再試。");
        setStatus("failed");
      }
    });
  }

  return (
    <div className="_rec-feedback" data-status={status} data-reaction={selected ?? undefined} aria-busy={isPending}>
      <div role="group" aria-label="推薦回饋" aria-describedby={statusId}>
        {ACTIONS.map(({ reaction, label, Icon }) => (
          <button
            key={reaction}
            type="button"
            data-active={selected === reaction ? "true" : undefined}
            aria-pressed={selected === reaction}
            aria-label={`送出推薦回饋：${label}`}
            disabled={isPending}
            onClick={() => send(reaction)}
          >
            <Icon size={14} strokeWidth={1.9} />
            {label}
          </button>
        ))}
      </div>
      <span id={statusId} role="status" aria-live="polite" aria-atomic="true">
        {liveStatus}
      </span>
    </div>
  );
}
