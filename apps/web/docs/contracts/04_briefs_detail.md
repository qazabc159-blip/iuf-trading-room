# Contract: 每日簡報詳情 (/briefs/[id])

## 1. 首屏要回答什麼問題

Operator 閱讀單篇簡報全文，查看市場狀態判斷、各段落分析與 AI 審核鏈通過/未通過記錄。

---

## 2. 需要哪些 API

| Endpoint | Source | 說明 |
|---|---|---|
| `GET /api/v1/briefs/:id` | live | 簡報詳情（含 sections / marketState / auditChain）|

auditChain 包含：
- `hardReject.rules` / `hardReject.rejected`
- `adversarialReview`: 對抗性審核結果
- `hallucinationCheck`: 事實核查結果（含 ragUsed / confidence）

---

## 3. 五種 State 語言

| State | 繁中產品語言 |
|---|---|
| loading | "簡報讀取中…" |
| empty | "這篇簡報沒有段落內容；可能是草稿未完成。" |
| stale | — （詳情頁無 stale 狀態；資料即取即用）|
| blocked | "簡報資料暫時無法讀取（[具體原因]）。" |
| error | "找不到這篇簡報，可能已被移除或連結有誤。" |

**審核鏈 sub-state（per panel）**

| State | 繁中產品語言 |
|---|---|
| 未執行 | "本輪未進行此項審核" |
| 通過 | "審核通過" |
| 截獲 / 部分問題 | "發現潛在問題，已標記供人工確認" |
| 錯誤 | "審核程序異常，本輪跳過" |

---

## 4. 禁止出現的工程詞

- `BriefDetailAuditChain` 型別名稱
- `adversarialReview` / `hallucinationCheck` 任何形式 key 名
- `PARTIAL_HALLUCINATED` / `HALLUCINATED` / `INTERCEPTED` enum value
- `ragUsed: true/false` 原始 boolean 值顯示
- `reviewerModel` / `modelChain` 模型名稱
- `sourceTrail` 欄位名稱（可顯示為「資料來源」）
- migration 檔名 / auditedAt 欄位名稱原文

---

## 5. 廠商設計回來時接哪些 Props

```ts
// 簡報頁標題 (hero)
type BriefHeroProps = {
  date: string;           // "YYYY/MM/DD"
  title: string;
  marketStateLabel: string;
  marketStateTone: "ok" | "warn" | "dim";
  publishedAt: string;    // "MM/DD HH:mm"
  isUnpublished: boolean; // 草稿或待審
};

// KPI bar (4 cell)
type BriefKpiBarProps = {
  statusLabel: string;     // "已發布" | "待審核" | "草稿"
  statusTone: "ok" | "warn" | "bad";
  sectionCount: number;
  adversarialLabel: string; // "通過" | "截獲" | "未執行"
  adversarialTone: "ok" | "warn" | "dim";
  factCheckLabel: string;   // "通過" | "部分問題" | "未執行"
  factCheckTone: "ok" | "warn" | "dim";
};

// 段落 section card
type BriefSectionCardProps = {
  heading: string;
  body: string;
  sourceLabel: string | null; // "資料來源：..." 或 null
};

// 審核結果 panel（可展開）
type AuditPanelProps = {
  adversarialResult: {
    label: string;   // "通過" | "截獲" | "未執行" | "異常"
    tone: "ok" | "warn" | "bad" | "dim";
    flags: string[]; // 產品語言描述，不秀原始 flag key
    confidence: number | null; // 0-1
  };
  factCheckResult: {
    label: string;
    tone: "ok" | "warn" | "bad" | "dim";
    confidence: number | null;
    usedExternalSource: boolean; // ragUsed 轉換
  };
};

// 預留 hook
interface VendorSwapHook {
  onBriefDetailReady?: (hero: BriefHeroProps, sections: BriefSectionCardProps[]) => void;
}
```
