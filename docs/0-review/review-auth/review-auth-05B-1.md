# P-AUTH-05B-1 — Account Merge Begin/Finalize Implementation — Review

> **P-AUTH-05B-1 hotfix 更正（見 [review-auth-05B-1-hotfix.md](./review-auth-05B-1-hotfix.md)）**：
> 本文件下方「需求 7 情境對照表」原本把「重複點擊（duplicate click）」誤列為一律回傳 `409` 的失敗
> 情境，與後面「05C 測試計畫」中「合法重送應回傳相同 `mergeId`」的敘述互相矛盾——已在下方表格中
> 訂正並標註。**Gate 狀態同時訂正**：本文件不代表「05B 整體完成」，只代表「05B-1（Account Merge
> Begin/Finalize 本身）完成候選」；05B-2（`mascot`/`redeem_history`/`points`/`shop_cart`/`orders`
> 安全寫入 API）仍完全未開始，也是 `20260816000000` RLS migration 能否套用的前置條件，詳見 hotfix
> 文件。

**狀態：本階段是 05B Implementation 的第一步 — 依 `review-auth-05A.1-hotfix.md` 的契約，實際撰寫
Begin/Finalize Edge Function 本體，並將前端從 `idempotencyKey` 概念改為 `claimToken` 概念。僅實作
與（Node 側）測試，**未部署 Production，未套用 `20260816000000` RLS migration**。**

延續 `review-auth-05A.1-hotfix.md` 建立的三關卡框架：

- **05A Design Gate**：schema／RLS／SECURITY DEFINER function 設計 — 已完成（`20260816000000`～
  `20260816000400` migration + 靜態結構測試），本次未修改。
- **05B Implementation**：實際撰寫 Begin/Finalize Edge Function 本體 — **05B-1（Account Merge
  Begin/Finalize 本身）完成候選**（Node 側可測部分）。**不等於「整體 05B 完成」**——05B-2（其餘
  user_id 關聯資料表的安全寫入 API：`mascot`/`redeem_history`/`points`/`shop_cart`/`orders`）完全
  尚未開始，見 [review-auth-05B-1-hotfix.md](./review-auth-05B-1-hotfix.md)。
- **05C Staging Gate**：在真實／staging Supabase 專案上執行「真實 PostgreSQL 測試計畫」— **本次未執行**，見下方測試計畫。

正式環境部署需要 05A → 05B → 05C 依序全部通過；本文件只涵蓋 05B-1 的完成度，不代表可以部署 Production，
也不代表整體 05B 已完成。


## 本次做了什麼

### 1. Account Merge Repository（RPC 呼叫層）
新增 [js/services/auth/account-merge-repository.js](../../../js/services/auth/account-merge-repository.js)
（+ Deno 雙生檔 [supabase/functions/_shared/lib/account-merge-repository.ts](../../../supabase/functions/_shared/lib/account-merge-repository.ts)）：

- `createAccountMergeRepositoryFromSupabaseClient({ supabaseClient })` 回傳 `{ createClaim, finalizeMerge }`，
  分別呼叫 `create_account_merge_claim(...)` 與 3 參數版 `finalize_account_merge(...)` RPC。
- 呼叫端必須提供**service-role** Supabase client（由 Edge Function 入口組裝，本模組本身不建立
  client，也不決定 client 的權限）。
- `finalizeMerge` 永遠只傳 3 個參數（`claimTokenHash`/`existingUserId`/`existingUserEmailHash`），
  沒有任何管道可以帶入 `idempotencyKey`。

### 2. Begin/Finalize 業務邏輯（Handler）
新增 [supabase/functions/_shared/account-merge-handler.js](../../../supabase/functions/_shared/account-merge-handler.js)
（+ Deno 雙生檔 `.ts`），實作 `review-auth-05A.1-hotfix.md` 契約的每一條：

