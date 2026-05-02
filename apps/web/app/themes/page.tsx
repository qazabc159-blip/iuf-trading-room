import Link from "next/link";

import { PageFrame, Panel } from "@/components/PageFrame";
import { MetricStrip } from "@/components/RadarWidgets";
import { getThemes } from "@/lib/api";
import { friendlyDataError } from "@/lib/friendly-error";

export const dynamic = "force-dynamic";

type ThemeRow = Awaited<ReturnType<typeof getThemes>>["data"][number];
type LoadState =
  | { state: "LIVE"; data: ThemeRow[]; updatedAt: string; source: string }
  | { state: "EMPTY"; data: ThemeRow[]; updatedAt: string; source: string; reason: string }
  | { state: "BLOCKED"; data: ThemeRow[]; updatedAt: string; source: string; reason: string };

function friendlyError(error: unknown) {
  return friendlyDataError(error, "主題資料暫時無法讀取。");
}

async function loadThemes(): Promise<LoadState> {
  const source = "主題資料庫";
  const updatedAt = new Date().toISOString();

  try {
    const envelope = await getThemes();
    const data = envelope.data;
    if (data.length === 0) {
      return {
        state: "EMPTY",
        data,
        updatedAt,
        source,
        reason: "主題資料庫目前回傳 0 筆，不顯示假主題。",
      };
    }
    return { state: "LIVE", data, updatedAt, source };
  } catch (error) {
    return {
      state: "BLOCKED",
      data: [],
      updatedAt,
      source,
      reason: friendlyError(error),
    };
  }
}

function formatTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-TW", { hour12: false });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
}

function stateTone(state: LoadState["state"]) {
  if (state === "LIVE") return "up";
  if (state === "EMPTY") return "gold";
  return "down";
}

function stateLabel(state: LoadState["state"]) {
  if (state === "LIVE") return "正常";
  if (state === "EMPTY") return "無資料";
  return "暫停";
}

function marketLabel(state: ThemeRow["marketState"]) {
  if (state === "Attack") return "進攻";
  if (state === "Selective Attack") return "選擇進攻";
  if (state === "Defense") return "防守";
  if (state === "Preservation") return "保全";
  if (state === "Balanced") return "平衡";
  return state;
}

function marketTone(state: ThemeRow["marketState"]) {
  if (state === "Attack" || state === "Selective Attack") return "up";
  if (state === "Defense" || state === "Preservation") return "down";
  return "gold";
}

function lifecycleLabel(value: string | null | undefined) {
  if (value === "Discovery") return "探索";
  if (value === "Validation") return "驗證";
  if (value === "Expansion") return "擴張";
  if (value === "Crowded") return "擁擠";
  if (value === "Distribution") return "分配";
  if (value === "Incubation") return "孵化";
  if (value === "Monitoring") return "監控";
  if (value === "active") return "啟用";
  if (value === "watch") return "觀察";
  if (value === "paused") return "暫停";
  if (value === "retired") return "退場";
  return value ?? "--";
}

function hasBrokenText(value: string | null | undefined) {
  if (!value) return false;
  return /�|Ã|Â|undefined|null/i.test(value);
}

function isEnglishHeavy(value: string | null | undefined) {
  if (!value) return false;
  const latin = value.match(/[A-Za-z]/g)?.length ?? 0;
  const cjk = value.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return latin >= 12 && latin > cjk * 2;
}

function themeDisplayName(theme: ThemeRow) {
  const bySlug: Record<string, string> = {
    "orphan-audit-trail": "內部稽核軌跡",
    "orphan-ai-optics": "AI 光通訊封裝",
    "5g": "5G 通訊",
    abf: "ABF 載板",
    ai: "AI 伺服器",
    apple: "Apple 供應鏈",
    cowos: "CoWoS 先進封裝",
    cpo: "CPO 光通訊",
  };
  const mapped = bySlug[theme.slug.toLowerCase()];
  if (mapped) return mapped;
  return theme.name.replace(/^\[ORPHAN\]\s*/i, "待歸檔：");
}

