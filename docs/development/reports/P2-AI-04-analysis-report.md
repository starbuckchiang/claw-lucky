# P2-AI-04 Wallpaper UI Workflow Integration — Analysis Report (v3)

**狀態：規格修訂階段。本文件不包含任何程式碼變更，僅供 Product Review。**

## 0. 修訂記錄

### 0.1 v2 修訂摘要（保留，詳見下方 v1 錯誤修正）

v1 提出「方案 A：獨立 Shopkeeper Preview Function ＋ stateless 簽章 previewToken」，v2 依 Product Review 回饋推翻 stateless token 設計，改採 DB-backed `shopkeeper_previews` 短效紀錄（詳見 0.2 節）。

### 0.2 v3 修訂摘要（本次）

Product Review 針對 v2 提出的架構，發現以下四類尚未解決的正確性問題，v3 逐一修正：

1. **並行安全問題**：v2 的「`SELECT count(*)` + `FOR UPDATE`」寫法**無法**防止（a）同一使用者同時建立兩個全新 Session、（b）每日次數在邊界值（19/20）並發時超額、（c）同一 Session 並發重抽超額——因為 `FOR UPDATE` 只能鎖定「已存在且符合查詢條件」的列，無法阻擋另一筆交易並發插入一筆全新、尚未被計入的列。v3 改用 `pg_advisory_xact_lock` 搭配 MD5 衍生的穩定鍵值，在同一交易內序列化「同一使用者＋同一天」與「同一使用者＋同一 Session」的競爭者（詳見第 17 節）。
2. **額度預約時機問題**：v2 的 Preview 建立流程隱含「先呼叫 Gemini、才檢查次數上限」的風險（因為 v2 沒有明確拆出「先佔位、再產生內容」兩個階段）。v3 拆成 **reserve → generate → finalize** 三階段，額度檢查與佔位在呼叫 Shopkeeper Agent **之前**完成（詳見第 16 節）。
3. **Finalize／並發完成問題**：v2 沒有處理「Shopkeeper Agent 呼叫期間，使用者是否可能同時觸發下一次重抽」「finalize 呼叫本身是否需要冪等」等問題。v3 明確定義 Finalize 的冪等語意與失敗處理（詳見第 16.3 節）。
4. **Confirm Consume 的前置條件問題**：v2 的 Consume 設計把「已存在的 `generationId`」當作 Consume 的輸入條件之一，但實際上 `generation-orchestrator.js` 的真實執行順序是「先建立 `jobId`，Image 生成成功後才會有 `generationId`」——`generationId` 在 Consume 當下**根本還不存在**。v3 修正為以既有、且在 Consume 當下已確實存在的 `jobId` 作為冪等鍵（詳見第 18 節）。

此外，Product Review 也要求誠實盤點「Job 重試」的真實能力（不得只因資料表有 `retry_count` 欄位就宣稱已有重試機制）、修正過渡期部署策略（避免同一次 release 讓舊版 UI 失效）、完整追蹤 Response DTO 傳遞鏈、以及下載按鈕的技術方案——詳見第 19～22 節。

### 0.3 v1 錯誤敘述修正（保留自 v2，仍然有效）

v1 曾提出「stateless 簽章 previewToken」作為 Preview 狀態的載體。經 Product Review 檢視，以下 v1 敘述不準確，特此修正：

1. **「Stateless HMAC token 可以做到一次性消費」——不成立。** Stateless token 本身不具備狀態，一旦簽發，任何人在有效期內都可以重複送出同一個 token 進行 Confirm；要做到「只能成功 Consume 一次」，必須有一個**持久化的、可被原子更新的狀態記錄**（例如資料庫中的 `consumed_at` 欄位）作為單一事實來源，單純驗證簽章與過期時間**無法**防止重放。
2. **「Stateless token 可以立即使舊 Preview 失效」——不成立。** 若 token 本身不落地，系統沒有任何地方可以「標記某個舊 token 已失效」；即使發出新 token，舊 token 只要簽章與過期時間仍有效，仍然可以被拿去 Confirm。要「立即失效」，必須有伺服器端可查詢、可寫入的狀態。
3. **「Stateless token 可以可靠執行每日／Session 次數限制」——不成立。** 次數限制本質上是一種**跨請求的計數狀態**，stateless 設計沒有任何地方可以累計「這是第幾次」；若要用 token 內夾帶次數欄位由 client 帶回來，等同於信任客戶端回報的計數，可被竄改（例如重送舊 token 使計數不遞增）。
4. **「方案 A（獨立 Function）對現有 wallpaper-generate 零風險」——不準確。** 即使新增獨立的 Preview Function，**Confirm／Generate 路徑（`wallpaper-generate`）仍必須修改**以：(a) 改為接受 `previewId` 而非直接信任的 `luckyTheme`/`blessing` 文字、(b) 呼叫新的 Preview 消費邏輯、(c) 調整必填欄位驗證。因此正確的敘述是：**方案 A 的修改範圍可以被清楚隔離在「Confirm 路徑的一小段」，風險相對其他方案更低、更可控，但並非零風險。**

### 0.4 本次修訂後的核心架構決策（v3 更新）

- **獨立 `shopkeeper-preview` Edge Function**（沿用 v1 推薦方向）。
- **`shopkeeper_previews` 資料表**，狀態模型改為明確的 `status` 欄位（`pending`／`ready`／`failed`／`consumed`／`invalidated`），取代 v2 單靠 `consumed_at`／`invalidated_at` 兩個時間戳記推論狀態的隱含設計（詳見第 16 節）。
- **Preview 建立拆成 reserve／generate／finalize 三階段**，額度檢查與佔位在呼叫 Gemini 之前完成。
- **並發安全改用 `pg_advisory_xact_lock`**，而非僅靠 `SELECT ... FOR UPDATE`。
- **Confirm Consume 改以既有 `jobId` 作為冪等鍵**，不再假設一個此刻尚未存在的 `generationId`。
- **Gift 兌換語意定案（Product Decision #16）**：已兌換可重複使用，本次不消耗 `redeem_history`。

---

## 1. 現況 UI 與程式呼叫鏈

### 1.1 前端檔案與職責

| 檔案 | 職責 |
|---|---|
| [wallpaper.html](../../../wallpaper.html) | 單頁表單：吉祥物卡片、Gift 卡片、風格下拉、**Lucky Theme 文字輸入**、**祝福文字 textarea**、開始生成／清空按鈕、生成進度區、生成結果區、錯誤區 |
| [js/pages/wallpaper.js](../../../js/pages/wallpaper.js) | 頁面控制器：載入收藏／Gift、渲染卡片、`createGenerationRequest()` 組裝 payload、送出、輪詢回呼、渲染結果／錯誤 |
| `wallpaper-selection-service.js` | 純函式：正規化 mascot/gift 資料、選擇狀態、預覽文字組裝 |
| `wallpaper-generation-client.js` | `createWallpaperHttpApiClient`（低階 fetch 封裝）＋ `createWallpaperGenerationClient`（submit → poll → present 三段串接） |
| `wallpaper-polling-service.js` | `pollUntilTerminal()`：輪詢 `wallpaper-status`，直到 `terminal:true` |
| `wallpaper-result-presenter.js` | 將 submit 回應 ＋ 最終 status 回應合併成統一的成功／失敗 DTO |

### 1.2 現況呼叫鏈（User → Image）

```
使用者選擇吉祥物 + Gift + Style
      │
      ▼
使用者手動輸入 Lucky Theme（文字框，required）
使用者手動輸入 祝福文字（textarea，required）
      │
      ▼
點擊「開始生成」
      │
      ▼
POST /functions/v1/wallpaper-generate
  { mascotId, giftId, wallpaperStyle, luckyTheme, blessing, promptType }
      │
      ▼
generation-validator.js（REQUIRED: mascotId/giftId/wallpaperStyle/luckyTheme/blessing/promptType — 全部非空字串）
      │
      ▼
generation-orchestrator：驗證使用者 → 檢查每日上限 → 查詢生成成本 → 建立 Job(Pending→Running)
      │
      ▼
generation-service.createWallpaperGeneration()：
  查詢 Prompt Registry(wallpaper_generation type，僅供 metadata)
  → Promise.all([mascotRepository.findMascotById, giftRepository.findGiftById])（僅此一次）
  → shopkeeperContextAgent.generate({mascot, gift, wallpaperStyle, correlationId})
      → 內部呼叫 Gemini Text Provider（daily_lucky_context prompt）
      → 驗證／Fallback
  → promptContextResolver.resolve({mascot, gift, wallpaperStyle,
      luckyTheme: shopkeeperContext.luckyTheme,   ← 使用者輸入的 luckyTheme 在此被「覆蓋」
      blessing: shopkeeperContext.blessing })     ← 使用者輸入的 blessing 也被「覆蓋」
  → Prompt Validator → Wallpaper Prompt Builder（純函式）→ Prompt Snapshot
  → Provider Adapter → Gemini Image → Storage 上傳
  → generationRepository.createGenerationRecord()（含 shopkeeperSnapshot／promptSnapshot 等 metadata_json）
      │
      ▼
成功 → pointsService.deductOnSuccess() + usageService.recordSuccess() + jobService.markSuccess()
      │
      ▼
回傳 { generationId, status, provider, model, imageUrl, promptVersion, durationMs, createdAt, jobId, ... }
（⚠️ 不包含 luckyTheme／blessing／story／oneLiner／shopkeeperMessage 任何 Shopkeeper 內容）
      │
      ▼
前端輪詢 wallpaper-status 直到 terminal → 顯示圖片＋Provider/Model/PromptVersion
```

### 1.3 關鍵既有事實（本次驗證得知）

- **使用者輸入的 `luckyTheme`／`blessing` 目前已經被後端忽略／覆蓋**——`generation-service.js` 在呼叫 `promptContextResolver.resolve()` 時傳入的是 `shopkeeperContext.luckyTheme`／`shopkeeperContext.blessing`，不是 `validated.luckyTheme`／`validated.blessing`（P2-AI-03 已完成此覆蓋邏輯，並經 Gate C 真實驗證 `source=ai` 成功）。
- **但 `generation-validator.js`（Node 端）與 `wallpaper-generate-handler.js`／`.ts` 的 `REQUIRED_FIELDS` 陣列仍要求前端送出非空的 `luckyTheme`／`blessing`**——這是目前 UI 仍要求使用者輸入這兩個欄位的**根本原因**：不是 Shopkeeper 沒接上，而是這個 Request Shape Validation 尚未隨 P2-AI-03 一起更新。
- **`response-dto.js`（`createGenerationSuccessDto`）完全不回傳任何 Shopkeeper 內容**（`luckyTheme`／`blessing`／`story`／`oneLiner`／`shopkeeperMessage`），這是 P2-AI-03 當時刻意的範圍決策（保留既有 P1-BIZ-03 契約），代表**前端目前完全沒有管道可以顯示店長的祝福**，即使後端已經產生。
- **點數扣除（10 點）與每日次數上限，只在圖片生成「成功」時才真正計入**（`pointsService.deductOnSuccess`／`usageService.recordSuccess`），失敗不計費。但目前唯一觸發 Shopkeeper Agent 的路徑，就是這個同時會呼叫 Gemini Image 的完整流程——**目前沒有任何「只呼叫 Shopkeeper、不生成圖片」的輕量路徑**。

### 1.4 現況 UI 截圖

- 桌面：`docs/development/reports/P2-AI-04-current-ui-desktop.png`
- 手機（390×844）：`docs/development/reports/P2-AI-04-current-ui-mobile.png`

盤點結果：

| 項目 | 現況 |
|---|---|
| 吉祥物選擇 | 卡片式，含插圖、名稱、稀有度，可點選（單選） |
| Gift 選擇 | 卡片式，含縮圖、名稱、Gift ID，可點選（單選）；Kuromi 縮圖因占位網址載入失敗（已知問題，另案處理） |
| Style 選擇 | 下拉選單（Retro/Cute/Japanese/Fantasy/Minimal） |
| luckyTheme 輸入 | **純文字框，使用者手動輸入，required** |
| blessing 輸入 | **Textarea，使用者手動輸入，required** |
| 生成按鈕 | 「開始生成」＋「清空」 |
| loading／polling／result／error 狀態 | 皆有對應區塊，`aria-live` 已設定，狀態機為 `idle → submitting → processing → succeeded/failed`（單階段，無 preview 狀態） |
| 圖片結果 | `<figure><img></figure>`，顯示 Provider/Model/PromptVersion |
| 正式下載按鈕 | **無**——只顯示圖片本身，使用者需自行右鍵儲存（P2-AI-03 Gate C 已記錄為待辦，非本次修改） |
| 手機版版面 | 單欄自適應，卡片與表單皆可正常換行顯示，無明顯版面錯誤 |
| Console／Network 問題 | 僅既有、無關的 2 個錯誤（favicon 404、Kuromi 占位圖片載入失敗），無 JS 例外或未處理錯誤 |

---

## 2. 舊版 UI 問題

1. **違反 AI Constitution Principle 2／11**：使用者被要求手動輸入 Lucky Theme／祝福文字，等同「要求使用者寫 Prompt」，且這兩個值目前後端根本不會採用——**UI 與後端行為已經不一致**，是使用者體驗上的欺瞞（填了但沒用）。
2. **看不到店長的祝福／故事**：Shopkeeper 產生的 `story`／`oneLiner`／`shopkeeperMessage` 完全沒有出現在畫面上，也沒有出現在回應 DTO 中——AI Constitution Principle 12「每張桌布都該說一個故事」在 UI 層完全沒有體現。
3. **無法「重抽」**：使用者只能整張桌布重新生成（消耗 Gemini Image 額度＋點數＋每日次數），無法「只換一句祝福」。
4. **無下載按鈕**（已知，另案追蹤，非本次修改）。
5. **Request Shape 驗證與實際行為脫節**：`REQUIRED_FIELDS` 仍要求 `luckyTheme`／`blessing`，但這兩個值進入 `generation-service` 後就被覆蓋，形同虛設的必填欄位。

---

## 3. 目標 User Flow（依任務描述整理）

```
1. 選擇吉祥物
2. 選擇已兌換 Gift
3. 選擇桌布 Style
4. 呼叫 Shopkeeper Agent → 顯示 luckyTheme / blessing / story / oneLiner / shopkeeperMessage
5. 使用者可「接受」或「再抽一次」
6. 確認後才交給 Prompt Builder → Gemini Image Provider
7. 顯示生成進度
8. 顯示結果 + 正式下載按鈕
```

這與 **AI Constitution 的「AI Workflow」圖示完全吻合**：
`User → Choose Mascot → Choose Gift → Shopkeeper Context Agent → Lucky Theme → Blessing → Wallpaper Prompt Builder → Image Provider → Wallpaper`
——Shopkeeper 明確被畫在 Prompt Builder **之前**，代表使用者理應在圖片生成前就看得到店長的內容。目前實作把 Shopkeeper 塞在同一次呼叫的中段、圖片生成前一刻，前端完全看不到——**這是 P2-AI-04 要解決的核心落差**。

---

## 4. 架構方案比較（v2 — 修正 stateless token 相關敘述）

### 核心限制回顧
- `wallpaper-generate` 目前是「一次呼叫＝Shopkeeper＋Prompt Builder＋Gemini Image＋Storage＋DB＋點數／次數扣除」的單一整體流程。
- 若要「先看祝福、可重抽、才生成圖片」，重抽動作**不能**觸發 Gemini Image（太貴／太慢／浪費額度），只能觸發 Shopkeeper（Text-only，相對便宜）。
- 現行 `wallpaper-generate` 剛完成 P2-AI-03 部署與 Gate C 真實驗證（`source=ai`），**任何方案都必須把「弄壞現有已驗證成功的流程」的風險降到最低**。
- **v2 新增限制**：一次性消費、Session 內立即失效、每日／每 Session 次數上限，皆屬於**跨請求的伺服器端狀態**，只有「資料庫可原子讀寫的持久狀態」能可靠達成（見本節後段修正說明）。

### 方案比較表（v2）

