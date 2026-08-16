# P-AUTH-05B-1 Hotfix — 冪等語意訂正／文件矛盾修正／Gate 狀態訂正／安全日誌 — Review

**狀態：修正 `review-auth-05B-1.md` 的一個文件內部矛盾與一個 Gate 狀態宣告過寬的問題，並補強
Finalize 冪等相關測試與伺服器端安全日誌。本次未新增/修改任何資料庫 migration，未變更
`finalize_account_merge`/`create_account_merge_claim` 的 SQL 本體（那一層的冪等邏輯在 P-AUTH-05A.1
已經是正確的——問題出在 Node 側的**文件敘述**與**日誌內容**，不是 SQL）。未部署 Production，未套用任何
migration。**

## 根因總覽

P-AUTH-05B-1 完成後的 `review-auth-05B-1.md`「需求 7 情境對照表」把「重複點擊（duplicate click）」
誤列為與「Token 過期／Email 不符／偽造 token」同一類「一律回傳 409」的失敗情境，但同一份文件下方
「05C Staging Gate 測試計畫」第 5 點卻正確地說「已經成功 Finalize 過的 `claimToken` 重新呼叫一次，
應該回傳與第一次完全相同的 `mergeId`/`result`」——這兩段話彼此矛盾：一個說重複點擊回 409，另一個說
合法重送回 200 且結果相同。

實際程式碼行為是**後者才對**：`finalize_account_merge`（P-AUTH-05A.1 版）對同一個 canonical
`(claim.anonymous_user_id, existing_user_id)` pair 的重送，會直接查到 `account_merge_requests`
裡已存在的列並原樣回傳（不重新合併、不重複轉點數），這是正常回傳，不是例外，所以
`account-merge-repository.js`/`account-merge-handler.js` 也不會把它當成錯誤——只有真正的「claim
不存在／過期／Email 不符／資料不一致」才會讓 RPC 丟出例外，Handler 才會回 409
`MERGE_CLAIM_INVALID`。換句話說：**Node 層程式碼本身沒有這個 bug**，問題純粹出在
`review-auth-05B-1.md` 這份文件把兩種完全不同的情境寫混了，且原本的測試套件也沒有專門用一個
「會記錄合併是否真的執行第二次」的假 repository 去正面證明「重送/重複點擊不會二次合併、不會重複
加點」——本次補上。

## 修正內容（對應 6 項需求）

### 1. 統一 Finalize 冪等語意（需求 1）

確認並在文件/測試中明確化：同一正式帳號持有同一「有效」或「已使用」`claimToken` 重送時，回傳
**`200`** 及**完全相同**的 `mergeId`/`result`，**不得**映射成 `409`；只有下列情況才回 `409
MERGE_CLAIM_INVALID`：
- 錯誤/偽造、資料庫查無對應列的 `claimToken`；
- 已過期的 `claimToken`；
- 呼叫者（既有帳號）的 Email 與 claim 建立時的目標 Email 不符；
- `status='used'` 但查無對應 `account_merge_requests` 列（資料不一致）；
- RPC/連線層級的真正失敗（例如網路錯誤）。

程式碼（`account-merge-handler.js`/`.ts` 的 `handleFinalizeMergeRequest`）本身已經是這個行為——本次
沒有修改這段邏輯，只是強化了測試與文件的準確性（見下）。

### 2. 新增 Handler/Repository 測試：模擬第一次成功、回應遺失後重送、併發後重送（需求 2）

新增一個**有狀態**的假 repository / 假 Supabase client（`createStatefulFinalizeRepository` /
`createStatefulFinalizeSupabaseClient`），行為模擬真實 `finalize_account_merge` RPC 的 canonical-key
冪等性：同一組參數，**只有第一次**呼叫會讓內部的 `appliedCount` 真的 +1（代表「真的執行了一次合併/
轉點數」），之後所有呼叫（不論是循序重送，還是用 `Promise.all` 模擬併發重送/重複點擊）都回傳**同一個**
快取結果，`appliedCount` 永遠停在 `1`。

- `supabase/functions/_shared/__tests__/account-merge-handler.test.js` 新增：
  - `resend after the first response was lost (sequential retries) applies the merge/points transfer exactly ONCE`
  - `resend after concurrent duplicate clicks applies the merge/points transfer exactly ONCE`
