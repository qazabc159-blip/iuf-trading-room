import { PageFrame, Panel } from "@/components/PageFrame";
import { DataStateBadge } from "@/components/DataStateBadge";
import { getTrackRecordPerformance, type TrackRecordPerformance, type TrackRecordPerformanceResult } from "@/lib/api";
import { getTrackRecordNav } from "@/lib/fauto-sim-api";
import { FAutoNavPanel } from "@/app/ops/f-auto/FAutoNavPanel";
import { formatFractionPct, formatSignedFractionPct, signTone } from "@/lib/weekly-review-format";
import { adaptTrackRecordNavForPanel, buildTrackRecordScoreWindows, formatTrackRecordRangeText } from "@/lib/track-record-format";

// Both sections do a per-request SSR fetch that forwards the visiting user's
// session cookie (see requestRaw / apiFetch in lib/api.ts + lib/fauto-sim-api.ts).
// Without this, Next.js would statically prerender the page once at build time
// with no cookie context, baking in a permanent stale snapshot for everyone.
export const dynamic = "force-dynamic";

/**
 * /track-record — 公開績效記帳頁 (P0-C)
 *
 * 三區塊，全部走誠實四態（見 DataStateBadge）：
 *   A. AI 推薦成績單 — GET /api/v1/track-record/performance（login-only 公開唯讀端點，#1177）
 *   B. F-AUTO 策略連續 NAV — GET /api/v1/track-record/nav（login-only 公開唯讀端點，#1177，沿用 #1155 FAutoNavPanel）
 *   C. 策略把關紀錄 — 靜態文字，說明自家統計檢定如何淘汰過擬合策略
 *
 * A/B 兩支端點原本是 Owner-only（`/api/v1/admin/ai-rec/performance`、
 * `/api/v1/portfolio/f-auto/nav`）——裁決是不鬆綁那兩支，改由 #1177 開了兩支
 * 白名單欄位的 login-only 公開版本。本頁改吃這兩支新端點；任何已登入角色皆可讀。
 * 欄位比 Owner 版本瘦（見 `lib/api.ts` / `lib/fauto-sim-api.ts` 的型別註解），
 * NAV 曲線缺的 returnPct/weekNum 由 `adaptTrackRecordNavForPanel()` 在前端補算。
 */

function AuthIssueNotice({ code, title, sub }: { code: string; title: string; sub: string }) {
  return (
    <Panel code={code} title={title} sub={sub}>
      <div className="_trk-empty">
        <DataStateBadge state="empty" reason="登入階段異常，請重新整理或重新登入後再試" />
      </div>
    </Panel>
  );
}

function UnavailableNotice({ code, title, sub }: { code: string; title: string; sub: string }) {
  return (
    <Panel code={code} title={title} sub={sub}>
      <div className="_trk-empty">
        <DataStateBadge state="empty" reason="資料服務暫時無法讀取，稍後重新整理再試" />
      </div>
    </Panel>
  );
}

function AiRecScorecardSection({ result }: { result: TrackRecordPerformanceResult }) {
  if (!result.ok) {
    if (result.reason === "forbidden") {
      return <AuthIssueNotice code="TRK-AI" title="AI 推薦成績單" sub="每一筆 AI 判斷都被記帳" />;
    }
    return <UnavailableNotice code="TRK-AI" title="AI 推薦成績單" sub="每一筆 AI 判斷都被記帳" />;
  }

  const perf: TrackRecordPerformance = result.data;

  if (perf.total_picks === 0) {
    return (
      <Panel code="TRK-AI" title="AI 推薦成績單" sub="每一筆 AI 判斷都被記帳">
        <div className="_trk-empty">
          <DataStateBadge state="empty" reason="尚無推薦樣本可供統計" eta="累積首批樣本後自動顯示" />
        </div>
      </Panel>
    );
  }

  const rangeText = formatTrackRecordRangeText(perf);
  const windows = buildTrackRecordScoreWindows(perf);

  return (
    <Panel
      code="TRK-AI"
      title="AI 推薦成績單"
      sub="每一筆 AI 判斷都被記帳"
      right={`基準 ${perf.benchmark}`}
    >
      <div className="_trk-sample-line">
        樣本 <b>{perf.total_picks}</b> 筆推薦{rangeText ? `，${rangeText}` : ""}
      </div>
      <div className="_trk-grid">
        {windows.map((w) => {
          return (
            <div key={w.label} className="_trk-cell">
              <span className="_trk-cell-label">{w.label}勝率</span>
              {w.smallSample ? (
                <span className="_trk-cell-pending">紀錄累積中，不足以下結論</span>
              ) : (
                <>
                  <b>{formatFractionPct(w.hit)}</b>
                  {w.excess !== null && (
                    <span className={`_trk-excess _trk-tone-${signTone(w.excess)}`}>
                      超額 {formatSignedFractionPct(w.excess)} vs {perf.benchmark}
                    </span>
                  )}
                </>
              )}
              <i>{w.sample} 筆已驗證</i>
            </div>
          );
        })}
      </div>
      <p className="_trk-note">
        勝率＝推薦後相對 {perf.benchmark} 有超額報酬的比例。此為事後績效追蹤，非未來報酬保證，過去表現不代表未來結果。
      </p>
    </Panel>
  );
}

