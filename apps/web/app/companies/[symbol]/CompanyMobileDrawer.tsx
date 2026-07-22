// CompanyMobileDrawer.tsx — mobile-only collapse wrapper for heavy table/panel
// sections (財報 7-tab / 籌碼 / 上下游 / 完整資料區). Server Component.
//
// SSR always renders the native <details open> — desktop/tablet keep that
// `open` attribute untouched, so the wrapped panels render exactly as they
// did before this component existed (zero layout/visual change; no CSS
// override games against Chromium's internal ::details-content collapse-
// animation box, which clips content by its own block-size regardless of a
// child element's `display` — overriding a *child's* display cannot restore
// a parent-level clip, which is why an earlier version of this component
// that shipped without `open` and tried to force it open via CSS on desktop
// silently truncated every wrapped section there).
//
// Mobile (<=768px): a tiny synchronous inline script (no React state, no
// "use client") removes the `open` attribute immediately as each drawer is
// parsed — before the browser paints it — so mobile starts collapsed with
// no flash of expanded content. This is the same "no-flash" inline-script
// pattern used by dark-mode toggles; tapping the native <summary> re-opens
// it afterwards via the browser's built-in <details> behavior, zero JS
// needed for the toggle interaction itself.
import type { ReactNode } from "react";

const COLLAPSE_ON_MOBILE_SCRIPT = `(function(s){var d=s.closest("details");if(d&&window.matchMedia("(max-width: 768px)").matches){d.removeAttribute("open");}})(document.currentScript);`;

export function CompanyMobileDrawer({
  id,
  title,
  meta,
  children,
}: {
  id?: string;
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <details id={id} className="_co-mdrawer" open suppressHydrationWarning>
      <summary className="_co-mdrawer-summary">
        <span className="_co-mdrawer-title">{title}</span>
        {meta ? <span className="_co-mdrawer-meta">{meta}</span> : null}
        <span className="_co-mdrawer-chevron" aria-hidden="true">▾</span>
      </summary>
      <div className="_co-mdrawer-body">{children}</div>
      <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: COLLAPSE_ON_MOBILE_SCRIPT }} />
    </details>
  );
}
