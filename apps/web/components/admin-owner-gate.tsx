"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";

import { apiGetMe } from "@/lib/auth-client";
import { meetsMinRole, type WorkspaceRole } from "@/lib/canonical-surfaces";

type GateState =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "blocked"; reason: "not_owner" | "unauthenticated" | "network_error" };

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  Viewer: "Viewer",
  Trader: "Trader",
  Analyst: "Analyst",
  Admin: "Admin",
  Owner: "Owner",
};

function gateCopy(state: GateState, minRole: WorkspaceRole) {
  if (state.status === "checking") {
    return {
      title: `正在確認 ${ROLE_LABEL[minRole]} 權限`,
      body: "後台頁面只對具備對應角色的帳號開放，確認完成前不載入內部內容。",
      cta: "請稍候",
      href: "/",
    };
  }
  if (state.status === "blocked" && state.reason === "unauthenticated") {
    return {
      title: "登入狀態已失效",
      body: "請重新登入後再進入後台。一般客戶帳號不會看到後台頁面。",
      cta: "重新登入",
      href: "/login",
    };
  }
  return {
    title: `此頁僅限 ${ROLE_LABEL[minRole]} 以上角色`,
    body: "你仍可使用正式產品頁：戰情台、市場情報、AI 推薦、交易室、公司頁與策略觀察；後台不屬於客戶訂閱功能。",
    cta: "回到戰情台",
    href: "/",
  };
}

function GateShell({ state, minRole }: { state: GateState; minRole: WorkspaceRole }) {
  const copy = gateCopy(state, minRole);
  const Icon = state.status === "checking" ? ShieldCheck : LockKeyhole;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg-0, #0d0d0d)",
        color: "var(--fg-1, #ddd)",
        display: "grid",
        placeItems: "center",
        padding: 18,
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 460,
          border: "1px solid rgba(200,148,63,0.24)",
          background: "linear-gradient(180deg, rgba(18,18,18,0.96), rgba(8,8,8,0.98))",
          padding: 26,
          boxShadow: "0 22px 50px rgba(0,0,0,0.34)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Icon size={20} strokeWidth={1.8} style={{ color: "var(--accent, #c8943f)" }} />
          <div style={{ color: "var(--accent, #c8943f)", fontSize: 11, fontWeight: 800 }}>
            {ROLE_LABEL[minRole].toUpperCase()} ACCESS
          </div>
        </div>
        <h1 style={{ margin: "0 0 10px", fontSize: 22 }}>{copy.title}</h1>
        <p style={{ margin: "0 0 20px", color: "var(--fg-3, #8a93a3)", lineHeight: 1.7, fontSize: 14 }}>
          {copy.body}
        </p>
        <Link
          href={copy.href}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 38,
            padding: "0 14px",
            border: "1px solid rgba(200,148,63,0.45)",
            background: "rgba(200,148,63,0.1)",
            color: "var(--accent, #c8943f)",
            fontWeight: 800,
            textDecoration: "none",
            fontSize: 13,
          }}
        >
          {copy.cta}
        </Link>
      </section>
    </main>
  );
}

/**
 * Generic role gate — permission matrix v1 D4 (`reports/permission_matrix/PERMISSION_MATRIX_v1.md`).
 * Blocks rendering `children` until `/auth/me` confirms the session's role rank meets `minRole`
 * on the D1 strict ladder (Viewer < Trader < Analyst < Admin < Owner).
 */
export function RoleGate({ children, minRole = "Owner" }: { children: ReactNode; minRole?: WorkspaceRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GateState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;

    void apiGetMe().then((result) => {
      if (cancelled) return;
      if (result.ok && meetsMinRole(result.user.role, minRole)) {
        setState({ status: "ready" });
        return;
      }
      setState({
        status: "blocked",
        reason: result.ok ? "not_owner" : result.error === "unauthenticated" ? "unauthenticated" : "network_error",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [minRole]);

  useEffect(() => {
    if (state.status !== "blocked") return;
    const target = state.reason === "unauthenticated"
      ? `/login?next=${encodeURIComponent(pathname)}`
      : "/";
    const timer = window.setTimeout(() => {
      router.replace(target);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [pathname, router, state]);

  if (state.status !== "ready") return <GateShell state={state} minRole={minRole} />;
  return <>{children}</>;
}

/** Owner-only wrapper around {@link RoleGate}, kept for existing call sites (e.g. `app/admin/layout.tsx`). */
export function AdminOwnerGate({ children }: { children: ReactNode }) {
  return <RoleGate minRole="Owner">{children}</RoleGate>;
}