| 面向 | A. 獨立 Shopkeeper Preview Function + DB-backed 紀錄（**採用**） | B. wallpaper-generate 擴充 preview/confirm 兩階段 | C. 維持單一生成請求，生成後才顯示 |
|---|---|---|---|
| 符合目標 UI（生成前看到祝福＋可重抽） | ✅ 完全符合 | ✅ 完全符合 | ❌ 不符合（須先花 Gemini Image 額度才能看到祝福，且無法「重抽不重新生成圖片」） |
| 是否重複呼叫 Gemini（Image） | 否，Preview 只呼叫 Text | 否，Preview 階段只呼叫 Text | 每次「重抽」＝重新呼叫整條含 Image 的流程，**必定重複呼叫 Gemini Image** |
| 重抽一次的 API 成本 | 低（1 次 Shopkeeper Text 呼叫 ＋ 1 次輕量 DB 寫入，無 Image／Storage 寫入） | 低（同左，但邏輯耦合在同一支 Function 內，較難獨立限流／降級） | 極高（等同一次完整生成，含點數／次數消耗） |
| 是否重複查詢 Mascot／Gift | 是，Preview 與 Confirm 各驗證一次擁有權（**同一套已審核過的驗證邏輯**被兩個端點重用，非重複程式邏輯；屬「2 次 HTTP 請求各自驗證 1 次」，非「同一次請求內查兩次」） | 同左 | 否（原本就只查一次） |
| 如何避免前端竄改 luckyTheme／blessing | **DB-backed `shopkeeper_previews`**：Confirm 階段以 `previewId` 查詢資料庫中已鎖定的 `context_snapshot`，前端從未持有可回灌的內容編碼 | 同左（DB-backed，非 token） | 不適用（沒有 Preview 階段） |
| Snapshot 與版本如何保存 | Preview 階段即寫入 `shopkeeper_previews.context_snapshot`；Confirm 成功後複製一份到 `wallpaper_generations.metadata_json`（沿用既有 shopkeeperSnapshot 欄位） | 同左 | 沿用現況（已驗證可行） |
| Preview context 如何在 Confirm 時驗證 | 原子 `UPDATE ... WHERE previewId AND userId AND selections相符 AND 未過期 AND 未消費 AND 未失效 RETURNING context_snapshot` | 同左 | 不適用 |
| 是否需要新增資料表或 migration | **是**——`shopkeeper_previews`（見第 6 節） | 是 | 否 |
| 一次性消費／立即失效／次數上限 | **可靠**——皆由資料庫原子操作保證（見第 7 節） | 同左（可靠，因同樣需要 DB-backed 狀態） | 不適用 |
| JWT／RLS／使用者所有權 | 沿用既有 `resolveAuthenticatedUserId`／Gateway JWT 驗證模式；**新增** mascot／gift 擁有權驗證（Product Decision #10，兩端點皆須） | 同左 | 沿用現況（**現況未驗證擁有權**，屬既有落差，非本次新增風險，但本次順帶修正） |
| timeout／rate limit／fallback | Preview 呼叫沿用既有 `shopkeeperContextAgent`（已有完整 Fallback），另加 Session／每日次數上限 | 同左 | 沿用現況 |
| Idempotency | 資料庫層面原子 `consumed_at`／`invalidated_at` 保證同一 Preview 只能被消費一次（見第 7 節） | 同左 | 不適用 |
| 與現有 wallpaper-generate 的相容性 | **修正後的正確敘述：非零風險，但風險可隔離且較低**——Confirm 路徑需修改以接受 `previewId` 並執行原子消費，但其餘 Prompt Builder／Image Provider／Storage／點數／次數邏輯完全不變 | 中風險——需修改既有 handler 的 request/response 契約與內部流程分支，耦合度更高 | 無風險（不改），但無法達成目標 UI |
| 部署與回滾風險 | 低－中——新 Function＋新資料表需一併部署（migration 是新增表，向後相容，不影響既有表），`wallpaper-generate` 的修改範圍可被獨立 code review／獨立回滾（透過 feature flag 或分支合併順序控制） | 中——牽動已上線 Function 的既有邏輯，回滾需同時考慮兩個階段 | 無 |

**結論（Product Decision #1/#2/#3 已定案）**：採用方案 A，並以 DB-backed `shopkeeper_previews` 取代 v1 提出的 stateless token。

---

## 5. 推薦方案與理由（v2）

**推薦：方案 A — 獨立 `shopkeeper-preview` Edge Function ＋ DB-backed `shopkeeper_previews` 短效紀錄。**

理由：
1. **唯一能滿足「一次性消費、立即失效、次數上限」三項強一致性需求的設計**——這三項需求本質上都是跨請求的伺服器端狀態，只有資料庫（或等效的伺服器端持久狀態存放區）才能提供可靠的原子讀寫保證；stateless token 在 v1 分析中被誤判為可行，已在第 0 節修正。
2. **修改範圍仍可被清楚隔離**——雖然不再是「零風險」，但 Confirm 路徑的修改僅限於「如何取得已驗證的 Shopkeeper Context」這一小段（用 `previewId` 查詢＋消費取代原本內部直接呼叫 `shopkeeperContextAgent`），Prompt Builder／Image Provider／Storage／點數／次數扣除等既有已驗證邏輯完全不變。
3. **成本可控**——Preview／重抽只呼叫 Gemini Text（Shopkeeper）＋輕量 DB 寫入，不觸發 Gemini Image／Storage 寫入／點數扣除。
4. **架構乾淨、符合既有 RLS 慣例**——`shopkeeper_previews` 可比照 `wallpaper_generations`／`wallpaper_generation_jobs` 既有的「RLS 啟用＋僅限 Service Role 寫入」慣例（見第 6.3 節），不需要發明新的安全模型。
5. **原生支援擁有權驗證與稽核**——DB-backed 設計讓 Preview 與 Confirm 都能記錄 `user_id`／`mascot_id`／`gift_id`，便於稽核與除錯，也讓 Product Decision #10（擁有權驗證）有明確的落地欄位。

---

## 6. `shopkeeper_previews` 資料表設計

### 6.1 Migration 草案（供 Implementation 階段參考，本次不建立實際 migration 檔案）

> 依循既有 `20260712040000_create_wallpaper_core_tables.sql` 的慣例：以 `DO $$ ... $$` 區塊動態偵測 `users`/`mascots`/`gifts` 的主鍵欄位名稱與型別，確保外鍵型別正確對齊；`gen_random_uuid()`／`TIMESTAMPTZ`／`CHECK` 慣例與既有 migration 一致。

```sql
-- 草案：supabase/migrations/<TBD>_create_shopkeeper_previews.sql
DO $$
DECLARE
    users_pk_column TEXT;
    users_pk_type TEXT;
    mascots_pk_column TEXT;
    mascots_pk_type TEXT;
    gifts_pk_column TEXT;
    gifts_pk_type TEXT;
BEGIN
    -- (與 20260712040000 相同的 PK 偵測邏輯，省略重複貼上；
    --  正式建立 migration 時應重用同一段偵測邏輯，或抽成共用函式。)
    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
      INTO users_pk_column, users_pk_type
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
     WHERE n.nspname = 'public' AND c.relname = 'users' AND i.indisprimary
       AND i.indnatts = 1 AND a.attname = ANY (ARRAY['user_id','mascot_id','gift_id','id'])
     LIMIT 1;

    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
      INTO mascots_pk_column, mascots_pk_type
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
     WHERE n.nspname = 'public' AND c.relname = 'mascots' AND i.indisprimary
       AND i.indnatts = 1 AND a.attname = ANY (ARRAY['user_id','mascot_id','gift_id','id'])
     LIMIT 1;

    SELECT a.attname, format_type(a.atttypid, a.atttypmod)
      INTO gifts_pk_column, gifts_pk_type
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
     WHERE n.nspname = 'public' AND c.relname = 'gifts' AND i.indisprimary
       AND i.indnatts = 1 AND a.attname = ANY (ARRAY['user_id','mascot_id','gift_id','id'])
     LIMIT 1;

    IF users_pk_column IS NULL OR mascots_pk_column IS NULL OR gifts_pk_column IS NULL THEN
        RAISE EXCEPTION 'Cannot create shopkeeper_previews: users/mascots/gifts PK not found.';
    END IF;

    EXECUTE format($sql$
        CREATE TABLE IF NOT EXISTS public.shopkeeper_previews (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id %1$s NOT NULL,
            session_id UUID NOT NULL,
            mascot_id %2$s NOT NULL,
            gift_id %3$s NOT NULL,
            wallpaper_style TEXT NOT NULL,
            sequence_no SMALLINT NOT NULL DEFAULT 0
                CHECK (sequence_no >= 0 AND sequence_no <= 2), -- 0=首次, 1-2=重抽（合計最多3次）
            context_snapshot JSONB NOT NULL,
            shopkeeper_version TEXT NOT NULL,
            source TEXT NOT NULL CHECK (source IN ('ai', 'fallback')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            consumed_at TIMESTAMPTZ,
            invalidated_at TIMESTAMPTZ,
            generation_id UUID, -- Confirm 成功後回填，關聯到 wallpaper_generations.id（見第 9 節一致性設計）
            taipei_usage_date DATE NOT NULL
                GENERATED ALWAYS AS ((created_at AT TIME ZONE 'Asia/Taipei')::date) STORED,
            CONSTRAINT ck_shopkeeper_previews_expires_after_created CHECK (expires_at > created_at),
            CONSTRAINT ck_shopkeeper_previews_consumed_after_created
                CHECK (consumed_at IS NULL OR consumed_at >= created_at),
            CONSTRAINT ck_shopkeeper_previews_invalidated_after_created
                CHECK (invalidated_at IS NULL OR invalidated_at >= created_at),
            CONSTRAINT ck_shopkeeper_previews_not_both_terminal
                CHECK (consumed_at IS NULL OR invalidated_at IS NULL), -- 不可同時被消費又被失效
            CONSTRAINT fk_shopkeeper_previews_user FOREIGN KEY (user_id)
                REFERENCES public.users(%4$I) ON DELETE RESTRICT,
            CONSTRAINT fk_shopkeeper_previews_mascot FOREIGN KEY (mascot_id)
                REFERENCES public.mascots(%5$I) ON DELETE RESTRICT,
            CONSTRAINT fk_shopkeeper_previews_gift FOREIGN KEY (gift_id)
                REFERENCES public.gifts(%6$I) ON DELETE RESTRICT,
            CONSTRAINT fk_shopkeeper_previews_generation FOREIGN KEY (generation_id)
                REFERENCES public.wallpaper_generations(id) ON DELETE SET NULL
        );
    $sql$, users_pk_type, mascots_pk_type, gifts_pk_type, users_pk_column, mascots_pk_column, gifts_pk_column);
END $$;

-- 索引：Session 內查詢 active preview（重抽/一次性消費時的主要查詢路徑）
CREATE INDEX IF NOT EXISTS ix_shopkeeper_previews_session_active
    ON public.shopkeeper_previews (user_id, session_id)
    WHERE consumed_at IS NULL AND invalidated_at IS NULL;

-- 索引：每日次數上限計算（Asia/Taipei 邊界，見下方 6.2 說明）
CREATE INDEX IF NOT EXISTS ix_shopkeeper_previews_daily_count
    ON public.shopkeeper_previews (user_id, taipei_usage_date);

-- 索引：依 id 查詢（Confirm 時的主要查詢路徑，PK 已自帶索引，此處為顯式標註）
-- （id 為 PRIMARY KEY，PostgreSQL 自動建立唯一索引，無需額外語句）

-- updated_at 類 trigger 不需要：本表為 append-only + 狀態欄位就地更新（consumed_at/invalidated_at/generation_id），
-- 不使用 updated_at 欄位，改以個別狀態欄位的時間戳記精確表達「何時發生什麼事」。

CREATE OR REPLACE FUNCTION public.request_user_key() -- 若已存在則不重複建立，沿用既有函式
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.user_id', true), ''),
        NULLIF(current_setting('request.jwt.claim.sub', true), ''),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'user_id'),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    );
$$;

ALTER TABLE IF EXISTS public.shopkeeper_previews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_shopkeeper_previews_deny_select_authenticated ON public.shopkeeper_previews;
DROP POLICY IF EXISTS p_shopkeeper_previews_deny_insert_authenticated ON public.shopkeeper_previews;
DROP POLICY IF EXISTS p_shopkeeper_previews_deny_update_authenticated ON public.shopkeeper_previews;
DROP POLICY IF EXISTS p_shopkeeper_previews_deny_delete_authenticated ON public.shopkeeper_previews;

-- 設計選擇：本表對 authenticated 角色完全不開放直接讀寫（含 SELECT）。
-- 理由：context_snapshot 屬於「尚未確認、尚未計費」的 AI 內容，其呈現與消費規則
-- （過期/失效/次數上限/一次性消費）必須經過 Edge Function 的業務邏輯驗證，
-- 不應該存在任何繞過 Edge Function、直接以 PostgREST 讀寫本表的路徑。
-- 前端與本表的唯一互動管道 = shopkeeper-preview / wallpaper-generate 兩個 Edge Function（Service Role）。
CREATE POLICY p_shopkeeper_previews_deny_select_authenticated
    ON public.shopkeeper_previews AS RESTRICTIVE FOR SELECT TO authenticated USING (false);

CREATE POLICY p_shopkeeper_previews_deny_insert_authenticated
    ON public.shopkeeper_previews AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);

CREATE POLICY p_shopkeeper_previews_deny_update_authenticated
    ON public.shopkeeper_previews AS RESTRICTIVE FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY p_shopkeeper_previews_deny_delete_authenticated
    ON public.shopkeeper_previews AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
```

### 6.2 Asia/Taipei 每日 20 次計算邊界

- `taipei_usage_date` 為 **STORED GENERATED COLUMN**，以 `(created_at AT TIME ZONE 'Asia/Taipei')::date` 計算並實際落地存放（非每次查詢即時運算），確保：(a) 索引 `ix_shopkeeper_previews_daily_count` 能直接命中，效能可預期；(b) 與既有 `daily_generation_usage` 表的每日計算方式（若該表未來也採用相同慣例）維持一致的時區語意，避免「UTC 日界」與「台北日界」混淆造成的邊界 bug（例如 UTC 16:00 = 台北隔日 00:00）。
- 每日次數檢查邏輯：`SELECT count(*) FROM shopkeeper_previews WHERE user_id = :userId AND taipei_usage_date = (now() AT TIME ZONE 'Asia/Taipei')::date`，計入所有 Preview（含已失效／已消費／已過期者，因為「呼叫次數」本身就是額度消耗，不因後續狀態改變而返還）。

### 6.3 為何不允許前端直接 INSERT／UPDATE `context_snapshot`

- RLS 對 `authenticated` 角色的 SELECT／INSERT／UPDATE／DELETE 全部設為 `RESTRICTIVE ... false`，與既有 `wallpaper_generations`／`wallpaper_generation_jobs` 的「寫入僅限 Service Role」慣例一致，並**進一步擴大到 SELECT**（既有表允許 owner SELECT，本表因內容尚未確認/計費而完全不開放直接讀取）。
- 所有讀寫僅能透過 `shopkeeper-preview` 與 `wallpaper-generate` 兩個 Edge Function（使用 Service Role Key，天然繞過 RLS）進行，確保「Preview 的內容與狀態轉換規則」100% 由後端業務邏輯把關。

### 6.4 過期資料清理策略

- **不需要即時清理**才能保證正確性——所有查詢都會顯式檢查 `expires_at > now()`，過期列即使還在資料表中也不會被誤用。
- **建議定期清理（維運層面，非本次實作範圍）**：以 Supabase 排程（`pg_cron` 或外部排程呼叫一支清理 Edge Function／SQL）定期刪除「`expires_at` 超過 N 天（如 7 天）」的舊列，避免資料表無限增長；因本表不含使用者個資以外的敏感內容且與 `wallpaper_generations` 有 `generation_id` 外鍵關聯，清理時需以 `expires_at`／`consumed_at` 為準，**不清除已成功 Confirm（`generation_id IS NOT NULL`）的列**，保留稽核軌跡與 Debug 能力。
- 此清理排程屬於維運/基礎設施決策，**建議列為獨立的、後續的維運任務**，不阻擋本次 P2-AI-04 的功能實作。

