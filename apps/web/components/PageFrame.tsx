function formatTpeParts(date: Date) {
  return {
    date: date.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }),
    time: date.toLocaleTimeString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
    }),
  };
}

export function statusLabel(value: "LIVE" | "EMPTY" | "BLOCKED" | "LOADING" | string) {
  if (value === "LIVE") return "正常";
  if (value === "EMPTY") return "無資料";
  if (value === "BLOCKED") return "暫停";
  if (value === "LOADING") return "讀取中";
  return value;
}

function displayCode(code: string) {
  const exact: Record<string, string> = {
    "01": "戰情台",
    "02": "主題板",
    "03": "公司板",
    "04": "策略想法",
    "05": "策略批次",
    "06": "交易室",
    "07": "訊號證據",
    "08": "交易計畫",
    "09": "營運監控",
    "10": "重大訊息",
    "11": "量化研究",
    "03-ERR": "公司板 / 錯誤",
    "03-NF": "公司板 / 無資料",
    "05-D": "策略批次 / 明細",
    "06-PORT": "交易室",
    "LAB-D": "量化研究明細",
  };

  if (exact[code]) return exact[code];
  if (/^\d{2}$/.test(code)) return code;
  if (/^\d{2}-/.test(code)) return code.replace("-", " / ");

  const prefix = code.split(/[-_]/)[0];
  const labels: Record<string, string> = {
    ADM: "管理",
    AUD: "稽核",
    BRF: "簡報",
    BT: "回測",
    CMP: "公司",
    CO: "公司",
    DIV: "回饋",
    DRF: "草稿",
    DUP: "重複資料",
    EXC: "成交",
    IDA: "想法",
    IDEA: "策略想法",
    INT: "重大訊息",
    JOB: "背景工作",
    KIL: "交易模式",
    LAB: "量化研究",
    LAT: "最近資料",
    MEM: "成員",
    MKT: "市場",
    OPS: "營運",
    ORD: "委託",
    PLAN: "計畫",
    PLN: "計畫",
    POS: "部位",
    PROMO: "發布",
    QTE: "報價",
    REV: "複核",
    RISK: "風控",
    RSK: "風控",
    RUN: "策略批次",
    RUNS: "策略批次",
    SIG: "訊號",
    SRC: "資料來源",
    THM: "主題",
    WCH: "觀察清單",
  };

  return labels[prefix] ?? code;
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
          <span className="tg page-code">頁 / {displayCode(code)}</span>
          <h1>{title}</h1>
          {sub && <span className="tc">{sub}</span>}
        </div>
        <div className="tg meta-strip" suppressHydrationWarning>
          <span>產生 / <b suppressHydrationWarning>{generatedAt.date} {generatedAt.time}</b> 台北</span>
          <span>工作階段 / <b className="gold">真實資料</b></span>
          <span>模式 / <b>{exec ? "模擬交易" : "觀察"}</b></span>
        </div>
        <div className={`tg session-pill ${exec ? "exec" : ""}`}>
          {exec ? "交易室 / 模擬" : "盤面 / 真實資料"}
        </div>
      </header>
      {note && <div className="terminal-note">{note}</div>}
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
          <span className="tg panel-code">{displayCode(code)}</span>
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
        <span className="tg panel-code">{displayCode(code)}</span>
        {live && <span className="tg gold"> / 正常</span>}
        {sub && <div className="panel-sub">{sub}</div>}
      </div>
      {right && <div className="tg soft">{right}</div>}
    </div>
  );
}
