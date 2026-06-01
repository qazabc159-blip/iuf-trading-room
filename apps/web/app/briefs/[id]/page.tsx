import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import {
  getBriefDetail,
  type BriefDetail,
  type BriefDetailAuditChain,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline, cleanNarrativeText, formatBriefSourceTrail } from "@/lib/operator-copy";
import { evaluateBriefQuality } from "../briefQuality";

export const dynamic = "force-dynamic";

type LoadResult =
  | { kind: "OK"; data: BriefDetail }
  | { kind: "NOT_FOUND" }
  | { kind: "ERROR"; reason: string };

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function maskUnsafeAdviceText(text: string) {
  const patterns = [
    /買進/g,
    /賣出/g,
    /目標價/g,
    /必賺/g,
    /保證/g,
    /勝率/g,
  ];
  return patterns.reduce(
    (next, pattern) => next.replace(pattern, "[投資建議字詞已遮蔽]"),
    text,
  );
}

function safeBriefText(text: string) {
  return maskUnsafeAdviceText(cleanNarrativeText(text));
}

function safeHeadline(text: string) {
  return maskUnsafeAdviceText(cleanExternalHeadline(text));
}

function isNotFoundError(message: string) {
  if (!message) return false;
  if (message.includes("not_found")) return true;
  if (message.includes("Request failed: 404")) return true;
  return false;
}

async function loadBrief(id: string): Promise<LoadResult> {
  try {
    const response = await getBriefDetail(id);
    return { kind: "OK", data: response.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isNotFoundError(message)) {
      return { kind: "NOT_FOUND" };
    }
    return {
      kind: "ERROR",
      reason: friendlyDataError(error, "簡報明細暫時無法讀取。"),
    };
  }
}

function statusLabel(status: string) {
  if (status === "published") return "已發布";
  if (status === "awaiting_review") return "待審核";
  if (status === "rejected") return "已退回";
  if (status === "error") return "需處理";
  return status;
}

function statusParityClass(status: string) {
  if (status === "published") return "ok";
  if (status === "awaiting_review") return "warn";
  if (status === "rejected" || status === "error") return "bad";
  return "dim";
}

function auditVerdictLabel(value: string | null | undefined) {
  if (value === "OK") return "通過";
  if (value === "INTERCEPTED") return "攔截";
  if (value === "PARTIAL_HALLUCINATED") return "部分需查核";
  if (value === "HALLUCINATED") return "未通過";
  return "尚未完成";
}

function auditVerdictParityClass(value: string | null | undefined) {
  if (value === "OK") return "ok";
  if (value === "PARTIAL_HALLUCINATED") return "warn";
  if (value) return "bad";
  return "dim";
}