---

## 7. 原子操作設計

### 7.1 為何選擇「單一 UPDATE...RETURNING」而非額外的 RPC 做 Consume（Confirm）

現有程式碼中 `points-repository.js` 的 `deductPoints()` 是「先 `SELECT` 讀取目前點數 → 判斷 → 再 `UPDATE`」的**兩段式讀寫**，這是一個**已知的競態風險（TOCTOU, Time-Of-Check-Time-Of-Use）**：兩個並發請求都可能在第一段 `SELECT` 時讀到相同的「尚未扣除」點數，導致重複扣款或超扣。本次 Preview Consume **明確要求「同時兩次 Confirm 只能成功一次」**，因此**不可重蹈這個既有弱點**，必須採用單一陳述式的原子「比較並交換（compare-and-swap）」寫法：

```sql
-- Confirm 時的原子消費（於 Edge Function 內以 Service Role 執行單一 UPDATE）
UPDATE public.shopkeeper_previews
SET consumed_at = NOW(),
    generation_id = :generationId -- 由呼叫端於同一交易內先建立好 wallpaper_generations 列（見第 9 節），或先佔位後回填
WHERE id = :previewId
  AND user_id = :userId
  AND mascot_id = :mascotId
  AND gift_id = :giftId
  AND wallpaper_style = :wallpaperStyle
  AND expires_at > NOW()
  AND consumed_at IS NULL
  AND invalidated_at IS NULL
RETURNING context_snapshot, shopkeeper_version, source;
```

- PostgreSQL 對單一 `UPDATE` 陳述式的目標列有 **row-level lock** 保證：兩個並發交易若同時嘗試更新同一列，第二個交易會被阻塞直到第一個交易 `COMMIT`，接著重新評估 `WHERE` 子句——此時 `consumed_at IS NULL` 已不成立，第二個交易的 `UPDATE` 影響 0 列。**這是標準且不需要額外 RPC／stored procedure 的原子模式**，只要求呼叫端正確檢查「回傳的資料列數」：
  - 影響列數 = 1 → 消費成功，取得 `context_snapshot` 繼續走生成流程。
  - 影響列數 = 0 → 依序判斷原因（查不到 id／`user_id` 不符／`selections` 不符／已過期／已消費／已失效），回傳對應的錯誤碼（`PREVIEW_NOT_FOUND` / `PREVIEW_OWNER_MISMATCH` / `PREVIEW_SELECTION_MISMATCH` / `PREVIEW_EXPIRED` / `PREVIEW_ALREADY_CONSUMED` / `PREVIEW_INVALIDATED`）。
- **與既有 `points-repository.js` 弱點的對照**：本設計刻意不採用該檔案「先讀後寫」的方式，作為本次修訂中額外發現、值得記錄的既有技術債（建議另案追蹤修正 `points-repository.js` 的 TOCTOU 風險，但**非 P2-AI-04 範圍**，僅在此記錄以供未來參考）。

### 7.2 重抽（Reroll）需要真正的多陳述式交易 → 建議以 Postgres Function（RPC）實作

重抽涉及「(a) 檢查 Session 次數 ≤ 3、(b) 檢查每日次數 ≤ 20、(c) 使同 Session 舊 active Preview 失效、(d) 建立新 Preview」四個步驟，**必須在單一交易內完成**，否則兩個並發的重抽請求可能同時通過次數檢查後都成功插入，導致超過上限。Supabase-js 的 `.from()` 查詢建構器不支援跨多個陳述式的顯式交易，因此建議以 **SECURITY DEFINER 的 Postgres Function（RPC）**實作，由 Edge Function 以 `supabaseClient.rpc(...)` 呼叫：

```sql
CREATE OR REPLACE FUNCTION public.create_or_reroll_shopkeeper_preview(
    p_user_id UUID, -- 型別需比照 users PK 型別調整
    p_mascot_id UUID,
    p_gift_id UUID,
    p_wallpaper_style TEXT,
    p_session_id UUID DEFAULT NULL, -- NULL = 首次；非 NULL = 重抽
    p_context_snapshot JSONB,
    p_shopkeeper_version TEXT,
    p_source TEXT,
    p_ttl_minutes INT DEFAULT 10
)
RETURNS TABLE (
    preview_id UUID,
    session_id UUID,
    expires_at TIMESTAMPTZ,
    remaining_rerolls INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session_id UUID := COALESCE(p_session_id, gen_random_uuid());
    v_session_count INT;
    v_daily_count INT;
    v_ref_mascot UUID;
    v_ref_gift UUID;
    v_ref_style TEXT;
    v_new_id UUID;
    v_expires_at TIMESTAMPTZ := NOW() + make_interval(mins => p_ttl_minutes);
    v_sequence_no SMALLINT;
BEGIN
    -- 鎖定同一 Session 的既有列，序列化並發的重抽請求（同一 Session 內）
    PERFORM 1 FROM public.shopkeeper_previews
     WHERE session_id = v_session_id AND user_id = p_user_id
     FOR UPDATE;

    IF p_session_id IS NOT NULL THEN
        -- 重抽：驗證本次 selections 與該 Session 原始 selections 一致（防竄改／防跨選項重抽）
        SELECT mascot_id, gift_id, wallpaper_style
          INTO v_ref_mascot, v_ref_gift, v_ref_style
          FROM public.shopkeeper_previews
         WHERE session_id = v_session_id AND user_id = p_user_id
         ORDER BY created_at ASC
         LIMIT 1;

        IF v_ref_mascot IS NULL THEN
            RAISE EXCEPTION 'PREVIEW_SESSION_NOT_FOUND' USING ERRCODE = 'P0001';
        END IF;

        IF v_ref_mascot <> p_mascot_id OR v_ref_gift <> p_gift_id OR v_ref_style <> p_wallpaper_style THEN
            RAISE EXCEPTION 'PREVIEW_SESSION_SELECTION_MISMATCH' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Session 次數上限（合計最多 3 次：首次 + 最多 2 次重抽）
    SELECT count(*) INTO v_session_count
      FROM public.shopkeeper_previews
     WHERE session_id = v_session_id AND user_id = p_user_id;

    IF v_session_count >= 3 THEN
        RAISE EXCEPTION 'PREVIEW_SESSION_LIMIT_REACHED' USING ERRCODE = 'P0001';
    END IF;

    -- 每日次數上限（Asia/Taipei 邊界，20 次/日）
    SELECT count(*) INTO v_daily_count
      FROM public.shopkeeper_previews
     WHERE user_id = p_user_id
       AND taipei_usage_date = (NOW() AT TIME ZONE 'Asia/Taipei')::date;

    IF v_daily_count >= 20 THEN
        RAISE EXCEPTION 'PREVIEW_DAILY_LIMIT_REACHED' USING ERRCODE = 'P0001';
    END IF;

    -- 使同 Session 舊 active（未消費且未失效）Preview 立即失效
    UPDATE public.shopkeeper_previews
       SET invalidated_at = NOW()
     WHERE session_id = v_session_id AND user_id = p_user_id
       AND consumed_at IS NULL AND invalidated_at IS NULL;

    v_sequence_no := v_session_count; -- 0 = 首次, 1, 2 = 重抽

    INSERT INTO public.shopkeeper_previews (
        user_id, session_id, mascot_id, gift_id, wallpaper_style,
        sequence_no, context_snapshot, shopkeeper_version, source, expires_at
    ) VALUES (
        p_user_id, v_session_id, p_mascot_id, p_gift_id, p_wallpaper_style,
        v_sequence_no, p_context_snapshot, p_shopkeeper_version, p_source, v_expires_at
    )
    RETURNING id, expires_at INTO v_new_id, v_expires_at;

    RETURN QUERY SELECT v_new_id, v_session_id, v_expires_at, (2 - v_sequence_no);
END;
$$;

REVOKE ALL ON FUNCTION public.create_or_reroll_shopkeeper_preview FROM PUBLIC;
-- 僅授權給 Service Role 使用的角色（依專案實際 Service Role 對應角色調整，例如 service_role）：
GRANT EXECUTE ON FUNCTION public.create_or_reroll_shopkeeper_preview TO service_role;
```

- **鎖定策略**：`PERFORM ... FOR UPDATE` 鎖定同一 `(user_id, session_id)` 的既有列，確保同一 Session 內兩個並發的重抽請求會被序列化（一個等待另一個交易 `COMMIT`），避免「兩個重抽同時通過次數檢查」的競態。首次建立（`p_session_id IS NULL`）因為是全新 `session_id`，天然不會有鎖定衝突。
- **`RAISE EXCEPTION ... ERRCODE`** 讓 Edge Function 能以固定的錯誤字串 `SQLERRM` 對應到 API 錯誤碼（`PREVIEW_SESSION_SELECTION_MISMATCH`／`PREVIEW_SESSION_LIMIT_REACHED`／`PREVIEW_DAILY_LIMIT_REACHED`），不需額外的欄位比對。
- **`SECURITY DEFINER`＋`GRANT EXECUTE ... TO service_role`**：此函式只能被持有 Service Role 權限的呼叫者（即 Edge Function）執行，`authenticated` 角色無法直接呼叫，維持「所有寫入只能經由後端業務邏輯」的原則。

---

## 8. API Contract（v2）

### 8.1 Shopkeeper Preview Request DTO

首次：
```json
{
  "mascotId": "string (required)",
  "giftId": "string (required)",
  "wallpaperStyle": "string (required, enum)"
}
```

重抽：
```json
{
  "mascotId": "string (required)",
  "giftId": "string (required)",
  "wallpaperStyle": "string (required)",
  "sessionId": "string (uuid, required)"
}
```

**禁止客戶端傳入**（`FORBIDDEN_FIELDS`）：`luckyTheme`、`blessing`、`story`、`oneLiner`、`shopkeeperMessage`、`source`、`shopkeeperVersion`、`userId`、`previewId`（Preview 請求本身不應該帶入既有 previewId，只透過 `sessionId` 銜接）。

### 8.2 Shopkeeper Preview Response DTO

```json
{
  "ok": true,
  "data": {
    "previewId": "string (uuid, opaque)",
    "sessionId": "string (uuid)",
    "expiresAt": "ISO8601",
    "remainingRerolls": "number (0-2)",
    "luckyTheme": "string",
    "blessing": "string",
    "story": "string",
    "oneLiner": "string",
    "shopkeeperMessage": "string"
  }
}
```

（**不回傳** `source`／`shopkeeperVersion`——維持「使用者不需要知道背後是 AI 還是 Fallback」的產品原則；這兩個欄位只存在於資料庫 `context_snapshot`／`shopkeeper_version`／`source` 欄位，供後端與 Confirm 階段使用，不對前端揭露。）

### 8.3 Confirm／Generate Request DTO（取代現有 `wallpaper-generate` request）

```json
{
  "mascotId": "string (required)",
  "giftId": "string (required)",
  "wallpaperStyle": "string (required)",
  "previewId": "string (uuid, required)",
  "promptType": "wallpaper_generation"
}
```

**移除** `luckyTheme`／`blessing` 兩個必填欄位——改列入 `FORBIDDEN_FIELDS`（與 `story`／`oneLiner`／`shopkeeperMessage`／`source`／`shopkeeperVersion`／`userId` 一併列入，比照現有 `apiKey`／`serviceRoleKey` 等禁止客戶端提供欄位的處理方式），若客戶端仍傳入將直接拒絕（`INVALID_REQUEST`）。

**後端行為**：以第 7.1 節的原子 `UPDATE...RETURNING` 消費 `previewId`；成功則取得 `context_snapshot`／`shopkeeper_version`／`source`，**不再重新呼叫 Shopkeeper Agent**，直接交給既有 Prompt Context Resolver／Validator／Prompt Builder；失敗依原因回傳對應錯誤碼（見 8.4）。

### 8.4 錯誤碼一覽（v2 新增）

| 錯誤碼 | 情境 |
|---|---|
| `PREVIEW_NOT_FOUND` | `previewId` 不存在 |
| `PREVIEW_OWNER_MISMATCH` | `previewId` 存在但不屬於目前使用者 |
| `PREVIEW_SELECTION_MISMATCH` | Confirm 請求的 mascotId/giftId/wallpaperStyle 與 Preview 建立時不符 |
| `PREVIEW_EXPIRED` | 超過 10 分鐘有效期 |
| `PREVIEW_ALREADY_CONSUMED` | 已被成功 Confirm 過一次 |
| `PREVIEW_INVALIDATED` | 已因重抽而失效 |
| `PREVIEW_SESSION_SELECTION_MISMATCH` | 重抽請求的 selections 與該 Session 原始 selections 不符 |
| `PREVIEW_SESSION_LIMIT_REACHED` | 同一 Session 已達 3 次上限 |
| `PREVIEW_DAILY_LIMIT_REACHED` | 當日（Asia/Taipei）已達 20 次上限 |
| `MASCOT_NOT_OWNED` | mascotId 不屬於目前使用者（`user_mascots` 查無對應列） |
| `GIFT_NOT_REDEEMED_OR_UNAVAILABLE` | giftId 未兌換或狀態不可用（`redeem_history` 查無可用列，見第 12.3 節） |

---

## 9. 生成流程（v2）

### 9.1 Confirm／Generate 流程

1. 驗證 JWT，解析出真實 `userId`（沿用 `resolveAuthenticatedUserId()`）。
2. 驗證 Mascot／Gift 擁有權（見第 12.3 節）——不通過則回傳 `MASCOT_NOT_OWNED`／`GIFT_NOT_REDEEMED_OR_UNAVAILABLE`，**在消費 Preview 之前**就先擋下，避免無謂消耗一次 Preview。
3. 以第 7.1 節的原子 `UPDATE...RETURNING` 消費 `previewId`——失敗則依錯誤碼回傳，**不繼續往下**。
4. 從消費成功回傳的 `context_snapshot` 取得 Shopkeeper Context（`luckyTheme`／`blessing`／`story`／`oneLiner`／`shopkeeperMessage`）。
5. **不重新呼叫 Shopkeeper Agent**——直接把 Context 交給既有 `promptContextResolver.resolve()`／`prompt-validator`／`wallpaper-prompt-builder`（皆維持 P2-AI-02／03 核心邏輯不變，Product Decision #14/#15）。
6. 呼叫既有 Gemini Image Provider，走既有 Storage 上傳流程。
7. 寫入 `wallpaper_generations`（含既有 `promptSnapshot`／`shopkeeperSnapshot`／`shopkeeperVersion`／`source` metadata），並將新建立的 `wallpaper_generations.id` 回填至 `shopkeeper_previews.generation_id`（第 9.2 節的一致性設計）。
8. 回應中加入 Shopkeeper 顯示 DTO（見第 9.3 節）——**這是 v2 新增的正式回應欄位**（Product Decision #11）。
9. 若 Gemini Image 失敗，走既有的 Job 失敗／重試機制，並依第 9.2 節策略決定 Preview 是否可恢復使用。

### 9.2 一致性與失敗恢復策略：Consume 成功後 Gemini Image 失敗，Preview 是否恢復可用？

**推薦策略：不恢復（不清空 `consumed_at`），改以既有 Job 失敗重試機制處理，並透過 `generation_id` 關聯避免同一 Preview 被任意重放。**

