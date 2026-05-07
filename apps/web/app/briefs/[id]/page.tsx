import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import {
  getBriefDetail,
  type BriefDetail,
  type BriefDetailAuditChain,
} from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";
import { cleanExternalHeadline, cleanNarrativeText } from "@/lib/operator-copy";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK #8 Lane B — /briefs/[id] detail page with audit chain visualization
// SSR fetch GET /api/v1/briefs/{id} (Owner/Admin/Analyst auth, cookie forwarded
// by lib/api request()).
//
// Hard rules:
//   - never display OpenAI key / FinMind token / API secrets
//   - mask 買進 / 賣出 / 目標價 / 必賺 / 保證 / 勝率 in body text
//   - never render fake guarantee / strategy approved wording
//   - fallback_template generated brief still shown but flagged so it is NOT
//     rendered as a "live brief" (status badge reflects reality)
//   - 404 when brief not found → "Brief 不存在" message, no fake content
// ─────────────────────────────────────────────────────────────────────────────

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
  // server returns { error: "not_found" } body with 404 — request() throws
  // Error(text). Match either the JSON body or HTTP 404 marker.
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
      reason: friendlyDataError(error, "簡報詳情讀取失敗。"),
    };
  }
}

function statusLabel(status: string) {
  if (status === "published") return "PUBLISHED";
  if (status === "awaiting_review") return "AWAITING_REVIEW";
  if (status === "rejected") return "REJECTED";
  if (status === "error") return "ERROR";
  return status.toUpperCase();
}

function statusBadgeClass(status: string) {
  if (status === "published") return "badge-green";
  if (status === "awaiting_review") return "badge-yellow";
  if (status === "rejected" || status === "error") return "badge-red";
  return "badge-yellow";
}

function statusZh(status: string) {
  if (status === "published") return "已發布";
  if (status === "awaiting_review") return "待審核";
  if (status === "rejected") return "已退回";
  if (status === "error") return "產生失敗";
  return status;
}

// ── Audit chain rendering ────────────────────────────────────────────────────

