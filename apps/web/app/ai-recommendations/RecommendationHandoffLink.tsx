"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

const HANDOFF_TITLE = "帶入交易室 SIM 預覽；不會建立券商委託";

const LABEL_MAX_LENGTH = {
  ticker: 16,
  recommendationId: 96,
  direction: 16,
  price: 40,
} as const;

function firstParam(href: string, key: string) {
  try {
    return new URL(href, "https://app.eycvector.local").searchParams.get(key)?.trim() || null;
  } catch {
    return null;
  }
}

function safeQueryText(value: string | null | undefined, maxLength: number) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[<>]/g, "").slice(0, maxLength);
}

function safeTicker(value: string | null | undefined) {
  const ticker = value?.trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9._-]{1,16}$/.test(ticker)) return null;
  return ticker;
}

function buildHandoffLabel(href: string, recommendationId: string, directionLabel?: string) {
  const ticker = safeTicker(firstParam(href, "ticker")) ?? safeTicker(firstParam(href, "symbol"));
  const entry = safeQueryText(firstParam(href, "entry"), LABEL_MAX_LENGTH.price);
  const stop = safeQueryText(firstParam(href, "stop"), LABEL_MAX_LENGTH.price);
  const target = safeQueryText(firstParam(href, "tp"), LABEL_MAX_LENGTH.price);
  const safeDirection = safeQueryText(directionLabel, LABEL_MAX_LENGTH.direction);
  const safeRecommendationId = safeQueryText(recommendationId, LABEL_MAX_LENGTH.recommendationId) ?? "unknown";
  const details = [
    ticker ? `標的 ${ticker}` : null,
    safeDirection ? `方向 ${safeDirection}` : null,
    entry ? `進場 ${entry}` : null,
    stop ? `停損 ${stop}` : null,
    target ? `目標 ${target}` : null,
    `推薦 ${safeRecommendationId}`,
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
    recordActed(recommendationId);
  }

  function handleAuxClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented) return;
    if (event.button !== 1) return;
    recordActed(recommendationId);
  }

  return (
    <Link
      className="_rec-prefill"
      href={href}
      aria-label={handoffLabel}
      title={handoffLabel}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
    >
      {children}
      {directionLabel ? (
        <span className="_rec-prefill-side" aria-hidden="true">
          {directionLabel}
        </span>
      ) : null}
    </Link>
  );
}

export function RecommendationHandoffUnavailable({
  reason,
  children,
}: {
  reason: string;
  children: ReactNode;
}) {
  return (
    <span className="_rec-prefill _rec-prefill-disabled" role="status" aria-label={reason} title={reason}>
      {children}
      <span className="_rec-prefill-side" aria-hidden="true">
        停用
      </span>
    </span>
  );
}