- **Begin**：
  - Request body **只允許** `targetEmail`（allowlist，非 blacklist）— 任何其他欄位（含
    `anonymousUserId`/`existingUserId`/`idempotencyKey`）整包請求直接 `400 INVALID_REQUEST`。
  - 呼叫者身份 100% 來自 Edge Function 入口用 `resolveAuthenticatedUser(req)` 解析出的、已驗證的
    `user` 物件（Authorization JWT），**絕不**讀取 request body 裡的任何身份欄位。`user.is_anonymous`
    必須為 `true`，否則 `403 MERGE_REQUIRES_ANONYMOUS_SESSION`。
  - `targetEmail` 先正規化（trim + lowercase）再雜湊（`merge-claim-crypto.js` 的
    `normalizeEmailForHash`/`hashClaimValue`），只有雜湊值會進入 `create_account_merge_claim`。
  - Claim token 用 `crypto.randomBytes(32)`（256-bit）產生；**只有它的雜湊**會被送進資料庫/寫入任何
    log；raw token 只在成功回應的 `data.claimToken` 出現一次，Handler 本身完全不記錄它。
  - 成功回傳 `201 { ok: true, data: { claimToken, expiresAt } }`。
- **Finalize**：
  - Request body **只允許** `claimToken`（allowlist）— `anonymousUserId`/`existingUserId`/`email`/
    `emailHash`/`idempotencyKey` 任何一個出現都會讓整包請求被拒絕（`400 INVALID_REQUEST`），不是「忽略
    但繼續處理」。
  - 呼叫者的既有帳號身份（`existingUserId`/`existingUserEmail`）100% 來自已驗證的 `user` 物件；
    `user.is_anonymous` 必須為 `false`，否則 `403 MERGE_REQUIRES_OFFICIAL_SESSION`。
  - 呼叫 3 參數版 `finalize_account_merge` RPC — 沒有 `idempotencyKey` 可傳。
  - **任何** RPC 失敗原因（claim 不存在／過期／Email 不符／已使用／資料不一致／網路錯誤）**全部**對外
    翻譯成同一組 `409 MERGE_CLAIM_INVALID`，絕不透露是哪一種原因、claim/Email 是否存在、或任何原始
    SQL 訊息；真實原因只透過 `console.error` 記錄在伺服器端。
  - 成功回傳 `200 { ok: true, data: { merged: true, mergeId, result } }`。

### 3. Edge Function 入口
新增 [supabase/functions/account-merge/index.ts](../../../supabase/functions/account-merge/index.ts)，
完全比照既有 `subscription-checkout/index.ts` 的慣例（薄入口，只做 CORS／身份解析／service-role
client 組裝／JSON 解析／correlationId／委派給 shared handler／把 `{statusCode, body}` 轉成
`Response`）。依 URL pathname 後綴路由：

```
POST /functions/v1/account-merge/begin    -> handleBeginMergeRequest
POST /functions/v1/account-merge/finalize -> handleFinalizeMergeRequest
```

**這個檔案無法在本機驗證**（此環境沒有 Deno CLI，`.ts` 檔從未被實際執行過，只能靠與它逐行對應的
`.js` 雙生檔的 Node 測試間接佐證邏輯一致）— 見下方「05C Staging Gate」測試計畫。

### 4. 前端：`idempotencyKey` → `claimToken`

- [js/services/auth/account-merge-service.js](../../../js/services/auth/account-merge-service.js)
  改寫為兩個方法的 claimToken 契約：
  - `beginAccountMerge({ email })` — 呼叫注入的 `beginMergeApiClient`；未設定時誠實回傳
    `MERGE_NOT_SUPPORTED`（沿用 P-AUTH-04.3 建立的「誠實失敗，絕不假裝成功」慣例）。
  - `mergeAnonymousIntoExistingAccount({ claimToken })` — 呼叫注入的 `finalizeMergeApiClient`；
    `claimToken` 缺失回傳 `MERGE_CLAIM_TOKEN_REQUIRED`；同樣未設定 client 時回傳
    `MERGE_NOT_SUPPORTED`。**不再接受/轉發** `idempotencyKey`/`anonymousUserId`/`existingUserId`。
