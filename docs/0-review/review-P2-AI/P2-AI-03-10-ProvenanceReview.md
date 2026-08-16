# P2-AI-03 Deployment Provenance Review

**方法**：全程唯讀調查。**未修改任何檔案、未 commit、未 push、未 db push、未 functions deploy、未設定 secrets、未重新執行任何 workflow、未修改任何遠端資料。**

---

## 一、GitHub 自動部署設定檢查

| 檢查項目 | 結果 |
|---|---|
| `.github/workflows/**` | **不存在**（`.github/` 目錄僅含 `agents/`、`prompts/` 兩個子目錄，皆為 GitHub Copilot 自訂 Agent／Prompt 設定檔，與 CI/CD 無關；經 `file_search` 對 `**/*.yml`／`**/*.yaml` 全庫搜尋，也沒有任何 GitHub Actions workflow 檔案） |
| `supabase/config.toml` | **不存在**（整個 repo 中找不到此檔案） |
| `package.json` | 只有一個佔位用的 `"test"` script，**沒有**任何 `deploy`／`db:push`／`postinstall`／`prepush` 等自動化 hook |
| 其他 deployment scripts | 找到 `把程式推到 GitHub.txt`——這是一份**給人看的手動操作筆記**（`git add`／`git commit`／`git push` 的手動步驟提示），內容純粹是 Git 操作教學，**完全沒有提到 Supabase、migration 或 db push**，與資料庫部署無關 |

**結論：這個 repository 內完全沒有任何 CI/CD 設定（無 GitHub Actions workflow、無 Supabase config.toml、無 npm deploy script）。單純的 `git push` 技術上不可能觸發 `supabase db push` 或 `supabase functions deploy`。**

### `gh` CLI 檢查

`gh` 指令在此環境中**未安裝**（`Get-Command gh` 找不到）。因此無法執行 `gh run list`／`gh run view`。但由於已確認 repo 內**零個** workflow 檔案存在，即使 `gh` 可用，`gh run list` 也必然回報零筆 Actions 執行紀錄——這點不影響本次調查結論。

---

## 二、Edge Function 現況（唯讀 `supabase functions list`）

| 欄位 | `wallpaper-generate` | `wallpaper-status` |
|---|---|---|
| status | `ACTIVE` | `ACTIVE` |
| version | `26` | `13` |
| created_at | 2026-07-17T08:40:08 UTC | — |
| **updated_at** | **2026-07-20T09:41:49 UTC** | 2026-07-17T10:54:46 UTC |

**關鍵發現：`wallpaper-generate` 最後更新時間是 2026-07-20T09:41:49 UTC——比這次 commit（`c411784`，2026-07-27T06:12:19 UTC）早了將近 7 天，也早於 migration row 的建立時間（2026-07-27T06:33:41 UTC）。**

**這證明：`wallpaper-generate` Function 完全沒有被重新部署過，目前執行的仍是舊版程式碼（version 26，7 天前的版本），P2-AI-02／P2-AI-03 的新程式碼尚未上線。** Migration 被套用，不代表 Function 也被部署——兩者確認是分開的事件。

---

## 三、Secrets 狀態（唯讀 `supabase secrets list`，僅回報名稱是否存在）

| Secret 名稱 | 是否存在 | 最後更新時間 |
|---|---|---|
| `GEMINI_API_KEY` | ✅ 存在 | 2026-07-20T07:45:26 UTC |
| `SHOPKEEPER_MODEL` | ❌ **不存在** | — |
| `SHOPKEEPER_TIMEOUT_MS` | ❌ **不存在** | — |
| `SHOPKEEPER_MAX_RETRY` | ❌ **不存在** | — |

（僅回報名稱存在性，未輸出任何 value。）

3 個 Shopkeeper 專用 secrets 皆尚未設定——程式碼有安全預設值（`gemini-2.5-flash`／`20000`／`0`），不影響 Function 是否可運作，但這也是 Function 尚未被真正重新部署/設定過的旁證。

---

## 四、Migration 來源判定

### 時間軸證據

