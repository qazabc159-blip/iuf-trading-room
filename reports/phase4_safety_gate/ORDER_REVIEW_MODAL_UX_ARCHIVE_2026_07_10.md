
# OrderReviewModal UX 抽存（PR-5 清理附錄，2026-07-10）

**地位**：`S1_UNIFIED_ORDER_FLOW_DESIGN_v1.md` §5 F2-O2 裁決（楊董 2026-07-03）——「刪孤兒
`OrderTicket.tsx`，但 `OrderReviewModal` 的 UX 元素先抽存（Phase 4 真金確認流要用），再刪整檔」。
本檔即該抽存動作；來源整檔已在 PR-5（chore/unified-order-pr5-cleanup-jim-20260710）刪除。

**來源**：`apps/web/components/portfolio/OrderTicket.tsx`（刪除前 commit，`OrderReviewModal` 元件
本體 :624-731，配套 style 常數 :1441-1546，`KV` 小元件 :1136-1143，`sideLabel` helper :123-125）。
零頁面掛載已於刪除前用 repo-wide grep 覆核確認（`OrderTicketForm` 匯出處零匯入端）。

**為何值得留**：這是全站目前最完整的「送單前逐欄複核 + LOT 二次確認」UX——不是重寫，是現成可
改造的起點。Phase 4 真金確認流（D2 Phase 4 接點：`submitOrder` 前插 G-KILL→G-LIMIT→G-AUTH 檢查
鏈）的 UI 誠實範圍寫死是「確認 modal 對真金帳號多一個密碼重驗欄位」——這個 modal 就是要改造的
對象，不是從零設計。

## 元件核心結構（原樣保留，僅供 Phase 4 實作參考，非可執行程式碼）

```tsx
function OrderReviewModal({
  input,
  canSubmit,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  input: PaperOrderInput;
  canSubmit: boolean;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const unit = input.quantity_unit;
  const qty = input.qty;
  const shares = toTaiwanStockShareCount(qty, unit);
  const price = input.price ?? null;
  const notional = price === null ? null : estimateTaiwanStockNotional(price, qty, unit);
  const lotNeedsAck = unit === "LOT";
  const [lotAcknowledged, setLotAcknowledged] = useState(!lotNeedsAck);
  const canConfirm = canSubmit && (!lotNeedsAck || lotAcknowledged);
  const unitFormula = unit === "LOT"
    ? `${qty.toLocaleString("zh-TW")} 張 × 1,000 股/張 × ${price === null ? "市價" : formatTwd(price)}`
    : `${qty.toLocaleString("zh-TW")} 股 × ${price === null ? "市價" : formatTwd(price)}`;

  return (
    <div style={modalBackdropStyle} role="presentation">
      <div style={modalShellStyle} role="dialog" aria-modal="true" aria-label="SIM 委託紀錄建立確認">
        <div style={modalHeaderStyle}>
          <div>
            <div className="tg" style={{ color: "var(--gold-bright)", fontWeight: 800 }}>
              SIM 委託紀錄建立確認
            </div>
            <div style={marketSourceLineStyle}>
              台股單位防呆：零股=股，整張=1,000股。確認後只建立 SIM 委託紀錄，不送正式券商。
            </div>
          </div>
          <button type="button" onClick={onCancel} style={modalCloseStyle} disabled={isSubmitting}>
            取消
          </button>
        </div>

        <div style={reviewGridStyle}>
          <KV k="股票" v={input.symbol} />
          <KV k="方向" v={sideLabel(input.side)} />
          <KV k="類型" v={input.orderType === "market" ? "市價" : "限價/條件"} />
          <KV
            k="單位"
            v={
              <span style={unitBadgeRowStyle}>
                <span style={unit === "SHARE" ? activeUnitBadgeStyle : unitBadgeStyle}>零股（SHARE）</span>
                <span style={unit === "LOT" ? activeUnitBadgeStyle : unitBadgeStyle}>整張（LOT）</span>
              </span>
            }
          />
          <KV k={unit === "LOT" ? "張數" : "股數"} v={qty.toLocaleString("zh-TW")} />
          <KV k="實際股數" v={`${shares.toLocaleString("zh-TW")} 股`} />
          <KV k="SIM 參考價格" v={price === null ? "市價，建立紀錄時依系統報價門檻處理" : formatTwd(price)} />
          <KV
            k="金額算式"
            v={
              notional === null
                ? "市價單待系統報價門檻計算"
                : `${unitFormula} = ${formatTwd(notional)}`
            }
          />
          <KV k="手續費" v="NT$0（SIM 紀錄；正式券商委託另依券商費率）" />
          <KV k="建立型態" v="SIM 委託紀錄，不送正式券商" />
        </div>

        <TruthNote
          state={unit === "LOT" && !lotAcknowledged ? "BLOCKED" : "LIVE"}
          text={
            unit === "LOT"
              ? "你目前選的是整張（LOT）：1 張一定會用 1,000 股計算。高價股測試請優先改用零股（SHARE）；若確定要測整張，請先勾選下方確認。"
              : "你目前選的是零股（SHARE）：1 股就是 1 股，SIM 紀錄也會明確標記為零股（quantity_unit=SHARE）。"
          }
        />

        {lotNeedsAck && (
          <label style={lotAckStyle}>
            <input
              checked={lotAcknowledged}
              disabled={isSubmitting}
              onChange={(event) => setLotAcknowledged(event.target.checked)}
              type="checkbox"
            />
            <span>我知道這是整張 SIM 紀錄，1 張會用 1,000 股計算；不是零股測試。</span>
          </label>
        )}

        <div style={modalActionStyle}>
          <button type="button" onClick={onCancel} disabled={isSubmitting} style={secondaryActionStyle}>
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || isSubmitting}
            style={primaryActionStyle}
          >
            {isSubmitting ? "建立中..." : "確認建立 SIM 紀錄"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

## 配套 style 常數（原樣保留）

```ts
const modalBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "rgba(0,0,0,0.68)",
  backdropFilter: "blur(3px)",
};

