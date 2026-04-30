---
name: KGI Escalation W5b Final Polish (Lane E)
description: 7-item final polish on top of W5 send-ready package; status STAYS NOT_SENT_AWAITING_YANG_SEND_KGI_ESCALATION
type: escalation_final_polish
date: 2026-04-29
sprint: W5b
status: NOT_SENT_AWAITING_YANG_SEND_KGI_ESCALATION
prepared_by: Elva (via W5b Lane E dispatch)
gate_to_send: yang_verbatim_send_kgi_escalation
prior_round: kgi_escalation_w5_send_ready_package.md
---

# KGI Escalation W5b Final Polish — Lane E (2026-04-29)

W5 Scope A delivered the 8/8 send-ready package. W5b adds 7 polish items per 楊董 directive. **Status remains `NOT_SENT_AWAITING_YANG_SEND_KGI_ESCALATION`.**

Send only fires when 楊董 issues verbatim phrase: `送出 KGI escalation` / `send KGI escalation`.

---

## §E5b.1 — 中文寄信版最終稿（Outbound Email Body, Traditional Chinese）

**Subject**: `[IUF] /position 端 KGI Native Crash 升級單 — Candidate F containment 已部署`

**Body**:

```
KGI 客戶服務／業務 您好：

我們是 IUF Trading Room（內部代號 IUF），目前正在以 kgisuperpy SDK 在 Windows 端
建置 read-only 行情與部位查詢介面。基本登入、行情訂閱、tick / bidask 已完整測通；
但在呼叫 `/position` 取得帳戶部位時，會觸發 KGI native binary 層的 crash，
導致整個 gateway process 終止。為了不阻擋其餘 read-only 路徑，我們已部署
Candidate F 隔離（POSITION_DISABLED 旗標 → /position 503），其他端點不受影響。

附件：
1. kgi_position_crash_escalation_package.md — 技術重現摘要（含環境、SDK 版本、
   call sequence、observed crash signature、containment 設計）
2. reproduction_summary_redacted.md — 最小重現流程（已將 person_id / account /
   password / cert 全數遮罩成 <REDACTED_*> 占位符）
3. kgi_position_support_questions.md — 我們希望請貴司業務／工程協助回覆的 10 個
   技術問題

我們目前的訴求：

  (1) 確認此 crash 是否為已知問題、是否有對應的 SDK 版本修補
  (2) 是否有建議的呼叫序列或前置條件可以避免此 native crash
  (3) 若需提供更詳細的 log 或 Windows event viewer 截圖，請告知偏好格式

我們暫不需要 KGI 開放 paper trading 或 live trading 帳號；現階段仍維持 read-only 用途。
等 /position 路徑穩定後，我們會再循正式流程提交下一階段需求。

如有任何不便，敬請告知。

IUF Trading Room Engineering
```

**注意**：此版本維持 W4/W5 已 ack 的語氣與範圍。**未要求 paper / live / order path enablement**。

---

## §E5b.2 — English Technical Abstract (One-page summary)

```
SUBJECT: KGI gateway native crash on /position — IUF read-only deployment

WHO   : IUF Trading Room Engineering (internal code "IUF"; founder-led)
WHAT  : When calling Position.list_positions via kgisuperpy SDK from Python 3.11
        on Windows, the KGI native binary layer raises an unhandled exception
        that terminates the entire host process. Other SDK calls (login, quote
        subscribe, tick, bidask, deals) function correctly.
WHERE : Local Windows 11 host running uvicorn FastAPI gateway (services/kgi-gateway)
        bridging IUF API on Linux/Railway.
WHEN  : Reproducible in any Mode 4 single-shot diagnostic; documented since
        2026-04-23 Phase 0 closeout; currently mitigated.
WHY   : Unknown — needs KGI engineering insight. Not a network, auth, or
        Python-level error. Crash occurs deep in kgisuperpy native layer.
HOW MITIGATED:
        Candidate F circuit breaker:
          - env KGI_GATEWAY_POSITION_DISABLED=true
          - /position route returns 503 POSITION_DISABLED idempotently
          - /trades, /deals, /quote/* unaffected
ASKS  :
  1. Is this a known crash? Patch / SDK version available?
  2. Is there a safe call sequence (pre-conditions) to avoid the native crash?
  3. Recommended log/event format for further diagnosis?
NOT ASKING:
  - Paper trading enablement
  - Live trading enablement
  - Order path enablement
  - SDK source code

ATTACHMENTS:
  - escalation_package.md (technical detail)
  - reproduction_summary_redacted.md (minimum repro, all PII redacted)
  - support_questions.md (10 specific questions)
```