- [js/services/auth/subscription-entry-guard.js](../../../js/services/auth/subscription-entry-guard.js)：
  - 建構子現在**要求** `accountMergeService.beginAccountMerge` 與 `.mergeAnonymousIntoExistingAccount`
    兩者皆存在（缺一即 throw）。
  - 新增 `beginAccountMerge({ email })` 薄轉送函式。
  - `completeLoginAndResume({ email, token, pending, otpPurpose, claimToken })` — 參數從舊版的
    `previousAuthUserId` 改為 `claimToken`；**移除** `buildMergeIdempotencyKey(...)` 輔助函式（不再
    於前端計算任何 idempotency key —— canonical key 完全由資料庫內部計算，見
    `review-auth-05A.1-hotfix.md`）；直接把呼叫端傳入的 `claimToken` 原封不動轉給
    `accountMergeService.mergeAnonymousIntoExistingAccount({ claimToken })`。
- [js/pages/subscription-entry.js](../../../js/pages/subscription-entry.js)：
  - 新增 `pendingClaimToken`（單純的頁面內記憶體變數，`resetPendingOtpState()` 一併清除）— **從未**
    寫入 `localStorage`/`sessionStorage`（需求 3 的強制要求）。
  - `handleSendOtp()` 的 `EMAIL_ALREADY_REGISTERED` 分支：在（仍持有匿名 Session 時）呼叫
    `guard.beginAccountMerge({ email })`，時機在偵測到「匿名 `updateUser` 回傳 Email 已存在」之後、
    `guard.startLoginOtp(...)`（呼叫 `signInWithOtp`）之前 — 精確對應需求 3。Begin 失敗（例如尚未部署
    /網路暫時性錯誤）**不會**擋住登入本身：`pendingClaimToken` 維持 `null`，之後 Finalize 會透過既有的
    `EXISTING_ACCOUNT_MERGE_REQUIRED` 阻擋器優雅失敗，而不是讓一次合併基礎設施的問題連登入這個更基本的
    能力都無法使用（刻意設計，非疏漏）。
  - `handleVerifyOtp()` 的 `pendingMode === "login"` 分支：呼叫 `guard.completeLoginAndResume(...)`
    時改傳 `claimToken: pendingClaimToken`（不再傳 `previousAuthUserId` — 該參數對這個呼叫路徑已經
    沒有意義；`completeUpgradeAndResume`（匿名升級路徑）呼叫仍然照舊使用 `previousAuthUserId` 做 UUID
    Preservation，未受影響）。成功（`ENTER_CHECKOUT`）會自動繼續原本的 Checkout；失敗
    （`EXISTING_ACCOUNT_MERGE_REQUIRED`）顯示錯誤並提示使用者重新點擊「訂閱」（此時 Session 已是
    既有帳號，重新點擊會直接評估為 `ENTER_CHECKOUT`，見 `handlePlanClick`）。
  - 新增 `beginMergeApiClient`/`finalizeMergeApiClient`：真正呼叫
    `window.supabaseClient.functions.invoke("account-merge/begin"|"account-merge/finalize", { body })`
    的 HTTP 包裝函式，統一透過 `invokeAccountMergeFunction(path, body)`。**已知且已處理**的細節：
    supabase-js 的 `functions.invoke()` 對任何非 2xx 回應一律回傳 `error`（`FunctionsHttpError`），
    不會把應用層自己的 `{ok:false, error:{code,message}}` JSON 主體放進 `data`；因此包裝函式改讀
    `error.context`（原始 `Response` 物件）並嘗試 `.json()` 取出真正的錯誤碼/訊息，若解析本身失敗則
    退回一個通用的 `MERGE_REQUEST_FAILED` 訊息（絕不讓解析失敗變成未捕捉的例外）。
  - 未曾、也不會把 service-role key 或任何機密值放進這個瀏覽器端檔案（需求 5 的明確禁止）。
- [subscription.html](../../../subscription.html)：對應三個 `<script>` 的 cache-busting query string
  bump 為 `?v=20260816-1`（本專案無 build step，靜態頁面靠這個機制避免瀏覽器快取舊檔）。

## 修改/新增檔案清單

