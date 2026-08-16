# P2-AI-03 × localhost:5500 整合現況檢查（唯讀，未修改任何檔案）

## 1. 前端是否有 P2-AI-03 的操作入口？

**❌ 沒有。** 這是 P2-AI-03 工作規格明文禁止的範圍（`❌ UI 修改`、`❌ wallpaper.html`）。[wallpaper.html](../wallpaper.html) 的表單仍只有「吉祥物 / Gift / 風格 / Lucky Theme / 祝福文字」，沒有任何 Shopkeeper 相關 UI 元件。

（另外 `good.html`/`product.html` 裡的 "askShopkeeperBtn" 是店家頁的另一個無關功能，經確認與 P2-AI-03 的 Shopkeeper Context Agent 完全無關，只是命名巧合。）

## 2. 相關 JavaScript 是否已由 HTML 載入？

**❌ 沒有，且原本就不會有。** [wallpaper.html](../wallpaper.html) 只載入：

`config.js` → `js/api.js` → `js/user.js` → `wallpaper-selection-service.js` → `wallpaper-polling-service.js` → `wallpaper-result-presenter.js` → `wallpaper-generation-client.js` → `js/pages/wallpaper.js`

全站搜尋確認**沒有任何 `<script>` 標籤引用** `shopkeeper-context-agent.js`、`gemini-text-provider.js` 等新檔案 —— 這些本來就是純後端 Node/Deno 模組，設計上只會在 Supabase Edge Function 內執行，永遠不會被送到瀏覽器。

## 3. UI 是否會呼叫 P2-AI-03 的功能？

**⚠️ 只有間接、且目前完全不會（因為尚未部署）。** [wallpaper-generation-client.js](../js/services/wallpaper/wallpaper-generation-client.js) 會 POST 到 `/functions/v1/wallpaper-generate`，**一旦部署後**該 Edge Function 內部會呼叫 `generation-service.js → shopkeeper-context-agent.js`。但即使部署後，回傳給前端的 DTO（`createGenerationSuccessDto`）**仍未新增** `story`/`luckyTheme`/`blessing`/`oneLiner`/`shopkeeperMessage` 欄位 —— 也就是說**就算部署了，也無法從瀏覽器畫面/回應內容直接觀察到 Shopkeeper 是否生效**，只能從資料庫 `metadata_json.shopkeeperSnapshot` 或後端 log 間接驗證。

## 4. 所需 API、環境變數與測試資料是否齊全？

| 項目 | 狀態 | 說明 |
|---|---|---|
| `GEMINI_API_KEY` | ✅ 已設定 | 用 `supabase secrets list` 確認遠端專案已有此密鑰（僅列出雜湊值，未外洩明文） |
| `SHOPKEEPER_MODEL` / `SHOPKEEPER_TIMEOUT_MS` / `SHOPKEEPER_MAX_RETRY` | ⚠️ 未設定 | 但程式碼有安全預設值（`gemini-2.5-flash` / `20000` / `0`），**不會**因此擋住執行 |
| `metadata_json` 欄位 | ✅ 已存在 | 來自更早的 migration（`20260712040000_create_wallpaper_core_tables.sql`），P2-AI-03 沒有新增資料表/欄位，**不需要新 migration** |
| **Edge Function 部署** | ❌ **未部署** | `git status` 確認所有 P2-AI-03 檔案（`shopkeeper-*`、`gemini-text-provider.*`、`generation-service.*` 等）皆為未提交狀態（`M`/`??`），代表遠端 Edge Function 目前仍在跑**舊版**程式碼 |
| **測試帳號**（需已登入且擁有 ≥1 吉祥物 + ≥1 已兌換 Gift） | ❌ **沒有** | 本次未取得/未偽造任何測試帳號密碼 |
| 登入流程本身 | ⚠️ 有額外風險 | `js/user.js` 的登入流程強制要求通過 Cloudflare Turnstile 驗證，對全自動化 Playwright 登入是額外阻礙（即使日後有測試帳號） |

## 5. 能否透過 Playwright MCP 執行端到端測試？

- 「頁面載入 / UI 存在性 / 表單驗證」層級 → **可以**（先前會話已驗證過，首頁與 wallpaper.html 皆正常、無 console 錯誤）。
- 「真正觸發生成、驗證 Shopkeeper AI/Fallback 行為」層級 → **不行**，因為程式碼未部署 + 無測試帳號 + Turnstile 可能干擾自動化登入。

---

## 分類結論

| 檢查項目 | 分類 | 理由 |
|---|---|---|
| 1. 前端操作入口 | 🔴 **BLOCKED** | 設計上就不存在（Out of Scope），非缺失而是刻意不做 |
| 2. JS 是否由 HTML 載入 | 🔴 **BLOCKED** | 純後端模組，架構上永遠不會由瀏覽器載入 |
| 3. UI 呼叫 P2-AI-03 功能 | 🔴 **BLOCKED** | 尚未部署；即使部署後也只能間接驗證（DTO 未回傳 Shopkeeper 欄位） |
| 4. API / 環境變數 / 測試資料 | 🟡 **PARTIAL** | env vars 與 DB schema 已就緒，但**部署**與**測試帳號**兩項缺一不可 |
| 5. Playwright E2E 可執行性 | 🟡 **PARTIAL** | 僅能測「頁面存在/不崩潰/表單驗證」；無法測「Shopkeeper 實際生效」 |

**整體結論：P2-AI-03 目前對 `localhost:5500` 可操作流程而言是 🔴 BLOCKED（無法端到端驗證其 AI 行為）**，唯一可行的驗證方式仍是先前已執行的本機單元測試（`verify-local.ps1`，196/196 通過）。若要解除 BLOCKED，至少需要：

1. `supabase functions deploy wallpaper-generate`（需你確認才會做）
2. 一組已登入且擁有吉祥物/Gift 的測試帳號
3. 確認 Turnstile 不會擋掉自動化登入

本次未修改任何檔案、未 commit、未 push。
