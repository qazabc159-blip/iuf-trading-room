"use client";

// Error boundary for /companies/[symbol].

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
        [ERROR] Company detail failed to load
      </div>
      <div className="dim" style={{ marginBottom: 16 }}>
        {error.message || "Unknown error"}
        {error.digest && ` / digest: ${error.digest}`}
      </div>
      <button className="btn-sm" onClick={reset}>Retry</button>
    </div>
  );
}
