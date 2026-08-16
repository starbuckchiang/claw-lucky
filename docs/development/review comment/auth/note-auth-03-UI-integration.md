原始需求定義的是：

已綁定並驗證 Email、Google 或其他可再次登入的身分。

因此正式使用者條件應是「至少一種永久身分已驗證」，不是 Email 且 Google。Review 所指出的衝突確實會導致一般 Email OTP 使用者永遠停在 upgrade_incomplete。

正確規則
有效 Session
AND is_anonymous = false
AND 使用者狀態正常
AND 至少一個可再次登入的 Identity 已驗證：
    Email OR Google OR 其他支援的永久登入身分

第一版只有 Email OTP，所以：

Email 已驗證 + is_anonymous=false
→ Official User

不需要再綁 Google。