- `js/services/auth/__tests__/account-merge-repository.test.js` 新增：
  - `finalizeMerge: resend after the first response was lost (sequential retries) applies the underlying RPC's merge/points transfer exactly ONCE`
  - `finalizeMerge: resend after concurrent duplicate clicks applies the underlying RPC's merge/points transfer exactly ONCE`

**明確的限制聲明**（測試檔內的註解也這樣寫）：這些假物件是**單執行緒**的 Node 事件迴圈模擬，只能證明
「JS 這一層（Handler/Repository）本身不會在 RPC 回傳的結果之上，自己額外多呼叫一次或多做一次
處理」，**無法**證明 PostgreSQL 真實多連線併發下 `FOR UPDATE` 鎖 + MVCC 語意是否真的如預期運作——那
仍然是 05C Staging Gate 才能驗證的項目（見下方更新後的測試計畫）。

同時也把既有的「resend」「duplicate click」測試從單純的 `assert.deepEqual(...)` 加強為明確斷言
`statusCode === 200`（而不只是「兩次呼叫拿到一樣的東西」，也要明確排除「兩次都拿到一樣的 409」這種
誤判可能性）。

### 3. 修正 review 中 duplicate click 與 05C 失敗案例的矛盾（需求 3）

- `docs/0-review/review-auth/review-auth-05B-1.md`「需求 7 情境對照表」：把原本分開的「重新寄送
  （resend）」「重複點擊（duplicate click）」兩列合併成一列，明確訂正為「回傳 `200` 與完全相同的
  `mergeId`/`result`，絕不映射成 `409`」，並加註文件先前版本曾誤將兩者列為失敗情境。
- 同一份文件開頭新增一段醒目的訂正說明，指向本文件。
- `supabase/functions/_shared/__tests__/account-merge-handler.test.js` 的
  `FINALIZE_FAILURE_SCENARIOS` 陣列上方註解，也同步訂正說明：resend／duplicate click **明確不屬於**
  這個「必須全部回傳同一個 409」的失敗情境清單。

### 4. Gate 狀態訂正：05B-1 完成候選，禁止宣告整體 05B 完成；05B-2 待辦 API 清單（需求 4）

`review-auth-05B-1.md` 開頭已訂正為：本文件只代表 **05B-1（Account Merge Begin/Finalize 本身）完成
候選**，**不代表整體 05B 完成**。

05B-2（下一階段，本次未開始）需要涵蓋的**安全寫入 API**清單——這些是 P-AUTH-05A（`review-auth-05A.md`）
與 P-AUTH-04.3（`review-auth-04.3-hotfix.md`）就已經指出、`20260816000000`
RLS migration 套用後會直接打壞的既有直接寫入路徑，必須先有替代的安全寫入 API 才能套用該 RLS：

| 資料表 | 目前的不安全直接寫入路徑 | 05B-2 需要的安全寫入 API（草案方向） |
|---|---|---|
| `user_mascots` | `js/api.js` 用 anon key + client 提供的 `userId` 直接 insert/update（例如轉蛋/兌換獲得吉祥物）。 | 一個 Edge Function（例如 `mascot-award`）：呼叫者身份 100% 來自已驗證 Session，`user_id` 絕不由 request body 提供；業務規則（去重/`obtain_count` 累加）封裝進 `SECURITY DEFINER` RPC。 |
| `redeem_history` | `js/api.js` 同上模式直接 insert。 | 隨兌換流程（轉蛋/禮物兌換）本身的 Edge Function 一併寫入，同樣禁止由前端提供 `user_id`。 |
| `users.points` | 目前僅有 `apply_point_transaction` 這個 SECURITY DEFINER RPC（P-AUTH-05A 已建立），但呼叫端（`js/services/wallpaper/points-repository.js` 等）是否已經全面改走這個 RPC、而非任何殘留的直接 `UPDATE users SET points = ...`，需要在 05B-2 逐一盤點確認。 | 盤點現有呼叫點，逐一改為 100% 透過 `apply_point_transaction` 呼叫，不留任何繞過路徑。 |
| `shop_cart` | `js/shop/shop-api.js` 的 `updateCartItem(cartId,...)`/`removeCartItem(cartId)` **完全沒有** ownership 檢查（`.eq("id", cartId)` 而已）——P-AUTH-05A 就已指出的具體漏洞。 | 一個 Cart Edge Function 或至少把所有查詢改為 `.eq("user_id", auth.uid())` 併同 RLS 生效後的雙重保護；新增/修改/刪除操作都需要先驗證 `cart.user_id === 呼叫者自己的 id`。 |
| `orders`／`order_items` | 結帳流程目前的實際寫入路徑（需在 05B-2 開始時重新盤點 `js/shop/shop_cart.js`/`js/api.js` 對應呼叫點，本文件不臆測其現況）。 | 待 05B-2 盤點後設計；`subscription-checkout` Edge Function 的既有模式（thin entrypoint + shared handler + service-role RPC）可直接複用。 |

