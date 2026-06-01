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

        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) {
          overflow: hidden !important;
        }

        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .header-dock,
        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .header-dock-scrim,
        body:has(.iuf-final-content-frame[data-final-screen="paper-trading-room"]) .header-dock-drawer {
          display: none !important;
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
