# P-AUTH-05B-2A.1 Hotfix — Idempotency Key Retry 生命週期修正 — Review

**狀態：修正 `js/api.js`'s `invokeWalletOpsFunction()` 錯誤分類邏輯——先前版本只要收到「任何 HTTP
回應」（`error.context` 存在）就一律標記 `retryable:false`，即使那個回應其實是無法解析的
500/502/503/504 錯誤頁面，或伺服器其實已經回傳 `retryable:true`。這個 bug 會讓「資料庫已經 commit，
但第一次 HTTP 回應在傳輸中遺失/損毀」的情境被前端誤判為「確定性失敗」，清除掉
`pendingDrawIdempotencyKey`/`pendingRedeemIdempotencyKey`，導致使用者下次點擊會產生全新的
`idempotencyKey`，讓伺服器端的冪等保護完全失效（會真的再抽一次/再兌換一次/再扣一次款）。可見 UI／
使用者操作流程完全未變動。未部署 Production，未套用任何 migration。**

延續既有的三關卡框架：本次仍屬於 **05B Implementation** 底下的 Gacha/Gift 子範圍（**05B-2A**）。
**Gate 狀態不變**：05B-2A（本次連同兩次 hotfix）完成候選；05B-2B（Cart/Orders）尚未開始；05C
Staging Gate 完全未執行。

已更新 [threat-model-wallet-ops.md](./threat-model-wallet-ops.md)：訂正 T7 的重試機制描述，新增
T11 記錄本次修正的具體漏洞。

## 根因

`js/api.js`'s `invokeWalletOpsFunction()`（P-AUTH-05B-2A hotfix 版本）的錯誤分類邏輯是：

```js
if (error.context) {
  // ... 嘗試解析 JSON，若有 parsedBody.error 則回傳 { retryable: false, ...parsedBody.error }
  // 若解析失敗或沒有 parsedBody.error，一律回傳 retryable: false
} else {
  // 完全沒有收到回應 -> retryable: true
}
```

問題：`error.context` **存在**只代表「收到了某種 HTTP 回應」，**不代表**伺服器對這次操作做出了明確的
業務決定。以下情境都會被誤判為 `retryable:false`：

- 中間代理／閘道器回傳的 502 Bad Gateway，本文是 HTML 而非我們自己的 JSON 錯誤格式——`.json()`
  會拋出例外，落入「解析失敗」分支，被寫死成 `retryable:false`。
- 伺服器（`wallet-ops-handler.js`）明明已經在 body 裡回傳 `retryable:true`（例如
  `GACHA_DRAW_FAILED`/`GIFT_REDEEM_FAILED` 這類判定為可重試的一般性 RPC 失敗），但當時的程式碼在
  `{ retryable: false, ...parsedBody.error }` 之外，其他所有「解析失敗」「沒有 `.error` 欄位」的
  分支仍然寫死 `false`，等於只有「成功解析且剛好有 `.error`」這一種情況才可能是 `true`——任何非
  預期的回應形狀都會被悲觀地判定成「不可重試」。

實務影響（需求 6 要驗證的情境）：使用者點擊「轉一次」，伺服器端 `claim_gacha_draw` RPC **真的成功
commit 了**（扣款、發獎、寫入 `user_mascots`、寫入 `gacha_draw_requests` 冪等紀錄全部完成），但
Edge Function 把回應送回瀏覽器的路上發生問題（例如中間代理短暫故障回傳 502），瀏覽器收到的是一個
無法解析的錯誤——舊版程式碼會把這個「其實已經成功」的操作標記成 `retryable:false`，清除掉
`pendingDrawIdempotencyKey`。使用者困惑地重新點擊「轉一次」，前端因為 key 已被清除而產生一把
**全新**的 `idempotencyKey`，伺服器端的冪等查詢完全不會命中舊紀錄，於是**真的執行了第二次抽獎**
（二次扣款、二次發獎、二次寫入 `user_mascots`）——這正是整個 idempotency 機制原本要防止的事，卻因為
前端錯誤分類而被繞過。

## 修正內容（對應 8 項需求）

### 1-4. 重寫 `invokeWalletOpsFunction()` 的錯誤分類邏輯

