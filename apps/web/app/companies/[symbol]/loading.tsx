// loading.tsx — Suspense fallback for /companies/[symbol]
export default function CompanyDetailLoading() {
  return (
    <div style={{
      padding: "40px 24px",
      fontFamily: "var(--mono, monospace)",
      fontSize: 12,
      color: "var(--night-mid, #888)",
      letterSpacing: "0.12em",
    }}>
      LOADING · COMPANY DETAIL…
    </div>
  );
}