---

## §E5b.3 — LINE/電話話術最終版

**LINE 短訊（如業務窗口偏好 LINE 先聯絡）**：

```
您好，IUF Trading Room 這邊：
我們在 /position 端遇到 KGI native 層的 crash（不是網路也不是 auth 問題），
其他 read-only 路徑（行情、tick、bidask、deals）都 OK。
已部署 Candidate F 隔離，目前不影響其他功能。
想請業務協助安排與工程窗口確認，謝謝。
詳細技術摘要 + 最小重現流程 我們可以用 email 送過去，方便嗎？
```

**電話話術（如先電話通知再寄 email）**：

```
1. 自我介紹：IUF Trading Room，使用 kgisuperpy SDK 做 read-only 行情 + 部位查詢
2. 主訴：/position 路徑會觸發 KGI native 層的 crash，整個 process 終止
3. 範圍：只影響 /position；其他 read-only OK
4. 已採措施：Candidate F 隔離（POSITION_DISABLED 旗標 → 503）
5. 訴求：請業務轉介工程窗口；想確認是否已知問題 / SDK 是否有更新
6. 暫不要：paper / live / order — 還沒到那階段
7. 結尾：請業務告知偏好格式（email / 票證系統 / 內部工單）；我們可以提供
   完整技術文件與重現步驟
```

---

## §E5b.4 — 附件清單最終版（Final Attachment List）

