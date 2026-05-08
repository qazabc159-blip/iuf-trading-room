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

function statusBadgeClass(status: string) {
  if (status === "published") return "badge-green";
  if (status === "awaiting_review") return "badge-yellow";
  if (status === "rejected" || status === "error") return "badge-red";
  return "badge-yellow";
}

function statusZh(status: string) {
  return statusLabel(status);
}

function auditVerdictLabel(value: string | null | undefined) {
  if (value === "OK") return "通過";
  if (value === "INTERCEPTED") return "攔截";
  if (value === "PARTIAL_HALLUCINATED") return "部分需查核";
  if (value === "HALLUCINATED") return "未通過";
  return "尚未完成";
}

function auditVerdictTone(value: string | null | undefined) {
  if (value === "OK") return "status-ok";
  if (value === "PARTIAL_HALLUCINATED") return "gold";
  if (value) return "status-bad";
  return "muted";
}

function auditVerdictBadge(value: string | null | undefined) {
  if (value === "OK") return "badge-green";
  if (value === "PARTIAL_HALLUCINATED") return "badge-yellow";
  if (value) return "badge-red";
  return "badge-yellow";
}

function HardRejectPanel({ chain }: { chain: BriefDetailAuditChain }) {
  const { rules, rejected } = chain.hardReject;
  const tone = rejected ? "status-bad" : "status-ok";
  const label = rejected ? "不可發布" : "通過";
  return (
    <Panel
      code="BRF-HR"
      title="政策檢查"
      sub="不可發布條件"
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
        title="風險審核"
        sub="內容風險與發布檢查"
        right="未審核"
      >
        <p className="state-reason">
          這份簡報尚未完成風險審核；不會把未審核內容當成正式通過。
        </p>
      </Panel>
    );
  }

  const verdictBadge = auditVerdictBadge(review.verdict);
  const verdictTone = auditVerdictTone(review.verdict);
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
      <div className="brief-three-state">
        <span className={`badge ${verdictBadge}`}>{auditVerdictLabel(review.verdict)}</span>
        <span className={`tg ${verdictTone}`}>風險分數 {severityText}</span>
      </div>
      <MetricStrip
        columns={3}
        cells={[
          {
            label: "判定",
            value: auditVerdictLabel(review.verdict),
            tone: auditVerdictTone(review.verdict),
          },
          {
            label: "風險分數",
            value: severityText,
            tone:
              typeof review.severityScore === "number" && review.severityScore >= 7
                ? "status-bad"
                : "muted",
          },
          {
            label: "旗標",
            value: review.flags.length,
            tone: "muted",
          },
        ]}
      />
      <div className="brief-source-trail">
        <span>審核時間：{formatDateTime(review.auditedAt)}</span>
        <span>旗標數：{review.flags.length}</span>
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
        title="事實查核"
        sub="敘述與來源比對"
        right="未審核"
      >
        <p className="state-reason">
          這份簡報尚未完成事實查核；不會把未查核內容當成正式通過。
        </p>
      </Panel>
    );
  }

  const verdictBadge = auditVerdictBadge(hc.verdict);
  const verdictTone = auditVerdictTone(hc.verdict);
  const confidenceText =
    typeof hc.confidence === "number" ? hc.confidence.toFixed(2) : "--";

  return (
    <Panel
      code="BRF-HC"
      title="事實查核"
      sub="敘述與來源比對"
      right={auditVerdictLabel(hc.verdict)}
    >
      <div className="brief-three-state">
        <span className={`badge ${verdictBadge}`}>{auditVerdictLabel(hc.verdict)}</span>
        <span className={`tg ${verdictTone}`}>信心度 {confidenceText}</span>
        <span className={`tg ${hc.ragUsed ? "status-ok" : "muted"}`}>
          來源比對 {hc.ragUsed ? "已執行" : "待補"}
        </span>
      </div>
      <MetricStrip
        columns={3}
        cells={[
          {
            label: "判定",
            value: auditVerdictLabel(hc.verdict),
            tone: auditVerdictTone(hc.verdict),
          },
          { label: "信心度", value: confidenceText, tone: "muted" },
          {
            label: "來源比對",
            value: hc.ragUsed ? "已執行" : "待補",
            tone: hc.ragUsed ? "status-ok" : "muted",
          },
        ]}
      />
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
  return (
    <Panel
      code="BRF-PUB"
      title="簡報內容"
      sub={`${brief.date} / 正式內容`}
      right={statusZh(brief.status)}
    >
      <div className="brief-published">
        <div className="brief-market-state">
          <span className="tg gold">盤勢狀態</span>
          <strong>{safeHeadline(brief.marketState)}</strong>
        </div>
        {brief.sections.length === 0 && (
          <p className="state-reason">
            這份簡報沒有段落內容；請回每日簡報頁確認來源與審核狀態。
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
      <Panel
        code="BRF-NF"
        title="簡報不存在"
        sub="請回列表確認"
        right="無資料"
      >
        <div className="brief-three-state">
          <span className="badge badge-red">無資料</span>
          <span className="tg status-bad">簡報不存在</span>
        </div>
        <p className="state-reason">
          請改回 <Link href="/briefs">每日簡報列表</Link> 或檢查 id 是否正確。
        </p>
      </Panel>
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
      <Panel code="BRF-ERR" title="讀取失敗" sub="簡報明細" right="需處理">
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
    return <NotFoundView />;
  }

  if (result.kind === "ERROR") {
    return <ErrorView reason={result.reason} />;
  }

  const brief = result.data;
  const isPublished = brief.status === "published";
  const totalSections = brief.sections.length;

  return (
    <PageFrame
      code="BRF-D"
      title={safeHeadline(brief.title)}
      sub={`${brief.date} / 正式簡報`}
      note="此頁顯示單份簡報內容、政策檢查、風險審核與事實查核，不提供買賣建議。"
    >
      <div className="brief-three-state">
        <span className={`badge ${statusBadgeClass(brief.status)}`}>
          {statusLabel(brief.status)}
        </span>
        <span className="tg soft">日期：{brief.date}</span>
        <span className="tg soft">建立：{formatDateTime(brief.createdAt)}</span>
        {!isPublished && (
          <span className="tg status-bad">
            尚未發布，請勿視為正式內容
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
            label: "風險審核",
            value: auditVerdictLabel(brief.auditChain.adversarialReview?.verdict),
            tone: auditVerdictTone(brief.auditChain.adversarialReview?.verdict),
          },
          {
            label: "事實查核",
            value: auditVerdictLabel(brief.auditChain.hallucinationCheck?.verdict),
            tone: auditVerdictTone(brief.auditChain.hallucinationCheck?.verdict),
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
