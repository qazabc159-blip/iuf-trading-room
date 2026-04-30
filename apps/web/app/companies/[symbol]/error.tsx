"use client";

import { PageFrame } from "@/components/PageFrame";

export default function CompanyDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PageFrame
      code="03-ERR"
      title="ERROR"
      sub="公司資料載入失敗"
    >
      <section className="panel">
        <div className="panel-head">
          <span className="tg panel-code">CDL-ERR</span>
          <span className="tg muted"> · </span>
          <span className="tg gold">COMPANY DETAIL ERROR</span>
        </div>
        <div style={{ padding: "24px 16px" }}>
          <p className="dim" style={{ marginBottom: 12 }}>
            {error.message || "無法載入公司資料"}
          </p>
          <button className="btn-sm" onClick={reset}>
            重試
          </button>
        </div>
      </section>
    </PageFrame>
  );
}