function HardRejectPanel({ chain }: { chain: BriefDetailAuditChain }) {
  const { rules, rejected } = chain.hardReject;
  const label = rejected ? "不可發布" : "通過";
  return (
    <Panel
      code="BRF-HR"
      title="政策檢查"
      sub="不可發布條件"
      right={label}
    >
      <div className="brief-three-state">
        <span className={`parity-badge ${rejected ? "bad" : "ok"}`}>
          {label}
        </span>
        <span className="tg soft">共 {rules.length} 條規則</span>
      </div>
      <ul
        className="brief-source-trail"
        style={{ flexDirection: "column", alignItems: "flex-start" }}
      >
        {rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </Panel>
  );
}

function AdversarialReviewPanel({ chain }: { chain: BriefDetailAuditChain }) {
  const review = chain.adversarialReview;
  if (!review) {
    const sourceOnlyGate = chain.sourceOnlyGate;
    if (sourceOnlyGate?.verdict === "OK") {
      return (
        <Panel
          code="BRF-ADV"
          title="風險審核"
          sub="內容風險與發布檢查"
          right="來源門檻通過"
        >
          <div className="brief-three-state">
            <span className="parity-badge ok">來源門檻通過</span>
            <span className="tg soft">歷史補產生簡報</span>
          </div>
          <div className="brief-source-trail">
            <span>審核時間：{formatDateTime(sourceOnlyGate.auditedAt)}</span>
            {sourceOnlyGate.sourcePackId && <span>資料包：{sourceOnlyGate.sourcePackId}</span>}
          </div>
          <p className="muted-copy" style={{ margin: "12px 0 0" }}>
            這份簡報是依來源資料包補產生，未走完整 LLM 風險審核；系統已確認來源門檻與資料軌跡完整，
            因此不再顯示成未審核。
          </p>
        </Panel>
      );
    }
    return (
      <Panel
        code="BRF-ADV"
        title="風險審核"
        sub="內容風險與發布檢查"
        right="未審核"
      >
        <div className="parity-empty" style={{ minHeight: 100 }}>
          <div className="parity-empty-icon">?</div>
          <h3>尚未審核</h3>
          <p>這份簡報尚未完成風險審核；不會把未審核內容當成正式通過。</p>
        </div>
      </Panel>
    );
  }

  const verdictClass = auditVerdictParityClass(review.verdict);
  const severityText =
    typeof review.severityScore === "number"
      ? review.severityScore.toFixed(1)
      : "--";

  return (
    <Panel
      code="BRF-ADV"
      title="風險審核"
      sub="內容風險與發布檢查"
      right={auditVerdictLabel(review.verdict)}
    >
      {/* parity-kpi-bar for audit metrics */}
      <div className="parity-kpi-bar" style={{ margin: "0 0 14px" }}>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">判定</span>
          <span className={`parity-kpi-value ${verdictClass}`} style={{ fontSize: 16 }}>
            {auditVerdictLabel(review.verdict)}
          </span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">風險分數</span>
          <span className={`parity-kpi-value ${typeof review.severityScore === "number" && review.severityScore >= 7 ? "bad" : "dim"}`}>
            {severityText}
          </span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">旗標數</span>
          <span className={`parity-kpi-value ${review.flags.length > 0 ? "warn" : "dim"}`}>
            {review.flags.length}
          </span>
        </div>
      </div>
      <div className="brief-source-trail">
        <span>審核時間：{formatDateTime(review.auditedAt)}</span>
      </div>
      {review.flags.length > 0 && (
        <ul
          className="brief-source-trail"
          style={{ flexDirection: "column", alignItems: "flex-start" }}
        >
          {review.flags.map((flag, index) => (
            <li key={`${flag}:${index}`}>{flag}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function HallucinationPanel({ chain }: { chain: BriefDetailAuditChain }) {
  const hc = chain.hallucinationCheck;
  if (!hc) {
    const sourceOnlyGate = chain.sourceOnlyGate;
    if (sourceOnlyGate?.verdict === "OK") {
      return (
        <Panel
          code="BRF-HC"
          title="事實查核"
          sub="敘述與來源比對"
          right="來源比對通過"
        >
          <div className="brief-three-state">
            <span className="parity-badge ok">來源比對通過</span>
            <span className="tg soft">sourceTrail 已保留</span>
          </div>
          <div className="brief-source-trail">
            <span>審核時間：{formatDateTime(sourceOnlyGate.auditedAt)}</span>
            {sourceOnlyGate.confidence !== null && (
              <span>信心度：{sourceOnlyGate.confidence.toFixed(2)}</span>
            )}
          </div>
          <p className="muted-copy" style={{ margin: "12px 0 0" }}>
            這份簡報使用確定性來源資料與逐段 sourceTrail，不是即時 LLM RAG 查核結果；
            目前顯示的是來源門檻查核通過狀態，避免把已通過的補產簡報誤標成尚未查核。
          </p>
        </Panel>
      );
    }
    return (
      <Panel
        code="BRF-HC"
        title="事實查核"
        sub="敘述與來源比對"
        right="未審核"
      >
        <div className="parity-empty" style={{ minHeight: 100 }}>
          <div className="parity-empty-icon">?</div>
          <h3>尚未查核</h3>
          <p>這份簡報尚未完成事實查核；不會把未查核內容當成正式通過。</p>
        </div>
      </Panel>
    );
  }

  const verdictClass = auditVerdictParityClass(hc.verdict);
  const confidenceText =
    typeof hc.confidence === "number" ? hc.confidence.toFixed(2) : "--";

  return (
    <Panel
      code="BRF-HC"
      title="事實查核"
      sub="敘述與來源比對"
      right={auditVerdictLabel(hc.verdict)}
    >
      {/* parity-kpi-bar for hallucination metrics */}
      <div className="parity-kpi-bar" style={{ margin: "0 0 14px" }}>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">判定</span>
          <span className={`parity-kpi-value ${verdictClass}`} style={{ fontSize: 16 }}>
            {auditVerdictLabel(hc.verdict)}
          </span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">信心度</span>
          <span className="parity-kpi-value dim">
            {confidenceText}
          </span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">來源比對</span>
          <span className={`parity-kpi-value ${hc.ragUsed ? "ok" : "dim"}`} style={{ fontSize: 16 }}>
            {hc.ragUsed ? "已執行" : "待補"}
          </span>
        </div>
      </div>
      <div className="brief-source-trail">
        <span>審核時間：{formatDateTime(hc.auditedAt)}</span>
        <span>旗標數：{hc.flags.length}</span>
      </div>
      {hc.flags.length > 0 && (
        <ul
          className="brief-source-trail"
          style={{ flexDirection: "column", alignItems: "flex-start" }}
        >
          {hc.flags.map((flag, index) => {
            const text = typeof flag === "string" ? flag : JSON.stringify(flag);
            return <li key={`${text}:${index}`}>{text}</li>;
          })}
        </ul>
      )}
    </Panel>
  );
}

function BriefBodyPanel({ brief }: { brief: BriefDetail }) {
  const quality = evaluateBriefQuality(brief);

  if (!quality.displayable) {
    return (
      <Panel
        code="BRF-PUB"
        title="簡報內容"
        sub={`${brief.date} / 已暫停展示`}
        right="模板未通過"
      >
        <div className="brief-published">
          <div className="brief-market-state">
            <span className="tg gold">資料保護</span>
            <strong>這份簡報不符合 AI 每日簡報 v2 模板，已停止展示正文。</strong>
          </div>
          <p className="state-reason">
            系統偵測到舊版英文標題、原始主題 dump，或缺少固定段落。為避免把未整理內容當成投資依據，
            這裡只保留審核與來源資訊，不顯示舊簡報正文。
          </p>
          <div className="brief-source-trail">
            <span>缺少段落：{quality.missingHeadings.length ? quality.missingHeadings.join("、") : "無"}</span>
            <span>舊版英文標題：{quality.hasLegacyHeading ? "有" : "無"}</span>
            <span>原始 dump：{quality.hasRawDump ? "有" : "無"}</span>
          </div>
          <p className="state-reason">
            下一輪每日簡報會套用 v2 固定模板：市場總覽、AI 精選重點、產業與主題、風險觀察、資料來源狀態。
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      code="BRF-PUB"
      title="簡報內容"
      sub={`${brief.date} / 正式內容`}
      right={statusLabel(brief.status)}
    >
      <div className="brief-published">
        <div className="brief-market-state">
          <span className="tg gold">盤勢狀態</span>
          <strong>{safeHeadline(brief.marketState)}</strong>
        </div>
        {brief.sections.length === 0 && (
          <div className="parity-empty" style={{ minHeight: 120 }}>
            <div className="parity-empty-icon">◌</div>
            <h3>沒有段落內容</h3>
            <p>這份簡報沒有段落內容；請回每日簡報頁確認來源與審核狀態。</p>
          </div>
        )}
        {brief.sections.map((section, index) => (
          <article className="brief-section" key={`${section.heading}:${index}`}>
            <span className="tg muted">#{String(index + 1).padStart(2, "0")}</span>
            <h3>{safeHeadline(section.heading)}</h3>
            <p>{safeBriefText(section.body)}</p>
            {section.sourceTrail && (
              <div className="brief-source-trail">
                <span className="tg gold">來源</span>
                <span>{formatBriefSourceTrail(section.sourceTrail)}</span>
              </div>
            )}
            {!section.sourceTrail && (
              <div className="brief-source-trail">
                <span className="tg muted">
                  來源紀錄尚未完整，這段不作投資依據。
                </span>
              </div>
            )}
          </article>
        ))}
      </div>
    </Panel>
  );
}

function NotFoundView() {
  return (
    <PageFrame
      code="BRF-NF"
      title="簡報不存在"
      sub="找不到指定簡報"
      note="這份簡報可能已被刪除或尚未產生；頁面不會用假內容補位。"
    >
      <div className="parity-empty">
        <div className="parity-empty-icon">✕</div>
        <h3>簡報不存在</h3>
        <p>請改回 <Link href="/briefs">每日簡報列表</Link> 或檢查 id 是否正確。</p>
      </div>
    </PageFrame>
  );
}

function ErrorView({ reason }: { reason: string }) {
  return (
    <PageFrame
      code="BRF-ERR"
      title="簡報明細讀取失敗"
      sub="請稍後重試"
      note="簡報明細暫時無法讀取；不顯示任何快取或假資料。"
    >
      <div className="parity-empty">
        <div className="parity-empty-icon">!</div>
        <h3>讀取失敗</h3>
        <p>{reason}</p>
        <p style={{ marginTop: 8 }}>請改回 <Link href="/briefs">每日簡報列表</Link> 重試。</p>
      </div>
    </PageFrame>
  );
}

export default async function BriefDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await loadBrief(id);

  if (result.kind === "NOT_FOUND") {
    return <NotFoundView />;
  }

  if (result.kind === "ERROR") {
    return <ErrorView reason={result.reason} />;
  }

  const brief = result.data;
  const quality = evaluateBriefQuality(brief);
  const displayTitle = quality.displayable ? safeHeadline(brief.title) : "每日簡報內容暫停展示";
  const isPublished = brief.status === "published";
  const totalSections = brief.sections.length;
  const sourceOnlyGateOk = brief.auditChain.sourceOnlyGate?.verdict === "OK";
  const riskAuditLabel = brief.auditChain.adversarialReview
    ? auditVerdictLabel(brief.auditChain.adversarialReview.verdict)
    : sourceOnlyGateOk ? "來源門檻通過" : "尚未完成";
  const riskAuditClass = brief.auditChain.adversarialReview
    ? auditVerdictParityClass(brief.auditChain.adversarialReview.verdict)
    : sourceOnlyGateOk ? "ok" : "dim";
  const factAuditLabel = brief.auditChain.hallucinationCheck
    ? auditVerdictLabel(brief.auditChain.hallucinationCheck.verdict)
    : sourceOnlyGateOk ? "來源比對通過" : "尚未完成";
  const factAuditClass = brief.auditChain.hallucinationCheck
    ? auditVerdictParityClass(brief.auditChain.hallucinationCheck.verdict)
    : sourceOnlyGateOk ? "ok" : "dim";

  return (
    <PageFrame
      code="BRF-D"
      title={displayTitle}
      sub={`${brief.date} / 正式簡報`}
      note="此頁顯示單份簡報內容、政策檢查、風險審核與事實查核，不提供買賣建議。"
    >
      {/* parity-hero: title + status hero */}
      <div className="parity-hero">
        <div className="parity-hero-eyebrow">DAILY BRIEF — {brief.date}</div>
        <h2>{displayTitle}</h2>
        <p style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <span className={`parity-badge ${statusParityClass(brief.status)}`}>
            {statusLabel(brief.status)}
          </span>
          {!quality.displayable && (
            <span className="parity-badge bad">模板未通過 — 舊標題已隱藏</span>
          )}
          <span style={{ color: "var(--tac-fg-3)", fontSize: 13 }}>建立 {formatDateTime(brief.createdAt)}</span>
          {!isPublished && (
            <span className="parity-badge bad">尚未發布 — 請勿視為正式內容</span>
          )}
        </p>
      </div>

      {/* parity-kpi-bar: brief metrics */}
      <div className="parity-kpi-bar">
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">發布狀態</span>
          <span className={`parity-kpi-value ${statusParityClass(brief.status)}`} style={{ fontSize: 18 }}>
            {statusLabel(brief.status)}
          </span>
          <span className="parity-kpi-sub">{brief.date}</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">段落數</span>
          <span className={`parity-kpi-value ${totalSections > 0 ? "warn" : "dim"}`}>
            {totalSections}
          </span>
          <span className="parity-kpi-sub">已包含段落</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">風險審核</span>
          <span className={`parity-kpi-value ${riskAuditClass}`} style={{ fontSize: 16 }}>
            {riskAuditLabel}
          </span>
          <span className="parity-kpi-sub">內容安全閘</span>
        </div>
        <div className="parity-kpi-cell">
          <span className="parity-kpi-label">事實查核</span>
          <span className={`parity-kpi-value ${factAuditClass}`} style={{ fontSize: 16 }}>
            {factAuditLabel}
          </span>
          <span className="parity-kpi-sub">來源比對</span>
        </div>
      </div>

      <div className="brief-command-strip">
        <Link className="terminal-button" href="/briefs">
          返回每日簡報列表
        </Link>
      </div>

      <BriefBodyPanel brief={brief} />

      <section className="brief-overview-grid">
        <HardRejectPanel chain={brief.auditChain} />
        <AdversarialReviewPanel chain={brief.auditChain} />
        <HallucinationPanel chain={brief.auditChain} />
      </section>
    </PageFrame>
  );
}
