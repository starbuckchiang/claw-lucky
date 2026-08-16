P2-AI-02 分析報告：Deterministic Wallpaper Prompt Builder
（本階段僅分析，未修改任何檔案）

1. Constitution Compliance Summary
與 P2-AI-02 直接相關的約束（AI constitution.md）：

原則	內容	目前狀態
Principle 2	Prompt 是內部實作細節，使用者不得填寫/理解/編輯 prompt	❌ 違反
Principle 3	吉祥物一致性強制，不得被替換成其他動物	❌ 違反
Principle 4	變色龍店長是 Lucky Theme/Blessing/Story 的唯一來源	❌ 未實作（P2-AI-03 尚未開始）
Principle 5	所有圖片 Prompt 必須經過唯一的 Wallpaper Prompt Builder	❌ 不存在獨立 Prompt Builder
Principle 6	已知資訊（日期等）應該 deterministic 產生，不讓 AI 猜	❌ 日期完全缺席
Principle 7	AI 元件間應使用結構化資料，避免 free-form prompt 拼接	❌ 目前是純字串樣板替換
Principle 8	生成前必須驗證所有必要資料都存在（含 mascot/gift/blessing/theme/date/style）	⚠️ 部分驗證（缺 date、缺 mascot 實際身分）
Principle 9	每個 Prompt/Schema/Agent 輸出都要有版本	✅ Prompt 有 version 欄位（prompt_versions/fallback template）
Principle 11	使用者體驗優先於模型能力（範例：不該讓使用者輸入 Lucky Theme）	❌ 完全違反（見下方 Root Cause C/D）
2. Current Prompt Flow
實際組裝 wallpaper prompt 的完整呼叫路徑（引用實際檔案與函式）：

3. Root Cause Findings
選企鵝卻生成狐狸
兩個獨立、疊加的原因：

buildPromptContext()（generation-service.js L53-68）的 variables 只放 mascotId（不透明的 UUID），從未放入吉祥物的物種/名稱/外觀描述。 就算模板裡有 {{mascotId}}，替換進去也只是一串 UUID 文字，Gemini 完全無法得知「這是企鵝」。

實際使用的 fallback 樣板（fallback-templates.js L18-22）本身就不是可替換樣板：

這是一段「描述應該包含什麼」的英文меta指示，裡面沒有任何 {{}} placeholder。renderPrompt()（generation-service.js L42-50）用正規表達式比對 {{key}}，比對不到就完全不做替換——最終送進 Gemini 的字串很可能就是這段固定英文，完全不含使用者選的吉祥物/禮物/主題/祝福資訊，Gemini 只能自己「腦補」一個可愛動物（狐狸是常見的預設輸出）。

migrations 目錄下沒有任何一筆 INSERT 建立 prompt_versions 的實際資料（已用 grep 確認），代表正式環境很可能一直在走這個 fallback 分支。

進一步佐證：吉祥物名稱其實在前端就有（wallpaper-selection-service.js 的 normalizeMascot() [L15-20] 已經正常解析出 name，例如「Alpaca」），但 createGenerationRequest()（wallpaper.js L288）從未把 mascotName 放進送出的 payload；generation-validator.js 的必填欄位清單裡也沒有任何 mascot 名稱/物種欄位。資訊在前端就被丟棄了。

Lucky Theme 由使用者輸入
wallpaper.html:76：<input id="luckyTheme" name="luckyTheme" type="text" required autocomplete="off" />
wallpaper.html:82：<textarea id="blessing" name="blessing" rows="3" required></textarea>
wallpaper.js:297-298：直接讀這兩個 DOM 欄位的 .value
這是對 Principle 2／Principle 11「不可要求使用者輸入 Lucky Theme」的逐字違反（Constitution 裡「Forbidden」範例就是這個場景）。

變色龍店長祝福流程缺失
全專案搜尋 shopkeeper/店長/Chameleon 後確認：沒有任何一個 service 檔案實作 Shopkeeper Context Agent。daily_lucky_context 只存在於 fallback-templates.js:4-17 的 SUPPORTED_PROMPT_TYPES 清單與其自己的單元測試（prompt-registry-loader.test.js）裡，從未被 generation-orchestrator.js/generation-service.js 呼叫過。這與 P2-AI-roadmap.md 標示「🔴 P2-AI-03 Shopkeeper Context Agent」尚未開始完全一致——這不是這次的 bug，而是功能還沒做。

