# 功能規格書：AI Lucky Wallpaper Studio

**Feature Branch**: `[001-ai-lucky-wallpaper]`

**Created**: 2026-07-12

**Status**: Draft

**Input**: 依據 `docs/features/001_AI_Lucky_Wallpaper.md` 與產品文件建立規格

## 使用者情境與測試（必要）

### 使用者故事 1 - 生成今日幸運桌布（Priority: P1）

作為已登入使用者，我可以在 Lucky Wallpaper Studio 選擇一隻已收藏吉祥物、一件已兌換禮物與一種桌布風格，取得 AI 店長產生的今日祝福與 Lucky Theme，並生成可預覽的今日桌布。

**為何是此優先級**：此為核心價值，直接支撐每日回訪、個人化與 AI 陪伴體驗。

**獨立測試方式**：以具備可用吉祥物與禮物的帳號，完成一次完整生成流程並驗證輸出元素與扣點規則。

**驗收情境**：

1. **Given** 使用者至少有一隻已收藏吉祥物與一件已兌換禮物且 Lucky Points 足夠，**When** 使用者完成選擇並發起生成，**Then** 系統生成一張包含吉祥物、禮物、AI 祝福、日期浮水印與裝飾元素的桌布。
2. **Given** 生成成功，**When** 使用者查看結果，**Then** 可預覽並可進入下載與分享操作。
3. **Given** 當日已成功生成 3 次，**When** 使用者再次發起生成，**Then** 系統拒絕本日第 4 次生成並提供明確提示。

---

### 使用者故事 2 - 下載與歷史回看（Priority: P2）

作為使用者，我可以下載生成結果，並在 My Lucky Wallpapers 查看歷史紀錄與可下載狀態。

**為何是此優先級**：下載與歷史是桌布價值落地的必要能力，支撐持續使用。

**獨立測試方式**：完成一次生成後下載，再進入歷史頁驗證重下載與 30 天後行為。

**驗收情境**：

1. **Given** 有可用生成結果，**When** 使用者下載，**Then** 下載檔案格式為 PNG。
2. **Given** 歷史中有 30 天內圖片，**When** 使用者開啟歷史，**Then** 可查看生成日期並重新下載。
3. **Given** 圖片已超過 30 天保存期限，**When** 使用者查看歷史，**Then** 紀錄仍保留但不可下載圖片檔。

---

### 使用者故事 3 - 站內一鍵分享（Priority: P3）

作為使用者，我可以在桌布結果頁直接一鍵分享到指定社群平台。

**為何是此優先級**：分享是產品旅程的一部分，能放大幸運體驗與自然成長。

**獨立測試方式**：完成一次生成後，驗證結果頁可觸發指定平台分享流程。

**驗收情境**：

1. **Given** 桌布已生成，**When** 使用者點選分享，**Then** 系統提供 LINE、Instagram、Threads、Facebook、X、Telegram 的一鍵分享入口。

---

### 邊界情境

- AI 生成失敗：提供重新生成，不得扣除點數。
- 下載失敗：可重新下載。
- AI Timeout：提示稍後再試。
- 無已收藏吉祥物：不可進入生成。
- 無已兌換禮物：不可進入生成。
- 自拍非單人：不可套用自拍換臉流程。
- 使用者 Lucky Points 不足：不可生成並顯示扣點不足提示。

## 需求（必要）

### 功能需求

- **FR-001**：系統 MUST 提供 Lucky Wallpaper Studio 流程：選吉祥物、選禮物、取得 AI 每日內容、選風格、生成、預覽、下載、分享。
- **FR-002**：系統 MUST 僅允許從使用者已收藏吉祥物中選擇，並顯示名稱、圖片、稀有度。
- **FR-003**：系統 MUST 僅允許從使用者已成功兌換禮物中選擇，並顯示商品名稱與圖片。
- **FR-004**：系統 MUST NOT 因生成桌布消耗禮物。
- **FR-005**：AI 店長 MUST 每日產生今日祝福、今日一句話、今日 Lucky Theme，且輸出需隨日期變化。
- **FR-006**：每張桌布 MUST 包含今日日期、今日 Lucky Theme、AI 祝福資訊。
- **FR-007**：桌布內容 MUST 包含吉祥物、禮物、AI 祝福文字、日期浮水印與裝飾元素。
- **FR-008**：MVP 桌布解析度 MUST 為 1080×1920。
- **FR-009**：MVP 風格 MUST 提供 Retro（預設）、Cute、Japanese、Fantasy、Minimal。
- **FR-010**：生成成功後 MUST 可立即下載 PNG。
- **FR-011**：系統 MUST 提供 My Lucky Wallpapers，顯示歷史紀錄、生成日期與可下載狀態。
- **FR-012**：生成圖片檔 MUST 保留 30 天並自動刪除；超過期限後歷史紀錄 MUST 保留且標示不可下載。
- **FR-013**：MVP MUST 納入 Selfie；僅支援單人自拍，原始自拍 MUST 加密保存 24 小時後自動刪除，且 MUST NOT 用於模型訓練、廣告或二次用途。
- **FR-014**：系統 MUST 對 AI 內容施加安全限制，避免政治、宗教、成人、攻擊性內容。
- **FR-015**：預設生成成本為 10 點 Lucky Points。該成本 MUST 可由系統設定調整，以支援未來活動與會員權益。
- **FR-016**：每位使用者每日成功生成上限 MUST 為 3 次。
- **FR-017**：AI 生成失敗時 MUST 提供重新生成且 MUST NOT 扣點。
- **FR-018**：下載失敗時 MUST 允許重新下載。
- **FR-019**：AI Timeout 時 MUST 提示稍後再試。
- **FR-020**：系統 MUST 提供站內一鍵分享至 LINE、Instagram、Threads、Facebook、X、Telegram。

