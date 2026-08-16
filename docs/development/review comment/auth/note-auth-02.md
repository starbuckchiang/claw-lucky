| 驗收項目                               | 結果   | 說明                                                                                          |
| ---------------------------------- | ---- | ------------------------------------------------------------------------------------------- |
| ✅ 建立 Email OTP Service             | PASS | 已新增 `js/services/auth/email-otp-service.js`，提供 `sendUpgradeOtp()`、`verifyUpgradeOtp()` 等功能。 |
| ✅ Anonymous → Official Upgrade     | PASS | 採用 Supabase 官方 Anonymous Upgrade 流程 (`updateUser` / `verifyOtp`)。                           |
| ✅ 保留 Auth UUID                     | PASS | 已加入 `isUuidPreserved()`，並於驗證流程檢查 UUID 是否一致。                                                 |
| ✅ 回傳最新 Authentication State        | PASS | 已整合 P-AUTH-01 的 `resolveAuthState()`。                                                       |
| ✅ 與 P-AUTH-01 整合                   | PASS | Review 明確說明已整合既有 Auth Service。                                                              |
| ✅ 不修改 UI                           | PASS | 未修改 HTML、`js/user.js`、`js/api.js`。                                                          |
| ✅ 不實作 Checkout / Payment / Webhook | PASS | 保留至後續階段。                                                                                    |
| ✅ 單元測試                             | PASS | 新增 12 個測試，共 267/267 全數通過。                                                                   |
| ✅ 不影響既有功能                          | PASS | 所有既有測試持續通過。                                                                                 |
## 1. Visitor Assets 尚未做整合驗證（可接受）

Review 說明：

吉祥物
禮物
點數
購物車

沒有另外撰寫遷移程式，因為設計上是保留同一個 Auth UUID，理論上資料自然會保留；但尚未以真實 Supabase 整合測試驗證。

這與你的 Prompt 並不衝突，因為 P-AUTH-02 的 Deliverables 是 UUID 保留驗證，不是 E2E 資料保留驗證。

## 2. Status = Active 仍未完整實作（延續 Gate 1）

isOfficialUser() 中的 Status = Active 仍因資料表沒有對應欄位而暫時視為成立，這是已知限制，並非 P-AUTH-02 新增的問題

## 3.建議在進入 Gate 3 前增加一個 E2E 手動驗證

雖然不影響 Gate 2 通過，但建議在開始串接 UI 前先手動驗證一次：

建立 Anonymous User。
使用 Email OTP 完成升級。
確認升級前後 auth.users.id（UUID）完全一致。
確認原有使用者資料（例如購物車、點數等）仍可查詢。

這可以及早驗證 Supabase Anonymous Upgrade 在你的實際環境中符合預期，避免等到 Checkout 或 Webhook 階段才發現整合問題。

| 驗收項目                 | 結果     |
| -------------------- | ------ |
| Anonymous 建立         | ✅ PASS |
| Email Upgrade        | ✅ PASS |
| UUID 保留              | ✅ PASS |
| Email 驗證             | ✅ PASS |
| is_anonymous → false | ✅ PASS |
| Session 更新           | ✅ PASS |
| 沒建立第二個 User          | ✅ PASS |
| E2E 手動驗證             | ✅ PASS |

Gate 2 E2E 驗證結果
1. UUID 保留 ✅ PASS

升級前：

af12a745-943c-4d5d-ac43-561704c0ab7a

升級後：

af12a745-943c-4d5d-ac43-561704c0ab7a

UUID 完全相同。

2. Email 綁定成功 ✅ PASS
email:
starbuckchiang@gmail.com
3. 已完成 Email 驗證 ✅ PASS
email_confirmed_at:
2026-08-03T08:40:13.208025Z

代表 Email 已完成驗證。

4. Anonymous → Official 成功 ✅ PASS
is_anonymous:
false

這就是 P-AUTH-02 最重要的驗收點。

5. Session Refresh 有效 ✅ PASS

一開始：

email = ""

is_anonymous = true

Refresh 後：

email = starbuckchiang@gmail.com

is_anonymous = false

代表新的 JWT 已經取得。

## 4. 補一個小修正（P-AUTH-02 Hotfix）

目前完成 Email 驗證後，需要手動呼叫 refreshSession() 才會取得新的 JWT。
建議在升級流程中自動處理，例如：

await authClient.refreshSession();

const {
  data: { session }
} = await authClient.getSession();

return resolveAuthState(session);
Hotfix 驗收
✅ 修改位置正確

只修改：

js/services/auth/email-otp-service.js

而且只修改：

verifyUpgradeOtp()

沒有把 refreshSession() 分散到 UI 或其他頁面，符合我們討論的設計。

✅ 流程正確

現在流程變成：

verifyOtp()
      ↓
UUID Preservation Check
      ↓
refreshSession()
      ↓
getSession()
      ↓
resolveAuthState()
      ↓
return

這就是我們 E2E 驗證後發現最需要補強的地方。

✅ API 沒有破壞

Review 明確表示：

{ ok, data: { authUserId, authState } }

API 形狀完全沒變。

因此：

P-AUTH-03
P-AUTH-04

都不用修改呼叫方式。

✅ 測試完整

新增：

refresh 成功
refreshSession() 失敗
getSession() 失敗

三種情境。

而且：

270 / 270 PASS

代表沒有破壞既有功能。

## 5.建議再加一個小改善（非必要）

目前 verifyUpgradeOtp() 已經回傳：

authState

如果未來要讓 P-AUTH-03 更簡潔，我建議可以在 authState 中直接提供：

{
  userType: "visitor" | "anonymous" | "official",
  isOfficialUser: true,
  session,
  user
}

這樣後續頁面只要：

if (result.authState.isOfficialUser) {
    startCheckout();
}

不用再自行解析 userType 或重新查詢 Session，API 會更直觀。不過這屬於設計優化，不影響目前 Hotfix 的通過。