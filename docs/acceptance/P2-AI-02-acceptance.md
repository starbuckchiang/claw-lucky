Gate 1：Architecture（必過）

確認新的 Prompt Architecture 已經建立。

應該看到：

Generation Service
        │
        ▼
Prompt Context Resolver
        │
        ▼
Prompt Validator
        │
        ▼
Wallpaper Prompt Builder
        │
        ▼
Prompt Snapshot
        │
        ▼
Provider Adapter

確認：

✅ Builder 是唯一 Prompt 組裝入口
✅ Provider 不再組 Prompt
✅ Generation Service 不再手動 replace template
✅ 沒有人直接呼叫 Gemini 並自行拼 Prompt

如果還找得到：

renderPrompt(...)

或：

buildPromptContext(...)

代表：

FAIL。

## copilot check
確認結果
1. renderPrompt( 已無實際使用 ✅
全專案搜尋（限定 .js/.ts）：零筆結果。僅存在於 5 份文件（docs、review 下的分析報告與 acceptance/working-prompts 文件）中作為歷史記錄提及，程式碼中完全移除。

2. buildPromptContext( 已無實際使用 ✅
同樣搜尋結果：零筆程式碼結果，僅存在於文件記錄中。

3. generation-service 確實依序呼叫 Resolver → Validator → Builder ✅
generation-service.js:221-232（及 generation-service.ts:242-253）內確認呼叫順序：

三者依序執行，中間沒有插入任何舊的字串替換邏輯。

4. wallpaper-provider-adapter 沒有再自行拼接 Prompt ✅
wallpaper-provider-adapter.js:44-46 的 generateWallpaper() 只做：

單純讀取已經由 Generation Service 組好的 promptText 字串並原封不動轉發給 provider（renderedPrompt），沒有任何字串拼接、樣板替換或 prompt 組裝邏輯。

四項確認皆通過，架構重構已完整落地，沒有殘留的舊路徑。

Gate 2：Code Quality（必過）

Builder 必須符合：

Pure Function

確認：

Builder：

沒有：

fetch()
supabase
Repository
Database
process.env
Date.now()

只有：

WallpaperPromptInput

↓

WallpaperPromptResult

同一個 Input：

100 次。

Prompt：

100 次一模一樣。

PASS。


## copilot check

證據總結
1. Builder 是否為 Pure Function ✅
wallpaper-prompt-builder.js:39-67 的 buildWallpaperPrompt(input)：

同步函式（無 async/await），只讀取傳入的 input 參數，用字串內插組出 promptText，回傳一般物件。
測試證明「相同輸入 → 逐字相同輸出」：wallpaper-prompt-builder.test.js:32-37 用 JSON.parse(JSON.stringify(input)) 產生獨立複本重新呼叫，assert.equal(first.promptText, second.promptText) 通過。
2. Builder 沒有依賴 DB、Repository、Supabase、Environment ✅
對 wallpaper-prompt-builder.js/.ts 兩份檔案分別搜尋 require(/import /process.env/Deno.env/fetch(/supabaseClient/await/from(：全部零筆結果。.ts 版本唯一的 import 是：

import type 是 TypeScript 純型別匯入，編譯/執行時完全被抹除，不構成任何 runtime 依賴。

3. Prompt Validator 是否一定在 Builder 前執行 ✅
generation-service.js:221-231（及 generation-service.ts:242-252）：

兩行之間沒有任何條件分支，且全專案搜尋 buildWallpaperPrompt( 確認唯一的正式呼叫點就是這裡（其餘都是它自己的單元測試直接呼叫，屬於測試該函式本身，非略過驗證）。validateWallpaperPromptInput 若驗證失敗會同步拋出 PromptValidationError，中斷執行、buildWallpaperPrompt 根本不會被呼叫到。

4. Prompt Snapshot 是否一定會產生 ✅
同一區塊內，buildPromptSnapshot() 緊接在 buildWallpaperPrompt() 之後、無條件執行：

且在成功寫入生成紀錄時，generation-service.js:392-396 無條件把 promptSnapshot/contextVersion/builderVersion 三個欄位帶入 generationRepository.createGenerationRecord()：

由於這段程式碼只有在前面的 Resolver→Validator→Builder→Snapshot 流程沒有拋出例外時才會執行到，因此每一筆成功持久化的生成紀錄都必然帶有 Snapshot。

5. 相關單元測試是否全部通過 ✅
剛執行 verify-local.ps1：

167/167 全數通過，0 失敗，涵蓋 Builder 純函式/決定性測試、Validator 各欄位缺漏測試、Resolver 日期/mascot/gift 測試、Snapshot 測試，以及 Generation Service 端到端驗證（P2-AI-02: mascot not found by Resolver -> PROMPT_VALIDATION_FAILED、P2-AI-02: provider receives the mascot's actual species...）皆在通過清單中。

Gate 3：Business（最重要）

這才是真正驗收。

建立一組固定測試。

例如：

Test A

使用：

吉祥物

轉運小企鵝

禮物

幸運乒乓守護吊飾

Lucky Theme

穩穩接住今天的好運

Blessing

今天每一次努力都會更靠近成功。

Date

2026.07.21

Builder：

輸出的 Prompt。

Product Review：

確認：

一定包含：

Penguin

Must remain penguin

Ping Pong Charm

2026.07.21

PASS。

Test B

改：

Lucky Theme。

其它：

全部不變。

Prompt：

只能：

Lucky Theme：

改。

其它：

不能亂變。

PASS。

Test C

改：

Gift。

Prompt：

Gift：

改。

其它：

保持一致。

PASS。

Test D

改：

Date。

Prompt：

只有：

Date：

改。

PASS。

這就是：

Deterministic。

## copilot 自動化測試(佔80%)
Gate 3 Verification Results — P2-AI-02 Wallpaper Prompt Builder
Created wallpaper-prompt-builder.gate3.test.js using the exact固定 input specified (轉運小企鵝 / 幸運乒乓守護吊飾 / 穩穩接住今天的好運 / 今天每一次努力都會更靠近成功。/ 2026.07.21):

Test	Result	Evidence
Test 1: Deterministic Prompt	✅ PASS	100 次獨立呼叫 buildWallpaperPrompt()（每次用全新複製的 input 物件），100 個輸出彙整成 Set 後 size = 1
Test 2: Single Change	✅ PASS	Gift=A vs Gift=B，逐行比對輸出，確認只有 1 行（Gift 那一行）不同，其餘所有行（含 Mascot/Theme/Blessing/Date）完全一致
Test 3: Character Identity	✅ PASS	輸出包含 - Species: 轉運小企鵝、- Appearance: ...、Character Consistency Rules 區塊；且不含任何 mascot-penguin-01 這類原始 ID
Test 4: Date	✅ PASS	用 UTC 日界邊界時間（2026-07-20T16:05:00Z）驗證 resolveTaipeiDate() 正確輸出 2026.07.21（證明用的是 Asia/Taipei 而非 UTC），並確認此字串逐字出現在最終 prompt 中
Test 5: Validation	✅ PASS	拿掉 Gift 後呼叫 validateWallpaperPromptInput()，確認拋出 PromptValidationError（code: PROMPT_VALIDATION_FAILED，details.errors 含 "gift.name is required"），且此驗證步驟在 generation-service.js 的實際流程中位於 Builder 之前，結構上不存在能繞過驗證產生半成品 prompt 的路徑
verify-local.ps1 → 172/172 全數通過（167 + 5 新增），無回歸。Gate 3 五項驗收全部 PASS。

### Review驗收結果
✅ Test 1：Deterministic Prompt — PASS

驗證內容：

相同固定輸入
呼叫 buildWallpaperPrompt() 100 次
100 個結果完全相同（Set 大小為 1）

這證明 Builder 的決定性（Determinism）符合預期。

✅ Test 2：Single Change — PASS

只修改 Gift。

結果：

只有 Gift 那一行改變。

其它：

Mascot
Theme
Blessing
Date

全部保持一致。

這正是我們希望的「局部變更，不影響其他內容」。

✅ Test 3：Character Identity — PASS

Prompt 中包含：

Species
Appearance
Character Consistency Rules

且不再包含原始 mascotId。

這表示已經修正了先前「UUID 丟給模型」的根本問題。

✅ Test 4：Date — PASS

驗證：

使用 UTC 邊界時間。
正確產生 Asia/Taipei 的 2026.07.21。
該日期出現在最終 Prompt。

這代表日期來源是系統決定，而不是模型猜測。

✅ Test 5：Validation — PASS

拿掉 Gift。

結果：

拋出 PromptValidationError
Builder 不會產生半成品 Prompt。

符合「Validate Before Generation」原則。

✅ Regression Test — PASS

目前：

172 / 172 測試全部通過。

表示新增 Gate 3 驗證後，沒有破壞既有功能。

## 手動 Product Review（約佔20%）
把Gate 3剩下的20%手動 + Gate 4(E2E) + P2-AI-03整併成Milestone Verification而不是P2-AI-02 專屬。

Gate 4：End-to-End（必過）

真正跑一次流程：

選：

企鵝

↓

Generate

↓

Gemini

確認圖片仍然企鵝不是狐狸。這才是真正Product PASS。

Unit Test

應看到：

例如：

wallpaper-prompt-builder.test

prompt-validator.test

prompt-context-resolver.test

prompt-snapshot.test

全部：

PASS。

Integration Test

確認：

Provider：

收到：

不是：

mascotId

UUID

而是：

Species

Penguin

Appearance

...

如果：

Log：

還看到：

0be92....


UUID。

FAIL。

Observability

確認：

DB：

metadata_json：

新增：

{
  "builderVersion":"2.0.0",

  "contextVersion":"1.0.0",

  "promptSnapshot":"..."
}

生成一次。

查：

DB。

確認：

存在。

PASS。

Constitution Review（最後一關）

逐條 Review：

Principle	PASS
Prompt 是內部細節	✅
Character Consistency	✅
Builder 唯一入口	✅
Deterministic Date	✅
Structured Input	✅
Validation Before Generation	✅
Version Everything	✅

全部：

PASS。

Product Demo（我最推薦）

我每次都會做：

這五個 Demo。

Demo 1

企鵝。

↓

還是：

企鵝。

Demo 2

換：

禮物。

↓

只有：

禮物：

改。

Demo 3

日期：

今天。

↓

浮水印：

今天。

Demo 4

Builder：

缺：

Gift。

↓

直接：

Validation Error。

不是：

Gemini：

亂畫。

Demo 5

查：

metadata_json。

看到：

Prompt Snapshot
Builder Version
Context Version
最終 Product Sign-off（建議新增）

## 以下表格同 specs/002-p2-ai-prompt-builder/acceptance.md 

最終驗收項目，例如：

驗收項目	結果
Prompt Builder 為唯一組裝入口	☐
Builder 為 Pure Function	☐
Provider 不再組 Prompt	☐
Prompt Snapshot 已保存	☐
Date 為 Asia/Taipei	☐
Character Consistency 通過	☐
企鵝生成仍為企鵝	☐
167+ Tests 全部通過	☐
AI Constitution 全數符合	☐

等這張表全部勾選完成，我就會正式簽核 P2-AI-02 完成，然後再進入 P2-AI-03（Shopkeeper Context Agent）。這樣每個 Milestone 都有清楚、可重複的驗收依據，而不是只依賴「測起來好像可以」。

## Release Gate

條件：

- Edge Function 已部署
- Frontend 已部署
- Gemini 可正常呼叫
- Storage 正常
- DB 正常

驗證：

✓ 生成圖片
✓ Prompt Snapshot
✓ Generation Record
✓ Image URL
✓ UI 正常