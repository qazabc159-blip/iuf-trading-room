"use client";

/**
 * /admin/strategies — Quant Lab 3-lane truthful status
 *
 * Ground truth source: Codex S1 file 2026-05-18 11:29 TST
 *   reports/data_lane/codex_quant_lab_elva_current_state_2026_05_18_v1.md
 *
 * Owner-only: non-Owner roles are redirected to /login.
 * No backend Lab API is called — state is static disk-backed Codex truth.
 *
 * Wording rules (F2):
 *   OK  → "owner-review packet exists"
 *   NOT → "capital-approved" / "alpha confirmed" / "live-ready" / "paper-ready"
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGetMe } from "@/lib/auth-client";

// ── Types ─────────────────────────────────────────────────────────────────────

type LaneState =
  | "active-owner-review"
  | "baseline-c04-fail"
  | "research-paused";

interface LaneCard {
  id: string;
  displayName: string;
  state: LaneState;
  statusCategory: "owner_review" | "risk_blocked" | "research_paused";
  statusReason: string;
  nextAction: string;
  owner: string;
  recommendationImpact: string;
  qualityChecks: { passed: number; total: number };
  lastUpdate: string;
  permissions: {
    broker: false;
    registry: false;
    capital: false;
    liveReady: false;
    paperReady: false;
  };
  forwardObsNote: string | null;
  evidenceFiles: string[];
  notes: string[];
  phantomItems?: string[];
}

// ── Static Codex ground-truth data (2026-05-18) ────────────────────────────────

const LANES: LaneCard[] = [
  {
    id: "iuf_ls_omni_v1_router",
    displayName: "S1 iuf_ls_omni_v1_router",
    state: "active-owner-review",
    statusCategory: "owner_review",
    statusReason: "複核包與 Bruce 10/10 檢查都已存在；目前仍是模擬研究包，不代表資金核准。",
    nextAction: "等待楊董複核後，決定是否保留模擬觀察；本頁不開啟券商或下單路徑。",
    owner: "Elva / Bruce / Yang",
    recommendationImpact: "只能作為研究背景，不會自動升級成正式推薦或紙上交易推薦。",
    qualityChecks: { passed: 10, total: 10 },
    lastUpdate: "2026-05-18T11:29:00+08:00",
    permissions: {
      broker: false,
      registry: false,
      capital: false,
      liveReady: false,
      paperReady: false,
    },
    forwardObsNote: "1000 萬模擬研究包：待楊董複核",
    evidenceFiles: [
      "reports/data_lane/s1_iuf_ls_omni_owner_review_packet_2026_05_18_v1.json",
      "reports/data_lane/s1_iuf_ls_omni_owner_review_packet_attest_v1.json",
      "reports/data_lane/s1_iuf_ls_omni_risk_budget_10m_sim_v1.json",
      "reports/data_lane/s1_iuf_ls_omni_capacity_proxy_10m_sim_v1.json",
      "reports/data_lane/s1_intraday_partial_fill_proxy_v1.json",
      "reports/data_lane/s1_inverse_hedge_bakeoff_v1.json",
    ],
    notes: [
      "多方核心：cont_liq v36R top8",
      "避險腳本：00632R 僅危機情境啟用，目標權重 0.60，已用還原價驗證",
      "Bruce 檢查：10 / 10 通過",
      "路徑代理測試：421 天，複利 +215.91%，最大回撤 -13.18%",
      "2025-08-25 的 2485 需要在模擬政策中降低切分或下單尺寸",
    ],
    phantomItems: undefined,
  },
  {
    id: "cont_liq_v36_h20_top4_regime_pos006",
    displayName: "cont_liq v36 top4 (baseline)",
    state: "baseline-c04-fail",
    statusCategory: "risk_blocked",
    statusReason: "單獨使用的 baseline 沒通過 C04 廣族群證據閘，目前只能保留為研究背景。",
    nextAction: "Athena / Bruce 需要重跑或替換廣族群證據，通過後才可標示為已清關。",
    owner: "Athena / Bruce",
    recommendationImpact: "C04 未通過前，不能當成獨立推薦來源。",
    qualityChecks: { passed: 10, total: 11 },
    lastUpdate: "2026-05-18T11:29:00+08:00",
    permissions: {
      broker: false,
      registry: false,
      capital: false,
      liveReady: false,
      paperReady: false,
    },
    forwardObsNote: null,
    evidenceFiles: [
      "reports/data_lane/codex_cont_liq_v36_capital_test_preflight_v1.json",
    ],
    notes: [
      "C04 廣族群證據閘未通過：max-T p=0.09979，高於 0.05 門檻",
      "嚴格統計清關路徑尚未開啟",
      "C11 風險預算已處理：1000 萬台幣模擬資金，最大虧損 30 萬台幣",
      "v36 top4 不是廢棄，但不能描述成完全清關",
      "cont_liq v36R top8 只作為 S1 裡的多方元件",
    ],
    phantomItems: undefined,
  },
  {
    id: "class5_v3_v4",
    displayName: "Class5 v3/v4",
    state: "research-paused",
    statusCategory: "research_paused",
    statusReason: "先前記憶中的通過說法找不到檔案證據，因此已撤回。",
    nextAction: "要先重新寫假設規格並產出新證據，才能再次列為候選策略。",
    owner: "Athena",
    recommendationImpact: "沒有新驗證檔案前，不影響 AI 推薦或策略路由。",
    qualityChecks: { passed: 0, total: 13 },
    lastUpdate: "2026-05-18T11:29:00+08:00",
    permissions: {
      broker: false,
      registry: false,
      capital: false,
      liveReady: false,
      paperReady: false,
    },
    forwardObsNote: null,
    evidenceFiles: [
      "reports/data_lane/athena_memory_phantom_retraction_packet_2026_05_18_v1.md",
      "reports/data_lane/athena_path_a_retract_draft_2026_05_18.md",
    ],
    notes: [
      "檔案狀態：已撤回，沒有可引用來源",
      "目前狀態：研究暫停，等待新的假設規格",
    ],
    phantomItems: [
      "Class5 Truth Board v15 / Class5 v3 通過 / v4 redesign",
      "Sprint Cycle 4 cont_liq Period 2 sector cap 3 通過",
      "Round-2 fixture publish under research/fixtures/",
      "Family C x SBL v3 通過",
    ],
  },
];

// ── State badge helpers ───────────────────────────────────────────────────────

function LaneStateBadge({ state }: { state: LaneState }) {
  if (state === "active-owner-review") {
    return (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 700,
        background: "rgba(76,175,80,0.18)",
        color: "#4caf50",
        border: "1px solid rgba(76,175,80,0.35)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}>
        待楊董複核
      </span>
    );
  }
  if (state === "baseline-c04-fail") {
    return (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 700,
        background: "rgba(255,167,38,0.15)",
        color: "#ffa726",
        border: "1px solid rgba(255,167,38,0.3)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}>
        C04 風險閘未過
      </span>
    );
  }
  // research-paused
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "2px 8px",
      borderRadius: 3,
      fontSize: 10,
      fontWeight: 700,
      background: "rgba(158,158,158,0.12)",
      color: "#9e9e9e",
      border: "1px solid rgba(158,158,158,0.25)",
      textTransform: "uppercase",
      letterSpacing: "0.06em",
    }}>
      研究暫停
    </span>
  );
}

function QualityBar({ passed, total }: { passed: number; total: number }) {
  const pct = total > 0 ? (passed / total) * 100 : 0;
  const color = passed === total ? "#4caf50" : passed === 0 ? "#9e9e9e" : passed >= total * 0.8 ? "#ffa726" : "#ef5350";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        flex: 1,
        height: 4,
        background: "rgba(255,255,255,0.08)",
        borderRadius: 2,
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: color,
          borderRadius: 2,
          transition: "width 0.3s",
        }} />
      </div>
      <span style={{
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "var(--mono, monospace)",
        color,
        minWidth: 32,
        textAlign: "right",
      }}>
        {passed}/{total}
      </span>
    </div>
  );
}

function PermissionsBlock() {
  const items = [
    "券商與下單",
    "策略註冊",
    "資金使用",
    "正式交易",
    "紙上交易",
  ];
  return (
    <div style={{
      marginTop: 8,
      padding: "8px 10px",
      background: "rgba(255,184,0,0.06)",
      border: "1px solid rgba(255,184,0,0.18)",
      borderRadius: 4,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#ffb800", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
        交易與資金權限未開啟
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
        {items.map(item => (
          <span key={item} style={{ fontSize: 11, color: "rgba(255,184,0,0.78)", fontFamily: "var(--mono, monospace)" }}>
            關閉：{item}
          </span>
        ))}
      </div>
    </div>
  );
}

function PhantomBadge({ label }: { label: string }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 6,
      padding: "4px 8px",
      background: "rgba(255,167,38,0.08)",
      border: "1px solid rgba(255,167,38,0.22)",
      borderRadius: 3,
      marginBottom: 4,
    }}>
      <span style={{ fontSize: 11, color: "#ffa726", fontWeight: 700, flexShrink: 0 }}>已撤回</span>
      <span style={{ fontSize: 11, color: "rgba(255,167,38,0.85)", fontFamily: "var(--mono, monospace)" }}>{label}</span>
    </div>
  );
}

function statusSummaryStyle(category: LaneCard["statusCategory"]) {
  if (category === "owner_review") {
    return {
      background: "rgba(76,175,80,0.07)",
      border: "1px solid rgba(76,175,80,0.2)",
      color: "rgba(76,175,80,0.9)",
      label: "等待複核",
    };
  }
  if (category === "risk_blocked") {
    return {
      background: "rgba(255,167,38,0.07)",
      border: "1px solid rgba(255,167,38,0.22)",
      color: "rgba(255,167,38,0.92)",
      label: "風險阻擋",
    };
  }
  return {
    background: "rgba(158,158,158,0.08)",
    border: "1px solid rgba(158,158,158,0.24)",
    color: "rgba(210,210,210,0.86)",
    label: "研究暫停",
  };
}

function StatusSummary({ lane }: { lane: LaneCard }) {
  const style = statusSummaryStyle(lane.statusCategory);
  return (
    <div style={{
      padding: "10px 12px",
      background: style.background,
      border: style.border,
      borderRadius: 5,
      display: "grid",
      gap: 8,
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{
          fontSize: 10,
          fontWeight: 800,
          color: style.color,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}>
          {style.label}
        </span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
          負責：{lane.owner}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)", lineHeight: 1.55 }}>
        {lane.statusReason}
      </div>
      <div style={{ display: "grid", gap: 4, fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.55 }}>
        <div><strong style={{ color: "rgba(255,255,255,0.72)" }}>下一步：</strong>{lane.nextAction}</div>
        <div><strong style={{ color: "rgba(255,255,255,0.72)" }}>對推薦系統影響：</strong>{lane.recommendationImpact}</div>
      </div>
    </div>
  );
}

function LaneCardView({ lane }: { lane: LaneCard }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.09)",
      borderRadius: 8,
      padding: "18px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            策略代號
          </div>
          <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 13, fontWeight: 700, color: "#e0e0e0" }}>
            {lane.id}
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>{lane.displayName}</div>
        </div>
        <LaneStateBadge state={lane.state} />
      </div>

      <StatusSummary lane={lane} />

      {/* Quality checks */}
      <div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
          品質檢查
        </div>
        <QualityBar passed={lane.qualityChecks.passed} total={lane.qualityChecks.total} />
      </div>

      {/* Last update */}
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "var(--mono, monospace)" }}>
        更新時間：{new Date(lane.lastUpdate).toLocaleString("zh-TW", { hour12: false })}
      </div>

      {/* Permissions block */}
      <PermissionsBlock />

      {/* Forward obs / status note */}
      {lane.forwardObsNote && (
        <div style={{
          padding: "7px 10px",
          background: "rgba(76,175,80,0.08)",
          border: "1px solid rgba(76,175,80,0.2)",
          borderRadius: 4,
          fontSize: 12,
          color: "rgba(76,175,80,0.9)",
        }}>
          {lane.forwardObsNote}
        </div>
      )}

      {/* Notes */}
      {lane.notes.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            狀態說明
          </div>
          <ul style={{ margin: 0, padding: "0 0 0 16px", display: "flex", flexDirection: "column", gap: 3 }}>
            {lane.notes.map((note, i) => (
              <li key={i} style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", lineHeight: 1.5 }}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Phantom items (Class5 only) */}
      {lane.phantomItems && lane.phantomItems.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "#ffa726", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            已撤回說法：不可引用
          </div>
          {lane.phantomItems.map((item, i) => (
            <PhantomBadge key={i} label={item} />
          ))}
        </div>
      )}

      {/* Evidence files */}
      {lane.evidenceFiles.length > 0 && (
        <details style={{
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 5,
          background: "rgba(255,255,255,0.018)",
          padding: "8px 10px",
        }}>
          <summary style={{
            cursor: "pointer",
            color: "rgba(255,255,255,0.52)",
            fontSize: 11,
            fontWeight: 700,
          }}>
            查看 {lane.evidenceFiles.length} 份證據檔案
          </summary>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
              來源：IUF_QUANT_LAB，只讀保存。
            </span>
            {lane.evidenceFiles.map((f, i) => (
              <code key={i} style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", display: "block", wordBreak: "break-all" }}>
                {f}
              </code>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type PagePhase = "loading" | "no-access" | "ready";

export default function AdminStrategiesPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<PagePhase>("loading");

  useEffect(() => {
    let cancelled = false;

    apiGetMe().then(result => {
      if (cancelled) return;
      if (!result.ok || result.user.role !== "Owner") {
        setPhase("no-access");
        router.replace("/login");
        return;
      }
      setPhase("ready");
    }).catch(() => {
      if (cancelled) return;
      setPhase("no-access");
      router.replace("/login");
    });

    return () => { cancelled = true; };
  }, [router]);

  if (phase === "loading") {
    return (
      <main style={{ padding: "40px 24px", color: "rgba(255,255,255,0.4)", fontFamily: "var(--mono, monospace)", fontSize: 12 }}>
        驗證身份中…
      </main>
    );
  }

  if (phase === "no-access") {
    return null;
  }

  return (
    <>
      <style>{`
        ._strat-page { max-width: 900px; margin: 0 auto; padding: 32px 24px 80px; }
        ._strat-header { margin-bottom: 28px; }
        ._strat-title { font-size: 18px; font-weight: 700; color: #e0e0e0; letter-spacing: 0.04em; margin-bottom: 6px; }
        ._strat-subtitle { font-size: 11px; color: rgba(255,255,255,0.35); font-family: var(--mono, monospace); }
        ._strat-truth-banner {
          padding: 8px 14px;
          background: rgba(255,167,38,0.07);
          border: 1px solid rgba(255,167,38,0.22);
          border-radius: 5px;
          font-size: 11px;
          color: rgba(255,167,38,0.9);
          margin-bottom: 24px;
          line-height: 1.6;
        }
        ._strat-lanes { display: flex; flex-direction: column; gap: 20px; }
        ._strat-section-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.3);
          margin-bottom: 12px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          padding-bottom: 6px;
        }
        ._strat-wording-rule {
          margin-top: 28px;
          padding: 10px 14px;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 5px;
          font-size: 11px;
          color: rgba(255,255,255,0.35);
          line-height: 1.7;
        }
        ._strat-wording-rule strong { color: rgba(76,175,80,0.8); }
        ._strat-wording-rule s { color: rgba(239,83,80,0.7); text-decoration-color: rgba(239,83,80,0.5); }
      `}</style>

      <main className="_strat-page">
        <div className="_strat-header">
          <div className="_strat-title">Quant Lab 策略狀態</div>
          <div className="_strat-subtitle">
            真實來源：Codex S1 狀態 2026-05-18 11:29 TST &nbsp;·&nbsp; 僅限管理者
          </div>
        </div>

        <div className="_strat-truth-banner">
          Quant Lab 目前只允許研究與模擬複核。S1 複核包已建置完畢，Bruce 10 / 10 檢查通過；
          但券商、下單、資金權限都沒有開啟，尚未取得楊董複核。
          cont_liq v36 top4 仍卡在 C04 風險閘；Class5 v3/v4 已撤回並暫停研究。
          任何來自 5/15 MEMORY 的描述都不能當成已驗證證據。
        </div>

        <div className="_strat-section-label">追蹤策略（{LANES.length}）</div>

        <div className="_strat-lanes">
          {LANES.map(lane => (
            <LaneCardView key={lane.id} lane={lane} />
          ))}
        </div>

        <div className="_strat-wording-rule">
          <strong>可說</strong>：複核包存在 / Bruce 10 / 10 檢查通過 / 1000 萬模擬研究包 /
          S1 已打包等待楊董複核 &nbsp;
          <br />
          <span style={{ color: "rgba(255,184,0,0.85)", fontWeight: 700 }}>不可說</span>：資金已核准 / alpha 已確認 / 可正式交易 / 可紙上交易 /
          可實單 / 產品化完成 / 可跟單
        </div>
      </main>
    </>
  );
}
