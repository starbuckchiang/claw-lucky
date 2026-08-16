# Auth Service API

來源：[js/services/auth/auth-service.js](../../../js/services/auth/auth-service.js)
測試：[js/services/auth/__tests__/auth-service.test.js](../../../js/services/auth/__tests__/auth-service.test.js)
規格依據：[003-spec-auth-subscription.md](../../../specs/003-spec-auth-subscription.md)（第 2、3 節）

純函式模組，不做任何 I/O（無 Supabase 呼叫、無 localStorage、無 DOM）。呼叫端需自行取得
Supabase 的 `session`/`user`（例如透過 `supabaseClient.auth.getSession()`），再傳入以下 API。
CJS（`require`）與瀏覽器（`window.AuthService`）雙輸出。

## 共用輸入型別

```ts
type AuthInput = {
  session: {
    user: object,
    access_token: string,
    expires_at?: number   // unix seconds，省略視為不過期
  } | null,
  user: {
    is_anonymous?: boolean,
    email_confirmed_at?: string | null,
    identities?: Array<{ provider: string }>
  } | null
}
```

---

## `resolveUserType({ session, user })`

**用途**：依 Spec 第 2 節判斷目前使用者屬於哪一種身份。

**輸入**：`AuthInput`

**輸出**：`"visitor" | "anonymous" | "official"`（即 `USER_TYPE` 常數之一）

**判斷邏輯**：
- 無 session 或 JWT 已過期 → `"visitor"`
- 有效 session 且 `user.is_anonymous === true` → `"anonymous"`
- 有效 session 且 `user.is_anonymous !== true` → `"official"`

> 註：這裡的 `"official"` 只代表「非匿名的正式登入者」，並不等於 Spec 第 3 節完整定義的
> Official User（尚需 email/Google 驗證）；完整判斷請用 `isOfficialUser()`。

---

## `isOfficialUser({ session, user })`

**用途**：判斷使用者是否符合 Spec 第 3 節「Official User」的完整定義，可否建立訂閱。

**輸入**：`AuthInput`

**輸出**：`boolean`

**判斷邏輯**（全部成立才回傳 `true`）：
1. 有效 session（存在且 JWT 未過期）
2. `user.is_anonymous !== true`
3. Email 已驗證（`user.email_confirmed_at` 存在）
4. Google 身分已驗證（`user.identities` 內含 `provider === "google"`）
5. Status = Active（**已知缺口**：`users` table 目前無 status/banned 欄位，未修改 schema，
   暫時恆為 `true`；待補上該欄位後需更新此判斷）

---

## `resolveAuthState({ session, user })`

**用途**：一次取得完整 Authentication State，供前端統一讀取，不必分別呼叫多個函式。

**輸入**：`AuthInput`

**輸出**：

```ts
{
  userType: "visitor" | "anonymous" | "official",
  isOfficialUser: boolean,
  isAnonymous: boolean,     // 僅在 hasSession && jwtValid 時可能為 true
  hasSession: boolean,
  jwtValid: boolean,
  emailVerified: boolean,
  googleVerified: boolean
}
```

各欄位即為對 `resolveUserType()` / `isOfficialUser()` 及內部驗證函式的組合結果，語意與上方兩個 API
一致，方便前端一次拿到所有旗標。

---

## 已知限制 / 後續事項

- `isOfficialUser()` 的 Status 檢查目前恆為 `true`，待 `users` table 補上
  `status` / `is_active` / `banned_at` 等欄位後需回來更新。
- 本模組目前尚未接入任何頁面（`js/user.js` 或 HTML script tag），下一階段
  （Email OTP / Anonymous Upgrade / Checkout）需要時再串接。
