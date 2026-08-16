# P2-AI-03 Gate C — Post-deployment Verification

**測試開始時間**：`2026-07-27T07:10:56.402Z`

本次使用 Playwright MCP 操作已登入的既有 Supabase 使用者 Session，執行**一次**真實桌布生成請求。**未建立/修改帳號、未繞過 Turnstile、未使用 service_role 冒充使用者、未修改資料庫資料、未修改 secrets、未 db push/functions deploy、未修改程式碼、未 commit/push、失敗後未自動重試。** 報告中不含 secrets、JWT、完整 Prompt、完整 AI 回應或個資。

---

## 一、部署狀態確認（唯讀）

| 檢查項目 | 結果 |
|---|---|
| `wallpaper-generate` status | `ACTIVE` ✅ |
| `wallpaper-generate` version | `28` ✅ |
| `wallpaper-generate` verify_jwt | `true` ✅ |
| `wallpaper-status` 是否被重新部署 | 否，version 仍為 `14`（與 Gate B 部署後一致）✅ |
| `daily_lucky_context` row count | `1` ✅ |
| `daily_lucky_context` version | `shopkeeper-context-v1` ✅ |
| `GEMINI_API_KEY` 名稱存在 | ✅ |
| `SHOPKEEPER_MODEL` 名稱存在 | ✅ |
| `SHOPKEEPER_TIMEOUT_MS` 名稱存在 | ✅ |
| `SHOPKEEPER_MAX_RETRY` 名稱存在 | ✅ |

全部條件符合，繼續執行。

---

## 二、瀏覽器與登入狀態

- 開啟 `http://localhost:5500/wallpaper.html` 成功。
- **瀏覽器已有有效 Supabase Session**（「我的吉祥物」／「可使用 Gift」皆正常顯示筆數，非因未登入卡在「載入中...」）——**未觸發手動登入流程，也未遇到 Cloudflare Turnstile**（Turnstile 只出現在登入頁，本次會話已處於登入狀態）。
- 未輸出 access token、refresh token 或完整 user UUID。

---

## 三、測試資料確認

| 項目 | 顯示名稱 | 數量 |
|---|---|---|
| 吉祥物 | 福屁柯基（稀有度 R）、星砂海豹（稀有度 SR） | 2 筆 |
| Gift | 幸運乒乓守護吊飾（Gift ID：gift001）、Kuromi（Gift ID：gift002） | 2 筆 |

✅ 至少 1 吉祥物、至少 1 已兌換 Gift，條件符合。**未新增、兌換或修改任何測試資料。**

（觀察到 Kuromi 的預覽圖片指向占位網域 `https://your-domain/images/kuromi.png`，導致圖片載入失敗——這是既有測試資料本身的問題，與本次驗證無關，因此測試改選「福屁柯基」＋「幸運乒乓守護吊飾」。）

---

## 四、真實生成執行紀錄

| 項目 | 內容 |
|---|---|
| 選擇 | 福屁柯基 ＋ 幸運乒乓守護吊飾 |
| 風格 | Retro |
| 送出次數 | **1 次**（未重試） |
| Request HTTP status | **200** |
| correlationId | `caefa281-2073-4bb8-96e9-2128f7f33036` |
| generationId（已遮蔽部分字元） | `c4533f94-****-****-****-****4efe59` |
| 前端狀態變化 | `idle` → `succeeded`（生成完成，輪詢建議變為 `terminal`） |
| durationMs | 7001 |
| Console error | 3 筆，皆為**既有、與本次生成無關**的錯誤（`favicon.ico` 404、Kuromi 占位圖片載入失敗 ×2）；**生成流程本身沒有產生任何新的 console 錯誤** |
| Network error | 無（`POST /functions/v1/wallpaper-generate` 回應 200） |

**未發生 Gemini quota／rate limit／timeout／Provider failure**，因此不適用「PROVIDER BLOCKED／FALLBACK VERIFIED」分類——**本次為直接成功**。

---

## 五、後端驗證（唯讀，僅回報布林/名稱，不輸出完整內容）

依 `generationId = c4533f94-f1fc-484c-a62e-97e5c34efe59` 查詢 `wallpaper_generations`：

| 檢查項目 | 結果 |
|---|---|
| 對應紀錄筆數 | **1** ✅（僅一筆） |
| generation status | `succeeded` ✅ |
| `metadata_json` 包含 `shopkeeperSnapshot` | ✅ present |
| `metadata_json` 包含 `shopkeeperVersion` | ✅ present |
| `metadata_json` 包含 `source` | ✅ present |
| `metadata_json` 包含 `promptSnapshot` | ✅ present |
| `metadata_json` 包含 `contextVersion` | ✅ present |
| `metadata_json` 包含 `builderVersion` | ✅ present |
| `shopkeeperSnapshot.luckyTheme` | ✅ non-empty |
| `shopkeeperSnapshot.blessing` | ✅ non-empty |
| `shopkeeperSnapshot.story` | ✅ non-empty |
| `shopkeeperSnapshot.oneLiner` | ✅ non-empty |
| `shopkeeperSnapshot.shopkeeperMessage` | ✅ non-empty |
| `shopkeeperSnapshot.version` | ✅ non-empty |
| `shopkeeperVersion` 數值 | **`shopkeeper-context-v1`** ✅ |
| `source` 數值 | **`ai`** 🎉 |