具體設計：
1. **Consume 與 Job 建立在同一段後端流程內、且發生在 Gemini Image 呼叫之前**：先原子消費 Preview → 立即以取得的 Context 建立 `wallpaper_generations`（`status='processing'`）與 `wallpaper_generation_jobs` 列 → 才呼叫 Gemini Image。這確保「Preview 已被消費」與「本次生成的身份（`generationId`／`jobId`）」在系統中同時且唯一地存在，兩者狀態從一開始就綁定。
2. **Gemini Image 失敗時，沿用既有的 Job 失敗／重試機制（`retry_count`／`next_retry_at`），而非讓使用者重新走一次 Preview**——因為：
   - `consumed_at` 一旦設定，代表「使用者已經確認並同意使用這份 Shopkeeper Context 生成桌布」這個**業務事實已經發生**，不應該因為下游的 Image 生成暫時失敗就否定這個事實（否則會產生「同一份已同意的內容，被允許使用兩次」的語意混亂，也可能被利用來繞過 Session／每日次數上限：使用者可以故意讓生成失敗、恢復 Preview、再重新消費，變相取得更多次生成機會而不消耗新的 Preview 額度）。
   - 既有 `wallpaper_generation_jobs` 本身就設計了 `attempt_no`／`next_retry_at`／`locked_at`／`locked_by` 等重試欄位（見 `20260712040000_create_wallpaper_core_tables.sql`），**重試應該重試「同一個 generationId／jobId」的 Image 生成步驟**（Context 已經確定，只是圖片生成失敗），而不是重新產生一個新的 Shopkeeper Context。這樣使用者體驗上「重試」等於「用同一份已核准的祝福內容再試一次生成圖片」，符合直覺且不重複消耗 Gemini Text 額度。
   - 若重試多次仍全部失敗（達到既有的最大重試次數），`wallpaper_generations.status` 轉為 `failed`，前端顯示失敗訊息並提供「返回重新選擇」的路徑——此時若使用者想要再次嘗試，屬於全新的一次 Preview／Confirm 流程（消耗新的 Session 額度），這是**刻意設計**：避免「無限期保留一個已消費但生成失敗的 Preview 內容供之後任意重放」的安全疑慮。
3. **`generation_id` 外鍵的作用**：讓 `shopkeeper_previews` 與 `wallpaper_generations` 的關聯在資料庫層面就是顯式、可稽核的一對一關係（每個 Preview 最多對應一個 Generation），便於 Observability／客服排查「這次生成用的是哪一次 Preview、當時的 Context 內容是什麼」。

### 9.3 最終結果 Shopkeeper 顯示 DTO（Product Decision #11 新增）

`response-dto.js` 的成功回應需新增以下欄位（沿用既有 `presentSuccess()`／`createGenerationSuccessDto()` 的既有欄位，僅新增，不刪除原有欄位）：

```json
{
  "generationId": "string",
  "imageUrl": "string",
  "provider": "string",
  "promptVersion": "string",
  "model": "string",
  "status": "string",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "luckyTheme": "string",
  "blessing": "string",
  "story": "string",
  "oneLiner": "string",
  "shopkeeperMessage": "string"
}
```

（仍然**不回傳** `source`／`shopkeeperVersion`——這兩個欄位維持只存在於後端 metadata，不對前端揭露，與第 8.2 節的一致原則相同。）

---

## 10. UI State Machine（v3 — 對齊 Reserve/Generate/Finalize 三階段）

```
idle
  │ 選擇 mascot/gift/style 完成
  ▼
selecting
  │ 使用者按下「產生今日祝福」（明確使用者動作，非自動觸發）
  ▼
previewLoading  ──(Reserve 被拒絕：次數已達上限)──► previewLimitReached
  │ （前端無法區分 Reserve/Generate/Finalize 三個後端內部階段，統一顯示同一個 loading 狀態；
  │  Finalize 系統性失敗時，見下方 rerolling 失敗分支的對稱處理）
  ▼
previewReady
  │──「再抽一次」（剩餘次數 > 0）──► rerolling
  │        ├─ Finalize 成功 ──► previewReady（新 previewId／新內容，remainingRerolls-1）
  │        └─ Finalize 系統性失敗（第 16.6 節）──► previewReady（保留剛才那份舊內容不變，
  │           顯示「這次重抽失敗，可以繼續使用剛才的祝福，或再試一次」，不清空畫面）
  │──「再抽一次」但 remainingRerolls = 0 ──► previewLimitReached（Session 已達 3 次上限，需重新選擇才能重置）
  │──（使用者變更 mascot/gift/style 選項）──► selecting（現有 Preview 立即視為前端失效，需重新產生）
  │
  │ 使用者按下「確認生成」（Confirm 按鈕防連點：送出中即 disabled）
  ▼
generating
  │ previewId 不可用（後端回傳 PREVIEW_EXPIRED／PREVIEW_UNAVAILABLE，第 19.4 節收斂錯誤碼）──► previewExpired（提示重新產生祝福）
  │ Confirm 成功，取得 jobId／generationId
  ▼
polling
  │ terminal
  ├─ succeeded ──► succeeded（顯示圖片＋luckyTheme/blessing/story/oneLiner/shopkeeperMessage＋正式下載按鈕）
  └─ failed ──► failed（顯示「這次生成失敗，若要再試一次，請重新選擇並產生新的祝福」，
                        不宣稱「重試」會沿用同一個失敗的 jobId——第 21.3 節已誠實盤點：
                        現有系統沒有真正的同 Job 重試機制，「重試」＝回到 selecting 走全新流程）
```

### 10.1 狀態轉移規則（v2 定案，取代 v1 草案）

| 規則 | 內容 |
|---|---|
| 選項變更後現有 Preview 立即失效 | 前端狀態機層面：任何 mascot/gift/style 的變更，立即將本地持有的 `previewId`／內容捨棄並轉回 `selecting`；下一次「產生今日祝福」視為全新 Session（不帶 `sessionId`）。（後端亦不信任前端這個「捨棄」動作本身，Confirm 時仍會用資料庫真實狀態驗證 selections 是否相符，見 `PREVIEW_SELECTION_MISMATCH`） |
| 不自動呼叫 Preview | 僅使用者點擊「產生今日祝福」／「再抽一次」按鈕時才呼叫後端，任何下拉選單／卡片點選變更本身**絕不**觸發 API 呼叫 |
| loading 時按鈕 disabled | `previewLoading`／`rerolling`／`generating` 狀態下，對應觸發按鈕（產生祝福／再抽一次／確認生成）皆需 disabled，防止連點造成重複請求（雖然後端已有原子保護，前端仍應提供良好 UX 與降低無謂請求） |
| 剩餘重抽次數顯示 | `previewReady` 狀態下顯示「還可以再抽 N 次」（`remainingRerolls`），達 0 時「再抽一次」按鈕 disabled 並顯示提示文字 |
| 每日上限錯誤訊息 | 收到 `PREVIEW_DAILY_LIMIT_REACHED` 時，顯示「今日的祝福次數已用完，請明天再來」，不提供「再抽一次」按鈕，但仍可查看目前的 `previewReady` 內容並選擇「確認生成」 |
| Preview 過期提示 | 收到 `PREVIEW_EXPIRED` 時，顯示「祝福內容已過期，請重新產生」，引導返回 `selecting` |
| Confirm 防連點 | `generating` 狀態下「確認生成」按鈕 disabled，直到收到明確的成功／失敗回應 |
| 正式下載按鈕 | `succeeded` 狀態新增下載按鈕（Product Decision #12），下載檔名建議包含 `generationId` 與日期，避免多次生成互相覆蓋 |
| 生成成功後保留祝福卡內容 | `succeeded` 畫面除了桌布圖片，同時保留顯示 Preview 階段看到的 luckyTheme／blessing／story／oneLiner／shopkeeperMessage（Product Decision #11），內容取自第 9.3 節的回應 DTO，而非重新呼叫任何 API |

### 10.2 頁面重新整理後是否恢復 Preview？

**維持 v1 建議：不需要跨重新整理保留。** 重新整理＝回到 `idle`，需要重新選擇並重新產生 Preview（Preview 本身在資料庫中仍存在且未過期，但前端不主動嘗試恢復，避免使用者混淆「這是不是剛剛看過的內容」）。若未來需要「恢復」體驗，可用 `sessionStorage` 暫存 `previewId`／顯示內容（純前端，不需要後端／DB 變更），但**不在本次 P2-AI-04 範圍**。

---

## 11. 需要新增／修改的檔案清單（v2，供未來 Implementation 階段參考，本次不執行）

### 新增
- `supabase/migrations/<TBD>_create_shopkeeper_previews.sql`（第 6.1 節草案）
- `supabase/functions/shopkeeper-preview/index.ts`（新 Edge Function 入口）
- `supabase/functions/_shared/shopkeeper-preview-handler.js` + `.ts`（比照 `wallpaper-generate-handler` 的雙軌 Node/Deno 模式）
- `js/services/shopkeeper/shopkeeper-preview-repository.js` + Deno `.ts` twin（封裝第 7 節的原子 UPDATE／RPC 呼叫，比照既有 `*-repository.js` DI 慣例：`create...Repository({ ... })` + `create...RepositoryFromSupabaseClient({ supabaseClient })`）
- `js/services/wallpaper/mascot-ownership-repository.js`／`gift-redemption-repository.js` + Deno twins（第 12.3 節的擁有權查詢，供 Preview 與 Confirm 兩端點共用）
- 對應測試檔（第 13 節）

### 修改
- `js/services/wallpaper/generation-validator.js`：移除 `luckyTheme`／`blessing` 必填，改為要求 `previewId`；`FORBIDDEN_FIELDS` 新增 `story`／`oneLiner`／`shopkeeperMessage`／`source`／`shopkeeperVersion`
- `supabase/functions/_shared/wallpaper-generate-handler.js`／`.ts`：`REQUIRED_FIELDS`／`FORBIDDEN_FIELDS` 調整；新增 previewId 消費分支＋擁有權驗證呼叫
- `js/services/wallpaper/generation-service.js`／`.ts`：新增「以已消費 Preview 的 `context_snapshot` 取代重新呼叫 `shopkeeperContextAgent`」分支
- `js/services/wallpaper/generation-orchestrator.js`／`.ts`：在 `markRunning(jobId)` 之後、呼叫 `generationService.createWallpaperGeneration()` 之前，插入以 `jobId` 為冪等鍵的 `consume_shopkeeper_preview` RPC 呼叫（第 19.2 節）；失敗時 `markFailed` 並回傳對應錯誤，不繼續呼叫 Gemini
- `js/services/wallpaper/progress-response-dto.js`／`generation-query-repository.js`／`wallpaper-result-presenter.js`：新增 5 個 Shopkeeper 顯示欄位的透傳（第 22.3 節）
- `js/services/wallpaper/response-dto.js`：新增 `luckyTheme`／`blessing`／`story`／`oneLiner`／`shopkeeperMessage` 欄位到成功回應（第 9.3 節）
- `wallpaper.html`：移除 `luckyTheme`／`blessing` 輸入欄位，新增「今日祝福卡」區塊、「再抽一次」／「確認生成」按鈕、正式下載按鈕
- `js/pages/wallpaper.js`：`createGenerationRequest()` 移除 `luckyTheme`／`blessing`，改帶入 `previewId`；新增 Preview 呼叫與第 10 節狀態機邏輯
- `js/services/wallpaper/wallpaper-generation-client.js`：新增 `createShopkeeperPreviewApiClient` 或等效方法
- `js/services/wallpaper/wallpaper-result-presenter.js`：`presentSuccess()` 透傳新增的 Shopkeeper 顯示欄位

**明確不修改**：`wallpaper-prompt-builder.js`、`prompt-validator.js`、`prompt-context-resolver.js`、`shopkeeper-context-agent.js` 本身的核心邏輯（Product Decision #14/#15）——僅生成服務層新增一個「取得 Context 的方式」分支，Agent／Builder 本身不變。

---

## 12. Security／RLS／JWT 分析（v2）

### 12.1 JWT
沿用現有模式——`shopkeeper-preview` 與 `wallpaper-generate` 皆使用預設 Gateway JWT 驗證（`verify_jwt: true`），並在 handler 內以 `resolveAuthenticatedUserId()` 解析真實使用者，**不信任任何客戶端傳入的 userId**。

### 12.2 RLS
`shopkeeper_previews` 啟用 RLS，且對 `authenticated` 角色**完全不開放**（含 SELECT），所有讀寫僅透過 Service Role（Edge Function／`SECURITY DEFINER` RPC）進行——詳見第 6.1／6.3 節。此設計比既有 `wallpaper_generations`（允許 owner SELECT）更嚴格，理由是 Preview 內容尚未確認／計費，不應該有任何繞過業務邏輯的直接讀取路徑。

### 12.3 使用者所有權驗證（Product Decision #10 新增，v1 遺留問題的正式解答）

- **Mascot 擁有權**：查詢既有 `user_mascots` 表（`js/api.js` 的 `getUserMascots`／`upsertUserMascot` 已在使用），確認 `EXISTS (SELECT 1 FROM user_mascots WHERE user_id = :userId AND mascot_id = :mascotId)`。不存在則回傳 `MASCOT_NOT_OWNED`。
- **Gift 擁有權／可用性**：查詢既有 `redeem_history` 表（`js/api.js` 的 `addRedeemHistory`／`redeemGift` 已在使用），確認存在對應 `user_id`／`gift_id` 的兌換紀錄。**待確認事項**：`redeem_history.status` 目前已知的值至少包含 `"pending"`（`addRedeemHistory` 寫入時的預設值），但「兌換後可否無限次用於生成桌布」或「每次生成是否應該消耗一筆兌換紀錄（例如轉為 `"used"`）」**目前沒有明確定義**，這是**本次修訂發現的新開放問題**，需要 Product Owner／後端負責人確認：
  1. 「Gift 已兌換」是否等同「此 Gift 可無限次用於產生桌布」？或者
  2. 每次成功生成桌布，是否應該消耗一筆該 Gift 的兌換數量／標記對應 `redeem_history` 列為已使用？
  - **本報告的暫定假設（待確認）**：先以「存在至少一筆該使用者、該 Gift 的兌換紀錄即視為可用」作為 MVP 實作基準，不消耗兌換紀錄，因為現有系統中沒有「Gift 使用次數」的既有機制可供沿用，避免發明新的消耗語意造成範圍蔓延。若 Product Owner 認為需要「用一次少一次」，建議另立子任務設計（可能牽動 `redeem_history` 的 schema 與既有兌換頁面邏輯，超出 P2-AI-04 範圍）。
- Preview 與 Confirm **兩端點都必須各自驗證**（Product Decision #10 明確要求「Preview 與 Generate 都必須驗證」），不可只在其中一端做檢查後假設另一端安全（避免直接呼叫 Confirm API 繞過 Preview 驗證的攻擊路徑；雖然 Confirm 本來就需要合法 `previewId`，但 `previewId` 建立當下若沒做擁有權檢查，等同任何人都能對別人的 Mascot/Gift 產生 Preview 佔用額度）。

### 12.4 Preview 安全性總結
- `previewId` 為資料庫 UUID 主鍵，前端無法從中反推內容或偽造有效 id。
- `context_snapshot` 從未透過任何 API 回傳「可回灌」的編碼格式給前端重新提交——前端只需回傳 `previewId`，實際內容由後端從資料庫查詢。
- `FORBIDDEN_FIELDS` 涵蓋所有 Shopkeeper 相關欄位＋`userId`，客戶端傳入一律拒絕（`INVALID_REQUEST`）。

---

## 13. 測試策略與驗收標準（v2）

### 13.1 新增測試（對應任務書第七節逐項落實）

