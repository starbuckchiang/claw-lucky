# P2-AI-04 Lite-2 Review — localhost 真實生成失敗診斷與部署

Source prompt: [docs/working-prompts/prompts-P2-AI-04-Lite-2.md](../docs/working-prompts/prompts-P2-AI-04-Lite-2.md)

**狀態：診斷＋部署完成，真實驗證通過。未 commit、未 push（依指示等待確認）。**

## 現象

`wallpaper.html` 在 localhost 真實生成時顯示：
```
[INVALID_REQUEST] Request validation failed.
```

## 根因

已部署的 `wallpaper-generate`（v28，2026-07-27）與 `wallpaper-status`（v14，約 2026-07-17）兩個 Edge Function，仍在執行 **P2-AI-04 Lite 本地程式碼修改之前**的舊版本——deployed 的 `REQUIRED_FIELDS` 仍要求 `luckyTheme`／`blessing`。

**證據鏈**：
1. 以 Playwright 攔截瀏覽器實際送出的 request body：
   ```json
   {"mascotId":"mascot-017","giftId":"gift001","wallpaperStyle":"Retro","promptType":"wallpaper_generation"}
   ```
   確認前端已正確不傳 `luckyTheme`／`blessing`。
2. 攔截 response body：
   ```json
   {"ok":false,"error":{"code":"INVALID_REQUEST","message":"Request validation failed.","retryable":false,"details":{"errors":["luckyTheme is required","blessing is required"]}}}
   ```
3. `npx supabase functions list` 顯示部署前版本：`wallpaper-generate` version 28（`updated_at` 對應 2026-07-27，早於本次 Lite 修改的 2026-07-31）、`wallpaper-status` version 14（`updated_at` 約 2026-07-17）。
4. 比對 `js/services/wallpaper/generation-validator.js` 與 `supabase/functions/_shared/lib/generation-validator.ts`：邏輯逐行一致（僅語法差異：`export`／`as const`／型別註記），無 Node/Deno 邏輯漂移問題。
5. `.\scripts\verify-local.ps1`：**225/225 全數通過**，證明本地程式碼本身沒有問題，純粹是**未部署**。

## 部署範圍與執行

依匯入圖確認 `wallpaper-generate/index.ts` 與 `wallpaper-status/index.ts` 各自靜態 `import` 整條 `_shared/lib/*.ts` 依賴鏈（Supabase 對每個 Function 各自打包完整依賴），故只需重新部署這兩個既有 Function，**不需要新增 Function、不需要 migration、不觸碰資料庫**。

| Function | 部署前 | 部署後 |
|---|---|---|
| `wallpaper-generate` | version 28 | **version 29**（sha256 已變更） |
| `wallpaper-status` | version 14 | **version 15**（sha256 已變更） |

執行指令：`npx supabase functions deploy wallpaper-generate`、`npx supabase functions deploy wallpaper-status`。

## 部署後真實驗證（Playwright + 真實 Gemini 呼叫）

- 選擇 福屁柯基（R）＋ 幸運乒乓守護吊飾（gift001）＋ Retro 風格 → 送出生成請求
- **Generation ID**：`d0f8afb1-7d42-4122-89f3-398b8f775e07`，狀態 `succeeded`
- 祝福卡完整顯示 5 個欄位（皆為真實 AI 內容，非空白）：
  - 今日幸運主題：轉角遇到愛，轉身遇到福氣
  - 祝福：願你今日心境開闊，福氣如福屁柯基的屁股...
  - 小故事：完整故事文字
  - 一句話：福屁柯基屁股一晃，幸運乒乓守護在旁...
  - 店長的話：親愛的，別讓生活中的小插曲影響了心情...
- 圖片正常顯示；Provider: `gemini`；Model: `gemini-2.5-flash-image`
- **下載按鈕成功觸發下載**：`claw-lucky-d0f8afb1-20260731.png`（fetch→Blob→object URL→click 流程正常運作）
- Console 僅剩既有、無關的 Kuromi 占位圖片載入錯誤，無新增錯誤

## 未執行事項（依指示）

- 未修改資料庫、未新增 Preview 架構、未開始 P2-AI-05
- 未執行 `git commit`／`git push`（等待使用者明確確認後才進行）

## 是否 READY FOR DEPLOYMENT

**✅ 是。** 本次診斷出的問題（Edge Function 未跟上本地程式碼變更）已透過重新部署解決，並在正式環境以真實 Gemini 呼叫完整驗證：生成成功、祝福顯示完整、圖片正常、下載可用。

## 建議下一步

若確認以上程式碼變更（P2-AI-04 Lite 的全部檔案）要正式納入版本控制，請明確授權後再執行 `git commit`／`git push`。