**這是最理想的結果：`source = "ai"`，代表這次是「真實 Gemini 呼叫成功產出符合 schema 的 JSON」，而不是退回 Fallback。這證實了 Gate Review 中修正的 `daily_lucky_context` 模板，在正式環境的真實 AI 呼叫中確實有效。**

（未輸出任何完整文字內容，僅回報布林值與版本/來源字串。）

---

## 六、Observability 驗證

嘗試透過 Supabase CLI 讀取此次 correlationId 對應的 Function logs：

```
supabase functions --help
```

**結果：此版本 CLI 的 `functions` 子指令僅有 `list／delete／download／deploy／new／serve`，沒有任何 `logs` 或等效指令可讀取 Edge Function 執行期日誌。**

依指示：**若 CLI 無法讀取 logs，標記 MANUAL LOG CHECK，不得因此假裝通過。**

**→ 當下已標記為 MANUAL LOG CHECK**，並請你於 Supabase Dashboard → Edge Functions → wallpaper-generate → Logs 人工搜尋 correlationId `caefa281-2073-4bb8-96e9-2128f7f33036` 補充確認。

### ✅ 人工確認結果（已由你於 Dashboard 完成檢查並回覆）

| 確認項目 | 結果 |
|---|---|
| `shopkeeper_context_agent_started` | ✅ 有 |
| `shopkeeper_context_agent_succeeded` | ✅ 有 |
| `generation_service_succeeded` | ✅ 有 |
| correlationId 全程一致 | ✅ 是 |
| 是否出現 fallback（`shopkeeper_context_agent_fallback_used` 等） | ✅ 否，沒有出現 fallback |
| 是否發現敏感資料外洩（API Key／JWT／完整 Prompt／原始 AI Response） | ✅ 否，沒有發現外洩 |

**Observability 驗證全數通過**，與第五節資料庫查詢的 `source=ai` 結果完全吻合，MANUAL LOG CHECK 項目已補齊完成。

---

## 七、前端結果驗證

生成成功，逐項確認：

| 檢查 | 結果 |
|---|---|
| 結果圖片可以載入 | ✅（`<img alt="Lucky Wallpaper 生成結果">` 已渲染） |
| 圖片 URL 不為空 | ✅（回傳簽章 URL，非空；本報告不完整列出簽章 token） |
| 下載按鈕可見 | ⚠️ 此頁面目前的實作**沒有獨立的「下載」按鈕**——只顯示圖片本身（供使用者自行右鍵儲存）。這是既有 UI 設計，非本次部署造成的缺陷，故不視為失敗項 |
| 未實際下載圖片 | ✅ 確認未執行下載動作 |
| Console 沒有未處理錯誤 | ✅ 生成流程本身沒有產生新的 console 錯誤（僅既有、無關的 3 筆） |

截圖存於 [review/P2-AI-03-12-GateC-result.png](P2-AI-03-12-GateC-result.png)。

---

## Provider 問題

**無。** 本次真實生成一次成功，未觸發 quota／rate limit／timeout／Provider failure，因此不適用 PROVIDER BLOCKED 或 FALLBACK VERIFIED 分類。

---

## 最終輸出

| 項目 | 結果 |
|---|---|
| 登入／測試資料狀態 | 已登入（既有 Session），吉祥物 2 筆、Gift 2 筆，條件符合 |
| HTTP 與生成結果 | HTTP 200，`status: succeeded` |
| **source** | **`ai`** |
| Snapshot 欄位驗證 | 6 個必要欄位全部 present + non-empty；`shopkeeperVersion = shopkeeper-context-v1` |
| correlationId 追蹤結果 | `caefa281-2073-4bb8-96e9-2128f7f33036`——✅ 已由你於 Dashboard 人工確認全程一致，`shopkeeper_context_agent_started`／`shopkeeper_context_agent_succeeded`／`generation_service_succeeded` 皆存在，無 fallback，無敏感資料外洩 |
| 前端結果 | 圖片正常顯示、無新增 console 錯誤、無永久 loading；無獨立下載按鈕（既有 UI 設計，已記錄為後續待辦，非本次缺陷） |
| Provider 問題 | 無 |
| **Gate C** | 🟢 **完整 PASS**（`source=ai`、Snapshot 完整落地、correlationId 全程一致且已人工確認、Observability 事件序列完整、無 fallback、無敏感資料外洩、前端結果正常） |

## 後續 UI／資料待辦（記錄用，本次 P2-AI-03 範圍不修改）

1. 增加正式的桌布下載按鈕（目前僅顯示圖片，無獨立下載按鈕）。
2. 修正 Kuromi 占位圖片網址（目前指向 `https://your-domain/images/kuromi.png`，載入失敗）。

## 下一步建議

1. ✅ Observability 已由你人工確認完成，MANUAL LOG CHECK 項目已補齊，無需再追蹤。
2. P2-AI-02/P2-AI-03 的完整部署鏈（migration → secrets → function deploy → 真實生成驗證 → Observability 人工確認）至此已全數驗證通過，本次 release 正式上線完成。
3. 若要長期監控，建議未來排程多跑幾次真實生成，觀察 `source=ai` 的穩定命中率（目前樣本數僅 1 次成功，不能代表長期穩定性）。
4. 上述 2 項 UI／資料待辦已記錄，留待未來獨立任務處理，本次不修改。

**完成，停止於此。未 commit、未 push、未 deploy、未重試生成、未修改功能程式碼。**