| # | 測試 | 對應層級 |
|---|---|---|
| 1 | 使用者無法 Preview 不屬於自己的 Mascot（`MASCOT_NOT_OWNED`） | 整合測試（shopkeeper-preview-handler） |
| 2 | 使用者無法使用未兌換 Gift（`GIFT_NOT_REDEEMED_OR_UNAVAILABLE`） | 整合測試 |
| 3 | 每 Session 第 4 次 Preview 被拒絕（`PREVIEW_SESSION_LIMIT_REACHED`） | 單元測試（`create_or_reroll_shopkeeper_preview` RPC 邏輯或其 Node 對照實作） |
| 4 | 每日第 21 次 Preview 被拒絕（`PREVIEW_DAILY_LIMIT_REACHED`） | 同上 |
| 5 | 重抽後舊 `previewId` 被拒絕（`PREVIEW_INVALIDATED`） | 同上 |
| 6 | 過期 `previewId` 被拒絕（`PREVIEW_EXPIRED`） | 單元測試（Confirm 原子消費邏輯） |
| 7 | 竄改 selections 被拒絕（`PREVIEW_SELECTION_MISMATCH` / `PREVIEW_SESSION_SELECTION_MISMATCH`） | 單元測試 |
| 8 | 同時兩次 Confirm 只能成功一次（`PREVIEW_ALREADY_CONSUMED`） | 整合測試（模擬並發呼叫同一 `previewId`，驗證僅一次影響列數為 1） |
| 9 | 客戶端傳入 Shopkeeper 欄位被拒絕（`INVALID_REQUEST`） | 單元測試（generation-validator／preview-validator） |
| 10 | Preview 與最終 Snapshot 完全一致（WYSIWYG） | 整合測試：比對 Preview Response 內容與最終 `wallpaper_generations.metadata_json.shopkeeperSnapshot` |
| 11 | Confirm 不會再次呼叫 Gemini Text | 整合測試（mock `shopkeeperContextAgent.generate`，斷言 Confirm 流程未呼叫） |
| 12 | 下載按鈕可用 | Playwright E2E |
| 13 | 手機版 9:16 顯示正常 | Playwright E2E（比照既有 390×844 視窗測試） |
| 14 | 既有 207 項測試全部通過 | 回歸測試（`scripts/verify-local.ps1`） |

### 13.2 驗收標準（整合 v1 + v2 新增項目）

1. 使用者無法在 UI 上手動輸入 luckyTheme／blessing（欄位移除）。
2. 選擇完吉祥物/Gift/Style 後，按下「產生今日祝福」才觸發第一次 API 呼叫（非自動）。
3. 「再抽一次」不會觸發 Gemini Image、不扣點數、不計入每日生成次數（僅計入獨立的每日 Preview 上限）。
4. 「再抽一次」達 Session 上限（3 次）或每日上限（20 次）後，UI 明確告知並引導對應動作。
5. 確認生成後，最終圖片的 luckyTheme／blessing／story 與使用者在 Preview 階段看到的完全一致（WYSIWYG，由第 13.1 第 10 項測試保證）。
6. 竄改／過期／已消費／已失效的 `previewId` 一律被拒絕，且有明確錯誤訊息。
7. 同時兩次 Confirm 同一 `previewId`，只有一次成功（第 13.1 第 8 項測試保證）。
8. 生成結果頁新增正式下載按鈕，且保留顯示 luckyTheme／blessing／story／oneLiner／shopkeeperMessage。
9. 手機版（9:16）版面正常，無版面錯位。
10. `verify-local.ps1` 全數通過，無回歸（含既有 207 項＋本次新增測試）。

---

## 14. Migration 需求（v2 — 修正 v1「不需要」的結論）

**需要。** 本次採用 DB-backed `shopkeeper_previews`（Product Decision #2/#3），需新增一份 migration（草案見第 6.1 節），內容包含：新表結構、索引、RLS policy、`create_or_reroll_shopkeeper_preview` RPC。**本次分析階段不建立實際 migration 檔案**，僅提出草案供 Implementation 階段使用；亦不需要修改任何現有資料表結構（`wallpaper_generations`／`wallpaper_generation_jobs`／`daily_generation_usage` 皆不變，僅新增一個外鍵欄位 `generation_id` 存在於**新表** `shopkeeper_previews` 上，不影響既有表）。

---

## 15. 與 P2-AI-02／03 的相容性

- **P2-AI-02（Prompt Builder）**：完全不受影響——`wallpaper-prompt-builder.js`／`prompt-validator.js`／`prompt-context-resolver.js` 的輸入輸出契約不變，只是「Context 從哪裡取得」多了一個分支（來自已消費的 Preview，而非即時呼叫 Shopkeeper Agent）。
- **P2-AI-03（Shopkeeper Context Agent）**：`shopkeeper-context-agent.js` 本身完全不變，只是新增了一個「被 `shopkeeper-preview` 這個新 Function 呼叫」的使用場景（介面本來就是 `generate({mascot, gift, wallpaperStyle, correlationId})`，天然可被兩個不同呼叫端重用）。
- **既有 `wallpaper-generate` 已驗證行為**：**修正 v1 過於樂觀的「100% 向後相容」敘述**——本次要求 Confirm 請求改用 `previewId` 取代 `luckyTheme`/`blessing`，是一個**破壞性的 API 契約變更**（非可選欄位的向後相容擴充），因此無法讓舊版前端與新版後端同時運作。**v3 更新**：詳細的過渡期部署策略見第 20 節（雙路徑並存＋明確的移除條件與監控事件），不再只是「建議方向」。

---

## 16. Preview 三階段流程：Reserve → Generate → Finalize（v3 新增）

### 16.1 為何要拆成三階段

v2 的設計把「額度檢查」與「呼叫 Shopkeeper Agent」隱含在同一個步驟裡，沒有明確規定順序，容易在 Implementation 階段被誤寫成「先呼叫 Gemini、再檢查次數」（因為呼叫 Agent 前的額度檢查程式碼與呼叫 Agent 的程式碼在同一個 function 裡，順序容易被後續維護者不小心調換）。v3 明確拆成三個獨立、有各自失敗模式的階段，讓「額度是否用掉」與「Shopkeeper 有沒有被呼叫」在時序上完全分離且可稽核。

### 16.2 Reserve（佔位，對應資料庫 RPC，見第 17 節）

**輸入**：`{ userId, mascotId, giftId, wallpaperStyle, sessionId? }`（`sessionId` 省略＝首次；提供＝重抽）

**Reserve RPC 行為**：
1. 取得 advisory lock（第 17 節，序列化同一使用者＋同一天／同一 Session 的並發請求）。
2. 驗證每日 20 次上限（計入所有狀態的列，含 `pending`／`failed`——因為「呼叫了一次 Reserve」本身就是額度消耗，不論後續是否成功產生內容）。
3. 驗證 Session 合計 3 次上限（同上，計入所有狀態）。
4. 配置新的 `previewId`（UUID）、`sessionId`（首次時新產生；重抽時沿用）、`sequenceNo`（0/1/2）。
5. 以 `status = 'pending'` 建立一列 reservation（此時**沒有** `context_snapshot`／`shopkeeper_version`／`source`，這些要等 Finalize 才寫入）。
6. **不使舊 `ready` Preview 失效**——這是刻意的設計：失效化必須等到 Finalize 成功「產生出新內容」之後才發生（見第 16.4 節理由），避免「Reserve 成功但 Generate/Finalize 失敗」導致使用者一個能用的 Preview 都沒有。
7. 回傳 reservation 資訊：`{ previewId, sessionId, sequenceNo, expiresAt }`。

**Reserve 被拒絕時（次數上限）**：直接回傳對應錯誤（`PREVIEW_DAILY_LIMIT_REACHED`／`PREVIEW_SESSION_LIMIT_REACHED`），**絕不呼叫 Gemini**——這是本節要解決的核心問題。

### 16.3 Generate（呼叫 Shopkeeper Agent，純後端內部步驟，非獨立對外 API）

- Reserve 成功後，才呼叫既有 `shopkeeperContextAgent.generate({mascot, gift, wallpaperStyle, correlationId})`。
- `shopkeeperContextAgent` 本身**從不拋出例外**（P2-AI-03 既有保證）：timeout／provider failure 時內部自動解析為 Fallback Context，一定回傳完整可用的 `{luckyTheme, blessing, story, oneLiner, shopkeeperMessage, version, source}`。
- Agent 回傳完整 Context 後，進入 Finalize。
- **此步驟本身沒有自己的「失敗」狀態**——因為 Agent 保證一定成功（頂多是 Fallback 內容），唯一可能讓流程中斷的是 Finalize 寫入資料庫時的系統性失敗（例如 DB 連線中斷），這屬於 Finalize 的失敗處理範疇（見下方）。

### 16.4 Finalize（落地內容，對應資料庫操作）

**輸入**：`{ previewId, userId, contextSnapshot, shopkeeperVersion, source }`

**Finalize 行為（單一交易內完成）**：
1. 驗證 reservation 存在、`user_id` 相符、`status = 'pending'`（見第 16.5 節的冪等處理）。
2. 寫入 `context_snapshot`／`source`／`shopkeeper_version`、設定 `finalized_at = NOW()`。
3. 將該 reservation 的 `status` 從 `pending` 改為 `ready`。
4. **同一交易內**，將同一 `(user_id, session_id)` 下、狀態為 `ready` 的其他舊列，改為 `invalidated`（`invalidated_at = NOW()`）——**此時（新 Preview 已確定 ready）才是失效化舊 Preview 的正確時機**，而非在 Reserve 階段就失效化。這確保「新 Preview 尚未 ready 前，舊 Preview 保持有效」（使用者若在等待 Finalize 期間重新整理頁面，看到的仍是上一個 ready 的祝福，不會出現「畫面空白、什麼都沒有」的空窗期）。
5. 回傳最終的 Preview 內容（同第 8.2 節 Response DTO）。

### 16.5 Finalize 的冪等性

「Finalize 重複呼叫必須冪等」——情境：Generate 呼叫 Shopkeeper Agent 成功、Finalize 的 HTTP 回應在傳回前端途中遺失（網路問題），前端誤判失敗而重試整個 Preview 流程；或者 Edge Function 本身因執行環境問題重新調用了 Finalize 兩次。

**冪等設計**：Finalize 以 `previewId` 為鍵，若查詢到該 reservation 的 `status` 已經是 `ready`（代表已經被 Finalize 過一次），則：
- 若這次要寫入的內容與已存在的 `context_snapshot` 一致（理論上應該一致，因為呼叫方應該是同一個 Generate 呼叫的結果重送），**直接回傳既有的 `context_snapshot`，不重新寫入、不重新觸發失效化舊 Preview 的動作**（避免重複觸發失效化造成不必要的資料異動）。
- 若該 reservation 的 `status` 已經是 `consumed`／`invalidated`（代表這個 Preview 早已進入生命週期的下一階段），Finalize 視為過期操作，回傳「此 Preview 已不可再 Finalize」的內部錯誤（不影響已經發生的下游狀態）。

### 16.6 Finalize 系統性失敗

「Finalize 系統性失敗時，reservation 標記 `failed`，不使舊 Preview 失效」——例如 DB 寫入 `context_snapshot` 時發生連線中斷。此時：
- 將該筆 reservation 的 `status` 改為 `failed`（若連這個 UPDATE 都做不到，則該筆 reservation 永遠停留在 `pending`，由第 6.4 節的過期清理策略處理，不影響任何其他資料）。
- **絕不觸碰同一 Session 內其他 `ready` 的舊 Preview**——維持它們的有效性，讓使用者至少還能用上一次成功產生的祝福內容去 Confirm，不會因為這一次的 Reroll 系統性失敗而整個 Session 都不能用。
- 前端收到 Finalize 失敗，UI 應顯示「這次重抽失敗，你可以繼續使用剛才的祝福，或再試一次」，並保留舊的 `previewReady` 畫面內容（見第 10 節 UI 狀態機的 `rerolling` 失敗分支，v3 更新）。

---

## 17. 並發安全設計（v3 新增 — 修正 v2「SELECT count + FOR UPDATE 不可靠」的問題）

### 17.1 為何 v2 的做法不可靠

v2 在 RPC 內先 `SELECT count(*)` 再 `INSERT`，並嘗試以 `PERFORM ... FOR UPDATE` 鎖定「同一 Session 既有列」來防止並發。這個做法對「同一 Session 內的重抽並發」有一定保護（因為鎖定的是已存在的列，重抽者確實會操作到這些既有列），但**對以下情境完全無效**：

- **兩個全新 Session（無共同既有列可鎖）並發建立**：`FOR UPDATE` 鎖定的是「符合 WHERE 條件的既有列」，但兩個全新 Session 在建立當下彼此沒有任何共同的既有列可供鎖定，因此兩個交易可以完全並行執行各自的 `SELECT count(*)`（皆讀到相同的「目前每日次數＝19」），都判斷通過，都各自 `INSERT`，最終造成每日次數變成 21，超過上限。
- **每日次數在邊界值並發**：即使是同一使用者對同一天發起兩次「首次 Reserve」（例如兩個瀏覽器分頁），因為兩者都是全新 Session，同樣沒有可鎖定的既有列，會發生上述超額問題。

### 17.2 v3 解法：`pg_advisory_xact_lock` + 交易範圍鎖定

`pg_advisory_xact_lock(key)` 是 PostgreSQL 提供的**交易層級**建議鎖：取得鎖的交易若尚未 `COMMIT`/`ROLLBACK`，任何其他交易嘗試取得**相同 key** 的鎖都會被阻塞（等待），直到前者交易結束（鎖自動釋放，無需手動 unlock）。這不是鎖定「某一列資料」，而是鎖定一個**邏輯上的鍵值**（例如「使用者 X 在 2026-07-27 這一天」這整個抽象概念），因此即使是「全新 Session、沒有既有列」的情境，只要兩個交易使用相同的 key，第二個交易就會被迫等待第一個交易完全結束（包含它的 `INSERT` 已經 `COMMIT`）之後，才能開始執行自己的 `SELECT count(*)`，此時它讀到的計數已經包含了第一個交易剛剛新增的那一列——**問題根源（跨交易的「幻讀」）被直接消除**。

### 17.3 Advisory Lock Key 的產生方式（穩定、不碰撞、不依賴內建 hash 假設）

**不採用** PostgreSQL 內建的 `hashtext()` 或依賴 `hashint4`/`hashint8` 等一般用途雜湊函式的「目前實作剛好穩定」這個未被官方正式承諾的假設（PostgreSQL 官方文件僅保證這些函式在同一個大版本內部行為一致，並未承諾其演算法永遠不變；這是任務書明確要求避免依賴的「不穩定假設」）。

**改採**：以 **MD5**（演算法本身是公開、固定、跨版本永遠不變的密碼學雜湊標準，PostgreSQL 的 `md5()` 函式只是呼叫該標準演算法，不存在「PostgreSQL 版本升級後 MD5 演算法跟著變」的風險）將一個**明確加上命名空間前綴的字串**轉換成 64 位元整數，作為 `pg_advisory_xact_lock(bigint)` 的鍵值：

```sql
-- 每日額度鎖：同一使用者 + 同一天（Asia/Taipei）
SELECT pg_advisory_xact_lock(
    ('x' || md5('shopkeeper_preview_daily:' || p_user_id::text || ':' || (NOW() AT TIME ZONE 'Asia/Taipei')::date::text))::bit(64)::bigint
);

-- Session 額度鎖：同一使用者 + 同一 Session
SELECT pg_advisory_xact_lock(
    ('x' || md5('shopkeeper_preview_session:' || p_user_id::text || ':' || v_session_id::text))::bit(64)::bigint
);
```

- **命名空間前綴**（`shopkeeper_preview_daily:`／`shopkeeper_preview_session:`）確保「每日鎖」與「Session 鎖」這兩個邏輯上完全不同的鎖空間，即使雜湊到理論上相同的位元組合（機率上近乎不可能，MD5 為 128 位元，此處截斷取 64 位元，碰撞機率仍遠低於本應用實際規模），也不會互相干擾，因為它們本來就是兩個獨立的 `pg_advisory_xact_lock` 呼叫（PostgreSQL 的 advisory lock 是「同一個 key 才會互斥」，不同呼叫本來就互不影響——命名空間前綴的實際作用是防止「同一組 user_id+session_id 字串」被誤用在錯誤情境下產生的鍵值巧合碰撞另一種用途的鍵值）。
- **在一次 Reserve 呼叫中，兩個鎖都要取得**（先取每日鎖，再取 Session 鎖，固定順序以避免死鎖）：因為 Reserve 同時要驗證「每日上限」與「Session 上限」兩種計數，缺一都可能造成其中一種限制被繞過。

### 17.4 三個情境的並發安全證明

