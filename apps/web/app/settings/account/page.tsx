"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound } from "lucide-react";
import { apiChangePassword, apiLogout } from "@/lib/auth-client";

const MIN_PW_LENGTH = 12;

function changePasswordErrorMessage(error: string): string {
  switch (error) {
    case "INVALID_CURRENT_PASSWORD":
    case "invalid_current_password":
      return "目前密碼不正確，請重新確認後再送出。";
    case "WEAK_NEW_PASSWORD":
    case "weak_new_password":
      return `新密碼至少需要 ${MIN_PW_LENGTH} 個字元，並建議混合大小寫、數字與符號。`;
    case "network_error":
      return "連線失敗，請稍後再試。";
    default:
      if (error.startsWith("server_error_")) return "伺服器暫時無法處理密碼變更，請稍後再試。";
      return "密碼變更失敗，請重新確認輸入內容。";
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
          fontWeight: 800,
          color: "var(--fg-3, #888)",
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
            padding: "10px 42px 10px 12px",
            outline: "none",
            boxSizing: "border-box",
            opacity: disabled ? 0.55 : 1,
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
      {hint && <div style={{ fontSize: 11, color: "var(--fg-3, #666)", marginTop: 5 }}>{hint}</div>}
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

      if (!current.trim()) {
        setSubmitState({ status: "error", message: "請輸入目前密碼。" });
        return;
      }
      if (next.length < MIN_PW_LENGTH) {
        setSubmitState({ status: "error", message: `新密碼至少需要 ${MIN_PW_LENGTH} 個字元。` });
        return;
      }
      if (next !== confirm) {
        setSubmitState({ status: "error", message: "兩次輸入的新密碼不一致。" });
        return;
      }

      setSubmitState({ status: "submitting" });
      const result = await apiChangePassword(current, next);

      if (result.ok) {
        setSubmitState({ status: "success" });
        setCountdown(3);
      } else {
        setSubmitState({ status: "error", message: changePasswordErrorMessage(result.error) });
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
        color: "var(--fg-1, #ddd)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 460 }}>
        <Link href="/settings" style={{ color: "var(--fg-3, #888)", fontSize: 12, textDecoration: "none" }}>
          返回設定中心
        </Link>

        <header style={{ margin: "24px 0 30px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <KeyRound size={18} strokeWidth={1.7} style={{ color: "var(--accent, #c8943f)" }} />
            <div>
              <div style={{ color: "var(--accent, #c8943f)", fontSize: 11, fontWeight: 900 }}>ACCOUNT</div>
              <h1 style={{ margin: "4px 0 0", fontSize: 24 }}>帳號與安全</h1>
            </div>
          </div>
          <p style={{ color: "var(--fg-3, #8a93a3)", fontSize: 13, lineHeight: 1.7 }}>
            這裡只處理 IUF 登入密碼。券商 SIM 憑證不會在瀏覽器頁面輸入或保存，請走安全環境設定。
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          style={{
            border: "1px solid rgba(200,148,63,0.22)",
            background: "linear-gradient(180deg, rgba(18,18,18,0.96), rgba(8,8,8,0.98))",
            padding: 24,
          }}
        >
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
            hint={`至少 ${MIN_PW_LENGTH} 個字元，建議混合大小寫、數字與符號。`}
          />
          <PasswordInput
            id="confirm-password"
            label="再次輸入新密碼"
            value={confirm}
            onChange={setConfirm}
            disabled={busy}
            autoComplete="new-password"
          />

          {submitState.status === "error" && (
            <div
              role="alert"
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                color: "#f87171",
                background: "rgba(248,113,113,0.08)",
                border: "1px solid rgba(248,113,113,0.28)",
                padding: 12,
                fontSize: 13,
                lineHeight: 1.55,
                marginBottom: 16,
              }}
            >
              <AlertCircle size={16} strokeWidth={1.8} />
              <span>{submitState.message}</span>
            </div>
          )}

          {submitState.status === "success" && (
            <div
              role="status"
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                color: "#34d399",
                background: "rgba(52,211,153,0.08)",
                border: "1px solid rgba(52,211,153,0.28)",
                padding: 12,
                fontSize: 13,
                lineHeight: 1.55,
                marginBottom: 16,
              }}
            >
              <CheckCircle2 size={16} strokeWidth={1.8} />
              <span>密碼已更新，{countdown} 秒後會登出，請用新密碼重新登入。</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%",
              border: "1px solid rgba(200,148,63,0.55)",
              background: "rgba(200,148,63,0.16)",
              color: "var(--accent, #c8943f)",
              padding: "11px 14px",
              fontSize: 13,
              fontWeight: 900,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {submitState.status === "submitting" ? "更新中..." : "更新密碼"}
          </button>
        </form>
      </div>
    </main>
  );
}
