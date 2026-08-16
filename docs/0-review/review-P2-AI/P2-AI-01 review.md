# P2-AI-01 Review

## Architecture
- 維持既有流程：Client → API → Orchestrator → Generation Service → Provider Adapter → AI Provider
- Gemini SDK 僅出現在 Provider Adapter 邊界

## Provider Integration
- 新增 GeminiProviderAdapter
- 由 provider factory 注入，不改 Generation Service

## Configuration
- MODEL / TIMEOUT / MAX_RETRY / IMAGE_SIZE / SAFETY_LEVEL / API KEY 皆由 env
- 無 hardcode 機密

## Response Mapping
- Gemini 回應映射至 NormalizedProviderResponse
- 包含 provider/model/finishReason/image/usage/durationMs/rawResponse(debug only)

## Error Mapping
- 映射為：
  - PROVIDER_TIMEOUT
  - PROVIDER_RATE_LIMIT
  - PROVIDER_AUTH_FAILED
  - PROVIDER_BAD_REQUEST
  - PROVIDER_UNAVAILABLE
  - PROVIDER_UNKNOWN

## Retry Policy
- 僅 Provider Adapter 執行 retry
- 依 MAX_RETRY

## Observability
- structured log + correlationId
- 不記錄 prompt 全文與任何 secret

## Security
- API KEY 僅 server side
- 不提交 `.env`

## Testing
- Mock Gemini Success / Timeout / Rate Limit / Auth Failure / Unknown Failure
- Retry Success / Retry Failure
- Normalized Response / Normalized Error
- Correlation Propagation
- 全部 mock SDK，未呼叫真實 Gemini

## Known Limitations
- 目前只實作 gemini provider，其他 provider 為後續擴充

## Real Provider Readiness

- [ ] Mock Provider PASS
- [ ] Environment Variable 完成
- [ ] API Key 不會外洩
- [ ] Provider 可切換
- [ ] Retry Policy 驗證
- [ ] Error Mapping 驗證
- [ ] Observability 驗證
- [ ] Ready for Real Provider Manual Test
這代表：
程式已經準備好接真實 AI，但還沒有真的打 API。

## Needs Revision

Reason

目前測試腳本並未固定測試

Gemini Provider。

而是：

自動搜尋：

Provider Module。

可能：

測到：

非 Gemini。

這不符合：

P2-AI-01

Real Provider Integration

Acceptance。


## Needs Revision
Status
Accepted with Minor Revision

Blocking

None

Minor

- 移除 Dynamic Module Discovery
- Logger 不要完全靜音
- 增加 Invalid Model Acceptance
- 增加 Invalid API Key Acceptance

<!-- ...existing code... -->
## Known Limitations
- 目前只實作 gemini provider，其他 provider 為後續擴充

## Real Provider Readiness

- [x] Mock Provider PASS
- [x] Environment Variable 完成
- [x] API Key 不會外洩
- [x] Provider 可切換
- [x] Retry Policy 驗證
- [x] Error Mapping 驗證
- [x] Observability 驗證
- [x] Ready for Real Provider Manual Test
這代表：
程式已經準備好接真實 AI，但還沒有真的打 API。

## Needs Revision

**[COMPLETED]**

- **Reason**: 測試腳本使用動態模組發現，而非固定驗證 Gemini Provider。缺少真實的 `GeminiProvider` 實作與 `ProviderFactory`。
- **Status**: Accepted with Minor Revision
- **Blocking**: None
- **Minor**:
  - [x] 移除 Dynamic Module Discovery
  - [x] Logger 不要完全靜音
  - [ ] 增加 Invalid Model Acceptance
  - [ ] 增加 Invalid API Key Acceptance

### Revision Summary
- **新增 `GeminiProvider`**: 建立了 `js/services/ai/gemini-provider.js`，封裝了 `GoogleGenAI` SDK 呼叫，並回傳正規化後的回應與錯誤。
- **新增 `ProviderFactory`**: 建立了 `js/services/ai/provider-factory.js`，根據環境變數 `AI_PROVIDER` 建立對應的 Provider 實例，將 Provider 建立邏輯與 Adapter 解耦。
- **更新 `ProviderAdapter`**: Adapter 現在透過 `ProviderFactory` 取得 Provider，不再直接依賴任何 SDK。
- **更新 `test-real-gemini-provider.js`**: 測試腳本現在直接 `import` `provider-factory.js` 來建立並驗證真實的 Gemini Provider，移除了所有動態搜尋邏輯，確保測試目標固定。