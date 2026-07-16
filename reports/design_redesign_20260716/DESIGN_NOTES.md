# 三頁重設計 第三輪 — 設計說明 + 原版→新版逐區對照（2026-07-16 v3）

三檔 self-contained HTML（inline CSS/JS、無外部資源）· 1920 桌機主場景 + 390 手機 media query · 直接開檔可看。
視覺語言＝全站既有 CRT phosphor / amber 終端風：近黑底 `#04060a`、琥珀 `#c8943f`/`#e2b85c`、掃描線、HUD 角括號。
台股漲跌色：**紅漲 `#e63946` / 綠跌 `#2ecc71`**。工程語意（enum/debug/model name/vendor 字樣）不上桌面，vendor（FinMind/TEJ）改人話或降到 sfoot 級。

ground truth 來源：`ORIGINAL_PAGES_INVENTORY.md` + `originals/`（28 張 prod 實圖，逐張親驗）。

---

## 交付三檔
| 檔 | 頁 | 狀態 |
|---|---|---|
| `login_redesign_v1.html` | 登入 v3 | 原路徑原地改 |
| `register_redesign_v1.html` | 註冊（新增） | 兩態同頁切換示意 |
| `company_redesign_v1.html` | 公司 v3 | 原路徑原地改 |

---

## 一、登入 login_redesign_v1.html

### 設計主張（≤5 行）
- 把登入做成**操作員終端的開機門面**：一個 HUD 角括號的 console 框，左＝巨型戰情室字標，右＝登入卡，建立帳號焊在同框內。
- 品牌張力回到 v1 的份量（框式構圖／phosphor 光暈／大字），但**張力來自版式與字級，不是行銷內容**。
- 兩輪退件全處置：零「SIM／模擬」字樣、零 01-04 行銷能力清單、零假 readout；建立帳號＝一級 CTA。
- 左欄一句誠實定位（原版本來就有這句 body），非四顆能力 chip。
- 台北時鐘＝真實時間（非市場假讀值），只給終端生命感。

### 兩輪退件的處置
| 退件 | v3 處置 |
|---|---|
| v1：「SIM 模擬」badge | 全頁清零；masthead 副標/footband/lede 皆正式語言 |
| v1：01-04 能力清單「很像 AI 網站」 | 整段拿掉；改左欄一句 prose 定位（無 chip 列、無編號卡） |
| v1：缺註冊入口 | 建立帳號升一級：登入卡下同框 `.register` 區塊＋帶框 CTA「用邀請碼建立帳號」 |
| v2：「超醜超兩光沒設計感」＝矯枉過正 | 找回張力：console 角括號框 + 60px 大字標（「交易戰情室」琥珀）+ 網格 phosphor 光暈 + 頂部系統識別條；素面置中表單升級為框式雙欄構圖 |

### 原版 → 新版 逐區對照
| 原版 `/login` 區塊（逐字取自 inventory §1） | 新版位置 | 為什麼 |
|---|---|---|
| masthead：I chip + IUF TRADING ROOM + 副標「訪客登入 · SIM 模擬工作台」 | `.mast`（副標改「台股 AI 交易戰情室」，右加真實台北時鐘＋邀請制 BETA） | 去 SIM；時鐘給終端感不做假行情 |
| 左欄 eyebrow「IUF 帳號 · 台股交易工作台」 | brandpane `.boot`「OPERATOR CONSOLE / 受邀開通」 | 開機語意，非行銷 eyebrow |
| 左欄 H1「登入你的交易戰情室工作台」 | brandpane `h1`「台股 AI / 交易戰情室」60px | 字標＝hero，品牌張力主體 |
| 左欄說明「串接即時報價、風控與模擬委託紀錄…邀請制…」 | brandpane `.lede`（去「模擬委託」→「下單與風控」；保留邀請制） | 原版本來就有這句 prose，保留但去 SIM |
| 左欄 CTA「申請測試帳號」 | 併入 `.register` 動線（與「用邀請碼建立帳號」合一，不做兩顆測試帳號 CTA） | 邀請制下單一開通動線更誠實 |
| 左欄 4 chip「報價/風控/模擬委託/操作紀錄」 | **移除**（退件主因） | 這就是「行銷能力清單」；改左下 idline 三格誠實識別（市場/存取/節點） |
| 右欄 eyebrow「登入 · IUF 帳號驗證」+ 副標「電子信箱/密碼/裝置記憶」 | `.auth-head`「帳號登入 · MEMBER ACCESS」 | 收斂為卡頭 |
| 電子信箱 / 密碼欄（placeholder 逐字） | `.field` input（placeholder 照抄） | 1:1 |
| Checkbox「記住這台裝置」+ 說明（預設勾選） | `.check`（預設 checked，加「忘記密碼？」— 註：原版無此連結，v3 補為常見動線，可拆） | — |
| 主 CTA「登入戰情室」 | `.submit`「登入戰情室」 | 逐字 |
| 次連結「還沒有帳號？用邀請碼建立帳號」→ /register | `.register` 一級區塊（升格） | 退件要求 |
| footer 左右（IUF… / 操作員登入 · 邀請制 BETA） | `.footband`（逐字保留，去 SIM） | 1:1 |
| 手機：單欄堆疊 | 390：表單優先、品牌面收下方（貼原版手機序） | 原版手機也是表單在上 |

