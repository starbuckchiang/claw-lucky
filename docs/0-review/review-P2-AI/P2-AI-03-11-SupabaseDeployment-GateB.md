# P2-AI-03 Supabase Deployment Gate B — Shopkeeper Runtime Configuration + wallpaper-generate Deployment

**目標 Git commit**：`c41178443b05c1e2a6701da3f2591ac3808e8184`

**本次執行內容**：唯讀部署前檢查 → 設定 `SHOPKEEPER_*` secrets → 部署 `wallpaper-generate` → 唯讀部署後驗證。**未執行 db push、未修改程式碼、未 commit/push、未修改 GEMINI_API_KEY、未部署 wallpaper-status 或其他 Function、未執行真實桌布生成、未修改資料庫資料（僅唯讀查詢）。**

---

## 一、Git 與資料庫確認

| 檢查 | 結果 |
|---|---|
| `git rev-parse HEAD` | `c41178443b05c1e2a6701da3f2591ac3808e8184` |
| `git rev-parse origin/main` | `c41178443b05c1e2a6701da3f2591ac3808e8184` |
| 兩者是否等於目標 commit | ✅ 是 |
| `supabase db push --dry-run` | `Remote database is up to date.` ✅ |
| `daily_lucky_context` row count | **1** ✅ |
| `is_active` | `true` ✅ |
| `version` | `shopkeeper-context-v1` ✅ |

（未輸出完整 template 內容。）

---

## 二、JWT 部署模式判斷與證據

| 證據來源 | 發現 |
|---|---|
| `git log --all -p` 全歷史搜尋 `no-verify-jwt`／`verify_jwt` | **0 筆結果**——整個 git 歷史中從未出現過 `--no-verify-jwt` |
| 全 repo 檔案搜尋（docs／scripts／設定檔） | 唯一出現 `--no-verify-jwt` 字樣的檔案是**這次任務本身的 prompt 檔**（`prompts-P2-AI-03-11.md`），其餘檔案（含所有部署文件、scripts）**完全沒有**提及此旗標 |
| **`supabase functions list`（部署前，最直接證據）** | `wallpaper-generate` 目前設定 **`"verify_jwt": true`**（`wallpaper-status` 也是 `true`） |
| 前端 `js/pages/wallpaper.js` | 明確從 `window.supabaseClient.auth.getSession()` 取出 `access_token`，並 `headers.set("Authorization", "Bearer ${accessToken}")` 後才呼叫 API——架構設計上**依賴**送出有效 Supabase JWT |
| Edge Function `supabase-clients.ts`（`resolveAuthenticatedUserId`） | 從 `Authorization` header 解析 Bearer token，透過 `anonClient.auth.getUser(token)` 解析使用者身份——此為「Gateway 驗證 JWT 有效性 + Function 自行解析使用者身份」的標準模式，與 `verify_jwt=true`（預設）完全一致，並非 `--no-verify-jwt` 場景下才需要的自訂驗證邏輯 |

### 判定

依規則 1：**證據明確要求預設 JWT verification**（現行部署設定 `verify_jwt:true`、前端明確送出 Bearer token、歷史紀錄中從未使用過 `--no-verify-jwt`）。

**→ 部署時不加入 `--no-verify-jwt`，沿用預設（enabled）JWT verification。**

---

## 三、Runtime Configuration 設定

**設定前** `supabase secrets list`（僅列出名稱是否存在，下方僅列相關 4 項）：

| Secret 名稱 | 設定前是否存在 |
|---|---|
| `GEMINI_API_KEY` | ✅ 存在 |
| `SHOPKEEPER_MODEL` | ❌ 不存在 |
| `SHOPKEEPER_TIMEOUT_MS` | ❌ 不存在 |
| `SHOPKEEPER_MAX_RETRY` | ❌ 不存在 |

**執行**：
```
supabase secrets set SHOPKEEPER_MODEL=gemini-2.5-flash SHOPKEEPER_TIMEOUT_MS=20000 SHOPKEEPER_MAX_RETRY=0
```
結果：`{"count":3,"message":"Finished supabase secrets set."}` ✅ 成功。**未觸碰 `GEMINI_API_KEY`。**

**設定後** `supabase secrets list`（僅列名稱與時間戳，不含 value）：

| Secret 名稱 | 是否存在 | updated_at |
|---|---|---|
| `GEMINI_API_KEY` | ✅ 存在 | `2026-07-20T07:45:26Z`（**未變動**，確認沒有被重新設定） |
| `SHOPKEEPER_MODEL` | ✅ 存在 | `2026-07-27T07:00:27Z`（新設定） |
| `SHOPKEEPER_TIMEOUT_MS` | ✅ 存在 | `2026-07-27T07:00:27Z`（新設定） |
| `SHOPKEEPER_MAX_RETRY` | ✅ 存在 | `2026-07-27T07:00:27Z`（新設定） |

全部 4 個名稱確認存在，設定全部成功。

---

## 四、部署 Function

