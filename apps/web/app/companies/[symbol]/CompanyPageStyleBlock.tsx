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

/* 2-col desktop layout: left=chart+themes+ann / right=readable status rail */
.company-detail-layout {
  grid-template-columns: minmax(0, 1fr) minmax(320px, 360px) !important;
  gap: clamp(16px, 1.8vw, 26px) !important;
  overflow-x: visible !important;
}

@media (min-width: 1181px) {
  .company-side-column {
    position: sticky !important;
    top: clamp(76px, 8vh, 96px);
    align-self: start;
    grid-template-columns: minmax(0, 1fr) !important;
    min-width: 320px;
    overflow: visible;
  }
}

.company-side-nav-panel {
  padding: 12px 14px 14px !important;
}
.company-side-nav-panel .ascii-head {
  margin-bottom: 10px;
}
.company-side-nav-list {
  display: grid;
  gap: 7px;
}
.company-side-nav-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 34px;
  padding: 7px 9px;
  border: 1px solid rgba(220,228,240,0.08);
  background: rgba(5,8,12,0.34);
  color: var(--night-ink, #e7ecf3);
  font-family: var(--mono);
  font-size: 10.5px;
  text-decoration: none;
  transition: border-color 0.16s, color 0.16s, background 0.16s;
}
.company-side-nav-link:hover,
.company-side-nav-link:focus-visible {
  border-color: rgba(226,184,92,0.34);
  background: rgba(226,184,92,0.08);
  color: var(--gold-bright, #e2b85c);
  outline: none;
}
.company-side-nav-link small {
  color: var(--night-mid, #91a0b5);
  font-size: 9.5px;
  text-align: right;
  white-space: nowrap;
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

/* Data dock sections — tighter separator (was margin-top:24 / padding-top:20) */
.company-data-dock-title {
  margin-top: 14px;
  border-top: 1px solid rgba(220,228,240,0.07);
  padding-top: 14px;
}

/* ── 知識圖譜 grid — desktop 2-col ── */
.company-knowledge-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: clamp(12px, 1.4vw, 20px);
  align-items: start;
  margin-top: 10px;
}
.company-knowledge-grid > .panel {
  margin: 0 !important;
}

/* Knowledge panel base — reduced min-height for blocked/empty states */
._ck-panel,
._ig-panel {
  min-height: 100px;
}

/* state-panel spacing inside knowledge panels — was 24px 0 8px (too tall) */
._ck-panel .state-panel,
._ig-panel .state-panel {
  padding: 10px 0 6px;
}

/* Desktop: show knowledge + industry graph side by side starting at 1280px viewport.
   Previously 1500px — the main column is ~850px wide at 1440px viewport, plenty of room. */
@media (min-width: 1280px) {
  .company-knowledge-grid {
    grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.85fr);
  }
}
@media (max-width: 1180px) {
  .company-detail-layout {
    grid-template-columns: minmax(0, 1fr) !important;
  }
  .company-side-column {
    position: static !important;
    grid-template-columns: repeat(2, minmax(280px, 1fr)) !important;
    order: 0;
  }
}
@media (max-width: 768px) {
  .company-detail-layout {
    grid-template-columns: minmax(0, 1fr) !important;
  }
  .company-side-column {
    grid-template-columns: minmax(0, 1fr) !important;
    order: 0;
  }
  .company-side-nav-panel { display: none; }
  ._co-theme-grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 480px) {
  ._co-theme-grid { grid-template-columns: 1fr; }
}

/* ── AI Analyst Report Panel (_ai-*) ── */
._ai-report-panel {
  margin-top: 10px;
}

/* Meta strip */
._ai-meta-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  background: rgba(5,8,12,0.38);
  border: 1px solid rgba(220,228,240,0.07);
  border-radius: 4px;
  margin-bottom: 16px;
}
._ai-meta-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
._ai-meta-lbl {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255,255,255,0.35);
  font-family: var(--mono);
}
._ai-meta-val {
  font-size: 11px;
  font-family: var(--mono);
  color: rgba(255,255,255,0.72);
}
._ai-over-budget {
  color: #e63946 !important;
}

/* Refresh button */
._ai-refresh-btn {
  margin-left: auto;
  font-size: 10px;
}

/* Budget banner */
._ai-budget-banner {
  padding: 8px 14px;
  border: 1px solid rgba(230,57,70,0.4);
  background: rgba(230,57,70,0.08);
  color: #e63946;
  font-family: var(--mono);
  font-size: 11px;
  border-radius: 3px;
  margin-bottom: 14px;
}
._ai-quality-banner {
  border-color: rgba(226,184,92,0.45);
  background: rgba(226,184,92,0.09);
  color: #e2b85c;
}
._ai-quality-state {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid rgba(226,184,92,0.28);
  background: rgba(226,184,92,0.06);
  border-radius: 4px;
  font-family: var(--mono);
}
._ai-quality-state b {
  color: #e2b85c;
  font-size: 13px;
}
._ai-quality-state span,
._ai-quality-state li {
  color: rgba(220,228,240,0.75);
  font-size: 11px;
}
._ai-quality-state ul {
  margin: 0 0 0 18px;
  padding: 0;
}