| 事件 | 時間（UTC） |
|---|---|
| Commit `c411784` 建立（本機） | 2026-07-27T06:12:19 |
| Migration row `daily_lucky_context` 建立（遠端 DB） | 2026-07-27T06:33:41（約晚 21 分鐘） |
| `wallpaper-generate` Function 最後更新 | 2026-07-20T09:41:49（早了將近 7 天，未被觸碰） |

### 排除項目

- ❌ **GitHub Actions 自動套用**：repo 內完全沒有任何 `.github/workflows/**` 檔案，技術上不可能。
- ❌ **本次 Gate A 由我執行**：已於 Gate A 報告確認，我僅執行 `supabase db push --dry-run`，從未執行真正的 `supabase db push`。

### 較可能的來源（依現有證據排序）

1. **Supabase 原生 GitHub 整合自動套用（可能性較高）**：Supabase 專案設定中可在 Dashboard（Settings → Integrations）啟用「推送到指定分支時自動套用 migrations」功能，此設定**不會出現在 repo 檔案中**，純粹是 Supabase 專案端的設定，因此本次唯讀檢查**無法直接確認或排除**這個可能性。時間軸（push 後約 21 分鐘套用）與這個機制的典型行為相符。**此類整合通常只同步 migration，不會一併觸發 Function 部署**——這與「Function 仍是 7 天前的舊版」完全吻合，屬於強支持證據。
2. **本機先前操作套用**：也可能是有人（你本人、或此對話以外的另一個終端機/會話）直接手動執行了 `supabase db push`。我無法從唯讀指令中排除或確認這個可能性，因為 CLI 沒有提供「執行者身份」的稽核紀錄可供查詢。

**無法 100% 判定是「Supabase 自動整合」還是「人工手動執行」，因為兩者都會產生完全相同的資料庫端結果，且我沒有管道查詢 Supabase Dashboard 的整合設定或執行者身份紀錄。但可以 100% 確定排除「GitHub Actions」這個選項（repo 內無任何 workflow 檔案），也可以 100% 確定 Function 部署沒有一併發生。**

**建議你直接到 Supabase Dashboard → Settings → Integrations 確認是否有啟用 GitHub 自動同步 migration 的功能，以得到確切答案。**

---

## 五、Gate B 判定

依任務規則：

> 如果 migration 自動套用，但 Function 尚未部署：標記 READY FOR MANUAL FUNCTION DEPLOYMENT。

**本次情況完全符合此條件**——migration 已套用（確認 1 筆正確的 active row），但 `wallpaper-generate` Function 的 `updated_at`（2026-07-20）證實其**尚未部署**這次 P2-AI-02/P2-AI-03 的新程式碼。

---

## 最終輸出

| 項目 | 結果 |
|---|---|
| Migration 來源判定 | 無法 100% 確定是「Supabase GitHub 自動整合」或「人工手動 db push」；已 100% 排除「GitHub Actions」（repo 內無 workflow 檔案） |
| GitHub Actions 狀態 | 不存在任何 workflow，`gh` CLI 未安裝但不影響此結論 |
| `wallpaper-generate` 遠端版本與更新時間 | version 26，updated_at = 2026-07-20T09:41:49 UTC（早於本次 commit 與 migration，證實尚未部署新程式碼） |
| Secrets 名稱存在性 | `GEMINI_API_KEY` ✅ 存在；`SHOPKEEPER_MODEL`／`SHOPKEEPER_TIMEOUT_MS`／`SHOPKEEPER_MAX_RETRY` ❌ 皆不存在 |
| 是否已自動部署 Function | ❌ **否**，Function 仍是 7 天前的舊版本 |
| **Gate B** | 🟢 **READY FOR MANUAL FUNCTION DEPLOYMENT** |
| 建議下一步 | (1) 先至 Supabase Dashboard 確認 GitHub 整合設定，釐清 migration 套用來源，避免未來出現非預期的自動變更；(2) 確認後可執行 `supabase functions deploy wallpaper-generate`（本次未執行，需另行下達指示）；(3) 部署後建議明確設定 `SHOPKEEPER_MODEL`／`SHOPKEEPER_TIMEOUT_MS`／`SHOPKEEPER_MAX_RETRY` 三個 secrets |

**完成，停止於此。未進行任何部署動作。**