---

## 二、註冊 register_redesign_v1.html（新增）

### 設計主張（≤5 行）
- 與登入同一套 console 語言；`?invite=` 有無決定兩態，草稿用右上示意切換器同頁演示。
- State A 無邀請碼＝邀請制占位卡（原版本來就只有這張卡，逐字保留）。
- State B 有邀請碼＝雙欄開表單，左品牌＋密碼規則卡、右 REG 面板。
- 欄位/型別/驗證全照 inventory §2.1 代碼抄錄：密碼前端強制 ≥12＋大小寫＋數字，即時 4 規則勾選。
- 錯誤訊息＝常駐固定版位（原版設計如此，非 bug），預設灰字「錯誤訊息會顯示在這裡」。

### 原版 → 新版 逐區對照
| 原版 `/register` 區塊（inventory §2） | 新版位置 | 為什麼 |
|---|---|---|
| **無邀請碼態**：eyebrow 交易戰情室 + H1「台股 AI 交易戰情室」 | State A `.gate` boot + h1 | 逐字 |
| 卡：標題「本系統採邀請制」 | `.gatecard .gh` | 逐字 |
| 卡：說明「請聯繫系統管理員取得邀請連結，再開啟連結建立個人帳號。」 | `.gatecard .gp` | 逐字 |
| 卡：範例格式 `…/register?invite=...` | `.gatecard .fmt .v`（等寬字，框住） | 逐字 |
| 卡：CTA「已有帳號，前往登入」 | `.gatecard .gcta` | 逐字 |
| **有邀請碼態** 左欄 eyebrow「交易戰情室 · 受邀開通席位」 | State B brandpane boot「受邀開通席位 / SEAT」 | — |
| 左欄 H2「設定帳號後即可進入戰情室」 | brandpane `h1` | 逐字 |
| 左欄說明（IUF 網站帳號…券商綁定另行開通） | brandpane `.lede` | 逐字 |
| 左欄密碼強度規則說明卡（靜態） | `.rulecard`（4 條靜態列示，與右側即時提示同一份規則） | inventory 指明左欄有此卡 |
| 左欄次連結「已有帳號，前往登入」 | brandpane `.back` | 逐字 |
| 右卡 panel-code REG + 徽章「受邀開通/邀請制」 | `.reg-head` tab REG + badge 邀請制 | 逐字 |
| 姓名/暱稱 text required（placeholder 逐字） | `#name` | 1:1 |
| 電子信箱 email required | `#email` | 1:1 |
| 密碼：≥12＋大寫＋小寫＋數字，即時 4 規則✓/○ | `#pw` + `.pwrules`（JS 即時，✓綠/○灰） | inventory §2.1 逐條 |
| 確認密碼：須一致 | `#pw2`（JS 檢查一致） | 1:1 |
| 邀請碼 hidden（URL 帶入，使用者看不到） | 未渲染可見欄位；`.reg-foot` 一句「邀請碼已隨連結帶入並綁定」 | 照原版 hidden，不憑空造欄 |
| 送出鈕「建立帳號」（loading「建立中...」） | `.submit`（JS disabled + 文字切換） | 逐字 |
| 錯誤區常駐 role=alert 預設灰字「錯誤訊息會顯示在這裡」 | `.err-persist`（常駐固定版位；出錯轉紅） | inventory 註明是設計固定版位非 bug |
| 已知錯誤文案（invalid_or_expired 等） | JS 示意帶入「邀請連結無效或已過期，請聯繫邀請人。」 | 對照表其一 |
| 送出成功 → router.push("/") | `.reg-foot`「建立成功後直接進入戰情室首頁」 | 說明無中間頁 |

---

## 三、公司 company_redesign_v1.html

