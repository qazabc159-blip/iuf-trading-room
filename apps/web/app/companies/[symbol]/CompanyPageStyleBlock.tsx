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
  width: 100%;
  max-width: 100%;
  min-width: 0;
}
.company-main-column,
.company-side-column {
  width: 100%;
  max-width: 100%;
  min-width: 0;
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

/* Knowledge panel base min-height. 2026-07-17 update (Pete review #1293 🟡#2):
   blocked/empty/not_found/error no longer render at all (return null, see
   CoverageKnowledgePanel.tsx/IndustryGraphPanel.tsx) — this only still applies
   to the panel's brief loading state before the first fetch resolves. */
._ck-panel,
._ig-panel {
  min-height: 100px;
}

/* state-panel spacing inside knowledge panels (loading state only — was
   24px 0 8px, too tall for a one-line "讀取中" row) */
._ck-panel .state-panel,
._ig-panel .state-panel {
  padding: 10px 0 6px;
}

@media (max-width: 1180px) {
  .company-detail-layout {
    grid-template-columns: minmax(0, 1fr) !important;
    overflow-x: hidden !important;
  }
  .company-main-column {
    grid-template-columns: minmax(0, 1fr) !important;
  }
  .company-side-column {
    position: static !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
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

  /* M2 mobile pass (2026-07-06): back button measured 30px tall at 390px —
     below the 44px touch minimum. */
  ._co-back-btn {
    min-height: 44px;
    padding: 5px 12px;
    font-size: 11px;
  }

  /* Theme card text measured 12.5px/10px — bumped for mobile readability.
     !important guards against DOM-order ties with each panel's own inline
     style element (this block renders earlier in the page than most panels).
     NOTE (2026-07-19 jim3): never spell out the style-tag markup literally
     inside this comment. Writing the four characters open-angle-bracket,
     s-t-y-l-e, close-angle-bracket inside this block's own text content
     triggers React's SSR HTML-safety escaping for that sequence, which the
     RSC hydration payload does not mirror — the two copies of this comment
     then permanently disagree and React throws a hydration error (#418) on
     every single page load. Describe the tag in words only, never in
     angle-bracket form, anywhere in this file's CSS string. */
  ._co-theme-name { font-size: 13px !important; }
  ._co-theme-tier { font-size: 11px !important; }

  /* Industry graph panel's "在公司圖譜搜尋" link measured 27px tall (inline
     style, no min-height) at 390px. */
  ._ig-graph-search-link {
    min-height: 44px !important;
    padding: 8px 12px !important;
  }
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

/* State screens — interactive (running/error): keep centered for usability.
   idle (never generated) uses ._ai-cta-row instead — a single compact line,
   not a full centered empty-state block (2026-07-15 productize round). */
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

/* Compact single-line CTA row for the "not yet generated" idle state. */
._ai-cta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: rgba(5,8,12,0.32);
  border-top: 1px solid rgba(220,228,240,0.06);
}
._ai-cta-msg {
  font-size: 12px;
  color: rgba(255,255,255,0.62);
  line-height: 1.5;
}
._ai-cta-row ._ai-generate-btn {
  margin-top: 0;
  flex-shrink: 0;
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

._ai-lock-icon {
  font-size: 15px;
  flex-shrink: 0;
}
._ai-lock-msg {
  font-family: var(--mono);
  font-size: 11px;
  color: rgba(255,255,255,0.5);
  font-weight: 600;
  flex-shrink: 0;
}
._ai-lock-sub {
  font-size: 10.5px;
  color: rgba(255,255,255,0.32);
}
/* M2 mobile pass (2026-07-06): lock message measured 11px/10.5px at 390px. */
@media (max-width: 480px) {
  ._ai-lock-msg { font-size: 13px; }
  ._ai-lock-sub { font-size: 12px; }
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

/* ── Round 2: _co-hud-stats-strip — supplemental stats row (振幅/52週高低/市值/PBR) ── */
._co-hud-stats-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 112px), 1fr));
  margin-bottom: 14px;
  border: 1px solid rgba(220,228,240,0.09);
  border-left: 3px solid rgba(200,148,63,0.55);
  background: rgba(5,8,12,0.45);
  overflow: hidden;
}
@media (min-width: 900px) {
  ._co-hud-stats-strip {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
._co-hud-stat-cell {
  min-width: 0;
  padding: 10px 14px 11px;
  border-right: 1px solid rgba(220,228,240,0.07);
  border-bottom: 1px solid rgba(220,228,240,0.07);
}
._co-hud-stat-cell:last-child { border-right: none; }
._co-hud-stat-lbl {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--night-mid, #91a0b5);
  margin-bottom: 5px;
  line-height: 1;
}
._co-hud-stat-val {
  min-width: 0;
  font-family: var(--mono);
  font-size: 13.5px;
  font-weight: 700;
  color: var(--night-ink, #e7ecf3);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
._co-hud-stat-sub {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--night-soft, #566276);
  margin-top: 2px;
}
._co-hud-stat-val._co-hud-up { color: rgba(230,57,70,0.88); }
._co-hud-stat-val._co-hud-dn { color: rgba(74,219,136,0.88); }
@media (max-width: 640px) {
  ._co-hud-stats-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  ._co-hud-stat-cell {
    border-bottom: 1px solid rgba(220,228,240,0.07);
    padding: 10px 12px 11px;
  }
}

/* ── Round 2: _co-section-banner — unified section divider replaces company-tabs-band ── */
._co-section-banner {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-top: 24px;
  padding: 12px 4px 12px 16px;
  border-top: 1px solid rgba(220,228,240,0.07);
  border-left: 3px solid rgba(200,148,63,0.55);
  background: rgba(5,8,12,0.28);
}
._co-section-banner-title {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--gold-bright, #e2b85c);
  text-transform: uppercase;
}
._co-section-banner-sub {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--night-ink, #e7ecf3);
}
._co-section-banner-desc {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--night-mid, #91a0b5);
  flex-basis: 100%;
  line-height: 1.55;
  margin-top: 2px;
}
._co-section-banner-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-left: auto;
  align-self: center;
}
._co-section-banner-tags span {
  font-family: var(--mono);
  font-size: 9px;
  padding: 2px 7px;
  border: 1px solid rgba(220,228,240,0.11);
  background: rgba(5,8,12,0.4);
  color: var(--night-mid, #91a0b5);
  letter-spacing: 0.05em;
}

/* ══════════════════════════════════════════════════════════════════════
   v3 redesign skin (2026-07-16, jim2) — scoped strictly under .co-v3-page.
   Ports company_redesign_v1.html "individual stock worksheet" chrome onto
   the EXISTING panel components (FinancialsPanel / ChipsPanel / InstitutionalPanel /
   MarginShortPanel / CoverageKnowledgePanel / IndustryGraphPanel / CompanyInfoPanel /
   SourceStatusCard / AiAnalystReportPanel / OhlcvCandlestickChart / BidAskPanel /
   LiveTickStreamPanel / TickStreamPanel / AnnouncementsPanel) — zero rewrites of
   their render/data logic. Retheme only: tighter panel chrome (CSS var override,
   not padding:0 — internal component spacing stays intact), amber "tab" badge
   headers, and a reusable 2-col equal-height pairrow utility for the section
   groupings the artifact specifies (五檔|逐筆, 知識圖譜|上下游圖譜, 法人籌碼|融資融券).
   ══════════════════════════════════════════════════════════════════════ */

.co-v3-page {
  /* Global panel padding is driven by these two custom properties everywhere
     in globals.css — overriding them here (rather than touching padding
     directly) keeps every nested component's internal spacing assumptions
     intact while still shrinking the "roomy dashboard" gutter down to the
     artifact's dense operator-terminal feel. */
  --hud-gutter-x: 14px;
  --panel-gutter-x: 14px;
}

.co-v3-page .panel.hud-frame {
  padding-top: 10px !important;
  padding-bottom: 14px !important;
  border: 1px solid rgba(220,228,240,0.14) !important;
  border-top: 1px solid rgba(220,228,240,0.14) !important;
  background:
    linear-gradient(105deg, rgba(226,184,92,0.03), transparent 34%),
    linear-gradient(180deg, rgba(10,14,21,0.88), rgba(8,11,17,0.92)) !important;
  box-shadow: 0 0 0 1px rgba(5,7,11,0.55), inset 0 0 40px rgba(0,0,0,0.25) !important;
}
.co-v3-page .panel.hud-frame:hover {
  border-color: rgba(226,184,92,0.32) !important;
}
.co-v3-page .panel.hud-frame.kline-panel {
  padding-top: 8px !important;
  padding-bottom: 8px !important;
}
.co-v3-page .panel + .panel { margin-top: 16px !important; }

/* Section header → amber clip-path "tab" badge, matching the artifact's
   .tab treatment; rest of the ascii-head row becomes hint text. */
.co-v3-page .ascii-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 9px;
  min-height: 30px;
  margin: 0 0 12px !important;
  padding: 0 0 10px !important;
  border-bottom: 1px solid rgba(220,228,240,0.09);
  font-size: 12.5px !important;
}
.co-v3-page .ascii-head-bracket {
  display: inline-flex;
  align-items: center;
  height: 21px;
  padding: 0 13px 0 9px;
  background: var(--gold, #c8943f);
  color: var(--night, #05080c);
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  white-space: nowrap;
  clip-path: polygon(0 0, calc(100% - 7px) 0, 100% 100%, 0 100%);
  margin-right: 0 !important;
}
.co-v3-page .company-info-titlebar .ascii-head-bracket {
  clip-path: polygon(0 0, calc(100% - 7px) 0, 100% 100%, 0 100%);
}

/* Reusable equal-height 2-col pairrow — 五檔|逐筆 / 知識圖譜|上下游圖譜 /
   法人籌碼|融資融券, matching DESIGN_NOTES.md §三 rows 5/6, 8/9, 11/12.
   D1 lesson (2026-07-12 diagnosis): a 2-col split only becomes safe once the
   *main column itself* is wide enough — at a 1180-1439px viewport the side
   rail still reserves 320-360px, squeezing the main column to ~490-620px and
   wrapping every CJK word onto its own line. Reuse the same 1440px-viewport
   threshold this codebase already standardized on rather than inventing a
   second breakpoint. */
.co-v3-pairrow {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  grid-auto-rows: 1fr;
  align-items: stretch;
  margin-top: 16px;
}
.co-v3-pairrow > .panel { margin: 0 !important; height: 100%; }
@media (min-width: 1440px) {
  .co-v3-pairrow { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  /* 空態面板不渲染時只剩一個手足 — 讓它補滿兩欄，不留半版空白
     (2026-07-17 empty-state collapse, DESIGN_NOTES.md §三「空態規則」)。 */
  .co-v3-pairrow > .panel:only-child { grid-column: 1 / -1; }
}
/* 兩側手足都不渲染時（例如盤後五檔+逐筆同時空） pairrow 本身收合，
   避免留下一段沒有內容的 margin-top 空隙。 */
.co-v3-pairrow:empty { display: none; }

/* Financial 7-tab strip → flat amber-active tab row (artifact .fintabs) */
.co-v3-page .company-finance-tabs {
  border: 1px solid rgba(220,228,240,0.14);
  background: rgba(5,8,12,0.5);
  padding: 4px;
  gap: 4px;
}
.co-v3-page .company-finance-tabs .mini-button {
  background: var(--gold, #c8943f) !important;
  border-color: var(--gold, #c8943f) !important;
  color: var(--night, #05080c) !important;
  font-weight: 800 !important;
}
.co-v3-page .company-finance-tabs .outline-button {
  background: transparent !important;
  border-color: rgba(220,228,240,0.16) !important;
}

/* Full-width detail-table / news sections get the same compact chrome */
.co-v3-page .company-data-table-fit th,
.co-v3-page .company-data-table-fit td {
  font-size: 11px;
}
    `}</style>
  );
}
