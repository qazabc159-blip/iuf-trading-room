"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

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

function modeLabel(value: string | null | undefined) {
  if (!value) return "資料庫";
  if (value === "database") return "資料庫";
  if (value === "memory") return "記憶體";
  if (value === "mock") return "模擬資料";
  return value;
}

function workspaceLabel(value: string | null | undefined) {
  if (!value) return "主控工作區";
  if (value === "Primary Desk" || value === "primary-desk") return "主控工作區";
  return value;
}

export function DataSourceBadge() {
  const pathname = usePathname();
  const [state, setState] = useState<BadgeState>({
    status: "CHECKING",
    label: "檢查中 | 後端",
    detail: "正在確認資料來源",
    checkedAt: null,
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
          label: "正常 | 後端",
          detail: `${modeLabel(session.data.persistenceMode)} | ${workspaceLabel(session.data.workspace.name)}`,
          checkedAt,
        });
      } catch {
        if (cancelled) return;
        setState({
          status: "BLOCKED",
          label: "暫停 | 登入/後端",
          detail: "資料來源暫時無法確認",
          checkedAt,
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

  if (pathname === "/login" || pathname === "/register") {
    return null;
  }

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
      className="source-badge"
      role="status"
      aria-live="polite"
      title={`${state.detail}${state.checkedAt ? ` | 檢查 ${state.checkedAt}` : ""}`}
      style={{
        position: "fixed",
        right: 34,
        bottom: 34,
        zIndex: 9999,
        display: "grid",
        gap: 6,
        minWidth: 196,
        maxWidth: "min(360px, calc(100vw - 68px))",
        padding: "14px 16px 15px",
        border: `1px solid ${tone}`,
        color: tone,
        background: bg,
        fontFamily: "var(--mono)",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.62,
        letterSpacing: 0,
        backdropFilter: "blur(4px)",
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.28)",
      }}
    >
      <span>{state.label}</span>
      <span
        style={{
          color: "var(--night-soft)",
          fontSize: 10,
          fontWeight: 500,
          lineHeight: 1.58,
          letterSpacing: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {state.detail}
      </span>
    </div>
  );
}
