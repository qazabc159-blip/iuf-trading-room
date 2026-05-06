"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ActionState = "idle" | "done" | "error";

export function ContentDraftOverrideActions({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: "approve" | "reject") {
    setState("idle");
    setMessage(null);
    const response = await fetch(`/api/v1/content-drafts/${draftId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: action === "reject"
        ? JSON.stringify({ reason: "owner_manual_override_from_daily_brief_surface" })
        : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      setState("error");
      setMessage(text || "後端拒絕這次 override。");
      return;
    }

    setState("done");
    setMessage(action === "approve" ? "已送出核准 override，重新讀取狀態。" : "已送出退回 override，重新讀取狀態。");
    startTransition(() => router.refresh());
  }

  return (
    <div className="draft-override-actions" aria-label="Owner override fallback">
      <button
        className="mini-button"
        disabled={isPending}
        onClick={() => void run("approve")}
        type="button"
      >
        Owner 核准
      </button>
      <button
        className="outline-button danger"
        disabled={isPending}
        onClick={() => void run("reject")}
        type="button"
      >
        Owner 退回
      </button>
      {message && (
        <span className={`draft-override-message ${state === "error" ? "status-bad" : "status-ok"}`}>
          {message}
        </span>
      )}
    </div>
  );
}
