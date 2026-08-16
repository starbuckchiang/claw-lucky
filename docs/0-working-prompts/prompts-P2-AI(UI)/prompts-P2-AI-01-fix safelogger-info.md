請直接修正 Wallpaper Provider Adapter 的 logger wiring 問題，不要只做分析。

## 已確認的 production root cause

Production log：

TypeError: safeLogger.info is not a function

發生位置：

supabase/functions/_shared/lib/wallpaper-provider-adapter.ts

呼叫鏈：

wallpaper-generate-handler.ts
→ buildOrchestrator()
→ createWallpaperProviderAdapter(...)
→ wallpaper-provider-adapter.ts
→ safeLogger.info(...)

目前 buildOrchestrator() 傳入 Wallpaper Provider Adapter 的 logger 是原始 generationLogger。

generationLogger 提供：

- logInfo(entry)
- logWarn(entry)
- logError(entry)

但 Wallpaper Provider Adapter 要求：

- info(entry)
- warn(entry)
- error(entry)

同一個 buildOrchestrator() 內，Provider Resilience Agent 已正確使用：

wrapLoggerForProvider(logger)

請讓 Wallpaper Provider Adapter 使用相同包裝方式。

## 任務

### 1. 修正呼叫端

找到：

supabase/functions/wallpaper-generate/wallpaper-generate-handler.ts

以及對應的：

supabase/functions/wallpaper-generate/wallpaper-generate-handler.js

在 buildOrchestrator() 中找到：

createWallpaperProviderAdapter({
  providerAdapter,
  storageUploader,
  logger
})

或等價程式碼。

將 logger 改為：

logger: wrapLoggerForProvider(logger)

TS 與 JS 版本都要同步修改。

不要重複建立另一套 logger wrapper。
必須沿用目前已存在、已供 Gemini、Replicate 或 Resilience Agent 使用的 wrapLoggerForProvider。

### 2. 強化 Wallpaper Provider Adapter 的 defensive logger

修改：

supabase/functions/_shared/lib/wallpaper-provider-adapter.ts

以及對應的：

supabase/functions/_shared/lib/wallpaper-provider-adapter.js

目前可能是：

const safeLogger = logger || {
  info: () => {},
  warn: () => {},
  error: () => {}
};

請改成逐一驗證方法是否為 function，避免未來傳入部分 logger 時再次出現 runtime TypeError。

TS 建議實作：

const safeLogger: WallpaperProviderAdapterLogger = {
  info:
    typeof logger?.info === "function"
      ? logger.info.bind(logger)
      : () => {},
  warn:
    typeof logger?.warn === "function"
      ? logger.warn.bind(logger)
      : () => {},
  error:
    typeof logger?.error === "function"
      ? logger.error.bind(logger)
      : () => {}
};

JS 版本使用等價語法。

不要改變既有事件名稱、payload、錯誤正規化或 provider/storage 流程。

### 3. 新增或更新測試

新增最小測試，至少覆蓋以下情境：

#### Case A：正確包裝的 generationLogger

建立只有以下方法的 logger：

- logInfo
- logWarn
- logError

透過 wrapLoggerForProvider(logger) 傳入 createWallpaperProviderAdapter。

模擬：

- providerAdapter.generateImage() 成功回傳 base64 圖片
- storageUploader.uploadWallpaperImage() 成功回傳上傳結果

驗證：

- generateWallpaper() 成功完成
- 不會拋出 safeLogger.info is not a function
- logInfo 有收到 wallpaper_provider_adapter_succeeded

#### Case B：不完整 logger

直接傳入只有 error()、沒有 info() 的 logger。

模擬 provider 與 storage 成功。

驗證：

- generateWallpaper() 仍成功完成
- 不會因 logger 缺少 info() 而失敗

#### Case C：storage 上傳失敗

直接傳入缺少 error() 的 logger。

令 storageUploader.uploadWallpaperImage() 拋錯。

驗證：

- 原始 storage 錯誤仍被拋出
- failureCode 正確補成 STORAGE_UPLOAD_FAILED
- 不會因 safeLogger.error 不存在而覆蓋原始錯誤

優先更新既有 wallpaper-provider-adapter 或 handler wiring 測試，不要建立重複測試架構。

### 4. 搜尋殘留問題

搜尋整個專案：

createWallpaperProviderAdapter(
safeLogger.info(
safeLogger.warn(
safeLogger.error(
logger: logger
logger,

確認所有傳入 Wallpaper Provider Adapter 的 logger 都符合：

info / warn / error

若只有這一個 wiring 錯誤，只修改必要位置，不做大規模重構。

### 5. 執行驗證

執行專案現有的：

- lint
- type check
- unit tests
- integration tests
- local verification script

若完整測試命令不明確，先檢查 package.json、deno.json、README 或 scripts 目錄，不要自行杜撰命令。

## 限制

- 不要修改 Gemini SDK 呼叫方式
- 不要修改 Replicate 呼叫方式
- 不要修改 fallback eligibility
- 不要修改 normalizeProviderError()
- 不要修改 API response contract
- 不要輸出或記錄 API key、token、完整 prompt 或圖片 base64
- 不要移除目前的 temporary raw exception diagnostic
- 不要做與 logger 修正無關的重構

## 完成後回報

請清楚列出：

1. 修改的檔案
2. 每個檔案的修改摘要
3. 原始根因
4. 為什麼 wrapLoggerForProvider(logger) 能修正
5. defensive logger 如何避免未來同類錯誤
6. 新增或更新的測試
7. 實際執行的驗證命令
8. 每個驗證結果
9. 是否仍有任何失敗或未確認事項

完成修改後停下來，不要自動 commit 或 push。