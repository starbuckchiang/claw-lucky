# Authentication & Subscription Specification
Version: v1.0
Status: Draft
Owner: Claw Lucky
Related Features:
- AI Lucky Wallpaper
- Subscription
- Supabase Auth
- Payment
- Webhook

---

# 1. Purpose

本規格定義 Claw Lucky 訂閱系統的身份驗證流程。

目標：

- 保留訪客所有資料
- 降低註冊流失率
- 避免建立重複帳號
- 防止匿名使用者直接付款
- 將身份驗證與付款流程完全分離

---

# 2. User Types

系統共有四種身份。

## Visitor

尚未建立任何 Auth Session。

可能只有：

- localStorage
- ossUserId

不可訂閱。

---

## Anonymous User

已建立 Supabase Anonymous Auth。

具有：

- Auth UUID
- JWT

但：

- is_anonymous = true

不可訂閱。

---

## Official User

符合所有條件：

- 有有效 Session
- JWT 有效
- is_anonymous = false
- 至少一種永久登入身分已完成驗證
- 使用者狀態正常

可以建立訂閱。

---

## Subscriber

正式使用者且具有有效訂閱。

---

# 3. Official User Definition



正式使用者必須同時符合：

- 存在有效 Supabase Auth Session
- JWT 有效
- `is_anonymous == false`
- 使用者狀態為 Active
- 至少綁定並驗證一種可再次登入的永久身分：
  - Email，或
  - Google，或
  - 其他系統支援的永久 Identity

第一版使用 Email OTP；Email 驗證完成後即可判定為 Official User，
不要求同時綁定 Google。

---

# 4. Anonymous Upgrade

第一版採用 Email OTP。

流程：

Visitor

↓

Anonymous Auth

↓

輸入 Email

↓

寄送 OTP

↓

輸入 OTP

↓

Email 驗證成功

↓

Anonymous Upgrade

↓

Official User

不得重新建立另一個 Auth User。

---

# 5. UUID Preservation

Anonymous 升級正式帳號時：

必須保留：

- Auth UUID

不得：

- 建立新的 Auth User
- 搬移資料
- Copy User

所有資料均沿用原 UUID。

---

# 6. Visitor Assets

升級身份後必須保留：

- 吉祥物
- 禮物
- 點數
- 購物車
- Wallpaper
- Daily Quota
- 抽卡紀錄
- 所有歷史資料

不得遺失。

---

# 7. Existing Account Login

若使用者登入的是：

已存在正式帳號

則需要執行資料合併。

Merge Rules：

## Cart

合併商品。

重複商品依系統規則處理。

---

## Mascot

去除重複。

---

## Gift

去除重複。

---

## Points

不得直接相加。

必須建立交易紀錄。

---

## Subscription

一位使用者只能存在一個有效訂閱。

---

# 8. Subscription Flow

流程：

Visitor

↓

點擊訂閱

↓

是否正式使用者？

Yes

↓

建立 Checkout

↓

付款

↓

Webhook

↓

啟用訂閱

↓

開始使用

No

↓

Email OTP

↓

Upgrade

↓

建立 Checkout

---

# 9. Payment Principle

付款成功

≠

訂閱成功

真正啟用訂閱：

必須等待 Webhook。

---

# 10. Webhook Responsibilities

Webhook 收到付款成功後：

更新：

- Subscription
- Plan
- Billing Period
- Expire Date
- Quota
- Invoice
- Payment Status

不得由前端直接更新。

---

# 11. Checkout Authorization

subscription-checkout Edge Function 必須再次驗證：

Case 1

無 JWT

↓

401

UNAUTHORIZED

---

Case 2

Anonymous User

↓

403

ACCOUNT_UPGRADE_REQUIRED

---

Case 3

Identity 未驗證

↓

403

IDENTITY_NOT_VERIFIED

---

Case 4

已有有效訂閱

↓

直接回傳既有 Subscription

不得建立重複訂單。

---

Case 5

正式使用者

↓

建立 Checkout Session

---

# 12. Frontend Rules

前端只能：

- 顯示登入狀態
- 啟動 OTP
- 啟動 Checkout

不得：

- 判斷付款成功
- 修改 Subscription
- 修改 Quota

所有正式狀態皆來自後端。

---

# 13. Backend Rules

後端為唯一可信來源。

所有權限：

- Subscription
- Plan
- Payment
- Quota

均由：

Edge Function

+

Webhook

維護。

---

# 14. State Diagram

Visitor

↓

Anonymous

↓

Official User

↓

Subscriber

不得：

Visitor

↓

Subscriber

---

# 15. Sequence Diagram

Visitor

↓

Subscribe

↓

Official User?

├── No
│
├── Email OTP
│
├── Verify
│
└── Continue Checkout

└── Yes

↓

Checkout

↓

Payment

↓

Webhook

↓

Subscription Active

---

# 16. Security

不得相信：

- localStorage
- 前端 Flag
- Button Hidden
- UI State

所有授權：

皆以 JWT 為準。

---

# 17. Error Codes

AUTH_REQUIRED

ACCOUNT_UPGRADE_REQUIRED

IDENTITY_NOT_VERIFIED

ALREADY_SUBSCRIBED

PAYMENT_PENDING

PAYMENT_FAILED

WEBHOOK_NOT_RECEIVED

UNKNOWN_ERROR

---

# 18. Acceptance Criteria

Authentication

□ Anonymous 可正常建立

□ OTP 可成功驗證

□ UUID 不改變

Subscription

□ Anonymous 無法付款

□ Official User 可付款

□ 已訂閱不可重複建立

Webhook

□ Webhook 成功才啟用

□ Retry 不重複建立

Data

□ 購物車保留

□ 點數保留

□ 吉祥物保留

□ Wallpaper 保留

□ Daily Quota 保留

Security

□ Edge Function 二次驗證

□ JWT 驗證

□ Identity 驗證

□ Anonymous 無法繞過前端直接付款

---

# 19. Out of Scope (v1)

以下功能不包含於第一版：

- 密碼登入
- 忘記密碼
- 會員中心
- 多裝置管理
- Apple Login
- Facebook Login
- Family Plan
- Subscription Upgrade / Downgrade
- Refund Flow

---

# 20. Related Prompt Files

prompts-auth-01.md
Authentication Foundation

prompts-auth-02.md
Email OTP Upgrade

prompts-auth-03.md
Subscription Entry

prompts-auth-04.md
Checkout Authorization

prompts-auth-05.md
Visitor Data Preservation

prompts-auth-06.md
Account Merge

prompts-auth-07.md
Payment Webhook

prompts-auth-08.md
End-to-End Verification