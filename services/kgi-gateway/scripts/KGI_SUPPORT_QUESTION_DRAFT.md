# KGI superpy 登入失敗診斷 — 給 KGI 客服 / 業務 / API 技術窗口

> 楊董：填入 `<填>` 欄位後寄出。不要修改技術內容。

---

## 已驗證事實

- KGI 一般證券戶有效（網站登入正常）
- SuperPy API 申請狀態：已通過（狀態 ✓ 綠勾）
- SuperPy 風險預告書簽署狀態：已簽署（狀態 ✓ 綠勾）
- Python SDK kgisuperpy 已安裝（Windows 環境）
- CA / 憑證檢查：已通過
- simulation=True 確認傳入 SDK（程式碼已驗證）

---

## 嘗試的 API 呼叫

```python
import kgisuperpy as kgi
result = kgi.login(
    person_id="<身份證字號大寫>",
    person_pwd="<電子下單密碼>",
    simulation=True
)
```

---

## KGI Server 回應

```
IsLogon (FIsLogon): False
RtnCode: 78
ReplyString: 您尚未申請使用元件，請洽營業員
```

---

## 問題：請協助確認以下 5 點

### 問題 1：元件使用權限是否需要另外開通？

錯誤碼 78 = 「您尚未申請使用元件」。

我已完成：
- SuperPy API 申請 ✓
- 風險預告書簽署 ✓

請問「元件使用權限」（TradeCom 元件）是否需要在後台另外開通？
這與 API 申請通過是**兩個獨立的步驟**嗎？

如果是，請問開通流程為何？需要填寫哪些表單？

---

### 問題 2：kgisuperpy.login() 應使用哪一組密碼？

我使用的是「**電子下單密碼**」（e-trading password）。

請確認：
- (A) 電子下單密碼 ✓（正確）
- (B) 網站登入密碼（不正確）
- (C) API 專用密碼（需另外申請設定）
- (D) 其他 → 請說明

如果需要設定 API 專用密碼，請問設定管道為何？

---

### 問題 3：77 與 78 的正式定義？

我在 errMsg.ini 中看到：

```
77 = SSO系統異常
78 = 您尚未申請使用元件，請洽營業員
79 = 您尚未申請使用API，請洽營業員
```

請確認 78 的正式含義：
- (A) TradeCom 元件使用權限未開通
- (B) SuperPy API 未開通（但申請已通過，矛盾）
- (C) Simulation 環境元件未開通
- (D) 其他

---

### 問題 4：Simulation 環境是否需要另外開通？

我的 simulation=True 呼叫失敗（code 78）。

請問 simulation 環境：
- (A) SuperPy 申請通過後自動 enabled（預設開通）
- (B) 需要另外申請開通 simulation 環境
- (C) Simulation 環境有獨立的元件權限設定

如果需要另外申請 simulation，請問流程為何？

---

### 問題 5：申請通過到系統生效是否有同步延遲？

API 申請通過後，系統需要多久同步？
是否可能申請已通過但後台尚未同步完成（需等待特定時間或人工作業）？

---

## 帳號識別（給 KGI 內部查詢）

- 帳號 (person_id)：`<填：如 A123456789>`（前3後2 遮罩：`A12****89`）
- 證券戶名稱：`<填：姓名>`
- 開戶券商：KGI 凱基證券
- API 申請日期：`<填：YYYY-MM-DD>`
- SuperPy 申請通過時間：`<填：YYYY-MM-DD>`
- 風險預告書簽署時間：`<填：YYYY-MM-DD>`

---

## 聯絡方式

- Email：`<填>`
- 電話：`<填>`

---

*本信件由 IUF Trading Room 系統工程師根據 SDK 原始碼與 errMsg.ini 分析產出。*
*技術問題可直接回覆本信。*
