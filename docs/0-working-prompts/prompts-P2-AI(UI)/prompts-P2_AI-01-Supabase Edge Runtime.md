請先不要部署。

目前 P2-AI-04 Logger Wiring 修正已完成，Review 已通過。

在部署前，請完成 Deployment Readiness Check。

========================================
Task 1：確認 Runtime 使用的檔案
========================================

確認 Supabase Edge Runtime 最終使用的程式碼。

請回答：

1.
wallpaper-generate-handler.ts 是否為真正部署來源？

2.
wallpaper-generate-handler.js 是否仍會被 Runtime 使用？

3.
wallpaper-provider-adapter.ts 是否為真正部署來源？

4.
wallpaper-provider-adapter.js 是否仍會被 Runtime 使用？

請根據：

- import chain
- deno.json（若有）
- import/export
- Edge Function entrypoint

畫出實際 Runtime 載入流程。

若 JS 已不會被 Runtime 使用：

請不要修改 JS。

若 JS 仍為必要：

確認 JS/TS 已完全同步。

========================================
Task 2：新增 Integration Test
========================================

新增一個真正驗證 wiring 的 Integration Test。

流程：

Generation Service

↓

Provider Resilience Agent

↓

Wallpaper Provider Adapter

↓

Fake Provider

↓

Fake Storage

logger 使用：

wrapLoggerForProvider(createGenerationLogger())

Fake Provider：

generateImage()

回傳：

{
  provider: "fake",
  model: "fake-model",
  providerRequestId: "test-id",
  image: {
      base64: "...",
      mimeType: "image/png"
  }
}

Fake Storage：

uploadWallpaperImage()

回傳：

{
  bucket: "wallpaper",
  path: "demo.png",
  signedUrl: "...",
  mimeType: "image/png",
  fileSize: 100
}

驗證：

✔ generateWallpaper 成功

✔ Provider Adapter 不拋出

✔ 不出現

safeLogger.info is not a function

✔ generationLogger.logInfo 收到

wallpaper_provider_adapter_succeeded

========================================
Task 3：搜尋 Logger Interface
========================================

搜尋：

logger.info(
logger.warn(
logger.error(

logger.logInfo(
logger.logWarn(
logger.logError(

wrapLoggerForProvider(

createGenerationLogger(

確認：

Provider Interface

全部都是：

info
warn
error

Generation Logger

全部都是：

logInfo
logWarn
logError

兩者只能透過

wrapLoggerForProvider()

互相轉換。

列出所有仍可能存在 interface mismatch 的位置。

========================================
Task 4：確認沒有新的 TypeError

搜尋：

safeLogger.info

safeLogger.warn

safeLogger.error

確認沒有任何地方：

直接假設 logger 一定有這三個 function。

========================================
Task 5：執行完整驗證

請執行：

- lint
- type check
- unit tests
- integration tests
- verify-local.ps1

不得略過失敗。

========================================
Task 6：Deployment Readiness Report

最後輸出：

## Runtime

- Runtime 使用 TS 或 JS？
- import chain

## Logger Wiring

是否全部一致？

是否仍存在 interface mismatch？

## Tests

新增哪些？

總測試數

全部 PASS？

## Risk

部署剩餘風險

Low / Medium / High

若為 Medium 或 High，

請說明原因。

========================================

如果全部 PASS，

請最後只輸出：

READY FOR SUPABASE DEPLOYMENT

不要自動 commit。

不要自動 push。

不要自動 deploy。