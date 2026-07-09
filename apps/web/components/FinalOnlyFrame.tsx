type FinalOnlyFrameProps = {
  src: string;
  title: string;
};

export function FinalOnlyFrame({ src, title }: FinalOnlyFrameProps) {
  const isTradingRoom = src.includes("paper-trading-room");

  return (
    <main
      className="iuf-final-content-frame"
      data-final-screen={isTradingRoom ? "paper-trading-room" : "final-v031"}
      aria-label={title}
    >
      <style>{`
        .app-main-shell {
          background: #080b10 !important;
          padding: 0 !important;
        }

        .iuf-final-content-frame {
          width: 100%;
          height: 100dvh;
          min-height: 100dvh;
          background: #080b10;
          overflow: hidden;
        }

        .iuf-final-content-frame[data-final-screen="paper-trading-room"] {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          left: 252px;
          z-index: 2147483000;
          width: calc(100vw - 252px);
          height: 100dvh;
          max-width: calc(100vw - 252px);
          min-height: 0;
          isolation: isolate;
        }

        html:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]),
        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) {
          width: 100%;
          height: 100dvh;
          max-width: 100vw;
          overflow: hidden !important;
        }

        body.app-root:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) {
          display: flex !important;
          min-height: 0 !important;
          background: #080b10 !important;
        }

        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .app-main-shell {
          display: block !important;
          width: calc(100vw - 252px) !important;
          height: 100dvh !important;
          min-width: 0 !important;
          min-height: 0 !important;
          overflow: hidden !important;
        }

        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .app-sidebar {
          position: relative !important;
          z-index: 2147483001 !important;
          height: 100dvh !important;
          min-height: 100dvh !important;
          overflow: hidden !important;
        }

        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .source-badge,
        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .command-palette,
        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .header-dock,
        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .header-dock-scrim,
        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .header-dock-drawer {
          visibility: hidden !important;
          display: none !important;
          pointer-events: none !important;
        }

        /* Mobile M4 (2026-07-09): below the layout breakpoint where the app
           shell already collapses .app-sidebar into a sticky top nav bar
           (globals.css @media max-width:1000px), there is no reserved
           252px column left for the desktop trick above (position:relative
           + height:100dvh + z-index above the frame, which exists purely to
           keep the sidebar visible/clickable next to the fixed frame). Left
           unscoped, that desktop-only trick still applied here too and blew
           the sidebar up into a full-viewport opaque overlay that
           intercepted every tap on the embedded trading room (P0 gap found
           during PR-4 mobile pass, see reports/unified_order_frontend_20260709
           /PR4_VERIFICATION.md). Fix: on mobile, stack the sidebar (natural
           height, in-flow) above the frame in a column instead of layering
           it on top with a fixed height. */
        @media (max-width: 980px) {
          body.app-root:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) {
            flex-direction: column !important;
          }

          body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .app-sidebar {
            position: static !important;
            z-index: auto !important;
            height: auto !important;
            min-height: 0 !important;
            flex: 0 0 auto !important;
            width: 100% !important;
          }

          body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .app-main-shell {
            display: flex !important;
            width: 100vw !important;
            flex: 1 1 auto !important;
            min-height: 0 !important;
          }

          .iuf-final-content-frame[data-final-screen="paper-trading-room"] {
            position: static;
            left: auto;
            top: auto;
            right: auto;
            bottom: auto;
            width: 100%;
            max-width: 100vw;
            height: auto;
            min-height: 0;
            flex: 1 1 auto;
          }
        }

        .iuf-final-content-frame iframe {
          display: block;
          width: 100%;
          height: 100%;
          border: 0;
          background: #080b10;
        }
      `}</style>
      <iframe
        title={title}
        src={src}
        loading="eager"
        referrerPolicy="same-origin"
        scrolling={isTradingRoom ? "no" : undefined}
      />
    </main>
  );
}
