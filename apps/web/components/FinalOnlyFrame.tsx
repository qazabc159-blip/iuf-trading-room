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

        @media (max-width: 980px) {
          .iuf-final-content-frame[data-final-screen="paper-trading-room"] {
            left: 0;
            width: 100vw;
            max-width: 100vw;
          }

          body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .app-main-shell {
            width: 100vw !important;
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
