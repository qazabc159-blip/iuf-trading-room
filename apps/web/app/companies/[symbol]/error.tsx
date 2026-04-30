"use client";

// error.tsx — Error boundary for /companies/[symbol]
// Next.js App Router requires this to be a Client Component.

import { useEffect } from "react";

export default function CompanyDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[company-detail-error]", error);
  }, [error]);

  return (
    <div style={{
      padding: "40px 24px",
      fontFamily: "var(--mono, monospace)",
      fontSize: 12,
    }}>
      <div style={{ color: "var(--tw-up-bright, #e63946)", marginBottom: 12 }}>
        [ERROR] 公司頁載入失敗
      </div>
      <div className="dim" style={{ marginBottom: 16 }}>
        {error.message || "Unknown error"}
        {error.digest && ` · digest: ${error.digest}`}
      </div>
      <button className="btn-sm" onClick={reset}>重試</button>
    </div>
  );
}