const modalShellStyle: CSSProperties = {
  width: "min(720px, 96vw)",
  maxHeight: "86vh",
  overflow: "auto",
  border: "1px solid var(--gold)",
  background: "linear-gradient(180deg, rgba(14,15,16,0.98), rgba(4,6,8,0.98))",
  boxShadow: "0 24px 80px rgba(0,0,0,0.56)",
  padding: 34,
};

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 22,
  alignItems: "flex-start",
  borderBottom: "1px solid var(--exec-rule-strong)",
  paddingBottom: 24,
  marginBottom: 24,
};

const modalCloseStyle: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--exec-rule-strong)",
  color: "var(--exec-mid)",
  fontFamily: "var(--mono)",
  padding: "6px 10px",
  cursor: "pointer",
};

const reviewGridStyle: CSSProperties = {
  display: "grid",
  gap: 0,
  borderTop: "1px solid var(--exec-rule)",
};

const unitBadgeRowStyle: CSSProperties = {
  display: "inline-flex",
  justifyContent: "flex-end",
  flexWrap: "wrap",
  gap: 8,
};

const unitBadgeStyle: CSSProperties = {
  display: "inline-flex",
  minHeight: 28,
  alignItems: "center",
  padding: "0 10px",
  border: "1px solid var(--exec-rule-strong)",
  color: "var(--exec-mid)",
  background: "rgba(255,255,255,0.018)",
  fontFamily: "var(--mono)",
  fontWeight: 800,
  fontSize: 10,
};

const activeUnitBadgeStyle: CSSProperties = {
  ...unitBadgeStyle,
  borderColor: "var(--gold)",
  color: "var(--night)",
  background: "var(--gold-bright)",
};

const modalActionStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 18,
  borderTop: "1px solid var(--exec-rule-strong)",
  marginTop: 26,
  paddingTop: 24,
};

const lotAckStyle: CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "flex-start",
  marginTop: 22,
  padding: 18,
  border: "1px solid rgba(226,184,92,0.35)",
  background: "rgba(226,184,92,0.08)",
  color: "var(--exec-ink)",
  fontFamily: "var(--sans-tc)",
  fontSize: 13,
  lineHeight: 1.8,
};

const secondaryActionStyle: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--exec-rule-strong)",
  color: "var(--exec-mid)",
  fontFamily: "var(--mono)",
  fontWeight: 700,
  padding: "14px 18px",
  cursor: "pointer",
};

const primaryActionStyle: CSSProperties = {
  background: "var(--gold)",
  border: "1px solid var(--gold-bright)",
  color: "#080808",
  fontFamily: "var(--mono)",
  fontWeight: 800,
  padding: "14px 20px",
  cursor: "pointer",
};
```

`KV` 小元件（key/value row，一併需要）：

```tsx
function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div style={kvStyle}>
      <span style={{ color: "var(--exec-mid)", letterSpacing: "0.12em" }}>{k}</span>
      <span style={{ color: "var(--exec-ink)", textAlign: "right" }}>{v}</span>
    </div>
  );
}

const kvStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "96px 1fr",
  gap: 14,
  padding: "14px 0",
  borderBottom: "1px solid var(--exec-rule)",
  fontFamily: "var(--mono)",
  fontSize: 11.5,
};
```

## Phase 4 改造時要注意的落差

1. **輸入型別要擴充**：原型只吃 `PaperOrderInput`（`quantity_unit` + `qty` + `price` + `symbol`
   + `side` + `orderType`），真金流需要額外的 `accountId`／`authorization_token`（D2 Phase 4 接點）
   欄位；`OrderReviewModal` 需要新增一個密碼重驗輸入框 + 對應 `canConfirm` 判斷（目前 `canConfirm`
   只看 LOT 二次確認勾選，真金版要再疊一個「密碼已驗證」條件）。
2. **這是舊版 iframe 前 React 元件**，實際下單面板現在是 `apps/web/lib/final-v031-live.ts` 注入的
   raw `<script>` 字串（無 bundler import），不是 React。Phase 4 若走同一 iframe 表面，這份 JSX
   需要重寫成字串模板（比照 `final-v031-live.ts` 現有 `KGI_CHANNEL_REASON_LABELS` 內嵌模式，見
   `S1_UNIFIED_ORDER_FLOW_DESIGN_v1.md` §1 現況診斷第 7 點：iframe 無 postMessage，改造要在
   hydration script 層動手）；若 Phase 4 決定另開一個真正的 React 頁面（非 iframe），才能直接原樣
   搬用這份 JSX。兩條路都可行，設計文件未定案，屆時實作者判斷。
3. **詞彙表**：`paper-order-vocab.ts`（`paperRiskDecisionLabel` 等 6 個函式）刻意保留未刪（見 PR-5
   PR body），可直接被真金確認流複用做 reason-code → 中文映射（D5 裁決語意）。
4. **LOT 二次確認的 checkbox 模式**（`lotAckStyle` + `lotAcknowledged` state）值得原樣沿用到真金
   流的「我已確認金額與標的」複核步驟——這是唯一在正式下單前逼用戶再讀一次關鍵數字的既有 UX。

---
版本：v1，2026-07-10，PR-5 清理（`chore/unified-order-pr5-cleanup-jim-20260710`）落檔。
