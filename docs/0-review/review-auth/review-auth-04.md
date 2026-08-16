# P-AUTH-04 Checkout Authorization — Review

## 修改哪些
- 新增 `js/services/subscription/checkout-authorization-service.js`：Checkout Authorization Service
  （純協調層，DI 模式，預設沿用 `js/services/auth/auth-service.js`）。實作 003-spec-auth-subscription.md
  第 11 節 Case 1-5：`authorizeCheckout({ session, user, planId })` → 無 Session/JWT → `UNAUTHORIZED`；
  Anonymous → `ACCOUNT_UPGRADE_REQUIRED`；Identity 未驗證 → `IDENTITY_NOT_VERIFIED`；已有有效訂閱 →
  回傳既有訂閱（`created:false`，不建立新的）；正式使用者且無訂閱 → 建立 Checkout Session
  （`created:true`）。
- 新增 `js/services/subscription/__tests__/checkout-authorization-service.test.js`：12 個單元測試，
  涵蓋 5 種 Case、建構子依賴檢查、Email-only Official（沿用 P-AUTH-03.1 OR 規則）、repository/
  checkout creator 例外正規化。
- 新增 `supabase/functions/_shared/subscription-checkout-handler.js`（+ `.ts` twin）：Edge Function
  共用 Handler，沿用 `wallpaper-generate-handler.js` 慣例——請求格式驗證（`planId` 必填，禁止
  `userId`/金鑰等欄位）、統一錯誤碼→HTTP Status 對應
  （401/403/403/400/503/502）、Case 4→200、Case 5→201。內建
  `createPlaceholderSubscriptionRepository()`／`createPlaceholderCheckoutSessionCreator()`
  （見下方已知限制）。
- 新增 `supabase/functions/_shared/__tests__/subscription-checkout-handler.test.js`：12 個測試，涵蓋
  請求驗證、5 種 Case 的 HTTP Status 對應、correlationId 回傳、真實 wiring（含 Placeholder）行為。
- 新增 `supabase/functions/_shared/lib/auth-service.ts`、
  `supabase/functions/_shared/lib/checkout-authorization-service.ts`：對應 `.js` 的 ESM port（邏輯
  不變），供 Deno Edge Runtime 使用。
- 新增 `supabase/functions/subscription-checkout/index.ts`：薄 Deno HTTP 邊界，沿用
  `wallpaper-generate/index.ts` 慣例（CORS、JSON 解析、correlationId、委派共用 Handler）。
- 修改 `supabase/functions/_shared/supabase-clients.ts`：新增 `resolveAuthenticatedUser(req)`
  （回傳完整 Supabase auth user 物件，而非僅 id），供本階段需要 `is_anonymous`/
  `email_confirmed_at`/`identities` 的場景使用；未變動既有 `resolveAuthenticatedUserId`（純新增，
  不影響 wallpaper-generate/wallpaper-status 既有行為）。
- 修改 `scripts/verify-local.ps1`：加入上述新檔案的 `node --check` 與測試 glob。
- 未修改 Database Schema、UI、Payment、Webhook、Account Merge。

## 為什麼
依 Spec 第 11 節，`subscription-checkout` Edge Function 必須自行重新驗證身份（不得信任前端
`SubscriptionEntryGuard` 的判斷），並且已訂閱者不得重複建立訂單。全部 Auth 判斷沿用 P-AUTH-01～03
既有 Service（`resolveAuthState()`），未重複實作任何 Auth 邏輯。因專案目前無 `subscriptions` table
亦無真實金流串接，且本階段明確排除 Payment/Webhook/Schema 異動，`subscriptionRepository`/
`checkoutSessionCreator` 以明確標註的 Placeholder 實作，讓 Authorization 流程本身（本階段真正交付項）
可被完整驗證。

## 驗收結果
- `.\scripts\verify-local.ps1`：Syntax Check 全過（含新 `.js`/`.ts` 檔案）；Unit Tests 300/300 通過
  （原 279 + 新增 21：Checkout Authorization Service 9 個、Edge Function Handler 12 個），0 失敗。
- 無 JWT→401、Anonymous→403、Identity 未驗證→403、已訂閱→回傳既有訂閱（200）、合法使用者→建立
  Checkout（201），皆有對應測試並通過；未破壞既有功能。

## 待 P-AUTH-05 處理事項（不實作）
- 建立真實 `subscriptions` table migration，並以真實 Supabase-backed repository取代
  `createPlaceholderSubscriptionRepository()`。
- 串接真實 Payment Provider（Stripe/PayPal 等），取代
  `createPlaceholderCheckoutSessionCreator()`；需要獨立 ADR。
- Webhook（付款成功後啟用 Subscription）。
- Existing Account Login 的 Account Merge（Spec 第 7 節）。
- 前端串接（`subscription-entry.js` 呼叫真實 `subscription-checkout` Edge Function，取代目前
  P-AUTH-03.1 的「Ready for Checkout」暫代畫面）。
