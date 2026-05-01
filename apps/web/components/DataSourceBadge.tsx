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
  if (!value) return "工作區";
  if (value === "Primary Desk" || value === "primary-desk") return "主控工作區";
  return value;
}

export function DataSourceBadge() {
  const pathname = usePathname();
  const [state, setState] = useState<BadgeState>({
    status: "CHECKING",
    label: "檢查中 | 後端",
    detail: "正在確認工作階段",
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
          label: "暫停 | 登入/API",
          detail: "工作階段暫時無法確認",
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
        backdropFilter: "blur(4px)",
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
          whiteSpace: "nowrap",
        }}
      >
        {state.detail}
      </span>
    </div>
  );
}
