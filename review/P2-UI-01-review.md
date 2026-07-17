# P2-UI-01 Review

## Task Scope

- Task: `P2-UI-01`
- Goal: 建立第一版 `wallpaper.html`
- 僅處理：UI 與既有 client flow 整合
- 未修改：
  - Business Layer
  - Generation API
  - Status API
  - Prompt Registry
  - Provider Adapter
  - Observability

## 新增檔案

1. `wallpaper.html`
2. `css/pages/wallpaper.css`
3. `js/pages/wallpaper.js`
4. `review/P2-UI-01-review.md`

## UI Flow

1. 使用者填寫生成表單（mascotId / giftId / style / luckyTheme / blessing）
2. 點擊「開始生成」送出 `POST /api/wallpapers/generations`
3. 收到 `generationId` 後開始 polling `GET /api/wallpapers/generations/{id}/progress`
4. 非 terminal 時依 `recommendedPollIntervalMs` 繼續輪詢
5. terminal 成功：顯示結果圖片與 provider/model/promptVersion
6. terminal 失敗：顯示 normalized error（code + message）

## Component Structure

- Header
  - back link
  - page title + subtitle
- Generation Form
  - input/select/textarea fields
  - submit/reset actions
- Progress Panel
  - live status text
  - progress bar
  - meta info（generationId/status/poll interval）
- Result Panel
  - image preview
  - provider/model/promptVersion
- Error Panel
  - normalized error alert

## DOM Structure

主要節點：

- `#wallpaperForm`
- `#submitGenerationBtn`
- `#resetGenerationBtn`
- `#progressText`
- `#progressBar`
- `#metaGenerationId`
- `#metaStatus`
- `#metaPollInterval`
- `#resultFigure`
- `#resultImage`
- `#resultProvider`
- `#resultModel`
- `#resultPromptVersion`
- `#errorBox`
- `#errorMessage`

## Accessibility

- 表單欄位皆有可見 label
- 進度與結果區塊使用 `aria-live="polite"`
- 錯誤區塊使用 `role="alert"`
- 圖片包含 `alt` 文字
- 按鈕與連結可鍵盤操作

## Responsive Design

- 桌面版使用雙欄表單與多欄 metadata 卡片
- `max-width: 900px` 時切換為單欄
- 按鈕與資訊卡在手機版自動堆疊

## Integration Notes

- 直接串接既有 API contract：
  - `POST /api/wallpapers/generations`
  - `GET /api/wallpapers/generations/{id}/progress`
- polling 嚴格依 API 回傳 `recommendedPollIntervalMs`
- `terminal=true` 立即停止 polling
- 非 terminal 且 interval 無效時顯示 `INVALID_STATUS_RESPONSE`

## Local Verification

已執行：

```powershell
.\scripts\verify-local.ps1
node --check .\js\pages\wallpaper.js
```

結果：

- verify-local: PASS（56/56）
- wallpaper page script syntax: PASS

## Known Limitations

1. 第一版 UI 目前採手動輸入 mascot/gift id，尚未接收藏清單/禮物清單選擇器。
2. 本頁不包含下載、分享、face swap、queue/worker，符合本 Task 範圍。
