
請寫出自動化測試(Test 1~5)，或如果已經有測試程式就直接執行。

Test 1：Deterministic Prompt

固定輸入：

Mascot
轉運小企鵝

Gift
幸運乒乓守護吊飾

Theme
穩穩接住今天的好運

Blessing
今天每一次努力都會更靠近成功。

Date
2026.07.21

執行 Builder：

100 次

驗證：

100 次 Prompt 完全一致

PASS。

Test 2：Single Change

第一次：

Gift=A

第二次：

Gift=B

驗證：

Prompt：

只有 Gift 段落改變。

其它：

Mascot

Theme

Blessing

Date

全部完全一致。

PASS。

Test 3：Character Identity

Builder 產出的 Prompt：

一定包含：

Species

Appearance

Character Consistency Rules

而不是：

mascotId

PASS。

Test 4：Date

Builder：

今天：

Asia/Taipei

驗證：

2026.07.21

格式。

PASS。

Test 5：Validation

把：

Gift：

拿掉。

應得到：

PromptValidationError

不是：

半成品 Prompt

PASS。