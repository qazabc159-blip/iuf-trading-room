"use client";

/**
 * /ops/f-auto — F-AUTO SIM 觀察面板 client boundary
 *
 * Owner-only gate (same pattern as AiAnalystReportPanel).
 * Wraps FAutoSimPanel which handles all live API consumption.
 *
 * Split out of page.tsx (2026-07-19, finding #1 fix): Next.js only reads the
 * `dynamic`/revalidate route segment config from a Server Component page
 * file — a "use client" page.tsx silently ignores it. This component now
 * carries 100% of the previous page.tsx client logic unchanged; page.tsx
 * itself is a thin Server Component wrapper that owns the dynamic export.
 */

import { useEffect, useState } from "react";
import { PageFrame } from "@/components/PageFrame";
import { apiGetMe, authErrorMessage } from "@/lib/auth-client";
import { FAutoSimPanel } from "./FAutoSimPanel";

type RoleState = "loading" | "not-owner" | "session-error" | "ready";

export function FAutoOwnerGate() {
  const [roleState, setRoleState] = useState<RoleState>("loading");
  const [roleErrorMessage, setRoleErrorMessage] = useState<string>("");

  useEffect(() => {
    apiGetMe().then((result) => {
      if (!result.ok) {
        // fetch 失敗 / session 過期 ≠ 真的不是 owner；顯示誠實訊息而非假的權限不足。
        setRoleErrorMessage(authErrorMessage(result.error));
        setRoleState("session-error");
      } else if (result.user.role !== "Owner") {
        setRoleState("not-owner");
      } else {
        setRoleState("ready");
      }
    });
  }, []);

  return (
    <PageFrame
      code="FAUTO"
      title="F-AUTO SIM 觀察台"
      sub="KGI SIM / S1 策略"
      note="F-AUTO 10M SIM 自動交易狀態；Owner 限定；所有資料直接來自凱基 SIM 帳戶與 S1 pipeline。"
    >
      {roleState === "loading" && (
        <div className="_fauto-gate-loading">驗證身份中…</div>
      )}
      {roleState === "not-owner" && (
        <div className="_fauto-gate-locked">
          <div className="_fauto-gate-icon">
            <span>✕</span>
          </div>
          <div>
            <div className="_fauto-gate-title">此頁面僅限帳號擁有者檢視</div>
            <div className="_fauto-gate-sub">F-AUTO SIM 狀態屬 Owner 限定資料，請使用擁有者帳號登入。</div>
          </div>
        </div>
      )}
      {roleState === "session-error" && (
        <div className="_fauto-gate-locked">
          <div className="_fauto-gate-icon">
            <span>⟳</span>
          </div>
          <div>
            <div className="_fauto-gate-title">請重新登入</div>
            <div className="_fauto-gate-sub">{roleErrorMessage}</div>
          </div>
        </div>
      )}
      {roleState === "ready" && <FAutoSimPanel />}

      <style>{`
        ._fauto-gate-loading {
          padding: 56px 0;
          text-align: center;
          font-size: 13px;
          color: rgba(145,160,181,0.55);
          font-style: italic;
        }
        ._fauto-gate-locked {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          padding: 64px 32px;
          text-align: center;
        }
        ._fauto-gate-icon {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          background: rgba(230,57,70,0.07);
          border: 2px solid rgba(230,57,70,0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          color: #ff6b77;
        }
        ._fauto-gate-title {
          font-size: 15px;
          font-weight: 600;
          color: #c6d0de;
          margin-bottom: 6px;
        }
        ._fauto-gate-sub {
          font-size: 13px;
          color: #566276;
          line-height: 1.6;
        }
      `}</style>
    </PageFrame>
  );
}