| # | File | Format | Size | Purpose |
|---|---|---|---|---|
| 1 | `kgi_position_crash_escalation_package.md` | Markdown | ~384 lines | Full technical detail incl. env, SDK version, call sequence, observed crash signature, containment design |
| 2 | `reproduction_summary_redacted.md` | Markdown | ~220 lines | Minimum reproduction flow with all PII redacted as `<REDACTED_*>` |
| 3 | `kgi_position_support_questions.md` | Markdown | ~188 lines | 10 specific technical questions for KGI engineering |
| 4 | `kgi_escalation_w5_send_ready_package.md` (this round's parent) | Markdown | ~130 lines | Send-ready package metadata (Elva-internal; can omit when sending) |

**Recommended outbound bundle**: files #1 + #2 + #3. File #4 is internal Elva tracking; do NOT include in customer-facing send.

**Format options**:
- Plain markdown (preserves headers / code fences) — preferred for engineering audiences
- PDF (for archival; some customer service inboxes prefer this)

**LATER — confirmed PDF format requirement**: if KGI requests PDF, run `pandoc <file>.md -o <file>.pdf`. Inserted into this section so 楊董 has command on hand.

---

## §E5b.5 — Redaction re-check (re-verified on main 49deb87)

Re-grep across all 3 attachment files (#1-#3):

| Pattern | Hit count | Result |
|---|---|---|
| Raw person_id matching `^[A-Z][0-9]{9}$` | 0 in body content (mention only as "<REDACTED_PERSON_ID>") | ✅ PASS |
| Raw broker account number `<REDACTED:KGI_ACCOUNT>` | 0 in body content | ✅ PASS |
| Raw `KGI_LOGIN_PASSWORD` value | 0 (placeholder `<REDACTED_PASSWORD>`) | ✅ PASS |
| Raw `.pfx` cert content / pin | 0 | ✅ PASS |
| Raw API token / OpenAI key / GitHub token | 0 | ✅ PASS |
| Internal Slack/Discord URL | 0 | ✅ PASS |
| Internal Railway service ID | 0 | ✅ PASS |
| Railway deployment ID | 0 (Lane B internal evidence only, NOT in escalation files) | ✅ PASS |
| KGI internal ticket ID | 0 (none assigned yet) | N/A |

**Redaction integrity HELD on 49deb87.** Send-safe.

---

## §E5b.6 — One-page summary for 楊董 (Quick Reference)

```
=== KGI ESCALATION SUMMARY (FOR 楊董 PRE-SEND CHECK) ===

STATUS    : NOT_SENT — awaiting verbatim "送出 KGI escalation" / "send KGI escalation"
GATE      : 楊董 must say the exact phrase; Elva does NOT auto-send

WHAT TO ATTACH:
  ✓ kgi_position_crash_escalation_package.md
  ✓ reproduction_summary_redacted.md
  ✓ kgi_position_support_questions.md

WHAT TO FILL:
  ✓ From: 楊董's preferred outbound mailbox
  ✓ To  : KGI staffed inbox (per 楊董's KGI 業務 contact)
  ✓ Subject: [IUF] /position 端 KGI Native Crash 升級單 — Candidate F containment 已部署

WHAT NOT TO ATTACH:
  ✗ kgi_escalation_w5_send_ready_package.md (internal Elva tracking)
  ✗ Any file under evidence/ that lists Railway IDs / GHA run numbers
  ✗ Any file containing real person_id / account / password / cert / token

WHAT NOT TO ASK FOR:
  ✗ Paper trading enablement
  ✗ Live trading enablement
  ✗ Order path enablement
  ✗ SDK source code

WHAT TO LOG (POST-SEND):
  Next round closeout under "KGI escalation: SENT at YYYY-MM-DD HH:MM TST to <recipient>"
```

---

## §E5b.7 — Send checklist (run by 楊董 just before send)

1. ☐ Read 中文寄信版 (§E5b.1) end-to-end — confirm tone matches 楊董's voice
2. ☐ Confirm `From` mailbox identity is 楊董's outbound (not noreply / not Elva)
3. ☐ Confirm `To` is KGI staffed inbox (not internal IUF list)
4. ☐ Attach files #1, #2, #3 (per §E5b.4); convert to PDF if KGI prefers
5. ☐ Final visual scan: any `<REDACTED_*>` placeholder must remain `<REDACTED_*>` (do NOT fill in real values just because the field is empty)
6. ☐ Confirm Subject line and any classification headers
7. ☐ Click send
8. ☐ After send: log timestamp + recipient + subject in next-round closeout under "KGI escalation: SENT at YYYY-MM-DD HH:MM TST to <recipient>"

---

## §E5b.8 — Hard lines (Lane E)

- ❌ Does NOT auto-send
- ❌ Does NOT fill in real person_id
- ❌ Does NOT fill in raw account
- ❌ Does NOT fill in password / token / PFX content
- ❌ Does NOT promise paper / live / order enablement
- ❌ Does NOT include internal Railway/GHA IDs in customer-facing send
- ❌ Does NOT modify the W4 / W5 escalation package contents (this doc is polish; original 8/8 send-ready package stays canonical)

---

## §E5b.9 — Verdict

**STATUS_STAYS_NOT_SENT_AWAITING_YANG_SEND_KGI_ESCALATION**

Lane E delivers 7 polish items: 中文寄信稿 / English abstract / LINE+電話話術 / 附件清單 / redaction re-check / one-page summary / send checklist. Send-fire condition unchanged: 楊董 verbatim phrase. Elva will NOT autonomously send.

If 楊董 issues send phrase next round: §E5b.7 checklist is the operator runbook.

---

— Elva (via W5b Lane E dispatch), 2026-04-29
**Verdict**: NOT_SENT_AWAITING_YANG_SEND_KGI_ESCALATION. 7 polish items filed. Redaction integrity HELD. 0 stop-lines triggered.