`js/api.js`：

- **需求 1**：`error.context` 存在**不再**單獨決定 `retryable`。
- **需求 2**：只有**成功解析出**本應用程式自己的 `{ok:false, error:{...}}` JSON 主體時，才會讀取
  其中的 `error.retryable`；若該欄位是 boolean，**完全尊重**該值（`true`／`false` 皆然）。
- **需求 3**：`retryable:false` 現在**只**可能來自伺服器明確回傳的、確定性業務拒絕（餘額不足、
  庫存不足、商品/吉祥物不存在等——這些在 `wallet-ops-handler.js` 早已標記為 `retryable:false`，本次
  未變動那一層）。
- **需求 4**：以下情況**一律** `retryable:true`：
  - 成功解析出 JSON，但沒有可辨識的 `.error` 欄位（例如平台/閘道器自己的錯誤格式）。
  - JSON 解析本身失敗（`SyntaxError`，例如 HTML 錯誤頁面）——涵蓋 HTTP 500/502/503/504 這類非
    應用層錯誤。
  - 成功解析出 `.error`，但其中沒有 `retryable` 欄位、或該欄位不是 boolean（未知/舊版錯誤格式，
    **絕不**猜測為安全而預設 `false`）。
  - 完全沒有收到任何 HTTP 回應（`error.context` 不存在——`FunctionsFetchError`／斷線／DNS／
    timeout，既有邏輯，本次未變動這條分支本身，但明確在註解中重申涵蓋這些情境）。

修正後的核心邏輯（節錄）：

```js
if (error.context) {
  let parsedBody = null;
  try {
    parsedBody = await error.context.json();
  } catch (_parseError) {
    return { ok: false, error: { code: "WALLET_OPS_REQUEST_FAILED", message: "...", retryable: true } };
  }

  const serverError = parsedBody && typeof parsedBody === "object" ? parsedBody.error : null;

  if (serverError && typeof serverError === "object") {
    const retryable = typeof serverError.retryable === "boolean" ? serverError.retryable : true;
    return { ok: false, error: { ...serverError, retryable } };
  }

  return { ok: false, error: { code: "WALLET_OPS_REQUEST_FAILED", message: "...", retryable: true } };
}

return { ok: false, error: { code: "NETWORK_ERROR", message: "...", retryable: true } };
```

### 5. Pending Key 清除時機（維持既有邏輯，因分類修正而恢復正確）

`js/pages/gacha.js`／`js/gift.js` 在 P-AUTH-05B-2A hotfix 就已經寫好了「`!error?.retryable` 才清除
pending key」的邏輯——這段程式碼本身**沒有 bug**，問題完全出在 `invokeWalletOpsFunction()` 回傳的
`retryable` 值本身不準確。修正 `invokeWalletOpsFunction()` 之後，這段既有邏輯**自動恢復正確行為**，
本次未修改 `gacha.js`／`gift.js` 本身。

### 6-7. 補測（`js/__tests__/api.test.js`，新建立）

由於 `js/api.js` 是純瀏覽器腳本（`window.Api = {...}`，無 `module.exports`，本專案無 bundler），
本次建立一個新的測試模式：在 `require()` 該檔案**之前**先定義一個最小化的假 `global.window`（含
`supabaseClient.functions.invoke` 的假實作）；由於 `window` 在腳本內是自由變數，Node 會在**呼叫
當下**才去全域物件上查找，所以之後每個測試只需要重新指定 `global.window`（不需要重新
`require()`），就能替換掉假的 `invoke` 實作。新增：

- `error.context` + 解析出 `retryable:true`／`retryable:false` 各自的專屬案例（需求 7）。
- `error.context` + 無法解析的 JSON（模擬 502 Bad Gateway 錯誤頁）→ `retryable:true`（需求 7）。
- `error.context` + 解析成功但沒有 `.error` 欄位、或完全是空物件 → `retryable:true`（需求 7）。
- `error.context` + 解析出 `.error` 但缺少 `retryable` 欄位（未知/舊格式）→ `retryable:true`
  （需求 7）。
