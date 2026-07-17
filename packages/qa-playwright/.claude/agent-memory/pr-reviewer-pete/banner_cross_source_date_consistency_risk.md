---
name: banner-cross-source-date-consistency-risk
description: 首頁/交易台 banner 跨獨立資料源取「較新日期」時，只驗日期新舊、不驗資料完整度的通用風險模式
metadata:
  type: project
---

IUF 首頁多處會從兩個獨立擷取的 TWSE 上游資料集拼一個「顯示用」數字（例：`/market/overview/twse`
的 MI_INDEX vs `market-data/overview` 的 `marketContext.index`）。這兩個源各自誠實（各自標對自己
的日期），但發布時序不保證同步，會出現「banner 日期跟旁邊 tile 日期不一致」的使用者可感知 bug
（6/10 也踩過同類但方向不同的 sign-contradiction：跨源混用 price+date 導致漲跌方向矛盾）。

2026-07-17 PR #1297 的修法：`isNewerTaipeiTradeDate()` 比較兩源日期，較新者「整組」（price+date）
一起採用，不跨源混用單一欄位——這解決了 6/10 那類 bug，是正確方向。

**Why 這是需要持續盯的模式而非一次修完**：「取較新日期」的判斷只驗證了「日期字串比較新」，沒有
驗證「這個較新日期的資料本身是否完整/可信」。同一晚（2026-07-17）團隊另外真實撞見「index STALE
狀態帶 07/17 殘缺 bar」的獨立事故（market-intel `_stockDayAllInflight` 掛死類），提醒了這類
newer-wins 邏輯如果不加資料品質門檻，理論上可能讓一筆「日期新但數值未收斂」的 STALE quote 覆蓋
掉「日期舊但完整正確」的資料。PR #1297 目前只用 `state !== "EMPTY"`（等於接受 LIVE+STALE）當門
檻，沒有比照 enricher 側的 `isPlausibleChangePct` 之類值域防呆，且只有純函式 `isNewerTaipeiTradeDate`
被單元測試，整合行為（`readMarketIndex()` 本體）零測試覆蓋——判為 🟡 non-blocking suggestion 而非
🔴，因為：(a) 影響面窄（只動首頁單一 banner 數字）(b) 不是本輪 regression（本來就更不安全，本輪是
淨改善）(c) STALE 在這條 pipeline 語意上通常只代表「過期幾分鐘/幾小時」而非「數值损毀」。

**How to apply**：下次看到任何「兩個獨立上游源，取較新日期那組」的 PR，除了驗證 6/10 那類跨源混
用 bug 有沒有修對，還要多問一句：「較新」的判斷有沒有連帶信任了資料完整度？如果門檻只卡
`state !== EMPTY`（等於連 STALE 都收），建議至少收斂到只信任最高品質狀態（如 `LIVE`），或要求補
一條整合測試鎖住 STALE+跨日情境的預期行為——但除非有具體事故證據，先列 🟡 不擋 merge。

Link: [[heatmap-data-honesty-gating-pattern]]
