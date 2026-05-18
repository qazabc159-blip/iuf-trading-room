import type { ReactNode } from "react";

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
  if (value === "LIVE") return "即時";
  if (value === "EMPTY") return "無資料";
  if (value === "BLOCKED") return "受阻";
  if (value === "LOADING") return "載入中";
  return value;
}

function displayCode(code: string) {
  const exact: Record<string, string> = {
    "01": "戰情台",
    "02": "市場情報",
    "03": "公司",
    "04": "交易室",
    "05": "策略實驗",
    "06": "投組",
    "07": "警示",
    "08": "訊號",
    "09": "計畫",
    "10": "主題",
    "11": "執行",
    "12": "AI 摘要",
    "03-ERR": "公司 / 錯誤",
    "03-NF": "公司 / 找不到",
    "05-D": "策略 / 詳情",
    "06-PORT": "投組 / 部位",
    "LAB-D": "策略 / 詳情",
    "AI-01": "AI 推薦",
    "AI-02": "AI 推薦",
    "AI-D": "AI 推薦 / 詳情",
  };

  if (exact[code]) return exact[code];
  if (code.startsWith("AI-")) return "AI 推薦 / 詳情";
  if (code.startsWith("QNT-")) return "量化策略 / 詳情";
  if (code.startsWith("10-")) return "主題 / 詳情";
  if (code.startsWith("12-")) return "AI 摘要 / 詳情";

  const prefix = code.split(/[-_]/)[0];
  const labels: Record<string, string> = {
    ADM: "管理",
    ALR: "警示",
    AUD: "稽核",
    BRF: "摘要",
    BT: "回測",
    CMP: "公司",
    CO: "公司",
    DIV: "除權息",
    DRF: "草稿",
    DUP: "重複公司",
    EXC: "交易",
    IDA: "想法",
    IDEA: "想法",
    AI: "AI 推薦",
    INT: "市場情報",
    JOB: "工作",
    KIL: "熔斷",
    LAB: "策略",
    LAT: "延遲",
    MEM: "記憶",
    MKT: "市場情報",
    OPS: "營運",
    ORD: "委託",
    PLAN: "交易計畫",
    PLN: "交易計畫",
    POS: "部位",
    PROMO: "推廣",
    QTE: "報價",
    QNT: "量化策略",
    REV: "複盤",
    RISK: "風控",
    RSK: "風控",
    RUN: "策略執行",
    RUNS: "策略執行",
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
  children: ReactNode;
  exec?: boolean;
  note?: ReactNode;
}) {
  const generatedAt = formatTpeParts(new Date());

  return (
    <main className="page-frame">
      {exec && <div className="exec-band" aria-hidden />}
      <header className="page-head">
        <div className="page-title">
          <span className="tg page-code">{displayCode(code)}</span>
          <h1>{title}</h1>
          {sub && <span className="tc">{sub}</span>}
        </div>
        <div className="tg meta-strip" suppressHydrationWarning>
          <span>
            台北 / <b suppressHydrationWarning>{generatedAt.date} {generatedAt.time}</b>
          </span>
          <span>資料 / <b className="gold">正式資料</b></span>
          <span>模式 / <b>{exec ? "模擬交易" : "觀察與研究"}</b></span>
        </div>
        <div className={`tg session-pill ${exec ? "exec" : ""}`}>
          {exec ? "SIM / 受控" : "研究 / 前端資料"}
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
  right?: ReactNode;
  children: ReactNode;
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
  right?: ReactNode;
  exec?: boolean;
  live?: boolean;
}) {
  return (
    <div className="panel-head">
      <div>
        <span className="tg panel-code">{displayCode(code)}</span>
        {live && <span className="tg gold"> / 即時</span>}
        {sub && <div className="panel-sub">{sub}</div>}
      </div>
      {right && <div className="tg soft">{right}</div>}
    </div>
  );
}
