"use client";

/**
 * /settings/account — 帳號設定
 *
 * Currently exposes: change password form.
 * POST /api/v1/auth/change-password (PR #476)
 *   Body: { currentPassword, newPassword }
 *   Errors: INVALID_CURRENT_PASSWORD | WEAK_NEW_PASSWORD
 *
 * On success: countdown 3s → auto-logout → redirect /login
 */

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";
import { apiChangePassword, apiLogout } from "@/lib/auth-client";

const MIN_PW_LENGTH = 12;

function changePasswordErrorMessage(error: string): string {
  switch (error) {
    case "INVALID_CURRENT_PASSWORD":
    case "invalid_current_password":
      return "目前密碼不正確，請重新輸入。";
    case "WEAK_NEW_PASSWORD":
    case "weak_new_password":
      return `新密碼強度不足，請使用至少 ${MIN_PW_LENGTH} 個字元，包含大小寫字母與數字。`;
    case "network_error":
      return "連線失敗，請稍後再試。";
    default:
      if (error.startsWith("server_error_")) return "伺服器暫時無法完成請求，請稍後再試。";
      return "操作失敗，請稍後再試。";
  }
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  disabled,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  autoComplete?: string;
  hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: 18 }}>
      <label
        htmlFor={id}
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.07em",
          color: "var(--fg-3, #888)",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoComplete={autoComplete}
          style={{
            width: "100%",
            background: "var(--bg-1, #111)",
            border: "1px solid var(--border, #333)",
            borderRadius: 2,
            color: "var(--fg-1, #ddd)",
            fontFamily: "var(--mono, monospace)",
            fontSize: 13,
            padding: "9px 40px 9px 12px",
            outline: "none",
            boxSizing: "border-box",
            opacity: disabled ? 0.5 : 1,
          }}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          disabled={disabled}
          aria-label={show ? "隱藏密碼" : "顯示密碼"}
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--fg-3, #777)",
            display: "flex",
            alignItems: "center",
            padding: 0,
          }}
        >
          {show ? <EyeOff size={15} strokeWidth={1.8} /> : <Eye size={15} strokeWidth={1.8} />}
        </button>
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--fg-3, #666)", marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success" }
  | { status: "error"; message: string };

export default function AccountSettingsPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [countdown, setCountdown] = useState(3);

  // Countdown + auto-logout after success
  useEffect(() => {
    if (submitState.status !== "success") return;
    if (countdown <= 0) {
      void apiLogout().then(() => {
        router.push("/login");
      });
      return;
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [submitState.status, countdown, router]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmitState({ status: "idle" });

      // Client-side validation
      if (!current.trim()) {
        setSubmitState({ status: "error", message: "請輸入目前密碼。" });
        return;
      }
      if (next.length < MIN_PW_LENGTH) {
        setSubmitState({
          status: "error",
          message: `新密碼至少需要 ${MIN_PW_LENGTH} 個字元。`,
        });
        return;
      }
      if (next !== confirm) {
        setSubmitState({ status: "error", message: "新密碼與確認密碼不相符。" });
        return;
      }

      setSubmitState({ status: "submitting" });
      const result = await apiChangePassword(current, next);

      if (result.ok) {
        setSubmitState({ status: "success" });
        setCountdown(3);
      } else {
        setSubmitState({
          status: "error",
          message: changePasswordErrorMessage(result.error),
        });
      }
    },
    [current, next, confirm],
  );

  const busy = submitState.status === "submitting" || submitState.status === "success";

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg-0, #0d0d0d)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "60px 16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
        }}
      >
        {/* Page header */}
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 6,
            }}
          >
            <KeyRound
              size={18}
              strokeWidth={1.6}
              style={{ color: "var(--accent, #c8943f)" }}
            />
            <h1
              className="ascii-head"
              style={{ margin: 0, fontSize: 16 }}
            >
              <span className="ascii-head-bracket">帳號設定</span>
            </h1>
          </div>
          <p
            style={{
              fontSize: 12,
              color: "var(--fg-3, #888)",
              margin: 0,
              marginLeft: 28,
            }}
          >
            管理密碼與帳號安全
          </p>
        </div>

        {/* Panel */}
        <div className="panel hud-frame" style={{ padding: "24px 26px" }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "var(--accent, #c8943f)",
              textTransform: "uppercase",
              marginBottom: 20,
              borderBottom: "1px solid var(--border, #333)",
              paddingBottom: 10,
            }}
          >
            變更密碼
          </div>

          {/* Success state */}
          {submitState.status === "success" && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "14px 16px",
                border: "1px solid rgba(80,200,140,0.35)",
                borderRadius: 2,
                background: "rgba(80,200,140,0.06)",
                marginBottom: 20,
              }}
            >
              <CheckCircle2
                size={16}
                strokeWidth={1.8}
                style={{ color: "#50c88c", flexShrink: 0, marginTop: 1 }}
              />
              <div>
                <div
                  style={{
                    fontSize: 13,
                    color: "#50c88c",
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  密碼已更新，請重新登入
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-3, #888)" }}>
                  {countdown > 0
                    ? `${countdown} 秒後自動登出…`
                    : "正在登出…"}
                </div>
              </div>
            </div>
          )}

          {/* Error state */}
          {submitState.status === "error" && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "12px 14px",
                border: "1px solid rgba(220,80,80,0.35)",
                borderRadius: 2,
                background: "rgba(220,80,80,0.06)",
                marginBottom: 20,
                fontSize: 13,
                color: "#dc5050",
              }}
            >
              <AlertCircle
                size={15}
                strokeWidth={1.8}
                style={{ flexShrink: 0, marginTop: 1 }}
              />
              {submitState.message}
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} noValidate>
            <PasswordInput
              id="current-password"
              label="目前密碼"
              value={current}
              onChange={setCurrent}
              disabled={busy}
              autoComplete="current-password"
            />
            <PasswordInput
              id="new-password"
              label="新密碼"
              value={next}
              onChange={setNext}
              disabled={busy}
              autoComplete="new-password"
              hint={`至少 ${MIN_PW_LENGTH} 個字元`}
            />
            <PasswordInput
              id="confirm-password"
              label="確認新密碼"
              value={confirm}
              onChange={setConfirm}
              disabled={busy}
              autoComplete="new-password"
            />

            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                padding: "10px 0",
                background:
                  busy
                    ? "rgba(200,148,63,0.3)"
                    : "rgba(200,148,63,0.15)",
                border: "1px solid var(--accent, #c8943f)",
                borderRadius: 2,
                color: busy ? "var(--fg-3, #888)" : "var(--accent, #c8943f)",
                fontFamily: "var(--mono, monospace)",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.06em",
                cursor: busy ? "not-allowed" : "pointer",
                transition: "background 0.15s, color 0.15s",
                marginTop: 4,
              }}
            >
              {submitState.status === "submitting"
                ? "送出中…"
                : submitState.status === "success"
                ? "已更新"
                : "更新密碼"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
