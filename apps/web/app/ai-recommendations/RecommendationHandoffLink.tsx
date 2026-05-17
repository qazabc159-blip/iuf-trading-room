"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

const HANDOFF_TITLE = "帶入交易室 SIM 預覽；不會建立券商委託";

function handoffParam(href: string, key: string) {
  try {
    return new URL(href, "https://app.eycvector.local").searchParams.get(key)?.trim() || null;
  } catch {
    return null;
  }
}

function buildHandoffLabel(href: string, recommendationId: string, directionLabel?: string) {
  const ticker = handoffParam(href, "ticker") ?? handoffParam(href, "symbol");
  const entry = handoffParam(href, "entry");
  const stop = handoffParam(href, "stop");
  const target = handoffParam(href, "tp");
  const details = [
    ticker ? `標的 ${ticker}` : null,
    directionLabel ? `方向 ${directionLabel}` : null,
    entry ? `進場 ${entry}` : null,
    stop ? `停損 ${stop}` : null,
    target ? `目標 ${target}` : null,
    `推薦 ${recommendationId}`,
  ].filter(Boolean);

  return `${HANDOFF_TITLE}${details.length ? `，${details.join("，")}` : ""}`;
}

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
  directionLabel,
  children,
}: {
  href: string;
  recommendationId: string;
  directionLabel?: string;
  children: ReactNode;
}) {
  const handoffLabel = buildHandoffLabel(href, recommendationId, directionLabel);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    recordActed(recommendationId);
  }

  return (
    <Link className="_rec-prefill" href={href} aria-label={handoffLabel} title={handoffLabel} onClick={handleClick}>
      {children}
      {directionLabel ? (
        <span className="_rec-prefill-side" aria-hidden="true">
          {directionLabel}
        </span>
      ) : null}
    </Link>
  );
}
