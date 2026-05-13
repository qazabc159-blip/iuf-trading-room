type FinalOnlyFrameProps = {
  src: string;
  title: string;
};

export function FinalOnlyFrame({ src, title }: FinalOnlyFrameProps) {
  return (
    <main className="iuf-final-only-frame" aria-label={title}>
      <style>{`
        html,
        body {
          overflow: hidden !important;
          background: #080b10 !important;
        }

        .app-sidebar {
          display: none !important;
        }

        .app-main-shell {
          width: 100vw !important;
          min-height: 100dvh !important;
          margin-left: 0 !important;
          padding: 0 !important;
          background: #080b10 !important;
        }

        .iuf-final-only-frame {
          position: fixed;
          inset: 0;
          z-index: 1000;
          width: 100vw;
          height: 100dvh;
          background: #080b10;
        }

        .iuf-final-only-frame iframe {
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
      />
    </main>
  );
}