### 關鍵實體

- **Collected Mascot**：使用者已擁有吉祥物（名稱、圖片、稀有度）。
- **Redeemed Gift**：使用者已成功兌換禮物（商品名稱、圖片）。
- **Daily Lucky Context**：AI 店長每日內容（日期、祝福、一句話、Lucky Theme）。
- **Wallpaper Generation Request**：生成輸入（吉祥物、禮物、風格、可選自拍）。
- **Generated Wallpaper**：生成輸出（PNG、視覺/文字元素、保留期限）。
- **Wallpaper History Item**：歷史紀錄（生成日期、可下載狀態）。
- **Selfie Asset**：自拍來源檔（加密、24 小時自動刪除）。

### Constitution 對齊（必要）

- **產品支柱對齊**：Lucky Experience、Collection、Personalization、Daily Habit、AI Companion、Sharing。
- **已檢視來源**：`docs/product/vision.md`、`docs/product/product-principles.md`、`docs/product/architecture.md`、`docs/features/001_AI_Lucky_Wallpaper.md`。
- **歧義紀錄**：分享範圍、分享平台、Selfie 是否納入 MVP、每日生成次數、扣點幣種與扣點值、Lucky Theme 來源、30 天後歷史行為，皆已完成 Clarify。
- **隱私需求**：自拍加密、24 小時刪除、不用於模型訓練/廣告/二次用途；生成圖 30 天自動刪除。
- **AI 行為需求**：AI 店長需溫暖正向且每日有變化，並遵守內容安全限制。
- **語言需求**：對使用者與產品文件使用繁體中文；程式、資料庫、API 命名維持英文。

## 成功指標（必要）

### 可衡量成果

- **SC-001**：上線 3 個月內，DAU 較上線前基準提升 30%。
- **SC-002**：上線 3 個月內，Wallpaper 下載量較基準提升 40%。
- **SC-003**：上線 3 個月內，Gift 兌換量較基準提升 20%。
- **SC-004**：上線 3 個月內，Returning User 較基準提升 25%。

## 假設

- 既有 Supabase 使用者系統、收藏、兌換、商城與購物車能力可直接沿用。
- MVP 僅支援 1080×1920，其他解析度屬後續擴充。
- 未列入功能簡報的項目（如 Live Wallpaper、影片生成、多人合照、NFT、Marketplace）不納入 MVP。

## System Workflow

1. 使用者進入 Lucky Wallpaper Studio，系統先檢查登入狀態、當日成功生成次數（上限 3 次）與 Lucky Points 是否足夠。
2. 系統載入可選清單：
   - 已收藏吉祥物（名稱、圖片、稀有度）
   - 已兌換禮物（商品名稱、圖片）
3. 使用者依序選擇吉祥物、禮物、風格；若啟用 Selfie，先完成自拍上傳與驗證。
4. 系統建立每日 Lucky Context（日期、今日祝福、今日一句話、今日 Lucky Theme）。
5. 系統組裝 AI prompt 並送出生成請求（含內容安全限制）。
6. 生成成功後：
   - 扣除 10 點 Lucky Points
   - 寫入桌布與歷史紀錄
   - 回傳預覽畫面與下載/分享入口
7. 使用者可下載 PNG，或透過站內一鍵分享到指定平台。
8. 背景排程處理資料生命週期：
   - 生成圖片 30 天後刪除檔案、保留歷史紀錄並標示不可下載
   - Selfie 原始檔 24 小時後自動刪除