日期月份錯誤
目前的生成流程裡完全沒有任何一行程式碼會產生「今天的日期」並放進 prompt 或 variables。 buildPromptContext() 的 variables 物件（generation-service.js L54-61）沒有 date 欄位。唯一提到日期的地方：

test-real-gemini-provider.js / .mjs / _暫存.js：寫死的字面字串 "Include a small tasteful date watermark: 2026-07-16." ——這是測試腳本裡的固定範例日期，不是 new Date() 動態產生。如果曾經有人把這段測試 prompt 複製貼進正式模板（prompt_versions 表或 fallback），就會導致桌布上的日期水印永遠卡在同一個月份/日期，這就是「月份錯誤」最合理的成因：根本不是計算錯誤，而是壓根沒有日期產生邏輯，只有一個被誤用的寫死範例值。
4. Proposed File Changes
新增（本 Task 範圍）：

js/services/prompt/wallpaper-prompt-builder.js + Deno twin supabase/functions/_shared/lib/wallpaper-prompt-builder.ts — 唯一允許組裝 image prompt 的模組，取代目前散落在 generation-service.js 裡的 renderPrompt/buildPromptContext。
js/services/prompt/wallpaper-prompt-schema.js（+ Deno twin）— 定義 Prompt Builder 的輸入/輸出 Schema（mascot identity、gift、lucky theme、blessing、date watermark、style、version），並提供驗證函式（Principle 7/8）。
js/services/prompt/mascot-catalog.js（或等價 repository）— 由 mascotId 查出物種/外觀等 deterministic 描述資料（若目前資料庫已有 mascots 表，這裡只是查詢/normalize，不是新建資料源）。
js/services/prompt/wallpaper-date-provider.js（+ Deno twin）— 依 Asia/Taipei 時區產生今日日期字串，供 Prompt Builder 使用（Principle 9/6）。
對應的 __tests__/*.test.js（deterministic 輸出、缺資料即失敗、version 標記等）。
修改（本 Task 範圍）：

generation-service.js / .ts — 移除內建的 renderPrompt/buildPromptContext，改為呼叫新的 Wallpaper Prompt Builder。
可能需要修改 generation-validator.js — 若要接受 Shopkeeper 產出的 lucky theme/blessing 作為「系統值」而非使用者輸入，欄位語意需要調整（實際欄位增減待第 8 節產品決策）。
wallpaper.html / wallpaper.js — 移除 #luckyTheme/#blessing 輸入欄位（這一塊會與 UI Workflow Task 重疊，見下方 Out of Scope）。
5. Implementation Plan（最小可行）
本 Task（P2-AI-02）要做：

建立 Wallpaper Prompt Builder + Schema，作為唯一組裝 image prompt 的入口（Principle 5）。
建立 deterministic 的 mascot 身分查詢（用 mascotId 換回物種/外觀描述），修正「企鵝變狐狸」。
建立 deterministic 的 Asia/Taipei 日期產生器，修正「日期月份錯誤」。
Prompt Builder 內建驗證：缺少 mascot/gift/blessing/luckyTheme/date/style 任一項就直接失敗（不產生不完整 prompt），對應 Principle 8。
固定輸入 → 固定 prompt 結構的單元測試（roadmap 驗收標準）。
暫時：在 Shopkeeper Agent 還沒做出來之前，luckyTheme/blessing 這兩個值本 Task 先接受「由呼叫端（Orchestrator/Handler）傳入的既有值」，Prompt Builder 本身不管這兩個值從哪來——只保證「有 Prompt Builder 這一層、有 Schema、有驗證、有 deterministic mascot/date」。不在本 Task 移除 wallpaper.html 的輸入欄位（那是 UI Workflow Task 的責任），但會標記為技術債。
留給 P2-AI-03 Shopkeeper Context Agent：

實際呼叫 daily_lucky_context prompt type，產生 {luckyTheme, blessing, story, oneLiner} JSON。
把 Shopkeeper 的輸出接進 Prompt Builder 的輸入。
留給 P2-AI-04 UI Workflow Task：

移除 wallpaper.html 的 #luckyTheme/#blessing 使用者輸入欄位。
串接「選吉祥物 → 選禮物 → Shopkeeper Agent → 顯示今日祝福（可換一句）→ Prompt Builder → Gemini」完整流程。
wallpaper.js 的 createGenerationRequest() 改為不再傳送使用者輸入的 luckyTheme/blessing。
6. Out of Scope
移除 UI 上的 #luckyTheme/#blessing 輸入框（屬於 UI Workflow Task，因為要等 Shopkeeper Agent 有實際輸出可以取代它們，否則會直接讓生成流程斷掉）。
實作 Shopkeeper Context Agent 本身（P2-AI-03）。
Prompt Registry v2（版本/A-B test/rollback，P2-AI-05）。
Wallpaper Lifecycle / 七天下載 / cleanup（P2-AI-06）。
7. Risks
改變 promptType: wallpaper_generation 的 variables 結構，會影響 prompt_versions 表裡任何已存在的正式模板（若有的話）——需要先確認 DB 裡是否真的有 active row，否則新 Schema 上線後行為可能「看起來沒變」（因為一直都是走 fallback）。
generation-service.js 抽掉 buildPromptContext/renderPrompt 後，必須保證 promptContext.promptText/promptType/promptVersion/variables 這幾個既有欄位形狀不變，否則會連動打破 wallpaper-provider-adapter.js（讀 promptContext.promptText）、generation-repository.js（寫入 metadata_json.promptType/promptVersion）、以及目前 91+ 項既有測試中大量依賴這個 contract 的測試（generation-service.test.js、provider-resilience-integration.test.js 等）。
新增「mascot 身分查詢」這一步會多一次資料庫查詢（依 mascotId 查詢物種資料），需要決定放在 Generation Service 內、還是 Prompt Builder 內部注入一個 repository——若沒設計好快取/失敗處理，可能新增一個新的失敗點（需要對應新的 DTO 錯誤碼，且不能破壞既有 P1-BIZ-03 的錯誤碼折疊約定）。
日期產生器如果實作錯誤時區（例如用 UTC 而非 Asia/Taipei），會產生「凌晨切換日期」的邊界 bug——這正是 Constitution 明確點名要避免的類型錯誤，需要專門測試 UTC+8 邊界時間。
Prompt Builder 若做成「驗證失敗直接丟錯」（Principle 8 要求），要確保這個新的失敗路徑有對應的 HTTP status 映射（wallpaper-generate-handler.js 的 ERROR_HTTP_STATUS），否則會變成未映射的 500。
8. Questions Requiring Product Decision
luckyTheme/blessing 在 Shopkeeper Agent 做出來之前，這個 Task 該怎麼過渡？ 是否要在 Prompt Builder 層先用「系統預設值」取代使用者輸入（即使 UI 還沒拔掉輸入框），讓 Constitution 違規至少在後端層先修正，前端輸入框先變成「唯讀顯示」？
mascot 的物種/外觀 deterministic 資料要從哪裡查？ 目前只看到前端有 mascot_name（顯示名稱），需要確認資料庫是否已有更完整的「物種/外觀特徵」欄位可供 Prompt Builder 查詢，或是否需要新建一份 mascot 描述對照表。
prompt_versions 表目前是否真的有任何 active row？ 若沒有，正式環境目前 100% 依賴 fallback template——這個事實本身要不要先單獨處理（例如先手動塞一筆正確的模板），還是整個等 Prompt Builder 上線一起換掉？
最終回答
最終送到 Gemini 的 prompt 是在哪一行形成的？

generation-service.js:69：

這是 buildPromptContext() 函式內、呼叫 renderPrompt(prompt.template, variables) 產生最終字串的那一行——之後這個字串只是被原封不動地透過 wallpaper-provider-adapter.js 第 45 行（renderedPrompt = promptContext.promptText）一路傳到 gemini-provider.js 第 174 行（contents: renderedPrompt），中間不再有任何組裝或修改。


## Product Decision
| 問題                 | 決定                       |
| ------------------ | ------------------------ |
| Lucky Theme AI?    | ✅ AI 生成                  |
| Story 是否必要?        | ✅ 必要                     |
| One Liner          | Optional                 |
| Shopkeeper Message | Optional                 |
| Mascot 查詢          | ✅ Generation Service 查一次 |
| Gift 查詢            | ✅ Generation Service 查一次 |
| Builder 修改?        | ❌ 不修改                    |


## 優點：

1.架構責任切分清楚。
2.與 P2-AI-02 高度相容。
3.失敗策略完整。
4.Observability 有考慮到。

## 建議調整：

1.將 Story 明確定義為必要欄位，而不是「建議必要」。
2.Lucky Theme 採 AI 生成 作為產品決策。
3.在 Generation Service 完成一次 Mascot/Gift 查詢，將 DTO 同時提供給 Shopkeeper 與 Prompt Context Resolver，避免重複查詢。
4.在 shopkeeperSnapshot 中增加少量診斷資訊（例如版本、語氣或種子），提升後續除錯與 Prompt 優化能力。