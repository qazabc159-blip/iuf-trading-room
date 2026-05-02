import { PageFrame, Panel } from "@/components/PageFrame";
import { getBriefs } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import type { DailyBrief } from "@iuf-trading-room/contracts";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-TW", { hour12: false });
}

function sortBriefs(briefs: DailyBrief[]) {
  return [...briefs].sort((a, b) => {
    const bTime = Date.parse(b.createdAt);
    const aTime = Date.parse(a.createdAt);
    return bTime - aTime;
  });
}

function statusBadge(status: DailyBrief["status"]) {
  return status === "published" ? "badge-green" : "badge-yellow";
}

function statusLabel(status: DailyBrief["status"]) {
  if (status === "published") return "已發布";
  if (status === "draft") return "草稿";
  return status;
}

function surfaceLabel(state: "EMPTY" | "BLOCKED") {
  return state === "EMPTY" ? "無資料" : "暫停";
}

function marketLabel(value: string | null | undefined) {
  if (value === "Attack") return "進攻";
  if (value === "Selective Attack") return "選擇性進攻";
  if (value === "Defense") return "防守";
  if (value === "Preservation") return "保全";
  return value ?? "市場簡報";
}

function BriefStatePanel({
  state,
  reason,
  updatedAt,
}: {
  state: "EMPTY" | "BLOCKED";
  reason: string;
  updatedAt: string;
}) {
  return (
    <Panel code={`BRF-${state}`} title={surfaceLabel(state)} right="每日簡報來源">
      <div className="state-panel">
        <span className={`badge ${state === "EMPTY" ? "badge-yellow" : "badge-red"}`}>{surfaceLabel(state)}</span>
        <span className="tg soft">來源：每日簡報資料庫</span>
        <span className="tg soft">更新 {formatDateTime(updatedAt)}</span>
        <span className="state-reason">{reason}</span>
      </div>
    </Panel>
  );
}

export default async function BriefsPage() {
  let briefs: DailyBrief[] = [];
  let error: string | null = null;
  const requestedAt = new Date().toISOString();

  try {
    const response = await getBriefs();
    briefs = sortBriefs(response.data ?? []);
  } catch (err) {
    error = friendlyDataError(err, "每日簡報暫時無法讀取。");
  }

  const latest = briefs[0] ?? null;

  return (
    <PageFrame
      code="BRF"
      title="每日簡報"
      sub="正式資料庫的操作員盤前/盤後摘要"
      note="每日簡報 / 真實資料；無資料或 API 暫停時不顯示假簡報。"
    >
      {error && (
        <BriefStatePanel
          state="BLOCKED"
          reason={`簡報資料暫時無法讀取。負責：Jason / Elva。${error}`}
          updatedAt={requestedAt}
        />
      )}

      {!error && !latest && (
        <BriefStatePanel
          state="EMPTY"
          reason="目前工作區沒有每日簡報資料列，不顯示假簡報。"
          updatedAt={requestedAt}
        />
      )}

      {!error && latest && (
        <>
          <Panel
            code="BRF-LIVE"
            title={marketLabel(latest.marketState)}
            sub={latest.date}
            right={
              <span className="source-line" style={{ margin: 0 }}>
                <span className="badge badge-green">正常</span>
                <span>來源：每日簡報資料庫</span>
                <span>更新 {formatDateTime(latest.createdAt)}</span>
              </span>
            }
          >
            <div className="brief-section-list">
              {latest.sections.map((section) => (
                <article className="brief-section" key={`${latest.id}-${section.heading}`}>
                  <h2>{section.heading}</h2>
                  <p>{section.body}</p>
                </article>
              ))}
            </div>
          </Panel>

          <Panel code="BRF-HIST" title="簡報歷史" right={`${briefs.length} 筆`}>
            <div className="brief-history-table">
              <div className="brief-history-row table-head">
                <span>日期</span>
                <span>盤勢</span>
                <span>狀態</span>
                <span>產生者</span>
                <span>建立</span>
              </div>
              {briefs.map((brief) => (
                <div className="brief-history-row" key={brief.id}>
                  <span className="tg gold">{brief.date}</span>
                  <span className="tg">{marketLabel(brief.marketState)}</span>
                  <span className={`badge ${statusBadge(brief.status)}`}>{statusLabel(brief.status)}</span>
                  <span className="tg soft">{brief.generatedBy}</span>
                  <span className="tg soft">{formatDateTime(brief.createdAt)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </PageFrame>
  );
}