**情境 1：daily count = 19，兩個新 Session 同時 Reserve**
- 交易 A、交易 B 皆先嘗試取得「每日鎖」（同一 user_id＋同一天，key 相同）。
- 假設 A 先取得鎖，B 被阻塞等待。
- A：`SELECT count(*) WHERE user_id=X AND taipei_usage_date=today` → 19（< 20，通過）→ `INSERT` 新 reservation（count 變成 20）→ `COMMIT`（鎖釋放）。
- B：取得鎖 → `SELECT count(*)` → **此時已是 20**（因為 A 的 INSERT 已經 COMMIT，B 是在 A COMMIT 之後才開始查詢）→ 20 ≥ 20 → 拒絕，回傳 `PREVIEW_DAILY_LIMIT_REACHED`。
- **結果：最終恰好 20 筆，不會變成 21。**

**情境 2：session count = 2，兩個重抽同時 Reserve**
- 交易 A、B 皆先嘗試取得「Session 鎖」（同一 user_id＋同一 session_id，key 相同）。
- A 先取得鎖：`SELECT count(*) WHERE session_id=S` → 2（< 3，通過）→ `INSERT`（count 變成 3）→ `COMMIT`。
- B：取得鎖 → `SELECT count(*)` → 3（≥ 3）→ 拒絕，回傳 `PREVIEW_SESSION_LIMIT_REACHED`。
- **結果：最終恰好 3 筆，不會變成 4。**

**情境 3：同一 request 因網路重送兩次**
- 兩份重送的請求（例如瀏覽器自動重試）在邏輯上鎖定的 key **完全相同**（同一 user_id＋同一天，若是首次 Reserve；或同一 user_id＋同一 session_id，若是重抽），因此兩者一樣會被序列化——第二份不會與第一份「同時」執行 `count → insert`，而是等第一份完全結束才開始。
  - 若沒有額外的客戶端冪等鍵：第二份會被視為一次「合法的、獨立的新 Reserve」，成功建立第二筆 reservation，消耗掉一個額度名額（使用者感知上「多用掉一次」，但**不會**造成計數矛盾或超額——這是安全但非最優的結果）。
  - **可選加強**：若前端在使用者按下「產生今日祝福」／「再抽一次」按鈕當下，於本地產生一個穩定的 `clientRequestId`（例如 UUID，同一次使用者操作因網路重送而觸發的多次 HTTP 呼叫都帶著同一個值），資料表可加上 `client_request_id TEXT` 欄位＋部分唯一索引 `UNIQUE (user_id, client_request_id) WHERE client_request_id IS NOT NULL`，Reserve RPC 在 `INSERT` 前先檢查是否已存在相同 `client_request_id` 的列，若存在則直接回傳該筆既有 reservation（而不是建立新的），如此可以連「多消耗一次額度」都避免。**此為可選加強項，非本次必要項**（因為即使不做，安全性本身已經成立，只是使用者體驗上少一分「網路重送不浪費額度」的保證）。

### 17.5 是否需要獨立的 quota counter table？優缺點比較

| 方案 | 優點 | 缺點 |
|---|---|---|
| **`pg_advisory_xact_lock` + 直接對 `shopkeeper_previews` 計數（v3 採用）** | 不需要額外資料表／欄位；計數與實際資料（reservation 列）永遠一致，不會有「counter 表與實際列數兜不起來」的資料漂移風險；`taipei_usage_date` 生成欄位已支援高效率索引查詢 | 每次 Reserve 都要 `count(*)`，在資料量極大時比讀取一個獨立 counter 欄位稍慢（但每人每日最多 20 筆、Session 最多 3 筆，`count(*)` 的資料量微小，效能無虞） |
| **獨立 quota counter table（例如 `shopkeeper_preview_daily_counters(user_id, usage_date, count)`）** | 讀取單一整數比 `count(*)` 理論上更快；可以額外儲存「已消耗」與「剩餘」等衍生欄位 | 需要額外維護「counter 表」與「明細列」兩份資料的一致性（每次 Reserve 都要同時 `UPDATE counter` 與 `INSERT` 明細列，仍然需要在同一交易＋同一把鎖下進行，並沒有省掉 advisory lock 的必要性）；多一張表、多一組 migration／RLS，維運複雜度提高；在本應用規模（每人每日最多 20 筆）下，效能差異可忽略不計 |

**結論：不採用獨立 quota counter table。** 直接對 `shopkeeper_previews` 做 `count(*)`（受 advisory lock 保護）已經足夠正確且高效，額外的 counter 表在此規模下只會增加維運複雜度，沒有實質效能收益。

---

## 18. `shopkeeper_previews` 狀態模型修訂（v3）

### 18.1 完整欄位（取代 v2 第 6.1 節的欄位設計）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | UUID PK | Preview 唯一識別（即對外的 `previewId`） |
| `user_id` | 比照 users PK 型別 | 擁有者 |
| `session_id` | UUID | 同一次「選擇→可重抽多次」的邏輯分組 |
| `mascot_id` | 比照 mascots PK 型別 | |
| `gift_id` | 比照 gifts PK 型別 | |
| `wallpaper_style` | TEXT | |
| `sequence_no` | SMALLINT | 0＝首次，1～2＝重抽（合計最多 3） |
| `status` | TEXT | `pending`／`ready`／`failed`／`consumed`／`invalidated`（見 18.2 狀態機） |
| `context_snapshot` | JSONB，**Reserve 時為 NULL，Finalize 時寫入** | |
| `shopkeeper_version` | TEXT，同上時機寫入 | |
| `source` | TEXT (`ai`\|`fallback`)，同上時機寫入 | |
| `created_at` | TIMESTAMPTZ | Reserve 當下 |
| `expires_at` | TIMESTAMPTZ | Reserve 當下設定（建立時就決定，Finalize 不延長） |
| `finalized_at` | TIMESTAMPTZ，nullable | Finalize 成功時間 |
| `consumed_at` | TIMESTAMPTZ，nullable | Confirm 原子消費成功時間 |
| `consumed_job_id` | UUID，nullable，**v3 新增**，FK → `wallpaper_generation_jobs.id` | 取代 v2 誤用的 `generation_id`（見第 0.2／19 節理由） |
| `invalidated_at` | TIMESTAMPTZ，nullable | 因重抽而失效的時間 |
| `failure_code` | TEXT，nullable，**v3 新增** | Finalize 系統性失敗時記錄原因 |
| `taipei_usage_date` | DATE，GENERATED ALWAYS AS | 沿用 v2 設計，供每日額度計算 |

（不再需要 v2 的 `generation_id` 欄位，改為 `consumed_job_id`；理由見第 19 節。）

### 18.2 合法狀態轉移

```
pending ──(Finalize 成功)──► ready ──(Confirm 原子消費成功)──► consumed（終態）
   │                            │
   │                            └──(同 Session 有新的 ready，本列被取代)──► invalidated（終態）
   │
   └──(Finalize 系統性失敗)──► failed（終態）
```

**不合法的轉移**（必須被 CHECK constraints 或應用邏輯阻擋）：
- `consumed` → 任何其他狀態（一旦消費，永遠終態）。
- `invalidated` → 任何其他狀態（一旦失效，永遠終態）。
- `failed` → 任何其他狀態（一旦 Finalize 失敗，永遠終態，不會「復活」變回 `pending`／`ready`）。
- `pending` 直接跳到 `consumed`（必須先經過 `ready`——Confirm 只能消費 `ready` 狀態的 Preview，不能消費「連內容都還沒產生完成」的 `pending` reservation）。

### 18.3 CHECK Constraints 草案

```sql
CONSTRAINT ck_shopkeeper_previews_status
    CHECK (status IN ('pending', 'ready', 'failed', 'consumed', 'invalidated')),

-- pending 時不應該有 context_snapshot／finalized_at；非 pending 時（除了 failed）必須有
CONSTRAINT ck_shopkeeper_previews_pending_no_snapshot
    CHECK (status <> 'pending' OR (context_snapshot IS NULL AND finalized_at IS NULL)),
CONSTRAINT ck_shopkeeper_previews_ready_has_snapshot
    CHECK (status NOT IN ('ready', 'consumed', 'invalidated') OR
           (context_snapshot IS NOT NULL AND shopkeeper_version IS NOT NULL AND source IS NOT NULL AND finalized_at IS NOT NULL)),

-- consumed 必須有 consumed_at + consumed_job_id；非 consumed 不應該有
CONSTRAINT ck_shopkeeper_previews_consumed_fields
    CHECK ((status = 'consumed') = (consumed_at IS NOT NULL AND consumed_job_id IS NOT NULL)),

-- invalidated 必須有 invalidated_at；非 invalidated 不應該有
CONSTRAINT ck_shopkeeper_previews_invalidated_fields
    CHECK ((status = 'invalidated') = (invalidated_at IS NOT NULL)),

-- failed 必須有 failure_code；非 failed 不應該有
CONSTRAINT ck_shopkeeper_previews_failed_fields
    CHECK ((status = 'failed') = (failure_code IS NOT NULL)),

-- 時序合理性（沿用 v2）
CONSTRAINT ck_shopkeeper_previews_expires_after_created CHECK (expires_at > created_at),
CONSTRAINT ck_shopkeeper_previews_finalized_after_created
    CHECK (finalized_at IS NULL OR finalized_at >= created_at),
CONSTRAINT ck_shopkeeper_previews_consumed_after_finalized
    CHECK (consumed_at IS NULL OR (finalized_at IS NOT NULL AND consumed_at >= finalized_at)),
CONSTRAINT ck_shopkeeper_previews_invalidated_after_created
    CHECK (invalidated_at IS NULL OR invalidated_at >= created_at),

-- 一列不可能同時是「已消費」又「已失效」（互斥終態）
CONSTRAINT ck_shopkeeper_previews_not_both_terminal
    CHECK (NOT (consumed_at IS NOT NULL AND invalidated_at IS NOT NULL)),

CONSTRAINT ck_shopkeeper_previews_sequence_no CHECK (sequence_no >= 0 AND sequence_no <= 2),

-- 同一 Session 內 sequence_no 不可重複（配合 advisory lock 一起保證正確遞增）
CONSTRAINT uq_shopkeeper_previews_session_sequence UNIQUE (session_id, sequence_no)
```

（其餘外鍵、索引沿用 v2 第 6.1／6.3／6.4 節設計，僅新增 `consumed_job_id` 外鍵：`CONSTRAINT fk_shopkeeper_previews_consumed_job FOREIGN KEY (consumed_job_id) REFERENCES public.wallpaper_generation_jobs(id) ON DELETE SET NULL`。）

---

## 19. Confirm Consume 修訂（v3 — 以既有 jobId 取代尚不存在的 generationId）

### 19.1 先確認 `generation-orchestrator.js` 的真實執行順序（逐檔查證）

實際讀取 `js/services/wallpaper/generation-orchestrator.js`／`generation-service.js`／`job-service.js`／`job-repository.js` 後，確認真實順序為：

```
1. pointsService.validateUser(userId)
2. usageService.checkDailyLimit(userId)
3. pointsService.getGenerationCost()
4. jobService.createJob({userId, status: Pending})   ← jobId 在此產生（DB 狀態 'queued'）
5. jobService.markRunning(jobId)                      ← DB 狀態 'processing'
6. generationService.createWallpaperGeneration(request)
     → 內部：查詢 mascot/gift → 呼叫 Shopkeeper Agent → Prompt Builder → Gemini Image → Storage → 寫入 wallpaper_generations（此時才產生 generationId）
7. 成功：pointsService.deductOnSuccess() → usageService.recordSuccess() → （回傳含 jobId 的成功 DTO）
   失敗：jobService.markFailed(jobId, {failureCode, failureMessage})
```

**關鍵事實**：`jobId` 在步驟 4 就已經確定存在，**在呼叫 `generationService.createWallpaperGeneration()`（步驟 6）之前**；而 `generationId` 要等到步驟 6 內部 Gemini Image 成功、`wallpaper_generations` 列被寫入之後才存在。**v2 把 Consume 設計成需要一個「尚未存在的 `generationId`」作為輸入，這是一個時序上不可能成立的設計錯誤**，v3 修正為使用步驟 4 就已確定存在的 `jobId`。

### 19.2 修訂後的 Consume 時機

Consume 應該插入在**步驟 5（`markRunning`）之後、步驟 6（呼叫 `generationService`）之前**：此時 `jobId` 已確定，且尚未耗費任何 Gemini Image 資源。若 Consume 失敗，直接 `jobService.markFailed(jobId, ...)` 並回傳對應錯誤，**不進入步驟 6**，不浪費任何 Gemini Image 呼叫。

### 19.3 原子 Consume RPC 設計

**輸入**：`{ previewId, userId, mascotId, giftId, wallpaperStyle, jobId }`

```sql
CREATE OR REPLACE FUNCTION public.consume_shopkeeper_preview(
    p_preview_id UUID,
    p_user_id UUID,   -- 型別比照 users PK
    p_mascot_id UUID,
    p_gift_id UUID,
    p_wallpaper_style TEXT,
    p_job_id UUID
)
RETURNS TABLE (
    consume_status TEXT,       -- 'consumed_now' | 'already_consumed_same_job' | 'error'
    context_snapshot JSONB,
    shopkeeper_version TEXT,
    source TEXT,
    error_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.shopkeeper_previews%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM public.shopkeeper_previews WHERE id = p_preview_id FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'error', NULL::JSONB, NULL::TEXT, NULL::TEXT, 'PREVIEW_NOT_FOUND';
        RETURN;
    END IF;

    -- 情境 2：已由「相同 jobId」消費過 → 冪等重試，直接回傳同一份內容，不再次消費
    IF v_row.status = 'consumed' AND v_row.consumed_job_id = p_job_id THEN
        RETURN QUERY SELECT 'already_consumed_same_job', v_row.context_snapshot, v_row.shopkeeper_version, v_row.source, NULL::TEXT;
        RETURN;
    END IF;

    -- 情境 3：已由「不同 jobId」消費過 → 明確拒絕
    IF v_row.status = 'consumed' THEN
        RETURN QUERY SELECT 'error', NULL::JSONB, NULL::TEXT, NULL::TEXT, 'PREVIEW_ALREADY_CONSUMED';
        RETURN;
    END IF;

    IF v_row.user_id <> p_user_id THEN
        RETURN QUERY SELECT 'error', NULL::JSONB, NULL::TEXT, NULL::TEXT, 'PREVIEW_OWNER_MISMATCH';
        RETURN;
    END IF;

    IF v_row.mascot_id <> p_mascot_id OR v_row.gift_id <> p_gift_id OR v_row.wallpaper_style <> p_wallpaper_style THEN
        RETURN QUERY SELECT 'error', NULL::JSONB, NULL::TEXT, NULL::TEXT, 'PREVIEW_SELECTION_MISMATCH';
        RETURN;
    END IF;

    IF v_row.status = 'invalidated' THEN
        RETURN QUERY SELECT 'error', NULL::JSONB, NULL::TEXT, NULL::TEXT, 'PREVIEW_INVALIDATED';
        RETURN;
    END IF;

    IF v_row.status = 'pending' OR v_row.status = 'failed' THEN
        -- 尚未 Finalize 完成或 Finalize 失敗，內容根本不存在，不可消費
        RETURN QUERY SELECT 'error', NULL::JSONB, NULL::TEXT, NULL::TEXT, 'PREVIEW_NOT_READY';
        RETURN;
    END IF;

    IF v_row.expires_at <= NOW() THEN
        RETURN QUERY SELECT 'error', NULL::JSONB, NULL::TEXT, NULL::TEXT, 'PREVIEW_EXPIRED';
        RETURN;
    END IF;

    -- 情境 1：ready 且未消費 → 原子設定 consumed
    UPDATE public.shopkeeper_previews
       SET status = 'consumed', consumed_at = NOW(), consumed_job_id = p_job_id
     WHERE id = p_preview_id;

    RETURN QUERY SELECT 'consumed_now', v_row.context_snapshot, v_row.shopkeeper_version, v_row.source, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_shopkeeper_preview FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_shopkeeper_preview TO service_role;
```

