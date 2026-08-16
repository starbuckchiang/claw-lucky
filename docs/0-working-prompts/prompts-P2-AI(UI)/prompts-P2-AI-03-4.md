請修正 P2-AI-03 部署前 Gate Review 發現的問題。

先閱讀並遵循：
1. AI constitution.md
2. P2-AI-03 工作規格
3. P2-AI-03-佈署前檢查.md
4. 現有 Prompt Registry、Fallback Template 與測試架構

本次允許修改程式碼與測試，但禁止 deploy、commit、push。

一、修正 daily_lucky_context 模板

修正 fallback-templates.js 中的 daily_lucky_context，使其：

1. 明確要求只輸出合法 JSON
2. 使用 camelCase 欄位
3. 完整包含：
   - luckyTheme
   - blessing
   - story
   - oneLiner
   - shopkeeperMessage
   - version
4. 所有必要欄位都必須是非空字串
5. 要求使用繁體中文
6. 不得輸出 Markdown code fence 或 JSON 以外的說明文字
7. 欄位格式必須與 validateShopkeeperContext 完全一致

同時檢查 Supabase Prompt Registry 是否已有
daily_lucky_context active prompt 的 migration 或 seed。

如果沒有，請提出並實作可重複執行、無重複資料風險的 migration，
確保部署環境能取得符合相同 schema 的 active prompt。

不得破壞既有 Prompt Registry 架構，
不得建立第二套 Registry。

二、補齊缺失測試

補上以下測試：

1. Same Mascot DTO
   - 相同 Mascot/Gift DTO 的輸出都符合一致的 Shopkeeper Context 結構
   - 不要求 AI 文字內容完全相同

2. Snapshot Persist
   - generation-service 傳入
     generationRepository.createGenerationRecord 的 payload
     必須包含 shopkeeperSnapshot、shopkeeperVersion、source

3. metadata_json Persist
   - generation-repository 組出的 metadata_json
     必須包含 shopkeeperSnapshot、shopkeeperVersion、source
   - 確認不會覆蓋既有 promptSnapshot、contextVersion、
     builderVersion 等欄位

4. 真實 fallback template contract test
   - 測試必須直接載入 fallback-templates.js 的
     daily_lucky_context
   - 確認模板明列 Validator 要求的全部欄位
   - 避免測試只使用手刻 mock template，漏掉正式模板錯誤

三、驗證

1. 執行 P2-AI-03 相關測試
2. 執行完整 verify-local.ps1
3. 回報新的測試總數
4. 逐項對照原規格 8 項測試，證明 8/8 已覆蓋
5. 檢查 git diff，確認沒有 UI、wallpaper.html 或無關範圍修改
6. 檢查 migration 是否安全且可重複部署
7. 不得把 API Key 或 secrets 寫入檔案

最後輸出：
- 修改檔案清單
- 問題根因
- 修正內容
- 8/8 測試覆蓋證據
- 完整測試結果
- migration／active prompt 處理方式
- 是否達到部署 Gate PASS
- 部署後仍需手動驗證項目

完成後停止，等待 Product Review。
不要 deploy、不要 commit、不要 push。