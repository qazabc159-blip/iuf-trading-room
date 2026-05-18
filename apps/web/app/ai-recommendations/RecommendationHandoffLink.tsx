"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { emitRecommendationFeedbackSnapshot } from "./recommendation-feedback-state";

const HANDOFF_TITLE = "帶入模擬委託單，不會送出真實委託";

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
    ticker ? `股票 ${ticker}` : null,
    safeDirection ? `方向 ${safeDirection}` : null,
    entry ? `進場 ${entry}` : null,
    stop ? `停損 ${stop}` : null,
    target ? `目標 ${target}` : null,
    `推薦 ${safeRecommendationId}`,
  ].filter(Boolean);

  return `${HANDOFF_TITLE}${details.length ? `：${details.join(" / ")}` : ""}`;
}

function sideLabel(value: string | null) {
  if (value === "buy") return "買進";
  if (value === "sell") return "賣出";
  return null;
}

function buildPreviewItems(href: string, recommendationId: string) {
  const ticker = safeTicker(firstParam(href, "ticker")) ?? safeTicker(firstParam(href, "symbol"));
  const side = sideLabel(firstParam(href, "side"));
  const entry = safeQueryText(firstParam(href, "entry"), LABEL_MAX_LENGTH.price);
  const stop = safeQueryText(firstParam(href, "stop"), LABEL_MAX_LENGTH.price);
  const target = safeQueryText(firstParam(href, "tp"), LABEL_MAX_LENGTH.price);
  const safeRecommendationId =
    safeQueryText(firstParam(href, "from_rec"), LABEL_MAX_LENGTH.recommendationId) ??
    safeQueryText(recommendationId, LABEL_MAX_LENGTH.recommendationId);

  return [
    ticker ? ["股票", ticker] : null,
    side ? ["方向", side] : null,
    entry ? ["進場", entry] : null,
    stop ? ["停損", stop] : null,
    target ? ["目標", target] : null,
    safeRecommendationId ? ["推薦", safeRecommendationId] : null,
  ].filter((item): item is [string, string] => Boolean(item));
}

function recordActed(recommendationId: string) {
  const url = `/api/recommendations/${encodeURIComponent(recommendationId)}/feedback`;
  const body = JSON.stringify({ reaction: "acted" });
  emitRecommendationFeedbackSnapshot(recommendationId, "acted", "queued");

  void fetch(url, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body,
  }).then((response) => {
    if (response.ok) emitRecommendationFeedbackSnapshot(recommendationId, "acted", "saved");
  }).catch(() => {
    // Handoff navigation should never be blocked by feedback telemetry.
  });
}

export function RecommendationHandoffPreview({
  href,
  recommendationId,
}: {
  href: string;
  recommendationId: string;
}) {
  const items = buildPreviewItems(href, recommendationId);

  return (
    <div className="_rec-handoff-preview" role="note" aria-label="模擬委託帶入預覽">
      <div className="_rec-handoff-preview-head">
        <b>SIM 委託預覽</b>
        <span>不送出真實委託</span>
      </div>
      <div className="_rec-handoff-preview-items">
        {items.map(([label, value]) => (
          <span key={`${label}-${value}`}>
            <b>{label}</b>
            {value}
          </span>
        ))}
      </div>
      <p>點擊後只會把推薦條件帶到模擬委託單，仍需在交易室再次確認。</p>
    </div>
  );
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
        不可用
      </span>
    </span>
  );
}