- `SELECT ... FOR UPDATE` 鎖定該列，確保同一 `previewId` 的兩個並發 Confirm 請求會被序列化（第二個等第一個交易 `COMMIT`／`ROLLBACK` 後才繼續，讀到的 `status` 已經反映第一個交易的結果）——這就是任務書「同時兩次 Confirm 只能成功一次」的保證來源。
- 回傳的 `consume_status` 區分三種情境：`consumed_now`（本次真的消費）／`already_consumed_same_job`（冪等重試，安全）／`error`（各種拒絕原因）。

### 19.4 對外錯誤碼收斂（避免洩漏 previewId 是否存在）

任務書要求「避免用不同錯誤碼對未授權使用者洩漏任意 `previewId` 是否存在」。設計：

- **內部** `error_code`（RPC 回傳、寫入 Edge Function 內部日誌）：完整區分 `PREVIEW_NOT_FOUND`／`PREVIEW_OWNER_MISMATCH`／`PREVIEW_SELECTION_MISMATCH`／`PREVIEW_INVALIDATED`／`PREVIEW_NOT_READY`／`PREVIEW_EXPIRED`／`PREVIEW_ALREADY_CONSUMED`，供除錯與 Observability 使用。
- **對外**（回傳給前端的 HTTP 錯誤碼／訊息）收斂為**兩類**：
  1. `PREVIEW_UNAVAILABLE`（涵蓋 `PREVIEW_NOT_FOUND`／`PREVIEW_OWNER_MISMATCH`／`PREVIEW_SELECTION_MISMATCH`／`PREVIEW_INVALIDATED`／`PREVIEW_NOT_READY`）——統一訊息「這個祝福內容已經不可用，請重新產生」，**不透露**究竟是「不存在」還是「不屬於你」還是「被竄改」，避免攻擊者透過錯誤訊息差異來列舉他人的 `previewId` 是否存在或猜測其歸屬。
  2. `PREVIEW_EXPIRED`（維持獨立錯誤碼，因為「過期」是一個對合法使用者也有意義、無害的資訊——不會洩漏任何他人資料，反而能給出正確的操作指引「請重新產生」）。
  3. `PREVIEW_ALREADY_CONSUMED` 的對外呈現：由於這個錯誤只可能發生在「同一個合法使用者、對自己已經用過的 previewId 再次送出不同 jobId 的 Confirm」這種情境（因為 `PREVIEW_OWNER_MISMATCH` 已經在更前面被攔截且統一成 `PREVIEW_UNAVAILABLE`），維持獨立錯誤碼是安全的，不構成資訊洩漏。

---

## 20. 過渡期部署策略修訂（v3 — 明確移除條件與監控事件）

### 20.1 雙路徑並存規則

新版後端部署後（新版前端尚未上線前），`wallpaper-generate` 需同時支援兩條路徑：

| 條件 | 行為 |
|---|---|
| 請求包含 `previewId`（新版前端） | 走新版 Consume 路徑（第 19 節），`luckyTheme`／`blessing` 等欄位一律列入 `FORBIDDEN_FIELDS`，若客戶端傳入直接拒絕 |
| 請求**不包含** `previewId`（舊版前端，仍在使用中） | **保留現行已驗證的 legacy path**：後端自行呼叫 `shopkeeperContextAgent`（完全比照 P2-AI-03 現行行為，不變）；`luckyTheme`／`blessing` 若存在於請求中，**繼續忽略，絕不信任客戶端內容**（這是 P2-AI-03 既有行為，不是新增風險） |

**不得在同一個 release 中讓舊版 UI 失效**——因為前端（`wallpaper.html`／`wallpaper.js`）與後端（Edge Functions）是分開部署的（前端可能是 GitHub Pages 靜態站台，後端是 Supabase Edge Function），兩者的部署時間點不保證同步；若後端一部署就要求所有請求必須帶 `previewId`，會讓「後端已更新、前端還沒更新」這段期間內的所有使用者無法生成桌布。

### 20.2 Legacy Path 的移除條件（v3 新增，取代 v2「僅標註方向」）

Legacy path（無 `previewId` 的舊版請求）**必須同時滿足以下全部條件**才能移除：

1. **監控事件**：新增一個 Observability 事件 `wallpaper_generate_legacy_path_used`（在 legacy path 被觸發時記錄，包含 `correlationId`／`userId`（遮罩）／`createdAt`，不含任何 Prompt 或 AI 內容），透過既有的 `generationLogger.logWarn()` 機制輸出。
2. **監控窗口**：新版前端上線後，觀察至少 **7 天**（涵蓋完整的一週使用週期，含週末），確認 `wallpaper_generate_legacy_path_used` 事件數量**連續 7 天為 0**（代表所有實際流量都已經是新版前端、都帶著 `previewId`）。
3. **無已知舊版前端快取/CDN 殘留**：確認 GitHub Pages（或其他前端託管）沒有殘留的舊版 `wallpaper.html`／`wallpaper.js` 快取仍在被瀏覽器提供（可透過檢查前端資產的版本號／hash 是否已全面更新確認）。
4. 滿足以上條件後，才建立**獨立的清理任務**（非本次 P2-AI-04 範圍）移除 `wallpaper-generate-handler` 中的 legacy 分支與 `REQUIRED_FIELDS` 中殘留的 `luckyTheme`／`blessing`。

### 20.3 過渡期的 FORBIDDEN_FIELDS 語意

過渡期內，`luckyTheme`／`blessing` 從「必填」改為「**可選且被忽略**」（不列入 `FORBIDDEN_FIELDS`，因為 legacy 前端仍會送出這兩個欄位，若列入 FORBIDDEN 會直接拒絕合法的舊版請求）；但 `story`／`oneLiner`／`shopkeeperMessage`／`source`／`shopkeeperVersion` 這幾個**從未在任何版本的前端出現過**的欄位，仍然可以立即列入 `FORBIDDEN_FIELDS`（不影響舊版前端，因為舊版前端本來就不會送這些欄位）。

---

## 21. Job Retry 真實能力盤點（v3 — 誠實評估，不得誇大）

### 21.1 逐檔查證結果

實際讀取 `job-service.js`／`job-repository.js`／`generation-orchestrator.js` 後確認：

| 問題 | 查證結果 |
|---|---|
| 誰建立 Job、初始狀態？ | `generation-orchestrator.js` 呼叫 `jobService.createJob({userId, status: Pending})`，`job-repository.js` 的 `insertJob()` 寫入 `wallpaper_generation_jobs`，DB 狀態為 `queued` |
| 誰標記 running/success/failed？ | 同一個 `generation-orchestrator.js`，同步呼叫 `markRunning`／`markSuccess`(隱含，見程式碼後段)／`markFailed`，**皆在同一次 HTTP 請求的同步流程內完成**，沒有任何非同步/背景程序參與 |
| 是否存在 retry worker／scheduler？ | **沒有找到任何排程器、佇列 worker、cron job、或背景輪詢機制**。整個程式庫中沒有任何檔案實作「掃描失敗 Job 並重新嘗試」的邏輯 |
| `retry_count`／`attempt_no`／`next_retry_at`／`locked_at`／`locked_by` 是否真的被讀寫？ | **否。** 資料庫 migration（`20260712040000_create_wallpaper_core_tables.sql`）確實定義了這些欄位，但 `job-repository.js` 的 `insertJob()`／`updateJob()` **從未讀取或寫入**這些欄位（`insertJob` 只寫 `wallpaper_id`／`user_id`／`status`／`idempotency_key`；`updateJob` 只寫 `status`／`wallpaper_id`／`last_error`）。這些欄位是**只存在於資料庫 schema、完全未被應用程式碼使用的死欄位** |
| 同一 `jobId` 是否會再次進入 `generation-service`？ | **不會。** 沒有任何程式路徑會針對「已標記 Failed 的既有 jobId」重新呼叫 `generationService.createWallpaperGeneration()`。唯一的入口是 `wallpaper-generate` 這個 HTTP endpoint，每次呼叫都會建立一個**全新的 jobId**（`job-repository.js` 的 `insertJob()` 若未帶入 `idempotencyKey` 會自動產生一個含 `Date.now()`＋隨機字串的新值，保證每次都是新的） |
| 使用者目前能否手動重試？ | 能——但「重試」在現有系統中的真實意義是**「使用者手動再次點擊送出，觸發一個全新的 `wallpaper-generate` 請求」**，等同於一次全新的生成流程（新 jobId、重新查詢每日上限、重新查詢點數），**不是**針對同一個失敗 Job 的重試 |
| 點數與每日額度在「重試」時是否會重複扣除？ | **不會**，但原因並非「有防重複扣除機制」，而是**點數扣除（`deductOnSuccess`）與每日額度記錄（`recordSuccess`）都只在 Image 生成真正成功之後才執行**——失敗的嘗試從一開始就沒有扣過點數／記過額度，所以「重試」（＝新請求）不會造成重複扣除，只會造成「使用者又用掉一次新的每日上限次數配額檢查機會」（但由於失敗不算入 `successCount`，這個新嘗試本身也不會被計入每日已用次數，除非它這次成功了） |

### 21.2 結論分類

**結論：「只有資料模型，尚無執行機制」。**

`wallpaper_generation_jobs` 資料表的 `retry_count`／`next_retry_at`／`attempt_no`／`locked_at`／`locked_by` 欄位從一開始就只是資料庫 schema 的一部分，應用程式碼完全沒有實作任何會讀寫這些欄位的邏輯，也沒有任何背景程序會利用它們執行「自動重試」。**v2 報告第 9.2 節聲稱「沿用既有的 Job 失敗／重試機制」是不準確的——該機制實際上不存在，本次予以修正。**

### 21.3 MVP 失敗策略（v3 修正——不擴張為新的 Retry 子系統）

依任務書指示「不得把它列為 P2-AI-04 已有能力」且「不要擴張成新的 Retry 子系統」，MVP 策略如下：

1. **Consume 成功後、Gemini Image 失敗時**：`consumed_job_id` 已經寫死指向這一次的 `jobId`（第 19 節），`shopkeeper_previews` 該列的狀態維持 `consumed`（**不恢復、不清空**，理由與 v2 相同：避免「同一份已核准內容被允許使用兩次」的語意混亂，也避免被利用來繞過 Session／每日次數上限）。
2. **使用者體感的「重試」＝提交全新請求**：既然現有系統本來就沒有「重試同一個 jobId」的能力，P2-AI-04 也**不新增**這個能力（避免任務書所說的「擴張成新的 Retry 子系統」）。使用者若想再次嘗試，前端導向「返回 `selecting`，重新走一次 Reserve → Generate → Finalize → Confirm」的完整流程——這會消耗一個新的 Preview 額度（Session／每日計數），這是**刻意且誠實的取捨**：現有系統的真實能力就是如此，P2-AI-04 不假裝有更好的重試體驗。
3. **前端錯誤訊息**：Image 生成失敗時，明確告知「這次生成失敗，若要再試一次，請重新選擇並產生新的祝福」，而非「請稍後重試」這種暗示「同一個請求會自動/可以重試」的措辭，避免誤導使用者期待一個系統中不存在的能力。
4. **未來若要真正解決 Job 重試**：應該是一個**獨立於 P2-AI-04 的子任務**（例如「P2-INF-XX Job Retry Worker」），需要設計真正的背景執行機制（排程器／佇列），這超出本次分析範圍，僅在此記錄為明確的技術債與後續建議。

---

## 22. 完整 Response DTO 傳遞鏈（v3 — 逐層追蹤）

### 22.1 現況五層 DTO 逐一列出（讀取程式碼確認，非推測）

| 層級 | 檔案 | 現有欄位 |
|---|---|---|
| ① `wallpaper-generate` submit response | `js/services/wallpaper/response-dto.js`（`createGenerationSuccessDto`） | `generationId, status, provider, model, imageUrl, promptVersion, durationMs, createdAt` |
| ② `wallpaper-status` polling response | `js/services/wallpaper/progress-response-dto.js`（`createStatusSuccessDto`） | `generationId, jobId, status, progressPercent, progressStage, estimatedRemainingSeconds, provider, model, imageUrl, failureCode, failureMessage, createdAt, updatedAt, recommendedPollIntervalMs, terminal` |
| ③ Query Repository（②的資料來源） | `js/services/wallpaper/generation-query-repository.js` | 從 `wallpaper_generations.metadata_json` 中**只取出 `provider`**，其餘 `metadata_json` 內容（含 `shopkeeperSnapshot`）雖然已經 `SELECT` 進記憶體，但**目前完全沒有被抽取到回傳物件中** |
| ④ `wallpaper-result-presenter.js` | `presentSuccess({submitData, statusData})` | `generationId, imageUrl, provider, promptVersion, model, status, createdAt, updatedAt`——**皆是 ①②轉手傳遞，目前沒有任何 Shopkeeper 欄位** |
| ⑤ 前端 `js/pages/wallpaper.js` `showResult(data)` | | 只讀取 `data.imageUrl／provider／model／promptVersion`，**沒有渲染任何文字內容的程式碼**（因為上游從未提供） |

### 22.2 關鍵結構性事實：submit 本身就是同步且終態的

`generation-service.js` 的 `createWallpaperGeneration()` 是**完全同步**完成整條「Shopkeeper → Prompt Builder → Gemini Image → Storage → DB 寫入」流程，也就是說 **①（submit response）在回傳當下，`wallpaper_generations` 列的狀態已經是 `succeeded`（或已經寫入失敗原因）**。前端仍然會呼叫 `wallpaper-status` 進行「輪詢」，但因為資料庫此時已是終態，**輪詢實務上只需要一次請求就會拿到 `terminal: true`**（`wallpaper-status` 是一個防禦性/一致性確認機制，而非真正意義上的「非同步任務輪詢」）。這個事實決定了：Shopkeeper 顯示內容**必須同時**放進 ①（submit response）**和** ②（status response），因為理論上前端可能只依賴其中一個（目前程式碼是①②都會呼叫到，但presenter目前傳入的是 `statusData` 優先、`submitData` 作為備援，見 ④ 的既有邏輯 `statusData?.generationId || submitData?.generationId`），若只加在其中一層，未來重構時容易遺失。

### 22.3 v3 修改設計：在哪裡新增 Shopkeeper 欄位

| 層級 | 修改內容 |
|---|---|
| ① `createGenerationSuccessDto` | 新增 `luckyTheme, blessing, story, oneLiner, shopkeeperMessage`（從 `shopkeeperContext`／已消費的 `context_snapshot` 取得，該物件在 `generation-service.js` 內本來就存在於記憶體中，只是先前沒有透傳到 DTO） |
| ② `createStatusSuccessDto` | 新增同樣 5 個欄位 |
| ③ `generation-query-repository.js` | 從 `row.metadata_json.shopkeeperSnapshot` 中抽取 `luckyTheme／blessing／story／oneLiner／shopkeeperMessage` 五個欄位到回傳物件（**明確排除** `metadata_json.source`／`metadata_json.shopkeeperVersion`，不透傳這兩個欄位——見下方 22.4） |
| ④ `presentSuccess()` | 從 `statusData`（優先）或 `submitData`（備援）透傳這 5 個欄位到最終 DTO，比照現有 `imageUrl`／`provider` 的透傳寫法 |
| ⑤ `js/pages/wallpaper.js` `showResult()` | 新增渲染邏輯：把這 5 個欄位顯示在「祝福卡」區塊（沿用 Preview 階段顯示的同一組 UI 元件／樣式，見第 10 節 UI 狀態機的 `succeeded` 狀態） |

### 22.4 安全與一致性要求逐項確認