/* Report markdown body */
._ai-report-body {
  padding: 4px 0 12px;
  font-size: 13px;
  line-height: 1.75;
  color: rgba(255,255,255,0.82);
}
._ai-md-h1 {
  font-size: 15px;
  font-weight: 700;
  color: #e2b85c;
  margin: 18px 0 8px;
  font-family: var(--mono);
  border-bottom: 1px solid rgba(226,184,92,0.2);
  padding-bottom: 4px;
}
._ai-md-h2 {
  font-size: 13px;
  font-weight: 700;
  color: rgba(255,255,255,0.88);
  margin: 14px 0 6px;
  font-family: var(--mono);
}
._ai-md-h3 {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255,255,255,0.75);
  margin: 10px 0 4px;
  font-family: var(--mono);
}
._ai-md-p {
  margin: 6px 0;
  color: rgba(255,255,255,0.78);
  font-size: 12.5px;
}
._ai-md-ul {
  margin: 6px 0 6px 18px;
  padding: 0;
  color: rgba(255,255,255,0.75);
  font-size: 12.5px;
  list-style: disc;
}
._ai-md-ul li {
  margin: 3px 0;
}

/* ReAct trace section */
._ai-trace-section {
  margin-top: 12px;
  border-top: 1px solid rgba(220,228,240,0.08);
  padding-top: 10px;
}
._ai-trace-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 11px;
  color: rgba(255,255,255,0.45);
  padding: 4px 0;
  transition: color 0.16s;
}
._ai-trace-toggle:hover {
  color: rgba(255,255,255,0.7);
}
._ai-trace-arrow {
  font-size: 9px;
}
._ai-trace-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
._ai-trace-step {
  border: 1px solid rgba(220,228,240,0.06);
  border-radius: 3px;
  padding: 8px 10px;
  background: rgba(5,8,12,0.3);
}
._ai-trace-step-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}
._ai-trace-icon {
  font-size: 13px;
}
._ai-trace-type {
  font-family: var(--mono);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: rgba(255,255,255,0.4);
}
._ai-trace-tool {
  font-family: var(--mono);
  font-size: 9px;
  color: #e2b85c;
  background: rgba(226,184,92,0.1);
  border: 1px solid rgba(226,184,92,0.2);
  padding: 1px 5px;
  border-radius: 2px;
}
._ai-trace-elapsed {
  font-family: var(--mono);
  font-size: 9px;
  color: rgba(255,255,255,0.28);
  margin-left: auto;
}
._ai-trace-content {
  font-family: var(--mono);
  font-size: 11px;
  color: rgba(255,255,255,0.65);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

/* State screens — interactive (idle/running/error): keep centered for usability */
._ai-empty-state,
._ai-running-state,
._ai-error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 22px 16px;
  gap: 8px;
  text-align: center;
}

/* Non-interactive states (owner-lock / role-loading) — compact horizontal bar */
._ai-owner-lock,
._ai-body-placeholder {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  text-align: left;
  min-height: unset;
  border-top: 1px solid rgba(220,228,240,0.06);
}

._ai-empty-icon {
  font-size: 24px;
}
._ai-lock-icon {
  font-size: 15px;
  flex-shrink: 0;
}
._ai-empty-msg {
  font-family: var(--mono);
  font-size: 13px;
  color: rgba(255,255,255,0.6);
  font-weight: 600;
}
._ai-lock-msg {
  font-family: var(--mono);
  font-size: 11px;
  color: rgba(255,255,255,0.5);
  font-weight: 600;
  flex-shrink: 0;
}
._ai-empty-sub {
  font-size: 11px;
  max-width: 340px;
}
._ai-lock-sub {
  font-size: 10.5px;
  color: rgba(255,255,255,0.32);
}
._ai-generate-btn {
  margin-top: 6px;
}
._ai-running-msg {
  font-family: var(--mono);
  font-size: 12px;
  color: #e2b85c;
  font-weight: 600;
}
._ai-running-sub {
  font-size: 11px;
}
._ai-error-msg {
  font-family: var(--mono);
  font-size: 12px;
  color: #e63946;
  font-weight: 600;
}

/* Spinner */
._ai-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(226,184,92,0.2);
  border-top-color: #e2b85c;
  border-radius: 50%;
  animation: _ai-spin 0.9s linear infinite;
}
@keyframes _ai-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  ._ai-spinner { animation: none; }
}
    `}</style>
  );
}
