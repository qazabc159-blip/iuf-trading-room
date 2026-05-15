"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

function recordActed(recommendationId: string) {
  const url = `/api/recommendations/${encodeURIComponent(recommendationId)}/feedback`;
  const body = JSON.stringify({ reaction: "acted" });

  try {
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {
    // Fall through to keepalive fetch.
  }

  void fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {
    // Handoff navigation should never be blocked by feedback telemetry.
  });
}

export function RecommendationHandoffLink({
  href,
  recommendationId,
  children,
}: {
  href: string;
  recommendationId: string;
  children: ReactNode;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    recordActed(recommendationId);
  }

  return (
    <Link className="_rec-prefill" href={href} onClick={handleClick}>
      {children}
    </Link>
  );
}
