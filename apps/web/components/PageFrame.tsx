function formatTpeParts(date: Date) {
  return {
    date: date.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }),
    time: date.toLocaleTimeString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
    }),
  };
}

export function PageFrame({
  code,
  title,
  sub,
  children,
  exec = false,
  note,
}: {
  code: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
  exec?: boolean;
  note?: React.ReactNode;
}) {
  const generatedAt = formatTpeParts(new Date());

  return (
    <main className="page-frame">
      {exec && <div className="exec-band" aria-hidden />}
      <header className="page-head">
        <div className="page-title">
          <span className="tg page-code">P / {code}</span>
          <h1>{title}</h1>
          {sub && <span className="tc">{sub}</span>}
        </div>
        <div className="tg meta-strip" suppressHydrationWarning>
          <span>更新 / <b>{generatedAt.date} {generatedAt.time}</b> 台北</span>
          <span>資料 / <b className="gold">真實資料</b></span>
          <span>模式 / <b>{exec ? "紙上交易" : "唯讀"}</b></span>
        </div>
        <div className={`tg session-pill ${exec ? "exec" : ""}`}>
          {exec ? "交易層 / 紙上" : "連線 / 真實資料"}
        </div>
      </header>
      {note && <div className="tg terminal-note">{note}</div>}
      {children}
    </main>
  );
}

export function Panel({
  code,
  title,
  sub,
  right,
  children,
}: {
  code: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="tg panel-code">{code}</span>
          <span className="tg muted"> / </span>
          <span className="tg gold">{title}</span>
          {sub && <div className="panel-sub">{sub}</div>}
        </div>
        {right && <div className="tg soft">{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function SectHead({
  code,
  sub,
  right,
  live,
}: {
  code: string;
  sub?: string;
  right?: React.ReactNode;
  exec?: boolean;
  live?: boolean;
}) {
  return (
    <div className="panel-head">
      <div>
        <span className="tg panel-code">{code}</span>
        {live && <span className="tg gold"> / LIVE</span>}
        {sub && <div className="panel-sub">{sub}</div>}
      </div>
      {right && <div className="tg soft">{right}</div>}
    </div>
  );
}
