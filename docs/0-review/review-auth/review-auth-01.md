# P-AUTH-01 Authentication Foundation — Review

## 修改哪些
- 新增 `js/services/auth/auth-service.js`：純函式 Authentication Service（CJS + 瀏覽器雙輸出，沿用
  `wallpaper-selection-service.js` 慣例）。提供 `resolveUserType()`、`isOfficialUser()`、
  `resolveAuthState()`，輸入為既有的 Supabase `session`/`user` 物件，不做任何 I/O。
- 新增 `js/services/auth/__tests__/auth-service.test.js`：8 個單元測試，涵蓋 Visitor / Anonymous /
  Official 三種身份與邊界情境（JWT 過期、email 未驗證、無 Google identity、無 access_token）。
- 修改 `scripts/verify-local.ps1`：加入新模組的 `node --check` 與測試 glob，使其納入既有驗證流程。
- 未修改任何 HTML/UI 檔案，亦未修改 `js/user.js`/`js/api.js`（前端實際串接留待下一階段）。

## 為什麼
依 003-spec-auth-subscription.md 第 2、3 節定義 Visitor / Anonymous User / Official User 判斷邏輯。
沿用既有 `js/services/**` 可測試架構慣例，而非直接擴充瀏覽器專用的 `js/user.js`（無法在 Node 下單元
測試），以滿足「單元測試」交付項；同時遵守「不修改 UI」與最小變更原則，暫不將新 Service 接入既有頁面。

## 驗收結果
- `.\scripts\verify-local.ps1`：Syntax Check 全過；Unit Tests 255/255 通過（原 247 + 新增 8），0 失敗。
- Visitor / Anonymous User / Official User 三類判定皆有對應測試並通過；未破壞既有測試。

## 未完成事項
- `isOfficialUser()` 的 Spec 第 3 節要求「Status = Active」，但 `users` table 目前無 status/banned
  欄位（未新增 schema），暫時視為恆為 active，待日後欄位補上再調整。
- 尚未將 `AuthService` 接入任何頁面（`js/user.js`/HTML script tag），下一階段（Email OTP / Anonymous
  Upgrade / Checkout）需要時再串接。
