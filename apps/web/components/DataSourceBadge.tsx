"use client";

import { useEffect, useState } from "react";

import { getSession } from "@/lib/api";

type BadgeState =
  | {
      status: "CHECKING";
      label: string;
      detail: string;
      checkedAt: string | null;
    }
  | {
      status: "LIVE";
      label: string;
      detail: string;
      checkedAt: string;
    }
  | {
      status: "BLOCKED";
      label: string;
      detail: string;
      checkedAt: string;
    };

const CHECK_INTERVAL_MS = 60_000;

export function DataSourceBadge() {
  const [state, setState] = useState<BadgeState>({
    status: "CHECKING",
    label: "CHECKING | BACKEND",
    detail: "session probe",
    checkedAt: null
  });

  useEffect(() => {
    let cancelled = false;

    async function probe() {
      const checkedAt = new Date().toISOString();
      try {
        const session = await getSession();
        if (cancelled) return;
        setState({
          status: "LIVE",
          label: "LIVE | BACKEND",
          detail: `${session.data.persistenceMode} | ${session.data.workspace.name}`,
          checkedAt
        });
      } catch {
        if (cancelled) return;
        setState({
          status: "BLOCKED",
          label: "BLOCKED | AUTH/API",
          detail: "session endpoint unavailable",
          checkedAt
        });
      }
    }

    void probe();
    const interval = window.setInterval(() => void probe(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const tone =
    state.status === "LIVE"
      ? "var(--gold-bright)"
      : state.status === "BLOCKED"
        ? "var(--tw-up-bright)"
        : "var(--night-mid)";
  const bg =
    state.status === "BLOCKED"
      ? "rgba(230,57,70,0.12)"
      : "rgba(13,14,10,0.92)";

  return (
    <div
      role="status"
      aria-live="polite"
      title={`${state.detail}${state.checkedAt ? ` | checked ${state.checkedAt}` : ""}`}
      style={{
        position: "fixed",
        right: 14,
        bottom: 14,
        zIndex: 9999,
        display: "grid",
        gap: 3,
        minWidth: 168,
        padding: "7px 10px",
        border: `1px solid ${tone}`,
        color: tone,
        background: bg,
        fontFamily: "var(--mono)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        backdropFilter: "blur(4px)"
      }}
    >
      <span>{state.label}</span>
      <span
        style={{
          color: "var(--night-soft)",
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: "0.08em",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {state.detail}
      </span>
    </div>
  );
}