## AI Prompt Strategy

建立 AI prompt 時，MUST 包含以下輸入欄位：

- 使用者選擇資料：吉祥物名稱、吉祥物特徵資訊、禮物名稱、桌布風格
- 每日上下文：當日日期、今日 Lucky Theme、今日祝福、今日一句話
- 視覺輸出約束：1080×1920、日期浮水印、裝飾元素、需包含吉祥物與禮物
- 安全與內容限制：禁止政治、宗教、成人、攻擊性內容
- 選配 Selfie 資料：僅在自拍驗證通過時加入 face-replacement 指示與安全標記

Prompt 組裝規則：

1. 先組固定結構（尺寸/元素/安全限制），再注入動態欄位（吉祥物、禮物、Lucky Context）。
2. 每次生成請求 MUST 帶入當日日期，確保每日內容可變化。
3. Selfie 未啟用或驗證失敗時，MUST 不得加入任何自拍相關內容。

## Retry Policy（AI 生成失敗與 Timeout）

- 單次 AI 請求 Timeout 門檻：30 秒。
- Retry 上限：最多 3 次（同一生成請求內）。
- Retry 觸發條件：
  - AI 服務錯誤（可重試類型）
  - 請求逾時（Timeout）
- Retry 流程：
  1. 第 1 次請求失敗或 Timeout 後，自動重試。
  2. 累計至第 3 次仍失敗，流程結束並回傳失敗結果。
  3. 顯示可手動重新生成入口。
- 扣點與退款規則：
  - 僅在最終生成成功時扣除 10 點 Lucky Points。
  - 若 3 次重試後仍失敗，該次生成不應產生點數扣除；若流程中曾預扣，MUST 全額退回 Lucky Points。

## Selfie Processing Workflow

### 1) 上傳與驗證

1. 使用者上傳 Selfie。
2. 系統執行檔案驗證：
   - 僅接受 JPG/PNG
   - 單檔大小上限 10MB
3. 系統執行內容驗證：
   - 必須為單人自拍
   - 驗證失敗則中止自拍流程並提示原因，桌布流程可在不使用自拍下繼續

### 2) 加密與暫存

1. 驗證通過後，原始自拍以加密形式寫入暫存儲存區。
2. 寫入刪除到期時間（24 小時）與必要追蹤欄位（上傳時間、到期時間、狀態）。
3. 自拍檔僅可用於本次桌布生圖上下文，不得提供模型訓練、廣告或其他二次用途。

### 3) 生成整合

1. 生成請求組裝時，僅引用已驗證且未過期的自拍資產。
2. AI 依規則執行吉祥物臉部替換（face replacement）。
3. 生成完成後，結果圖按一般桌布流程保存與歷史管理。

### 4) 自動刪除

1. 背景排程定期掃描已到期自拍資產（>=24 小時）。
2. 刪除加密原始檔與對應暫存索引。
3. 刪除作業完成後，更新狀態為已刪除，確保不可再被讀取或重用。

## Share Metadata

使用者透過站內一鍵分享時，分享 payload 應包含以下 metadata：

- 日期（生成日期）
- Lucky Theme
- 祝福短句
- 吉祥物名稱
- 禮物名稱
- 桌布風格

平台輸出規則：

1. 上述 metadata 為跨平台標準欄位（LINE、Instagram、Threads、Facebook、X、Telegram）。
2. 若特定平台欄位限制導致無法完整傳遞，系統應優先保留：日期、Lucky Theme、祝福短句。

## AI Generation Experience

桌布生成期間應提供具參與感的等待體驗，不得僅顯示通用 loading 畫面。

體驗需求：

- 生成進行中 MUST 顯示 AI 店長對話內容（例如鼓勵、祝福、進度語句）。
- 生成進行中 MUST 顯示進度狀態。
- 生成進行中 MUST 顯示當前 Lucky Theme。
- 若可取得估計資訊，生成進行中 SHOULD 顯示預估剩餘時間。
- 生成失敗時 MUST 提供友善的重試引導，不得僅顯示通用錯誤訊息。

## Wallpaper Metadata

每張生成桌布應持久化保存以下 metadata 欄位：

- wallpaper_id
- user_id
- mascot_id
- gift_id
- lucky_theme
- blessing
- wallpaper_style
- ai_model
- prompt_version
- generation_seed
- created_at
- expires_at

此 metadata 主要用於未來能力擴充，包含：

- 再生成（regeneration）：可重建接近原始結果的生成條件與脈絡。
- 分析（analytics）：可進行生成表現、風格偏好與主題分佈分析。
- 歷史（history）：可支援更完整的歷史查詢、篩選與回顧體驗。