### ⚠️ 部署前版本確認出現差異（已排查原因）

部署前預期 `wallpaper-generate` 應為 **version 26**，但實際查詢 `supabase functions list` 顯示 **version 27**（`wallpaper-status` 也從先前查到的 13 變成 14）。

**排查**：`entrypoint_path` 仍顯示 `..._26/source/...`（代表實際程式碼構件未變），且此版號跳動的時間點與本節「設定 secrets」動作幾乎同時——**判定為 `supabase secrets set` 造成的中繼資料版本號遞增（並非程式碼被重新部署，也不是有其他部署同時在進行）**。由於程式碼構件本身未變、也沒有第三方部署跡象，判定可安全繼續。

### 部署指令（已遮蔽敏感資訊——本指令本身不含任何 secret）

```
supabase functions deploy wallpaper-generate
```

（未加入 `--no-verify-jwt`，未加入 `--prune`，只指定 `wallpaper-generate` 一個 Function 名稱。）

### 部署結果

```json
{"project_ref":"umtqpstacjdwxcvcirbl","functions":["wallpaper-generate"],"dashboard_url":"...","message":"Deployed Functions."}
```

✅ **成功**。上傳的檔案清單中包含全部 P2-AI-02/P2-AI-03 必要模組（`shopkeeper-context-agent.ts`、`shopkeeper-context-validator.ts`、`shopkeeper-fallback-context.ts`、`gemini-text-provider.ts`、`prompt-context-resolver.ts`、`prompt-validator.ts`、`prompt-snapshot.ts`、`wallpaper-prompt-builder.ts`、`mascot-repository.ts`、`gift-repository.ts`、`fallback-templates.ts`、`generation-service.ts`、`generation-repository.ts` 等），只有 `wallpaper-generate` 被部署，**未觸及 `wallpaper-status`**。

---

## 五、部署後唯讀驗證

| 檢查 | 部署前 | 部署後 | 結果 |
|---|---|---|---|
| `wallpaper-generate` status | ACTIVE | ACTIVE | ✅ |
| `wallpaper-generate` version | 27 | **28** | ✅ 高於部署前 |
| `wallpaper-generate` updated_at | 2026-07-27T07:00:xx（secrets 設定造成） | **2026-07-27T07:02:00.430Z** | ✅ 晚於部署前 |
| `wallpaper-generate` entrypoint_path | `..._27/...` | `..._28/...` | ✅ 程式碼構件確實更新 |
| `wallpaper-generate` ezbr_sha256 | `b5b1e7bd...`（部署前一直是這個值） | `bf1126a9...`（**已變更**） | ✅ 確認程式碼內容真的不同了 |
| `wallpaper-status` version | 14 | **14（不變）** | ✅ 確認未被部署 |
| `wallpaper-status` updated_at / sha256 | 不變 | **完全不變** | ✅ 確認未被觸碰 |
| `supabase db push --dry-run` | — | `Remote database is up to date.` | ✅ 無 pending migration |
| `daily_lucky_context` row count | 1 | **1（不變）** | ✅ |
| `daily_lucky_context` is_active | true | **true（不變）** | ✅ |
| Git 工作區未提交檔案 | （見下方） | **完全一致，無新增刪除** | ✅ |

**本次 Gate 未執行任何真實桌布生成請求**（真實 Gemini／Snapshot／UI 流程留待 Gate C）。

---

## 最終輸出

| 項目 | 結果 |
|---|---|
| Git commit 驗證 | ✅ HEAD 與 origin/main 皆為 `c411784` |
| JWT deployment mode 與判斷證據 | **預設（enabled）**——現行 `verify_jwt:true`、前端明確送出 Bearer token、歷史從未使用 `--no-verify-jwt`，因此部署時**未加入** `--no-verify-jwt` |
| Runtime configuration 名稱存在性 | `GEMINI_API_KEY`／`SHOPKEEPER_MODEL`／`SHOPKEEPER_TIMEOUT_MS`／`SHOPKEEPER_MAX_RETRY` 4 項皆存在；`GEMINI_API_KEY` 確認未被改動 |
| 部署前 Function version | 27（非任務假設的 26——已排查為 secrets 設定造成的中繼資料版本遞增，非程式碼變更或第三方部署） |
| Deployment command | `supabase functions deploy wallpaper-generate`（無 `--no-verify-jwt`，無 `--prune`） |
| 部署結果 | ✅ 成功，僅 `wallpaper-generate` 被部署 |
| 部署後 Function version/status/updated_at | version 28／ACTIVE／2026-07-27T07:02:00.430Z（晚於部署前，且 sha256 已變更確認為新程式碼） |
| `wallpaper-status` 是否未改變 | ✅ 完全未變（version 14、updated_at、sha256 皆不變） |
| **Gate B** | 🟢 **PASS** |
| 是否可進入 Gate C：Post-deployment Verification | ✅ 可以 |

**完成，停止於此。未執行真實生成請求。**