function HardRejectPanel({ chain }: { chain: BriefDetailAuditChain }) {
  const { rules, rejected } = chain.hardReject;
  const tone = rejected ? "status-bad" : "status-ok";
  const label = rejected ? "已觸發 hard-reject" : "未觸發 hard-reject";
  return (
    <Panel
      code="BRF-HR"
      title="Hard Reject 規則"
      sub="政策層的硬性拒絕條款"
      right={label}
    >
      <div className="brief-three-state">
        <span className={`badge ${rejected ? "badge-red" : "badge-green"}`}>
          {label}
        </span>
        <span className={`tg ${tone}`}>共 {rules.length} 條規則</span>
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
    return (
      <Panel
        code="BRF-ADV"
        title="對抗式審核"
        sub="adversarial reviewer / GPT-4.1"
        right="未審核"
      >
        <p className="state-reason">
          這份簡報尚未經過對抗式審核，沒有 audit_log 對應紀錄。
        </p>
      </Panel>
    );
  }

  const verdictBadge = review.verdict === "OK" ? "badge-green" : "badge-red";
  const verdictTone = review.verdict === "OK" ? "status-ok" : "status-bad";
  const severityText =
    typeof review.severityScore === "number"
      ? review.severityScore.toFixed(1)
      : "--";

  return (
    <Panel
      code="BRF-ADV"
      title="對抗式審核"
      sub="adversarial reviewer / GPT-4.1"
      right={review.verdict}
    >
      <div className="brief-three-state">
        <span className={`badge ${verdictBadge}`}>{review.verdict}</span>
        <span className={`tg ${verdictTone}`}>severity {severityText}</span>
      </div>
      <MetricStrip
        columns={3}
        cells={[
          {
            label: "判決",
            value: review.verdict,
            tone: review.verdict === "OK" ? "status-ok" : "status-bad",
          },
          {
            label: "嚴重度",
            value: severityText,
            tone:
              typeof review.severityScore === "number" && review.severityScore >= 7
                ? "status-bad"
                : "muted",
          },
          {
            label: "審核模型",
            value: review.reviewerModel,
            tone: "muted",
          },
        ]}
      />
      <div className="brief-source-trail">
        <span>審核時間：{formatDateTime(review.auditedAt)}</span>
        <span>flags 數：{review.flags.length}</span>
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
    return (
      <Panel
        code="BRF-HC"
        title="幻覺檢查"
        sub="claim-extract → verify (GPT-4o-mini → GPT-4.1)"
        right="未審核"
      >
        <p className="state-reason">
          這份簡報尚未經過幻覺檢查，沒有 audit_log 對應紀錄。
        </p>
      </Panel>
    );
  }

  const verdictBadge =
    hc.verdict === "OK"
      ? "badge-green"
      : hc.verdict === "PARTIAL_HALLUCINATED"
        ? "badge-yellow"
        : "badge-red";
  const verdictTone =
    hc.verdict === "OK"
      ? "status-ok"
      : hc.verdict === "PARTIAL_HALLUCINATED"
        ? "gold"
        : "status-bad";
  const confidenceText =
    typeof hc.confidence === "number" ? hc.confidence.toFixed(2) : "--";

  return (
    <Panel
      code="BRF-HC"
      title="幻覺檢查"
      sub="claim-extract → verify"
      right={hc.verdict}
    >
      <div className="brief-three-state">
        <span className={`badge ${verdictBadge}`}>{hc.verdict}</span>
        <span className={`tg ${verdictTone}`}>信心度 {confidenceText}</span>
        <span className={`tg ${hc.ragUsed ? "status-ok" : "muted"}`}>
          RAG {hc.ragUsed ? "已啟用" : "未使用"}
        </span>
      </div>
      <MetricStrip
        columns={3}
        cells={[
          {
            label: "判決",
            value: hc.verdict,
            tone:
              hc.verdict === "OK"
                ? "status-ok"
                : hc.verdict === "PARTIAL_HALLUCINATED"
                  ? "gold"
                  : "status-bad",
          },
          { label: "信心度", value: confidenceText, tone: "muted" },
          {
            label: "RAG",
            value: hc.ragUsed ? "已啟用" : "未使用",
            tone: hc.ragUsed ? "status-ok" : "muted",
          },
        ]}
      />
      <div className="brief-source-trail">
        <span>模型鏈：{hc.modelChain}</span>
        <span>審核時間：{formatDateTime(hc.auditedAt)}</span>
        <span>flags 數：{hc.flags.length}</span>
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
  return (
    <Panel
      code="BRF-PUB"
      title="簡報內容"
      sub={`${brief.date} / ${brief.generatedBy}`}
      right={statusZh(brief.status)}
    >
      <div className="brief-published">
        <div className="brief-market-state">
          <span className="tg gold">盤勢狀態</span>
          <strong>{safeHeadline(brief.marketState)}</strong>
        </div>
        {brief.sections.length === 0 && (
          <p className="state-reason">
            這份簡報沒有段落內容。可能是 fallback_template 或產生失敗。
          </p>
        )}
        {brief.sections.map((section, index) => (
          <article className="brief-section" key={`${section.heading}:${index}`}>
            <span className="tg muted">#{String(index + 1).padStart(2, "0")}</span>
            <h3>{safeHeadline(section.heading)}</h3>
            <p>{safeBriefText(section.body)}</p>
            {section.sourceTrail && (
              <div className="brief-source-trail">
                <span className="tg gold">來源</span>
                <span>{safeBriefText(section.sourceTrail)}</span>
              </div>
            )}
            {!section.sourceTrail && (
              <div className="brief-source-trail">
                <span className="tg muted">
                  來源未持久化於 daily_briefs（僅留於草稿層）
                </span>
              </div>
            )}
          </article>
        ))}
      </div>
    </Panel>
  );
}

function NotFoundView({ id }: { id: string }) {
  return (
    <PageFrame
      code="BRF-NF"
      title="Brief 不存在"
      sub={`找不到 id=${id} 的簡報`}
      note="這個簡報可能已被刪除、尚未產生，或 id 輸入錯誤。請確認 daily_briefs.id (uuid) 或 date (YYYY-MM-DD) 後再試。"
    >
      <Panel
        code="BRF-NF"
        title="Brief 不存在"
        sub="404 / not_found"
        right="無資料"
      >
        <div className="brief-three-state">
          <span className="badge badge-red">404</span>
          <span className="tg status-bad">Brief 不存在</span>
        </div>
        <p className="state-reason">
          請改回 <Link href="/briefs">每日簡報列表</Link> 或檢查 id 是否正確。
        </p>
      </Panel>
    </PageFrame>
  );
}

function ErrorView({ id, reason }: { id: string; reason: string }) {
  return (
    <PageFrame
      code="BRF-ERR"
      title="簡報詳情讀取失敗"
      sub={`id=${id}`}
      note="後端回應錯誤；不顯示任何快取或假資料。"
    >
      <Panel code="BRF-ERR" title="讀取失敗" sub="API error" right="受阻">
        <p className="state-reason">{reason}</p>
        <p className="state-reason">
          請改回 <Link href="/briefs">每日簡報列表</Link> 重試。
        </p>
      </Panel>
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
    return <NotFoundView id={id} />;
  }

  if (result.kind === "ERROR") {
    return <ErrorView id={id} reason={result.reason} />;
  }

  const brief = result.data;
  const isPublished = brief.status === "published";
  const totalSections = brief.sections.length;

  return (
    <PageFrame
      code="BRF-D"
      title={safeHeadline(brief.title)}
      sub={`${brief.date} / ${brief.generatedBy}`}
      note="此頁顯示單份簡報詳情與 audit chain（hard-reject / 對抗式審核 / 幻覺檢查），不提供買賣建議。"
    >
      <div className="brief-three-state">
        <span className={`badge ${statusBadgeClass(brief.status)}`}>
          {statusLabel(brief.status)}
        </span>
        <span className="tg soft">日期：{brief.date}</span>
        <span className="tg soft">建立：{formatDateTime(brief.createdAt)}</span>
        <span className="tg soft">產生者：{brief.generatedBy}</span>
        {!isPublished && (
          <span className="tg status-bad">
            非 published 狀態，請勿視為正式可用內容
          </span>
        )}
      </div>

      <MetricStrip
        columns={4}
        cells={[
          {
            label: "狀態",
            value: statusZh(brief.status),
            tone: isPublished ? "status-ok" : "status-bad",
          },
          { label: "段落數", value: totalSections, tone: "muted" },
          {
            label: "對抗式審核",
            value: brief.auditChain.adversarialReview?.verdict ?? "未審核",
            tone:
              brief.auditChain.adversarialReview?.verdict === "OK"
                ? "status-ok"
                : brief.auditChain.adversarialReview?.verdict === "INTERCEPTED"
                  ? "status-bad"
                  : "muted",
          },
          {
            label: "幻覺檢查",
            value: brief.auditChain.hallucinationCheck?.verdict ?? "未審核",
            tone:
              brief.auditChain.hallucinationCheck?.verdict === "OK"
                ? "status-ok"
                : brief.auditChain.hallucinationCheck?.verdict ===
                    "PARTIAL_HALLUCINATED"
                  ? "gold"
                  : brief.auditChain.hallucinationCheck
                    ? "status-bad"
                    : "muted",
          },
        ]}
      />

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