- **不回傳 `source`／`shopkeeperVersion`／完整 Prompt／raw AI response**：以上五層修改中，沒有任何一層會透出 `source`（ai/fallback）或 `shopkeeperVersion`——這兩個欄位只存在於 `metadata_json`（DB 層），③ 的抽取邏輯明確只挑選 5 個顯示欄位，不做「整個 `shopkeeperSnapshot` 物件透傳」（避免不小心把 `source`/`version` 也帶出去）。完整 Prompt（`promptSnapshot`）與 raw AI response 从未存在於任何一層 DTO 中（本來就只在 `metadata_json`），維持不變。
- **Preview 階段顯示完整安全文字**：第 8.2 節 Preview Response DTO 本來就包含這 5 個欄位（v2 已定案），不受本次修改影響。
- **生成成功後仍能顯示相同內容**：因為 ①②③④ 四層都從**同一個 `context_snapshot`**（Consume 時取得，即 Preview 階段 Finalize 寫入的那一份，逐字相同）取值，不重新呼叫任何 AI，所以「生成後顯示的內容」與「Preview 階段看到的內容」**保證逐字一致**（WYSIWYG，第 13 節既有驗收標準）。
- **Polling 完成後不能遺失**：因為②③也同步新增了這 5 個欄位，即使前端的邏輯改成「以 `wallpaper-status` 的最終輪詢結果為準」，內容依然存在，不會在 submit→polling 的轉手過程中遺失。
- **前端顯示值必須與 DB Snapshot 一致**：由於全部 5 個欄位都是「原樣讀出、原樣往下傳」（沒有任何一層做二次加工／重新產生），天然保證與 DB `context_snapshot` 一致。

---

## 23. 下載按鈕技術分析（v3 新增）

### 23.1 現況：Storage 是私有 Bucket + 短效 Signed URL

實際讀取 `supabase/migrations/20260712122100_storage_policies_wallpapers.sql` 確認：`wallpapers` bucket 建立時 `public = false`（私有）。`generation-query-repository.js`／`wallpaper-storage-uploader.js` 皆透過 `supabaseClient.storage.from(bucket).createSignedUrl(path, 3600)` **每次查詢時即時產生一支新的、1 小時後過期的 Signed URL**（不是固定不變的公開網址）。這代表：

- 使用者看到的 `<img src="...">` URL 是一個**有時效性**的網址。
- 若使用者把分頁開著超過 1 小時沒有重新整理／重新輪詢，畫面上舊的 `imageUrl` 可能已經過期，此時才點下載會失敗（Storage 回傳 403）。

### 23.2 三種下載技術比較

| 方案 | GitHub Pages／localhost 跨網域 | 手機瀏覽器（含 iOS Safari） | CORS 需求 | 額外基礎設施 |
|---|---|---|---|---|
| **`<a href="signedUrl" download>`** | ❌ 不可靠——`download` 屬性對「跨網域」連結在多數瀏覽器（尤其 Safari）**不會**強制下載，通常只是開啟/導向該資源 | ❌ 同樣不可靠，iOS Safari 更嚴格 | 不需要（直接導覽，非 fetch） | 無 |
| **`fetch(signedUrl) → Blob → URL.createObjectURL() → <a download> click() → revokeObjectURL()`（**推薦**） | ✅ 可行——一旦轉成 `blob:` URL，對頁面而言視為同源，`download` 屬性可靠生效 | ✅ 現代 iOS/Android Safari／Chrome 皆支援；極舊版 iOS Safari 可能改為開啟新分頁而非直接下載（此時使用者可長按圖片手動儲存，屬可接受的降級） | 需要 Storage 端允許跨網域 `GET`（Supabase Storage 物件讀取預設允許跨網域，屬標準行為） | 無新增 Edge Function |
| **專用 download Edge Function（伺服器端代理＋`Content-Disposition: attachment`）** | ✅ 最可靠（伺服器端設定的 Header 瀏覽器一定遵守） | ✅ 最可靠 | 無 CORS 疑慮（可讓瀏覽器直接對 Edge Function 網域請求） | 需要新增一支 Edge Function，需重新驗證擁有權，需要串流轉發 Storage 內容，複雜度較高 |

**推薦：方案二（fetch→Blob→object URL）**，理由：在不新增 Edge Function 的前提下，已能可靠涵蓋 GitHub Pages／localhost／主流行動瀏覽器；專用 Edge Function 方案雖然最穩，但屬於「為了解決一個已經有更簡單方案的問題而新增基礎設施」，不符合精簡原則。

### 23.3 需要處理的細節

- **CORS**：`fetch(signedUrl, { mode: 'cors' })`；若 Supabase 專案的 Storage CORS 設定有例外限制，需在 Implementation 階段以實際簽名 URL 測試確認（本報告基於 Supabase Storage 標準預設行為推論，**建議在 Phase 5 落地時以真實環境驗證**，見 implementation-plan 第 5 階段）。
- **Signed URL 過期**：下載前先呼叫既有的 `wallpaper-status` 取得**最新**的 signed URL（不快取舊的），若 `fetch` 回傳 403／410，提示使用者「圖片網址已過期，正在重新整理...」並自動重新查詢一次最新網址再重試一次；若仍失敗，顯示「下載失敗，請重新整理頁面後再試」，不無限重試。
- **檔名**：`claw-lucky-{generationId的前8碼}-{yyyyMMdd}.png`，避免多次生成互相覆蓋，也不把完整 `generationId`（UUID）暴露在檔名中造成不必要的長檔名。
- **Object URL 記憶體釋放**：下載觸發後，於 `click()` 完成的下一個事件循環（例如 `setTimeout(() => URL.revokeObjectURL(objectUrl), 0)` 或監聽下載完成後）呼叫 `URL.revokeObjectURL()`，避免分頁存活期間累積未釋放的 Blob 記憶體。
- **下載失敗訊息**：明確區分「網址過期（可重試）」與「網路錯誤（可重試）」與「瀏覽器不支援（建議長按圖片另存）」三種訊息，不使用單一籠統的「下載失敗」。
- **不把 signed URL token 寫入 logs**：Signed URL 本身包含簽章 token 於 query string；下載流程若有任何錯誤記錄（例如 `generationLogger.logWarn` 或 `console.error`），一律只記錄「下載失敗」「HTTP 狀態碼」等中繼資訊，**絕不**把完整 URL 字串（含 token）寫入任何日誌輸出——比照現有 `wallpaper-storage-uploader.js` 對敏感資訊的處理慣例（現有程式碼從不記錄 signed URL 本身，只記錄 `failureCode`/`retryable`）。

---

## 特別回答

**Q1：如何做到「先看祝福、可以重抽、最後才生成圖片」？**
新增獨立輕量的 `shopkeeper-preview` Edge Function，只呼叫 Shopkeeper Context Agent（Text-only）＋寫入 `shopkeeper_previews`，不觸發 Image 生成／Storage／DB 寫入既有 `wallpaper_generations`／點數扣除；使用者確認後才呼叫（修改後的）`wallpaper-generate`，並帶入 Preview 階段取得的 `previewId`，由後端原子消費取得已核准的 Context。

**Q2：如何保證使用者無法竄改 AI 產生的祝福？**
前端從未持有可回灌的內容編碼，只持有一個不透明的資料庫 UUID（`previewId`）。Confirm 階段以原子 `UPDATE...WHERE...RETURNING` 從資料庫查詢並鎖定該 Preview 的 `context_snapshot`，**永遠不接受**客戶端直接傳入的 `luckyTheme`／`blessing`／`story` 等欄位（明確列入 `FORBIDDEN_FIELDS`，違反則直接拒絕請求）。

**Q3：Preview 是否需要暫存於資料庫？**
**需要（v2 修正 v1 的結論，v3 進一步補上完整狀態機與並發安全設計）。** 一次性消費、Session 內立即失效、每日／每 Session 次數上限，三者皆屬跨請求的伺服器端狀態，stateless 設計無法可靠達成，詳見第 0 節、第 16 節（reserve/generate/finalize 三階段）與第 17 節（advisory lock 並發安全證明）。

**Q4：重抽應限制幾次？**
每個 Preview Session 最多 3 次（首次 1 次＋最多再抽 2 次，`sequence_no` 0～2），每位使用者每日最多 20 次（Product Decision #5/#6，已定案），皆由第 17 節的 advisory lock 機制保證並發下仍然精確不超額。

**Q5：是否需要獨立 Edge Function？**
需要——`shopkeeper-preview`（Product Decision #1，已定案）。

**Q6：如何避免每次選項變動都自動花 Gemini 額度？**
Preview 呼叫**只能由使用者明確點擊「產生今日祝福」按鈕觸發**，選擇吉祥物／Gift／Style 的下拉或卡片點擊本身**絕不**自動觸發任何後端呼叫；並搭配 loading 期間按鈕 disable（防連點）與 Session／每日次數上限（第 10.1 節）。

---

# 最終輸出

## Analysis 摘要（v3）

v2 提出「獨立 `shopkeeper-preview` Edge Function ＋ DB-backed `shopkeeper_previews`」取代 v1 的 stateless token 設計，但 Product Review 發現 v2 仍有四個未解決的正確性問題：(1) 並發安全（`SELECT count + FOR UPDATE` 無法防止全新 Session 並發超額）、(2) 額度預約時機（沒有明確拆出「先佔位、再產生內容」）、(3) Finalize 冪等與失敗處理未定義、(4) Consume 設計誤用一個 Consume 當下尚不存在的 `generationId` 作為輸入。v3 逐一修正：三階段 Reserve/Generate/Finalize 流程、`pg_advisory_xact_lock` 並發安全設計（附三情境證明）、明確 `status` 狀態機＋CHECK constraints、以既有 `jobId` 為冪等鍵的原子 Consume RPC。另外誠實盤點「Job Retry」的真實能力（結論：只有資料模型，尚無執行機制）、修正過渡期部署策略（明確 legacy path 移除條件與監控事件）、完整追蹤五層 Response DTO 傳遞鏈、以及下載按鈕的技術方案。

## 修訂後推薦架構

獨立 `shopkeeper-preview` Edge Function（Reserve／Finalize／Reroll）＋ DB-backed `shopkeeper_previews` 表（狀態機見第 18 節）；`wallpaper-generate` 的 Confirm 路徑修改為接受 `previewId`，以 `jobId` 為冪等鍵的原子 Consume RPC（第 19 節）消費後直接沿用既有 Prompt Builder／Image Provider／Storage／點數／次數扣除邏輯。**此為破壞性 API 變更，過渡期採雙路徑並存（第 20 節），有明確的 legacy path 移除條件，不會在同一 release 讓舊版 UI 失效。**

## 並發安全證據

第 17 節以 `pg_advisory_xact_lock`（MD5 衍生鍵值，不依賴 PostgreSQL 內建 hash 穩定性假設）取代 v2 的 `FOR UPDATE`，逐一證明三個情境（daily count=19 兩個新 Session 並發／session count=2 兩個重抽並發／同一 request 網路重送兩次）皆不會超額，並比較過獨立 quota counter table 方案（結論：不採用，複雜度增加但無實質效能收益）。

## Reserve／Finalize／Consume 狀態模型

第 18 節：`status` 欄位（`pending`／`ready`／`failed`／`consumed`／`invalidated`）＋完整合法轉移圖＋CHECK constraints，取代 v2 單靠時間戳記推論狀態的隱含設計。第 16 節定義 Reserve（額度檢查＋佔位，不呼叫 Gemini）→ Generate（呼叫 Shopkeeper Agent，本身不失敗）→ Finalize（落地內容＋失效化同 Session 舊 Preview＋冪等處理＋系統性失敗策略）三階段順序，確保「額度耗用」發生在「呼叫 Gemini」之前。

## Job Retry 真實能力

第 21 節逐檔查證結論：**只有資料模型，尚無執行機制**——`retry_count`／`next_retry_at`／`attempt_no`／`locked_at`／`locked_by` 欄位存在於 schema 但從未被 `job-repository.js` 讀寫，也沒有任何排程器／worker。v2 report 第 9.2 節「沿用既有 Job 重試機制」的敘述已被本次修正。MVP 策略：Consume 成功後 Image 失敗，Preview 維持 `consumed`（不恢復），使用者體感的「重試」＝提交全新請求（消耗新的 Preview 額度），不擴張為新的 Retry 子系統。

## 過渡部署策略

第 20 節：雙路徑並存（有 `previewId` 走新路徑，無則走 legacy path，`luckyTheme`/`blessing` 過渡期內仍被忽略但不再必填）；legacy path 移除需同時滿足：新增 `wallpaper_generate_legacy_path_used` 監控事件、新版前端上線後連續 7 天監測到 0 次觸發、確認無舊版前端快取殘留，三者皆滿足才建立獨立清理任務。

## DTO 傳遞鏈

第 22 節逐層列出現況五層 DTO（submit／status／query-repository／presenter／前端渲染）的現有欄位，確認目前全部五層都沒有 Shopkeeper 顯示欄位，並設計新增位置（含明確排除 `source`／`shopkeeperVersion`／完整 Prompt／raw AI response，避免洩漏）。

## Download 方案

第 23 節：`wallpapers` bucket 為私有＋1小時短效 Signed URL（已從程式碼確認）；比較 `<a download>`（跨網域不可靠）／fetch→Blob→object URL（**推薦**，涵蓋 GitHub Pages／localhost／主流行動瀏覽器，無需新增 Edge Function）／專用 download Edge Function（最可靠但增加基礎設施）三種方案，並定義過期重試、檔名、object URL 釋放、失敗訊息分類、不記錄 signed URL token 等細節。

## Migration／RLS／RPC 清單（v3 更新）

- **Migration（草案，見第 18 節）**：`shopkeeper_previews` 表（`status` 狀態欄位＋`consumed_job_id`＋`failure_code` 等 v3 新增欄位）＋索引＋RLS（沿用 v2 第 6.3 節「對 authenticated 完全不開放」設計）＋CHECK constraints。
- **RPC**：Reserve／Finalize 相關操作＋`consume_shopkeeper_preview`（第 19.3 節，`SECURITY DEFINER`，僅授權 `service_role`，`SELECT...FOR UPDATE` 保證同一 `previewId` 並發 Confirm 只有一次成功）。
- **不修改既有表結構**（`wallpaper_generations`／`wallpaper_generation_jobs`／`daily_generation_usage` 皆不變）。

## 修改檔案預估清單／測試清單

見第 11 節（v2 基準，v3 新增檔案與測試項目已併入 [P2-AI-04-implementation-plan.md](./P2-AI-04-implementation-plan.md) 各階段的「修改檔案」與「測試」欄位，含 Job Retry 誠實標註、DTO 五層修改、下載按鈕測試）。

## 是否 READY FOR IMPLEMENTATION

**✅ READY FOR IMPLEMENTATION PLANNING。** v2 遺留的四個正確性問題（並發安全／額度預約時機／Finalize 冪等／Consume 前置條件）與 Gift 兌換語意問題（Product Decision #16）皆已在 v3 解決或定案。詳細落地步驟見新增的 [P2-AI-04-implementation-plan.md](./P2-AI-04-implementation-plan.md)（7 階段，每階段附修改檔案／測試／Gate／回滾方式／是否觸碰已部署 Function／前後相容性）。

## 尚存阻擋問題

1. **`consume_shopkeeper_preview` RPC 內對外錯誤碼收斂的實際前端文案**：第 19.4 節已定義 `PREVIEW_UNAVAILABLE`／`PREVIEW_EXPIRED`／`PREVIEW_ALREADY_CONSUMED` 三類，但具體使用者可讀文案仍待 UI 文案撰寫階段確認。
2. **Storage CORS 實際行為**：第 23.3 節的下載方案基於 Supabase Storage 標準預設行為推論，建議在 Implementation Phase 5 以真實簽名 URL 測試確認，而非只靠文件推論。
3. **RPC 執行角色授權**：`GRANT EXECUTE ... TO service_role` 中的角色名稱需在實際 migration 撰寫時對照專案實際角色設定二次確認。
4. **`client_request_id` 冪等加強欄位是否採用**（第 17.4 節「可選加強」）：需 Product Owner 決定是否值得為「避免網路重送浪費一次額度」這個次要體驗問題新增一個欄位與唯一索引，非阻擋項，但建議在 Phase 1 一併決定，避免日後再改 schema。

---

**完成，停止於此，等待 Product Review。未修改任何功能檔案、未 commit、未 push、未 deploy。**
