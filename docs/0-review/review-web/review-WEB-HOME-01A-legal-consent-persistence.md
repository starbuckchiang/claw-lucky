# review-WEB-HOME-01A — Legal Consent Persistence & Subscription Copy Fix

日期：2026-09-10
分支：`release/auth-07c-sandbox`（僅本機修改，未 commit、未部署）
狀態：**PASS — LOCAL_IMPLEMENTATION_COMPLETE**

---

## 一、任務摘要

WEB-HOME-01A 將 WEB-HOME-01 的瀏覽器 localStorage 同意紀錄改為伺服器權威、可稽核且 append-only 的同意流程。OTP 與 PayPal Subscription 建立前，前端只傳送 allowlist scope、source 與 idempotency key；Edge Function 驗證 Supabase JWT，並由伺服器決定 user ID、政策版本、政策 hash 與接受時間。

政策生效日期與版本已統一為 `2026年9月15日`／`2026-09-15`。既有 `docs/0-review/review-WEB-HOME-01.md` 是歷史執行紀錄，保留原文；本文件記錄版本修正及後端持久化變更。

## 二、政策與付款文案

- Canonical 條款：`docs/policies/claw-lucky-terms-v2026-09-15.md`
- Canonical 隱私權政策：`docs/policies/claw-lucky-privacy-v2026-09-15.md`
- Canonicalization：只將 CRLF 正規化為 LF，再以 SHA-256 計算；測試會從 canonical 文件重新計算並比對常數。
- Terms SHA-256：`e47b3fe0d205132087b862d28bdee9cf967b2108547f4319ead4b91a6e55329f`
- Privacy SHA-256：`dc04b9fd032869a7b5daa03b09427e841e8992e346b0178a703fd9bc4766ce02`
- 月訂與年訂文案均說明 PayPal 依週期自動扣款、可取消自動續訂、取消後可使用至已付款期間結束，權益以已驗證的訂閱及付款 Webhook 為準。
- Subscription UI 與流程不再使用「PayPal Orders v2 一次性付款」描述；獨立的一次性 PayPal checkout 模組仍保留既有 `createOrder` 實作，與本訂閱流程無關。

## 三、資料庫與權限設計

Migration：`supabase/migrations/20260910000300_user_consents_append_only.sql`

- 建立 `public.user_consents`，包含 user、scope、版本、hash、伺服器時間、source、correlation ID 與 idempotency key。
- `consent_scope` allowlist：`account_upgrade`、`checkout`、`digital_content_waiver`。
- `source` allowlist：`subscription_page`、`account_upgrade_form`。
- 唯一約束：`(user_id, consent_scope, idempotency_key)`。
- 外鍵未使用 `ON DELETE CASCADE`，避免帳號刪除時無聲移除稽核紀錄；帳號刪除與法定保留的最終政策仍需另行確認。
- RLS 已在 migration 中啟用；authenticated 僅可 SELECT `auth.uid() = user_id` 的紀錄。anon 無權限，anon/authenticated 均不可直接 INSERT、UPDATE、DELETE。
- UPDATE／DELETE 另由 trigger 阻擋，維持 append-only。
- `record_user_consent` RPC 固定 `search_path`，撤銷 PUBLIC、anon、authenticated EXECUTE，僅授權 service_role；使用 `ON CONFLICT DO NOTHING` 回傳既有紀錄。
- Migration 檔案已建立並完成靜態權限測試，但未套用至任何資料庫。

## 四、安全寫入 API

- `consent-ops` Edge Function 驗證 Bearer JWT 並以 `auth.getUser(jwt)` 取得 user ID。
- Request body 嚴格拒絕 `user_id`、`accepted_at`、版本及 hash 等伺服器欄位。
- 版本與 hash 由 `_shared/lib/policy-versions.ts` 決定；`accepted_at` 由資料庫 `now()` 產生。
- idempotency key 驗證格式及長度；同 user、scope、key 的重試回傳原紀錄。
- 回應僅包含必要的同意紀錄欄位；structured error log 僅記錄 correlation ID、錯誤類型與固定 reason，不記錄 JWT、Email、完整政策或付款資料。
- Browser client 僅送出 `consentScope`、`source`、`idempotencyKey`。