### 設計主張（≤5 行）
- 單檔「個股工作表」活在 app layout 內：252px 示意側欄 + 巨型報價錨點 + K 線引擎滿血 chrome + 成對面板等高。
- 原版所有區塊逐項落位（含財報七分頁 tab、K 線全週期/範圍/視窗、知識圖譜、上下游 node graph、法人籌碼、外資持股分佈、重大訊息、公司主檔、AI 九段、主題受惠、資料源狀態）。
- 編排優化：原版「財報/月營收/法人/融資券/股利」在摘要卡與 [06]-[11] 各出現兩次；v3 收斂到單一 7-tab 財報元件 + 籌碼 pairrow，資訊不減、去重複。
- 已核可元素沿用：K 線＝import 既有 `OhlcvCandlestickChart`（禁重寫，面板頭已標注）、空態＝面板不渲染自動補位、等高成對面板、tscroll 寬表滾動。
- 假資料皆 2330 plausible 靜態值（對齊 prod 原圖：2,435 / EPS 22.08 / 外資持股 69.52% / 融資 33,293…），接線時 K 線與 AI 報告整塊換既有引擎/管線輸出。

### 條件：K 線＝import 既有元件，禁重寫
`#sec-kline` 面板頭標「import OhlcvCandlestickChart · 禁重寫」。chrome 按元件真實樣貌 1:1：
均線 MA5/10/20/60（色 `#FFD600/#FF8C00/#00E5FF/#B388FF`）｜VWAP｜量價支撐/壓力｜交易計畫｜RSI｜MACD；
訊號 strip 6 chips；圖面 430px（桌）/300px（手機，min-height 34px）；
toolbar 日線[日K|週K|月K]、分K[1分|5分|15分|60分]、範圍[3月|6月|1年|2年|全部]、分K視窗[1日|5日|10日|20日]。
草稿圖面靜態 SVG 示意；接線時整塊由既有引擎渲染，RSI/MACD 子圖、pan/zoom 引擎自帶。

### 空態規則
`.pairrow` = grid 兩欄；接線時任一面板資料為空 → 整個面板不渲染 DOM，pairrow 自動補位（剩單項時該項可全寬）。**不做空態佔位卡**。同規則適用 [06]-[11] 任一面板與五檔/逐筆。

### 原版 → 新版 逐區對照（inventory §3 全區塊 checklist，每項都有位置）
| # | 原版區塊（逐字） | 新版位置 | 為什麼 / 備註 |
|---|---|---|---|
| 1 | 2330 H1 + 副標「上市」+ breadcrumb「公司板/2330/半導體/核心受惠」 | `.mast` + hero eyebrow + stamp | 代號/名稱/市場/受惠層級齊 |
| 2 | Hero KPI 10 格 | `.anchor`（最新價+漲跌幅）+ `.kpis` 8 格（成交量/開/高/低/動能/本益比/殖利率/月營收） | 10 項全在 |
| 3 | Hero 第二排：指幅/52週高/52週低/市值/本淨比/分K根數 | `.statstrip` 6 格 | **v2 漏了這排，v3 補上** |
| 4 | K 線圖（7 週期+5 range+4 分K視窗+MA+疊圖） | `#sec-kline`（見上，import 既有引擎） | 全控制項在 |
| 5 | 五檔委買委賣（LIVE） | pairrow 五檔 ladder（LIVE 時戳） | 1:1 |
| 6 | 逐筆即時成交（LIVE 20 筆/5s） | pairrow 逐筆（LIVE · 5s） | 1:1 |
| 7 | 公司主檔（識別+市場別/國別/產業鏈位置/受惠層級+產業受惠拆解 5 bar+備註） | rail `#sec-profile`：profgrid 4 格 + benebars（量能/均價/毛利/產能/敘事 各 3）+ profnote | **v2 過薄，v3 補齊 5 bar + 備註全文** |
| 8 | 知識圖譜（業務簡介/供應鏈上下游/主要客戶/供應商/主題脈絡） | pairrow `#sec-graph` 左：業務 prose + 供應鏈 5 列 + 客戶/供應商/主題 chips | **v2 只有 3 bullet，v3 補全內容** |
| 9 | 上下游圖譜（同業/上游/下游/主題 node 圖） | pairrow `#sec-graph` 右：SVG node graph + legend | **v2 缺，v3 新增** |
| 10 | AI 分析師報告（九段） | `#sec-ai` 整幅 9 段 2×N（每段 2-3 行）+ verdict 列 + 費用 | 見下條件 |
| 11 | 三大法人買賣超 | pairrow `#sec-chips` 左 法人籌碼（tiles + 近 30 日表含合計欄） | 1:1 |
| 12 | 融資券餘額 | pairrow `#sec-chips` 右 融資融券（餘額/變動/券資比 + 表） | 1:1 |
| 13 | 資料源狀態總覽（各源 LIVE/暫停） | rail `#sec-src`：5 源（公司主檔/K線/重大訊息/分K 正常、逐筆 暫停） | **v2 缺，v3 新增；「暫停」用人話非工程碼** |
| 14 | 主題受惠（Apple/EUV/NVIDIA/矽晶圓） | `#sec-theme` 4 卡（核心受惠） | **v2 折進他區，v3 還原獨立卡** |
| 15 | 頁面索引 [01]-[11] | rail `#sec` 頁面索引（9 錨點） | 1:1 |
| 16 | [03] 財報與估值 = 7 tab（財報/月營收/資產負債/現金流/估值/市值/股利） | `#sec-fin` **7-tab 元件**（JS 切換，表格 tab + 6-tile tab） | **v2 缺整個 7-tab，v3 建立；欄位逐字照 inventory §3.6** |
| 17 | [04] 籌碼流向右欄：外資持股 69.52%/尚可投資 30.47%/發行股數 25.93 十億/持股分佈 bars | `#sec-hold` 外資持股與分佈（tiles + distrib bars） | **v2 缺，v3 新增** |
| 18 | [05] 重大訊息（官方公告/新聞線索） | `#sec-news` 整幅（5 則，日期+類型 tag+標題） | 全寬還原 |
| 19 | 逐筆成交明細（KGI 逐筆/FinMind 分K）全寬表 | `#sec-detail` 全寬表（時間/成交價/漲跌/量/方向/累計） | 1:1 |
| 20 | [06]-[11] 細表（財報/月營收/法人/融資券/股利/重大訊息） | 已由 #16(財報 7-tab) + #11/#12(籌碼) + #18(重大訊息) 涵蓋 | **去重複**：原版同名區塊出現兩次，v3 收斂一次，資訊不減 |