| 檔案 | 狀態 |
|---|---|
| `js/services/auth/account-merge-repository.js` | 新增 |
| `supabase/functions/_shared/lib/account-merge-repository.ts` | 新增（Deno 雙生檔） |
| `js/services/auth/__tests__/account-merge-repository.test.js` | 新增 |
| `supabase/functions/_shared/account-merge-handler.js` | 新增 |
| `supabase/functions/_shared/account-merge-handler.ts` | 新增（Deno 雙生檔） |
| `supabase/functions/_shared/__tests__/account-merge-handler.test.js` | 新增 |
| `supabase/functions/account-merge/index.ts` | 新增（Deno Edge Function 入口，無法本機測試） |
| `js/services/auth/account-merge-service.js` | 改寫（idempotencyKey → claimToken 契約） |
| `js/services/auth/__tests__/account-merge-service.test.js` | 改寫 |
| `js/services/auth/subscription-entry-guard.js` | 修改（新增 `beginAccountMerge`、`completeLoginAndResume` 改用 `claimToken`、移除 `buildMergeIdempotencyKey`） |
| `js/services/auth/__tests__/subscription-entry-guard.test.js` | 修改（對應上面契約變更） |
| `js/pages/subscription-entry.js` | 修改（`pendingClaimToken` 狀態、真正的 Begin/Finalize HTTP 呼叫、Begin 呼叫時機） |
| `subscription.html` | 修改（cache-busting query string bump） |
| `scripts/verify-local.ps1` | 修改（新增 `node --check` 項目） |

未修改：任何資料庫 migration／RLS／SECURITY DEFINER function 本體（`20260816000000`～
`20260816000400` 維持 05A.1 版本不變）、任何方案/價格設定。

## 執行 `.\scripts\verify-local.ps1`

```
== Syntax Check ==  全數通過
== Unit Tests ==
ℹ tests 414
ℹ pass 414
ℹ fail 0
Verification Complete
```

（此數字含本次新增/修改的所有測試；上一個查核點是 05A.1 完成時的 381/381，本次淨增 33 個測試。）

## 需求 7 情境對照表（Handler 層，Node 測試已覆蓋）

以下情境全部由 `supabase/functions/_shared/__tests__/account-merge-handler.test.js` 覆蓋：

| 情境 | 覆蓋方式 |
|---|---|
| Token 過期 | `FINALIZE_FAILURE_SCENARIOS` 參數化案例之一：repository 拋出「claim expired」，Handler 一律回傳 `409 MERGE_CLAIM_INVALID`，訊息與其他失敗原因完全相同。 |
| Email 不符 | 同上參數化案例：repository 拋出「email mismatch」，回應與其他情境無法區分。 |
| 重新寄送（resend）／重複點擊（duplicate click） | **［P-AUTH-05B-1 hotfix 更正］** 對同一有效／已使用 `claimToken` 的合法重送與同一使用者的重複點擊，Handler 回傳 **`200`** 與**完全相同**的 `mergeId`／`result`，**絕不**映射成 `409`——這與「錯誤 token／過期／Email 不符」等真正失敗情境是完全不同的兩條路徑，見下方「Gate 狀態」一節說明本文件先前版本曾誤將這兩者混為一談。只有錯誤/偽造的 `claimToken`、已過期、或 Email 不符時才會回 `409 MERGE_CLAIM_INVALID`。 |
| Session 切換 | Begin 要求 `user.is_anonymous === true`、Finalize 要求 `user.is_anonymous === false`，兩者都直接讀已驗證的 `user` 物件而非 request body — 分別測試了「用既有帳號 Session 呼叫 Begin」與「用匿名 Session 呼叫 Finalize」皆被拒絕（`403`）。 |
| 網路失敗 | repository 拋出的任意錯誤（含網路類）在 Begin 對外回傳 `502 MERGE_BEGIN_FAILED`；在 Finalize 統一收斂為 `409 MERGE_CLAIM_INVALID`（與其他失敗原因一致，不特殊對待網路錯誤，避免藉由狀態碼差異洩漏內部原因）。**注意**：這裡指的是 RPC/連線本身失敗（例如根本連不上資料庫），而不是「合法 claimToken 的重送」——後者不算失敗，見上一列。 |
| Finalize 成功／rollback | 成功路徑回傳 `200 { merged: true, mergeId, result }`；rollback（資料庫交易失敗）由 05A.1 的單一 `SECURITY DEFINER` 交易與本次 Handler 的統一錯誤映射共同保證 — Handler 本身不做任何「部分成功」的特殊處理，RPC 要嘛完整成功要嘛整體失敗並映射成同一個錯誤碼。 |


