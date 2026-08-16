# P-AUTH-03.1 Spec Alignment Hotfix — Review

## 修改哪些
- 修改 `js/services/auth/auth-service.js`：`isOfficialUser()` 的 Identity Verified 條件由
  `isEmailVerified(user) && isGoogleVerified(user)` 改為 `isEmailVerified(user) ||
  isGoogleVerified(user)`（新增獨立 `isIdentityVerified()` 函式承載此 OR 邏輯）。Session/JWT/
  `is_anonymous`/Status=Active 等既有條件全部保留不變。更新模組頂部與函式註解，記錄此為 Spec 文字
  誤寫的修正（Section 3 原文讀起來像同時需要 Email 與 Google，正確規則是至少一種可再次登入的永久
  Identity 已驗證）。
- 修改 `js/services/auth/__tests__/auth-service.test.js`：移除 2 個舊的 AND 語意測試（「無 Google
  視為非 Official」「Email 未驗證視為非 Official」），改為 3 個對應 OR 語意的測試：僅 Email 驗證
  → Official；僅 Google 驗證 → Official；兩者皆無 → 非 Official。
- 未修改 UI、Database Schema、Checkout 流程（`subscription-entry-guard.js`/`email-otp-service.js`/
  `subscription.html`/`js/pages/subscription-entry.js` 皆未變動——此前 P-AUTH-03.1 UI 整合中提到的
  "upgrade_incomplete" 已知限制，因本次修正而在真實情境下大幅減少發生機率，但相關 UI 分支程式碼本身
  不需改動）。

## 驗收結果
- `.\scripts\verify-local.ps1`：Syntax Check 全過；Unit Tests 279/279 通過（278 → 移除 2、新增 3，
  淨增 1），0 失敗。
- 既有 Session/JWT/Anonymous/Status 相關測試全數維持原行為並通過；未破壞既有功能。
