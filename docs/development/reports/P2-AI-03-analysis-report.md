P2-AI-03 分析報告：Shopkeeper Context Agent Architecture
（本階段僅分析與架構設計，未修改任何檔案，未 commit/push）

已閱讀：AI Constitution、development-principles.md、constitution.md（僅為未填寫的範本，無專案特定規則）、P2-AI-06-review.md（P2-AI-02 Review）、P2-AI-roadmap.md 的 P2-AI-03 段落，以及現有 prompt 下的 Resolver/Validator/Builder/fallback-templates 原始碼。

1. Architecture Diagram
關鍵設計原則：Shopkeeper Context Agent 是 Prompt Context Resolver 的新上游來源，取代原本「使用者手動輸入 luckyTheme/blessing」的角色。Resolver / Validator / Builder 三個既有模組的對外介面完全不需要修改——這正是 P2-AI-02 Review 當時特別要求「Builder 不查 DB」所換來的低耦合紅利。

2. Responsibility Matrix
項目	應負責	絕對不能做
Lucky Theme	✅ 產生今日主題文字	—
Blessing	✅ 產生今日祝福文字	—
Story	✅ 產生簡短故事	—
One-liner	✅ 產生一句話標語	—
Shopkeeper Message	✅ 用「變色龍店長」第一人稱包裝上述內容	—
Image Prompt	❌ 絕對不可組裝	這是 Wallpaper Prompt Builder 的唯一職責（Principle 5）
Image Generation	❌ 絕對不可呼叫圖片模型	只能呼叫文字模型（例如 Gemini text-only 呼叫，或未來獨立文字 provider）
UI 呈現	❌ 不負責排版/顯示邏輯	前端的職責
Wallpaper Layout/Composition	❌ 不可決定構圖規則	Builder 已內建 Composition 規則
日期產生	❌ 不可自行決定「今天」是幾號	Prompt Context Resolver 的專屬職責（Principle 6），Shopkeeper 只能在文字內容裡「引用」系統已產生的日期，不能自己算
Mascot/Gift 外觀細節	❌ 不負責 species/appearance/colors 這種給圖片模型看的資料	那是 Resolver 查給 Builder 用的；Shopkeeper 最多只需要名稱做敘事個人化
3. Generation Flow（詳細版）
4. Context Contract（JSON Schema）
欄位	用途	必要性
luckyTheme	直接餵入 Prompt Context Resolver → Builder（既有欄位）	必要（Validator 已強制）
blessing	同上	必要（Validator 已強制）
version	Shopkeeper 輸出版本（Constitution Principle 9）	必要
story	呈現於 UI，滿足 Constitution「Every Wallpaper Should Tell a Story」核心體驗	建議必要（見第 8 節開放問題）
oneLiner	分享卡/通知用的短標語	可省略
shopkeeperMessage	聊天泡泡風格的店長口吻文字（UI 顯示用）	可省略
與圖片 prompt 的關係：只有 luckyTheme/blessing 兩個欄位會流入 Prompt Context Resolver → Wallpaper Prompt Builder；其餘欄位純粹是 UI 呈現/觀察用途，不進圖片 prompt。

現有基礎設施可直接沿用：fallback-templates.js 已經預先定義了 daily_lucky_context promptType 與其 fallback 樣板（"Generate one positive daily lucky context in Traditional Chinese with fields: lucky_theme, blessing, one_liner."），promptRegistryLoader.loadActivePrompt("daily_lucky_context") 這條路徑從 P1-INF-04 就已經存在、有測試涵蓋，只是從未被 Generation Orchestrator 實際呼叫過。Shopkeeper Agent 實作時可以直接沿用這個既有的 Prompt Registry 機制，不需要另建一套。

5. Prompt Strategy：Structured Output（建議採用）
建議：Structured Output（JSON Schema 約束輸出），不用 Free-form Text。

理由：

Principle 7（結構化資料優先）：luckyTheme/blessing 要逐字餵進 Builder，free-form 文字需要額外解析（regex/字串切割），一旦模型輸出格式漂移就會靜默壞掉。
Principle 8（生成前驗證）：Structured Output 才能可靠地做「這個 JSON 是否包含必要欄位」的驗證；free text 無法可靠驗證「有沒有寫祝福」。
安全風險：如果 Shopkeeper 用 free-form 輸出且解析失敗，最壞情況是把整段包含 markdown/JSON 符號的原始文字誤當成 luckyTheme 塞進圖片 prompt——圖片模型很可能把這些符號畫成畫面上的文字雜訊，直接損害使用者體驗。
與現有 Gemini Provider（gemini-provider.js）的呼叫模式不衝突：可用 responseMimeType: "application/json" + schema，或至少要求模型輸出「只有 JSON」的嚴格 system instruction。
6. Determinism 分類
資訊	分類	理由
Date	必須 deterministic	Resolver 已用 Intl.DateTimeFormat(Asia/Taipei) 產生，Shopkeeper 只能引用，不能自己算
Mascot 身分（species/名稱）	必須 deterministic	查資料庫得到，不可讓模型猜；Shopkeeper 若要在 story 裡提到吉祥物名字，必須用查詢結果，不能自己編
Gift 身分	必須 deterministic	同上
contextVersion/shopkeeperVersion	必須 deterministic	系統指定的版本字串，不是模型輸出
Blessing 文字	可由 AI 自由生成	創意內容
Story 文字	可由 AI 自由生成	創意內容
One-liner	可由 AI 自由生成	創意內容
Shopkeeper Message	可由 AI 自由生成	創意內容（人設語氣）
Lucky Theme（待決）	⚠️ 有爭議	見第 8 節——這既可以是「AI 自由生成的創意內容」，也可以是「從一組固定主題池依日期/mascotId 決定性挑選」。兩種都合乎 Constitution，但走向不同，需要產品決定。
7. Failure Strategy
Shopkeeper Agent 呼叫 AI 失敗時（Timeout / Rate Limit / Provider Failure / 輸出格式不合法 JSON）：