刻意未帶入（誠實揭露）：
- 月營收原版 `<th>` 含「代號/國別」→ 皆為 2330/台灣的冗餘常數，依「不秀工程語意」改列「年增率/月增率」（更有用）；市值 tab 同理去「代號」。
- AI 報告本輪 prod 撞品質閘門未產出合格九段本體 → v3 依真實九段**合約**（格式/數字/來源要求）設計顯示層，內容為 2330 plausible 示意；接線＝管線輸出。
- DerivativesPanel（衍生性）原版即因資料源未接不 render → 沿用不呈現。

### 條件：AI 分析師＝按真實後端合約
九段固定（01 公司定位…09 資料來源）、≥3 可驗證數字、≥3 資料來源類型、每判斷標來源、觀察等級四選一（可追蹤/中性觀察/資料不足/風險偏高暫不採用）、禁保證獲利語句。verdict 列帶「非下單建議」+ 生成費用；每段 2-3 行＝真實輸出量級；手機轉單欄。

### 側欄
左 252px 示意側欄（真值＝app layout），nav = canonical surfaces（戰情台/市場情報/AI 推薦/交易室/公司·主題/量化策略/F-AUTO SIM），「公司 / 主題」高亮；手機 390 隱藏（真 app 為收合抽屜）。

---

## 四、390 手機驗收 harness
新 headless 最小視窗 500px：用 `--headless=new --force-device-scale-factor=1` + 390px iframe 灰底 wrapper 量測，避開 DPI≠100% 假裁切。
本輪實測（`_v3shots/`）：登入/註冊(A+B)/公司 三頁 390 **零右緣裁切**；公司頁寬表全在 `.tscroll` 內滾動，`.phead .rt` ellipsis 保險。

### 證據截圖（`_v3shots/`）
`login_1920.png`、`register_1920.png`(State A)、`registerB_1920.png`(State B)、`company_full1920.png`（全頁 1920×~4400）、
`login_390.png`、`register_390.png`(State B)、`company_390.png`、`_crop_fin.png`（財報 7-tab 特寫）。

## 五、驗收提示
- 桌機 1920：console 框 HUD 角括號；公司頁側欄 252 + deck（1fr + 316 rail）；成對面板逐排等高（`grid-auto-rows:1fr` + `.sfoot margin-top:auto`）。
- 手機 390：單欄化、KPI/statstrip 2 欄、K 線 300px、訊號 strip 3 欄、AI 報告單欄、主題卡 2 欄；零右緣裁切。
- 並排自問「某資訊去哪了」逐項可答：見 §三對照表 20 列（含 v2 漏掉、v3 補回的 #3/#7/#8/#9/#13/#14/#16/#17）。
