import { PageFrame } from "@/components/PageFrame";

export default function CompanyDetailLoading() {
  return (
    <PageFrame
      code="03-LOADING"
      title="---"
      sub="載入公司資料中..."
    >
      <section className="panel">
        <div className="panel-head">
          <span className="tg panel-code">CDL-01</span>
          <span className="tg muted"> · </span>
          <span className="tg gold">COMPANY DETAIL</span>
        </div>
        <div style={{ padding: "32px 0", textAlign: "center" }}>
          <span className="dim">正在載入...</span>
        </div>
      </section>
    </PageFrame>
  );
}