async function FAutoNavSection() {
  const res = await getTrackRecordNav();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return <AuthIssueNotice code="TRK-NAV" title="F-AUTO 策略連續 NAV" sub="S1 全流程實單記帳" />;
    }
    return <UnavailableNotice code="TRK-NAV" title="F-AUTO 策略連續 NAV" sub="S1 全流程實單記帳" />;
  }

  return <FAutoNavPanel data={adaptTrackRecordNavForPanel(res.data)} phase="live" />;
}

function StrategyGateSection() {
  return (
    <Panel code="TRK-GATE" title="策略把關紀錄" sub="我們用統計檢定審自己的策略">
      <div className="_trk-gate-body">
        <p>
          每一支要成為主力策略的量化模型，在正式上架前與上架後都要持續通過一套學術級統計檢定
          （樣本外驗證、統計顯著性門檻、過擬合風險評估），不是回測數字好看就能掛牌。
        </p>
        <p className="_trk-gate-case">
          <b>2026-07-01：</b> S1 策略經內部統計檢定判定過度配適（over-fitting）風險偏高，
          隨即降級並凍結交易資格。判定依據包含樣本外驗證未達標、統計顯著性不足，
          以及對照組真實績效遠低於原始回測估計值。
        </p>
        <p className="_trk-gate-note">
          這代表我們寧可先自己拆穿看起來很漂亮的策略，也不把未經檢驗的回測數字當成賣點。
        </p>
      </div>
    </Panel>
  );
}

export default async function TrackRecordPage() {
  const aiRecResult = await getTrackRecordPerformance();

  return (
    <PageFrame code="TRK" title="公開績效記帳" sub="每個 AI 判斷都被記帳，好壞都攤在這裡">
      <style>{TRACK_RECORD_CSS}</style>
      <div className="_trk-sections">
        <AiRecScorecardSection result={aiRecResult} />
        <FAutoNavSection />
        <StrategyGateSection />
      </div>
      <p className="_trk-disclaimer">
        以上數字皆為歷史記帳結果，非投資建議、非招攬，過去績效不代表未來表現。
      </p>
    </PageFrame>
  );
}

const TRACK_RECORD_CSS = `
._trk-sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
._trk-empty {
  padding: 18px 4px;
  display: flex;
  align-items: center;
}
._trk-sample-line {
  font: 700 13px/1.4 var(--sans-tc);
  color: var(--tac-fg-2);
  margin-bottom: 12px;
}
._trk-sample-line b {
  font: 850 20px/1 var(--mono);
  color: var(--tac-fg-0);
  margin: 0 2px;
}
._trk-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
._trk-cell {
  display: grid;
  gap: 4px;
  border: 1px solid var(--tac-line);
  border-radius: 8px;
  padding: 12px 14px;
  background: rgba(8, 11, 16, 0.42);
  min-width: 0;
}
._trk-cell-label { font: 700 10.5px/1.2 var(--sans-tc); color: var(--tac-fg-3); }
._trk-cell b { font: 850 19px/1.1 var(--mono); color: var(--tac-fg-0); }
._trk-cell-pending {
  font: 700 11.5px/1.4 var(--sans-tc);
  color: var(--tac-warn, #e2b85c);
}
._trk-excess { font: 600 10.5px/1.3 var(--sans-tc); }
._trk-tone-ok { color: var(--tac-ok, #4adb88); }
._trk-tone-bad { color: var(--tac-bad, #ff6b77); }
._trk-tone-dim { color: var(--tac-fg-3); }
._trk-cell i { font: 500 10px/1.3 var(--sans-tc); color: var(--tac-fg-3); font-style: normal; }
._trk-note { margin: 10px 0 0; font: 500 11px/1.6 var(--sans-tc); color: var(--tac-fg-2); }

._trk-gate-body p { margin: 0 0 10px; font: 500 12.5px/1.7 var(--sans-tc); color: var(--tac-fg-2); }
._trk-gate-body p:last-child { margin-bottom: 0; }
._trk-gate-case { border-left: 2px solid var(--tac-warn, #e2b85c); padding-left: 12px; }
._trk-gate-note { color: var(--tac-fg-3); }

._trk-disclaimer {
  margin: 18px 2px 0;
  font: 600 11px/1.6 var(--sans-tc);
  color: var(--tac-fg-3);
  text-align: center;
}

@media (max-width: 640px) {
  ._trk-grid { grid-template-columns: 1fr; }
  ._trk-sample-line { font-size: 12px; }
}
`;