前端骨架層（`account-merge-service.js`/`subscription-entry-guard.js`）另有對應測試（見
`js/services/auth/__tests__/account-merge-service.test.js`、
`js/services/auth/__tests__/subscription-entry-guard.test.js`），涵蓋 claimToken 轉發、
`MERGE_NOT_SUPPORTED`/`MERGE_CLAIM_TOKEN_REQUIRED` 誠實失敗、成功自動繼續 Checkout、失敗保留可重試
狀態等。

## 在進入 05C Staging Gate 之前，還缺什麼

1. **Edge Function 從未在 Deno Runtime 下實際執行過**——此環境沒有 Deno CLI，`account-merge/index.ts`
   與其 `_shared/*.ts`/`_shared/lib/*.ts` 雙生檔只做過人工逐行比對，從未被真正 import/執行/型別檢查。
   `.ts`/`.js` 雙生檔之間的任何細微落差（例如 Deno 版 `hashClaimValue` 用 `crypto.subtle.digest`
   而非 Node 版的 `crypto.createHash`，兩者是否在所有輸入下產生完全相同的雜湊值）**只能靠實際部署後
   驗證**。
2. **資料庫層併發/交易行為未被真正驗證**——05A.1 已完成的靜態 SQL 結構測試無法證明 `FOR UPDATE` 鎖
   + MVCC 在真實併發重送下真的如預期運作（見 `review-auth-05A.1-hotfix.md`「限制重申」）。
3. **RLS migration（`20260816000000_core_user_tables_owner_rls.sql`）仍未套用**——這是 05A 就已存在
   的既有 blocker，本次未解除：`js/api.js`／`js/shop/shop-api.js`／`js/shop/shop_cart.js` 仍然用
   anon key + client 提供的 `userId` 直接讀寫 `users`/`user_mascots`/`redeem_history`/`shop_cart`/
   `orders`/`order_items`，一旦套用該 migration 這些既有功能會立刻壞掉。在這些呼叫點被改寫成走
   Edge Function（或至少改為使用 `auth.uid()`）之前，不能套用該 migration。
4. **Turnstile Captcha 在真實 Edge Function 呼叫下的行為未驗證**——`account-merge/begin` 是否也需要
   Captcha（目前契約認為不需要，因為呼叫者已經是已驗證的匿名 Session，不是公開的
   sign-up/sign-in 端點），但這只是設計判斷，未經真實 E2E 確認。
5. **前端 `functions.invoke()` 的 `error.context` 解析寫法未經真實環境驗證**——`error.context` 是否
   真的是可 `.json()` 的 `Response` 物件（依 supabase-js 版本可能改變），本次只依現有官方文件描述撰寫，
   從未在真實瀏覽器對真實已部署的 Edge Function 呼叫過。
6. **`account-merge-repository.js`/`.ts` 對 Postgres 錯誤訊息文字的判斷**（若有依賴特定錯誤字串來
   分類 claim 不存在 vs. 過期 vs. Email 不符）尚未對照真實 PostgreSQL 丟出的 `RAISE EXCEPTION`
   訊息格式做過驗證——目前 Handler 刻意把所有原因都收斂成同一個外部錯誤碼，副作用是這個風險影響範圍
   有限（不管訊息判斷準不準確，對外行為都一樣），但仍建議在 05C 驗證時順便確認。

## 05C Staging Gate — 真實 PostgreSQL / Staging 測試計畫

以下項目**本次全部未執行**，皆需要一個真實（建議用 staging，非 Production）Supabase 專案：