**在以上 05B-2 清單全部完成、前端所有呼叫點改接新 API、且回歸測試通過之前，`20260816000000`
migration 不得套用到任何環境（含 staging）。**

### 5. 修正 staging 部署順序（需求 5）

- `20260816000100_point_transactions_ledger.sql`、`20260816000200_account_merge_claims.sql`、
  `20260816000300_user_mascots_dedup_and_unique_constraint.sql`、
  `20260816000400_account_merge_requests_and_finalize.sql`——這四個**現在**就可以部署到 staging
  專案先行測試（Account Merge Begin/Finalize 的 05C 測試計畫依賴這四個）。
- `20260816000000_core_user_tables_owner_rls.sql`（`users`/`user_mascots`/`redeem_history`/
  `shop_cart`/`orders`/`order_items` 的 owner-scoped RLS）**必須**排在最後，等待：
  1. 05B-2（上方清單）的所有安全寫入 API 完成；
  2. 前端（`js/api.js`/`js/shop/shop-api.js`/`js/shop/shop_cart.js` 等）全部改接這些新 API；
  3. 完整回歸測試（`.\scripts\verify-local.ps1` + 手動 E2E）通過；
  之後才可以套用——即使是 staging 環境也一樣，避免在還沒有安全寫入 API 替代前就打壞既有轉蛋/兌換/
  購物車/結帳功能。
- `review-auth-05B-1.md` 的「05C Staging Gate」章節第 1 點已同步更新為這個順序。

### 6. 伺服器日誌白名單化（需求 6）

`supabase/functions/_shared/account-merge-handler.js`／`.ts`：

- 新增 `classifyFinalizeFailureReason(error)`——把 Finalize RPC 失敗的錯誤訊息，**只**分類成一組固定
  的白名單代碼之一：`CLAIM_NOT_FOUND`／`CLAIM_EXPIRED`／`EMAIL_MISMATCH`／`DATA_INCONSISTENCY`／
  `UNKNOWN`，函式本身**不會**把原始錯誤訊息回傳或記錄下來。
- `handleFinalizeMergeRequest` 的失敗 log 從 `message: error?.message` 改為
  `reason: classifyFinalizeFailureReason(error)`。
- `handleBeginMergeRequest` 的失敗 log 從 `message: error?.message` 改為固定字串
  `reason: "RPC_ERROR"`（Begin 失敗目前沒有值得細分的原因分類）。
- `supabase/functions/account-merge/index.ts` 的最外層例外處理，同樣不再記錄 `error.message`，改為
  `reason: "UNHANDLED_EXCEPTION"` + `errorType`（只記錄錯誤的建構子名稱，例如 `"TypeError"`，
  絕不含錯誤訊息內容）。
- 三處日誌現在只包含固定欄位：`level`／`event`／`correlationId`／`reason`（Begin/Finalize）或
  再加 `errorType`（index.ts 的例外處理）——**不含** `claimToken`、token hash、Email、
  `Authorization` 標頭、或原始 request body 的任何欄位。
- 新增測試（`account-merge-handler.test.js`）：`classifyFinalizeFailureReason` 的白名單映射測試；
  兩個 **defense-in-depth** 測試——刻意讓假 repository 拋出「訊息裡面包含假 email／假 claimToken 字串」
  的錯誤，監聽 `console.error` 實際輸出的內容，斷言：(a) 輸出的 JSON 物件的 key 只有
  `level`/`event`/`correlationId`/`reason`（沒有多餘欄位），(b) 輸出的原始字串**不含**該假
  email/claimToken 字串——即使未來某個依賴/邊角案例不小心把敏感值塞進 `Error.message`，這裡的日誌
  輸出仍然安全。

## 修改的檔案

