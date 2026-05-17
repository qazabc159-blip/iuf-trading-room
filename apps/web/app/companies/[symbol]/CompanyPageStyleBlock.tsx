// CompanyPageStyleBlock.tsx — server component, injects _co-page-* CSS
// Prefix: _co-page-* — fully isolated, does not touch globals.css

export function CompanyPageStyleBlock() {
  return (
    <style>{`
/* ── _co-page-* — company detail page layout upgrade 2026-05-09 ── */

/* Back button upgrade */
._co-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1px solid rgba(220,228,240,0.14);
  background: rgba(5,8,12,0.42);
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--night-mid, #91a0b5);
  letter-spacing: 0.04em;
  margin-bottom: 10px;
  transition: border-color 0.18s, color 0.18s;
  text-decoration: none;
}
._co-back-btn:hover {
  border-color: rgba(226,184,92,0.38);
  color: var(--gold-bright, #e2b85c);
}

/* Suppress old KPI strip — replaced by hero bar cells */
.company-kpi-strip { display: none !important; }

/* Old hero bar hide — replaced */
.company-hero-bar { display: none !important; }

/* 2-col desktop layout: left=chart+themes+ann / right=KPI+order */
.company-detail-layout {
  grid-template-columns: minmax(0, 1fr) minmax(320px, 360px) !important;
  gap: clamp(16px, 1.8vw, 26px) !important;
}

/* Panel card depth + border glow on hover */
.company-main-column .panel,
.company-side-column .panel {
  border: 1px solid rgba(220,228,240,0.09) !important;
  transition: border-color 0.22s, box-shadow 0.22s !important;
}
.company-main-column .panel:hover,
.company-side-column .panel:hover {
  border-color: rgba(226,184,92,0.22) !important;
  box-shadow: 0 6px 24px rgba(0,0,0,0.32), 0 0 0 1px rgba(226,184,92,0.08) inset !important;
}

/* Themes upgrade — card depth with hover lift */
._co-theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  padding: 12px 0 6px;
}
._co-theme-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(220,228,240,0.09);
  background: rgba(5,8,12,0.42);
  padding: 12px 14px 13px;
  transition: transform 0.18s, border-color 0.18s, box-shadow 0.18s;
  cursor: default;
}
._co-theme-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--_accent, rgba(226,184,92,0.62));
}
._co-theme-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 0% 0%, rgba(200,148,63,0.07), transparent 55%);
  pointer-events: none;
}
._co-theme-card:hover {
  transform: translateY(-3px);
  border-color: rgba(226,184,92,0.28);
  box-shadow: 0 8px 28px rgba(0,0,0,0.38);
}
._co-theme-name {
  font-family: var(--sans-tc);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--night-ink, #e7ecf3);
  line-height: 1.45;
  margin-bottom: 4px;
}
._co-theme-tier {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--night-mid, #91a0b5);
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  ._co-theme-card { transition: none; }
  ._co-theme-card:hover { transform: none; }
  .company-main-column .panel,
  .company-side-column .panel { transition: none !important; }
}

/* Data dock sections */
.company-data-dock-title {
  margin-top: 24px;
  border-top: 1px solid rgba(220,228,240,0.07);
  padding-top: 20px;
}

/* ── 知識圖譜 grid — desktop 2-col ── */
.company-knowledge-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.7fr);
  gap: clamp(16px, 1.8vw, 24px);
  align-items: start;
}

/* Knowledge panel base */
._ck-panel,
._ig-panel {
  min-height: 160px;
}

/* state-panel spacing inside knowledge panels */
._ck-panel .state-panel,
._ig-panel .state-panel {
  padding: 24px 0 8px;
}

/* Mobile: single col */
@media (max-width: 1280px) {
  .company-knowledge-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 768px) {
  .company-detail-layout {
    grid-template-columns: minmax(0, 1fr) !important;
  }
  .company-side-column { order: -1; }
  ._co-theme-grid { grid-template-columns: 1fr 1fr; }
  .company-knowledge-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 480px) {
  ._co-theme-grid { grid-template-columns: 1fr; }
}
    `}</style>
  );
}