1. **部署前置（順序已於 P-AUTH-05B-1 hotfix 訂正，見
   [review-auth-05B-1-hotfix.md](./review-auth-05B-1-hotfix.md) 完整說明）**：`20260816000100`～
   `20260816000400`（點數 ledger、claim 生命週期、mascot 去重約束、finalize RPC）可以**現在**就
   部署到 staging 測試；`20260816000000`（`users`/`user_mascots`/`redeem_history`/`shop_cart`/
   `orders`/`order_items` 的 owner-scoped RLS）**必須**等 05B-2（見上方 Gate 狀態）完成、前端相關
   呼叫點改接新 API、且回歸測試通過後才可以部署，**不是**與其他四個 migration 一起部署。
   `supabase functions deploy account-merge`（同樣限 staging）。
2. **Deno 型別/執行驗證**：確認 `account-merge/index.ts` 與 `_shared/*.ts` 能被 Deno 正常編譯/啟動
   （目前唯一从未跑過的一步）。
3. **Begin 端到端**：以一個真實匿名 Session 呼叫 `POST .../account-merge/begin`，確認：
   - 回傳的 `claimToken` 可用；
   - `account_merge_claims` 資料表裡只存了 hash，找不到明文 token；
   - 用**已登入的既有帳號** Session 呼叫同一端點會被拒絕（`403`）。
4. **Finalize 端到端（成功案例）**：用對應的既有帳號 Session + 上一步拿到的 `claimToken` 呼叫
   `POST .../account-merge/finalize`，確認：
   - 回傳 `200 { merged: true, mergeId, result }`；
   - `shop_cart`/`user_mascots`/`redeem_history`/`points` 真的依 V1 規則被合併（Cart/Mascot 去重、
     Points 透過 `apply_point_transaction` 產生交易紀錄而非直接覆蓋）；
   - `orders`/`order_items`/`subscriptions`/`logs` 確實**未被觸碰**（`result.excludedV1` 存在）。
5. **Finalize 端到端（失敗案例，全部應回傳同一組 `409 MERGE_CLAIM_INVALID`）**：
   - 過期的 `claimToken`（等待 TTL 或手動调整 `expires_at`）；
   - Email 不符的既有帳號（用另一個真實既有帳號的 Session 呼叫同一個 claimToken）；
   - 已經成功 Finalize 過的 `claimToken` 重新呼叫一次（驗證回傳與第一次**完全相同**的 `mergeId`／
     `result`，證明冪等重送而非重新合併一次）；
   - 同時（並發）對同一個 `claimToken` 送出兩個 Finalize 請求（驗證 `FOR UPDATE` 鎖 + 冪等查詢在真實
     併發下不會造成重複合併/雙重加點）。
6. **前端 E2E（真實瀏覽器 + 真實 Supabase 專案）**：
   - 完整跑一次「匿名使用者 → 輸入已註冊 Email → 觸發 Begin → 收到登入用 OTP → 驗證 → 自動合併 →
     自動繼續 Checkout」全流程，確認 `pendingClaimToken` 真的只存在頁面記憶體（重新整理頁面後應該要
     整個流程重來，不應該有任何殘留狀態）。
   - 驗證 `functions.invoke()` 失敗時（例如過期 `claimToken`）UI 顯示的訊息確實來自
     `invokeAccountMergeFunction` 的 `error.context` 解析結果，而不是掉到通用 `MERGE_REQUEST_FAILED`
     fallback（若掉到 fallback，代表 `error.context` 解析寫法需要修正）。
7. **回歸驗證**：在套用 RLS migration 之前，先確認 `js/api.js`/`js/shop/shop-api.js`/
   `js/shop/shop_cart.js` 的既有直接寫入路徑仍照常運作（因為 RLS migration 仍未套用），確保這次改動
   沒有意外影響到與合併無關的既有功能。

**在以上 7 項全部通過之前，不得將 `account-merge` Edge Function 或
`20260816000000_core_user_tables_owner_rls.sql` migration 部署/套用到 Production。**

## 明確聲明

- 本次任務**沒有**執行 `supabase functions deploy`（無論 staging 或 Production）。
- 本次任務**沒有**執行 `supabase db push` 或任何形式套用 `20260816000000_core_user_tables_owner_rls.sql`
  （或任何其他 migration）到任何真實資料庫。
- 本次僅在本機執行 `node --check` 與 `node --test`（`.\scripts\verify-local.ps1`），全部通過
  （414/414）。