絕不能讓整個生成失敗——產品目標是「每天都有一張桌布」，不是「店長心情不好今天就沒有桌布」。
Fallback 策略：比照現有 fallback-templates.js 的既有模式，準備一組預先寫好、deterministic 輪替的 luckyTheme/blessing/story 內容池（例如依日期 hash 或簡單輪詢挑選），作為 AI 呼叫失敗時的安全網——這與 P2-AI-01 Provider Resilience Agent「primary 失敗 → fallback」的設計哲學完全一致，但不需要重用同一份程式碼（那是給圖片 provider 用的），而是套用同樣的設計模式。
有界重試：比照 ProviderAdapter 的 maxRetry 慣例，最多重試固定次數，不得無限重試。
絕不洩漏原始 AI 例外：對外一律回傳正規化過的 fallback 內容，不把 provider 的 raw error 往外拋。
輸出格式驗證失敗也視同失敗：若 AI 回傳了「看起來是 JSON 但缺必要欄位」的內容，一樣觸發 Fallback，不接受半成品 Context（呼應 Principle 8）。
8. Observability
建議記錄：

correlationId（已貫穿全流程）
contextVersion（Prompt Context Resolver 既有版本標記，不變）
shopkeeperVersion（新增——比照 Builder 的 builderVersion 概念，標記 Shopkeeper 自己這次用的 prompt/邏輯版本）
source："ai" 或 "fallback"——這是最重要的新增觀察指標，用來追蹤「今天這張桌布的店長文案是 AI 生成還是走了安全網」，比照現有 generation_fallback_started/generation_fallback_succeeded 的可觀測性哲學。
durationMs：Shopkeeper 呼叫耗時。
Shopkeeper JSON Snapshot：建議保存。 沿用 P2-AI-02 Prompt Snapshot 的既有模式——直接加一個 shopkeeperSnapshot 欄位到既有 wallpaper_generations.metadata_json（不新建資料表），讓「為什麼今天畫企鵝但祝福文字怪怪的？」這類問題可以直接查資料庫debug，不需要重建現場。這裡沒有敏感資料疑慮（luckyTheme/blessing/story 本身不含 PII/API金鑰），可以完整保存。
9. AI Constitution Review
原則	是否符合	說明
P1 AI 服務產品	✅	Shopkeeper 存在是為了讓體驗更豐富，不是曝露給使用者的「AI 功能」
P2 Prompt 是內部細節	✅	Shopkeeper 自己的（文字生成）prompt 也是內部實作，使用者不填不改
P3 角色一致性	⚠️ 需注意	Shopkeeper 的 story 若提到吉祥物名字卻沒有拿到真實 mascot 資料，會重演 P2-AI-02 那次「企鵝變狐狸」的同類型 bug，只是這次是文字版而非圖片版——必須把真實查詢到的 mascot 名稱餵給 Shopkeeper，不能讓它自己編
P4 店長是敘事者	✅	這正是本元件存在的理由
P5 Prompt Builder 唯一組裝者	✅（需明確界線）	Shopkeeper 呼叫的是「文字模型」產生「敘事內容」，這不是 Constitution 禁止的「UI → Gemini」（那條線指的是圖片 prompt）。但實作時要非常清楚地區分：Shopkeeper 的內部 prompt 模板 ≠ 圖片 prompt，兩者是完全不同的 Prompt Registry 條目（daily_lucky_context vs wallpaper_generation）
P6 Deterministic before AI	⚠️ 有開放問題	日期/mascot/gift 身分已確定 deterministic；Lucky Theme 是否也該 deterministic 是本報告唯一未解決的爭議點（見上方）
P7 結構化資料優先	✅	建議採用 Structured Output（見第 5 節）
P8 生成前驗證	✅	Shopkeeper 輸出的 luckyTheme/blessing 最終還是要通過 P2-AI-02 既有的 Prompt Validator 這一關，等於雙重把關
P9 版本化	✅	shopkeeperVersion + contextVersion
P10 可預期	⚠️ 措辭上的張力	Principle 10 字面上寫「創意屬於圖片模型，一致性屬於 Prompt Builder」，但 Shopkeeper 產生的文字內容本質上就是創意內容，而它又不是「圖片模型」——建議在文件上明確這條原則的適用範圍是「圖片生成」，Shopkeeper 的文字創意生成是被允許的例外，只是結構（JSON 格式、必要欄位）仍必須可預期
P11 使用者體驗優先	✅	正是移除使用者輸入 luckyTheme/blessing 的核心動機
P12 每張桌布都該說故事	✅	story 欄位直接對應
10. Risks
文字版的角色一致性風險（見上方 P3）：Shopkeeper 若沒拿到真實 mascot/gift 名稱就自由發揮，可能寫出「你的守護吉祥物是小狐狸」但使用者選的是企鵝——這是文字版的「企鵝變狐狸」，同樣會傷害「這是為我專屬生成」的核心體驗。
額外的資料庫查詢：如果 Shopkeeper Agent 自己查一次 mascot/gift 名稱，Prompt Context Resolver 稍後又查一次完整資料，會有輕微的重複查詢——是否要在 Generation Service 層合併成「查一次、兩邊共用」，是效能 vs 解耦的取捨（見下方開放問題）。
AI 呼叫延遲疊加：目前流程只有一次 AI 呼叫（圖片生成）；加入 Shopkeeper 後變成兩次 AI 呼叫（文字 + 圖片），整體生成時間會變長，需要評估使用者等待體驗與 daily limit/timeout 設定是否要調整。
Fallback 內容池的新鮮感問題：如果 AI 呼叫頻繁失敗、頻繁落入 Fallback，使用者可能連續多天看到重複的 luckyTheme/blessing，違背「每天都是專屬」的產品承諾——需要監控 source: "fallback" 的比例。
內容安全：Shopkeeper 是自由文字生成（story/blessing），需要與圖片生成一樣有安全過濾機制（比照 Gemini safetyLevel 設定），避免生成不當內容。
11. Questions Requiring Product Decision
Lucky Theme 到底該不該是 AI 自由生成？ 還是應該像日期一樣，從一組固定/預先審核過的主題池中，依日期或其他 deterministic 規則挑選？這會決定 Shopkeeper 是否需要呼叫 AI，或只是一個查表工具。
Shopkeeper 需要多完整的 mascot/gift 資料才能個人化敘事？ 只要名稱（species/name）就夠，還是也需要外觀描述才能寫出更生動的故事？這會決定 Shopkeeper 要不要重用完整的 Mascot/Gift Repository，還是只需要一個輕量的名稱查詢。
是否要合併重複的 mascot/gift 查詢？ 讓 Generation Service 查一次、同時餵給 Shopkeeper 與 Prompt Context Resolver，還是接受兩邊各自查一次以維持模組獨立解耦？
story/oneLiner/shopkeeperMessage 是否應該是必要欄位？ Constitution 的 Core Product Vision 把 Story 列為五大體驗支柱之一，這是否代表它應該和 luckyTheme/blessing 一樣，缺了就要 Fallback，而不是單純「可省略」？
AI 呼叫延遲對整體生成時間的影響是否可接受？ 是否需要平行化（Shopkeeper 與其他非依賴步驟同時跑）或設定更嚴格的 Shopkeeper 專屬 timeout？
12. Implementation Plan（下一階段，本次不執行）
新建 js/services/shopkeeper/shopkeeper-context-agent.js（+ Deno twin）——輕量查 mascot/gift 名稱、組裝內部（文字）prompt、呼叫文字模型、Structured Output 解析。
新建 js/services/shopkeeper/shopkeeper-context-validator.js——驗證 AI 回傳 JSON 是否符合 Context Contract（必要欄位存在、非空字串）。
新建 js/services/shopkeeper/shopkeeper-fallback-context.js——deterministic 內容池 + 選取邏輯。
沿用既有 prompt-registry-loader.js 的 daily_lucky_context promptType（已存在，只是從未被呼叫）。
修改 generation-service.js：在呼叫 promptContextResolver.resolve() 之前，先呼叫 Shopkeeper Context Agent，取得 luckyTheme/blessing，其餘欄位（story/oneLiner/shopkeeperMessage）另外回傳給前端。Prompt Context Resolver / Validator / Builder 不需修改任何一行。
generation-repository.js 的 metadata_json 新增 shopkeeperSnapshot/shopkeeperVersion/source（沿用既有欄位擴充模式，不新建資料表）。
撰寫單元測試：Structured Output 解析成功/失敗、Fallback 觸發、必要欄位驗證、mascot 名稱正確餵入敘事（防止文字版「企鵝變狐狸」）。
等待 Product Review。本階段確認：未修改任何程式碼、未新建任何 Service/Prompt/Agent、未 commit、未 push。