function themeThesisText(theme: ThemeRow) {
  if (!theme.thesis || hasBrokenText(theme.thesis) || isEnglishHeavy(theme.thesis)) {
    return "主題說明待整理；目前保留來源主檔與公司池，不作自動解讀。";
  }
  return theme.thesis;
}

function SourceLine({ result }: { result: LoadState }) {
  return (
    <div className="tg soft" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "10px 0 12px" }}>
      <span className={stateTone(result.state)} style={{ fontWeight: 700 }}>{stateLabel(result.state)}</span>
      <span>來源：{result.source}</span>
      <span>更新 {formatDateTime(result.updatedAt)}</span>
      {result.state !== "LIVE" && <span>{result.reason}</span>}
    </div>
  );
}

function EmptyOrBlocked({ result }: { result: LoadState }) {
  if (result.state === "LIVE") return null;
  return (
    <div className="terminal-note">
      <span className={`tg ${stateTone(result.state)}`}>{stateLabel(result.state)}</span>{" "}
      {result.reason}
    </div>
  );
}

export default async function ThemesPage() {
  const result = await loadThemes();
  const themes = result.data.slice().sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const countsAvailable = result.state !== "BLOCKED";
  const attackCount = themes.filter((theme) => theme.marketState === "Attack" || theme.marketState === "Selective Attack").length;
  const defenseCount = themes.filter((theme) => theme.marketState === "Defense" || theme.marketState === "Preservation").length;
  const coreTotal = themes.reduce((sum, theme) => sum + theme.corePoolCount, 0);
  const observationTotal = themes.reduce((sum, theme) => sum + theme.observationPoolCount, 0);
  const priorityOneCount = themes.filter((theme) => theme.priority === 1).length;

  return (
    <PageFrame
      code="02"
      title="主題板"
      sub="台股主題階梯"
      note="主題板 / 正式主題資料；沒有真端點的熱度與脈衝指標先不顯示。"
    >
      <MetricStrip
        cells={[
          { label: "狀態", value: stateLabel(result.state), tone: stateTone(result.state) },
          { label: "總數", value: countsAvailable ? themes.length : "--" },
          { label: "進攻", value: countsAvailable ? attackCount : "--", tone: "up" },
          { label: "防守", value: countsAvailable ? defenseCount : "--", tone: "down" },
          { label: "核心", value: countsAvailable ? coreTotal : "--", tone: coreTotal > 0 ? "gold" : "muted" },
          { label: "觀察", value: countsAvailable ? observationTotal : "--" },
          { label: "P1", value: countsAvailable ? priorityOneCount : "--", tone: "gold" },
        ]}
        columns={7}
      />

      <Panel
        code="THM-LDR"
        title="主題主檔"
        sub="主題主檔 / 正式資料"
        right={stateLabel(result.state)}
      >
        <SourceLine result={result} />
        <EmptyOrBlocked result={result} />
        {result.state === "LIVE" && (
          <>
            <div className="row theme-row table-head tg">
              <span>#</span><span>代碼</span><span>主題</span><span>盤勢</span><span>階段</span><span>核心</span><span>觀察</span><span>更新</span>
            </div>
            {themes.map((theme) => (
              <Link href={`/themes/${theme.slug}`} className={`row theme-row ${theme.priority === 1 ? "theme-active" : ""}`} key={theme.id}>
                <span className="tg soft">{theme.priority}</span>
                <span className="tg" style={{ color: "var(--night-ink)", fontWeight: 700 }}>{theme.slug}</span>
                <span>
                  <strong className="tc" style={{ color: "var(--night-ink)", fontSize: 16 }}>{themeDisplayName(theme)}</strong>
                  <span className="tc soft theme-thesis">{themeThesisText(theme)}</span>
                </span>
                <span className={`tg ${marketTone(theme.marketState)}`}>{marketLabel(theme.marketState)}</span>
                <span className="tg muted">{lifecycleLabel(theme.lifecycle)}</span>
                <span className="num">{theme.corePoolCount}</span>
                <span className="num">{theme.observationPoolCount}</span>
                <span className="tg soft">{formatDate(theme.updatedAt)}</span>
              </Link>
            ))}
          </>
        )}
      </Panel>
    </PageFrame>
  );
}