## 五、寫入時機與匿名升級

- `account_upgrade`：checkbox 未預勾。未勾選或後端寫入失敗時，不呼叫 OTP service；成功持久化後才送 OTP。失敗訊息可由使用者重試。
- `checkout`：checkbox 未預勾。未勾選或後端寫入失敗時，不呼叫 `actions.subscription.create(...)`，因此不建立 Subscription 或付款。
- idempotency key 在同一次重試中保持穩定；完成或 context 改變後才產生新 key。
- 匿名帳號升級若保留相同 Supabase auth user ID，既有紀錄自然沿用。若 OTP 驗證後 JWT user ID 改變，流程不以前端、Email 或搬移舊紀錄配對，而是在新 JWT 身分下寫入新的 `account_upgrade` 同意紀錄後才繼續；未實作未經確認的跨 user ID 搬移。
- `digital_content_waiver` feature flag 維持關閉，不顯示為已啟用、不預勾，也不建立假紀錄。
- WEB-HOME-01 的 localStorage 紀錄可保留作非權威 UI 相容資料，但不再作為 OTP 或 Subscription 的授權依據。

## 六、測試與檢查

執行 `npm run verify-local`：**935 passed、0 failed**。

覆蓋項目包含：

- 顯示日期、程式版本與 canonical policy hash 重算。
- checkbox 存在且未預勾；subscription 使用 createSubscription 而非 createOrder。
- OTP／PayPal 在未勾選及 consent API 失敗時均被阻擋。
- JWT-derived user ID、server-derived 版本/hash/time、嚴格 request schema、log 安全。
- append-only migration、owner-only RLS、direct-write deny、RPC 權限與 idempotency。
- 不同 scope 的獨立 idempotency、匿名升級 user ID 變更、waiver flag 關閉。
- 既有 Auth、Subscription、Webhook、PayPal 與 RLS 測試無退化。
- VS Code diagnostics：本次核心 JS／HTML 檔案無錯誤。

未執行真實 JWT、資料庫、OTP 或 PayPal E2E；依停止條件僅執行本機測試與靜態 migration／Edge Function boundary 驗證。

## 七、部署狀態與後續

本階段未執行 db push、Edge Function deploy、Secrets 修改、PayPal 呼叫、真實訂閱、GitHub Pages 部署、commit 或 push。正式發布前需在核准環境依序套用 migration、部署 `consent-ops`、確認 function JWT／service-role 設定，再以測試帳號執行 server-backed E2E。

## 八、最終結果

```text
WEB-HOME-01A Result: PASS
Display Effective Date: 2026年9月15日
Terms Version: 2026-09-15
Privacy Version: 2026-09-15
Policy Content Hash: TERMS=e47b3fe0d205132087b862d28bdee9cf967b2108547f4319ead4b91a6e55329f; PRIVACY=dc04b9fd032869a7b5daa03b09427e841e8992e346b0178a703fd9bc4766ce02
Consent Table: public.user_consents (append-only migration created)
JWT-derived User ID: YES
Server-derived Versions: YES
Server Time: YES
RLS Own Read: YES
Direct Client Insert: DENIED
Direct Client Update/Delete: DENIED
Idempotency: YES — unique(user_id, consent_scope, idempotency_key)
Account Upgrade Blocking: PASS
Subscription Creation Blocking: PASS
Anonymous Upgrade Mapping: SAME UID retained; changed UID gets a new JWT-derived record; no email/client mapping
Digital Content Waiver Flag: OFF
PayPal Integration Copy: SUBSCRIPTIONS_API
Tests Passed: 935
Tests Failed: 0
Migration Applied: NO
Function Deployed: NO
Secrets Changed: NO
PayPal Called: NO
Commit/Push Performed: NO
Gate: PASS
```