- 完全沒有 `error.context`（模擬網路完全中斷）→ `retryable:true`（需求 7）。
- **需求 6 核心情境**：「資料庫已經 commit，但第一次回應是遺失/502」——用一個有狀態的假
  `invoke()`：第一次呼叫時，模擬伺服器端「真的執行了一次」（`appliedCount` 加一）但回傳一個無法
  解析的 502；第二次呼叫**用完全相同的 `idempotencyKey`**，模擬伺服器冪等查詢命中、回傳快取結果
  （`appliedCount` 不再遞增）。斷言：第一次呼叫拋出的例外 `retryable === true`；第二次呼叫成功並
  回傳與第一次「本來應該拿到」完全相同的結果；`appliedCount` 全程只等於 1（即使 client 端呼叫了
  兩次 HTTP）。`claimGachaDraw`／`redeemGift` 各自一個對應測試。

### 8. Threat Model 與本文件

見 [threat-model-wallet-ops.md](./threat-model-wallet-ops.md) 的 T7（訂正）／T11（新增）。

## 修改的檔案

| 檔案 | 變更 |
|---|---|
| `js/api.js` | 重寫 `invokeWalletOpsFunction()` 的錯誤分類邏輯（需求 1-4）。 |
| `js/__tests__/api.test.js` | 新建立——`js/api.js` 的第一份 Node 測試（假 `window` 模式）。 |
| `scripts/verify-local.ps1` | 新增 `js/__tests__/*.test.js` 測試 glob（`node --check js/api.js` 已在上一階段存在）。 |
| `docs/0-review/review-auth/threat-model-wallet-ops.md` | 訂正 T7，新增 T11。 |

未修改：`js/pages/gacha.js`／`js/gift.js`（pending key 清除邏輯本身正確，不需修改）、
`supabase/functions/_shared/wallet-ops-handler.js`／`.ts`（伺服器端 `retryable` 標記邏輯在
P-AUTH-05B-2A hotfix 已經正確，本次未變動）、任何資料庫 migration、任何方案/價格設定、任何 HTML
結構與可見使用者流程。

## 執行 `.\scripts\verify-local.ps1`

```
== Syntax Check ==  全數通過
== Unit Tests ==
ℹ tests 507
ℹ pass 507
ℹ fail 0
Verification Complete
```

（上一個查核點是 P-AUTH-05B-2A Hotfix 完成時的 497/497；本次新增 10 個測試，全部在
`js/__tests__/api.test.js`。）

## 05C Staging Gate（延續既有清單，補充本次相關項目）

1. **真實 502/503/504 場景驗證**：在 staging 環境用真實的網路層工具（例如暫時關閉 Edge Function
   或注入代理層錯誤）製造一次真正的「回應遺失/損毀」，確認瀏覽器實際收到的 `error.context`
   形狀與本次測試模擬的一致，且前端行為（保留 pending key、下次點擊沿用同一 key、最終看到正確結果）
   符合預期——本次的 Node 測試只能驗證「假設 error.context 是這個形狀時，程式碼分類正確」，無法驗證
   supabase-js 在真實網路失敗下實際產生的 `error`/`error.context` 形狀是否與假設一致。
2. **真實併發+遺失回應組合情境**：模擬「兩個瀏覽器分頁對同一個使用者用相同 idempotencyKey 幾乎同時
   重試」，確認伺服器端 `FOR UPDATE` 鎖 + 冪等查詢仍然只套用一次（延續既有 05C 清單，本次因為前端
   重試邏輯修正而變得更可能在真實環境被觸發，值得特別驗證）。

**在以上（含既有全部 05C 清單）全部通過之前，不得部署 `wallet-ops` Edge Function 或前端變更到
Production。**

## 明確聲明

- 本次任務**沒有**執行 `supabase functions deploy`（無論 staging 或 Production）。
- 本次任務**沒有**執行 `supabase db push` 或以任何形式套用任何 migration。
- 本次僅在本機執行 `node --check` 與 `node --test`（`.\scripts\verify-local.ps1`），全部通過
  （507/507）。
- 本文件**不**宣告「整體 05B 完成」——05B-2B（Cart/Orders）完全尚未開始。