| 檔案 | 變更 |
|---|---|
| `supabase/functions/_shared/account-merge-handler.js` | 新增 `classifyFinalizeFailureReason`；Begin/Finalize 失敗日誌改為白名單 `reason` 而非 `message`；`module.exports` 新增 `classifyFinalizeFailureReason`。 |
| `supabase/functions/_shared/account-merge-handler.ts` | 同步上述變更（Deno 雙生檔）。 |
| `supabase/functions/account-merge/index.ts` | 最外層例外處理的日誌改為 `reason: "UNHANDLED_EXCEPTION"` + `errorType`，不再記錄 `error.message`。 |
| `supabase/functions/_shared/__tests__/account-merge-handler.test.js` | 新增/加強 resend／duplicate-click／冪等執行次數／`classifyFinalizeFailureReason`／安全日誌測試；訂正 `FINALIZE_FAILURE_SCENARIOS` 上方註解。 |
| `js/services/auth/__tests__/account-merge-repository.test.js` | 新增 repository 層的有狀態冪等測試（循序重送、併發重送）。 |
| `docs/0-review/review-auth/review-auth-05B-1.md` | 訂正「需求 7 情境對照表」的 duplicate click 矛盾；Gate 狀態訂正為「05B-1 完成候選」；05C 部署順序章節同步更新。 |

未修改：任何資料庫 migration 本體（`20260816000000`～`20260816000400` 維持 P-AUTH-05A.1 版本不變）、
`js/services/auth/account-merge-service.js`／`subscription-entry-guard.js`／`js/pages/subscription-entry.js`
（前端 claimToken 轉發邏輯無需改動——這次的問題不在前端層）、任何方案/價格設定。

## 執行 `.\scripts\verify-local.ps1`

```
== Syntax Check ==  全數通過
== Unit Tests ==
ℹ tests 421
ℹ pass 421
ℹ fail 0
Verification Complete
```

（上一個查核點是 P-AUTH-05B-1 完成時的 414/414，本次新增 7 個測試：Handler 層 5 個 — 循序重送/併發
重送冪等各 1、`classifyFinalizeFailureReason` 1、安全日誌 defense-in-depth 2；Repository 層 2 個 —
循序重送/併發重送冪等各 1。）

## 05C Staging Gate 測試計畫（更新版，取代 `review-auth-05B-1.md` 舊版第 1 點）

以下項目**本次全部未執行**：

1. **部署順序（本次訂正）**：先部署 `20260816000100`～`20260816000400` 到 staging（**不含**
   `20260816000000`），驗證 Begin/Finalize 全流程；`20260816000000` RLS migration 排在 05B-2 完成、
   前端改接、回歸通過之後最後部署，即使在 staging 也一樣。
2. **Deno 型別/執行驗證**：確認 `account-merge/index.ts` 與 `_shared/*.ts`（含本次新增的
   `classifyFinalizeFailureReason`）能被 Deno 正常編譯/啟動。
3. **真實冪等驗證（本次新增測試無法涵蓋的部分）**：對同一個真實 `claimToken` 送出兩個「真正並發」
   （不同資料庫連線、非同一 Node 事件迴圈）的 Finalize 請求，確認：
   - 只有一筆 `account_merge_requests` 列被建立；
   - `users.points` 只被 `apply_point_transaction` 呼叫一次（可從 `point_transactions` ledger 的
     筆數直接驗證，而不是只看 `users.points` 的最終值——避免「剛好兩次相減打平看起來正常」的假陰性）；
   - 兩個請求最終都拿到完全相同的 `mergeId`/`result`。
4. **真實 Postgres 日誌檢查**：確認 Edge Function 部署後，Supabase 專案的 log 中確實只看得到
   `correlationId`/`reason`/`errorType` 等白名單欄位，**看不到**任何 claimToken/hash/Email/
   Authorization/request body 內容（本次的 Node 測試只能驗證 `console.error` 呼叫本身，無法驗證
   Supabase Edge Runtime 實際落地的 log 系統是否有自己的額外欄位/裝飾器意外夾帶了其他資訊）。
5. 其餘 05C 項目（Deno 執行驗證、Begin/Finalize 端到端、失敗案例、前端 E2E、回歸驗證）維持
   `review-auth-05B-1.md` 原有清單不變，本次未新增修改。

## 明確聲明

- 本次任務**沒有**執行 `supabase functions deploy`（無論 staging 或 Production）。
- 本次任務**沒有**執行 `supabase db push` 或以任何形式套用任何 migration 到任何真實資料庫。
- 本次僅在本機執行 `node --check` 與 `node --test`（`.\scripts\verify-local.ps1`），全部通過
  （421/421）。
- 本文件**不**宣告「整體 05B 完成」——05B-2（`mascot`/`redeem_history`/`points`/`shop_cart`/`orders`
  安全寫入 API）完全尚未開始，是下一個獨立任務的範圍。
