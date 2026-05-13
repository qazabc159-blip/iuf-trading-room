type FinalOnlyFrameProps = {
  src: string;
  title: string;
};

export function FinalOnlyFrame({ src, title }: FinalOnlyFrameProps) {
  return (
    <main className="iuf-final-content-frame" aria-label={title}>
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
      />
    </main>
  );
}
