// Skeleton shown immediately while the server component fetches data.
// Operator sees page structure in <50ms instead of blank screen during 3-fetch waterfall.
export default function CompanyDetailLoading() {
  return (
    <div style={{ padding: "24px", fontFamily: "var(--mono, monospace)", fontSize: 12 }}>
      <style>{`
        @keyframes _co-shimmer {
          0%   { opacity: 0.55; }
          50%  { opacity: 0.85; }
          100% { opacity: 0.55; }
        }
        ._co-skel {
          background: var(--night-rule-strong, #2c2c2c);
          animation: _co-shimmer 1.5s ease-in-out infinite;
        }
      `}</style>

      {/* HeroBar skeleton */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 20, paddingBottom: 18, borderBottom: "1px solid var(--night-rule,#222)" }}>
        <div className="_co-skel" style={{ width: 80, height: 32 }} />
        <div style={{ display: "grid", gap: 7 }}>
          <div className="_co-skel" style={{ width: 160, height: 14 }} />
          <div className="_co-skel" style={{ width: 100, height: 10 }} />
        </div>
        <div style={{ marginLeft: "auto" }}>
          <div className="_co-skel" style={{ width: 72, height: 28 }} />
        </div>
      </div>

      {/* KPI strip skeleton */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
        {[80, 70, 60, 72, 110].map((w, i) => (
          <div key={i} className="_co-skel" style={{ width: w, height: 20 }} />
        ))}
      </div>

      {/* Chart + side-column skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, marginBottom: 20 }}>
        <div className="_co-skel" style={{ height: 340 }} />
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <div className="_co-skel" style={{ height: 120 }} />
          <div className="_co-skel" style={{ height: 100 }} />
        </div>
      </div>

      {/* Data dock skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="_co-skel" style={{ height: 140 }} />
        ))}
      </div>

      <div style={{ marginTop: 16, color: "var(--night-dim, #555)", letterSpacing: "0.10em", fontSize: 11 }}>
        讀取中 / 公司資料
      </div>
    </div>
  );
}
