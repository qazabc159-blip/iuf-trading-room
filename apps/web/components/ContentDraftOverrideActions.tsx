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
      setMessage(text || "Owner fallback 執行失敗。");
      return;
    }

    setState("done");
    setMessage(action === "approve" ? "已核准草稿，等待正式資料回寫。" : "已退回草稿。");
    startTransition(() => router.refresh());
  }

  return (
    <div className="draft-override-actions" aria-label="Owner fallback actions">
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
