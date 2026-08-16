P2-AI Development Principles

所有 AI Agent 的共同準則，例如：

1.AI 不要求使用者理解 Prompt。
2.AI 必須維持吉祥物角色一致性。
3.變色龍店長是祝福與故事的唯一來源。
4.Prompt Builder 是唯一的圖片 Prompt 組裝入口。
5.所有 AI 輸入輸出皆採結構化資料（Schema），避免自由文字耦合。
6.每個 Prompt 都有版本號與驗證機制。



原則一：AI 必須服務產品，而不是產品服務 AI

AI 不應該要求使用者填 Prompt。

AI 應該根據：

吉祥物
禮物
日期
店長祝福

自動完成生成。

原則二：所有圖片生成只能經過 Prompt Builder

禁止：

UI
    ↓
Gemini

必須：

UI
    ↓
Prompt Builder
    ↓
Gemini
原則三：Character First

Prompt Builder 第一優先：

不是背景。

不是風格。

而是：

吉祥物不能變。

例如：

企鵝

↓

永遠是企鵝。
原則四：Shopkeeper 是故事核心

產品不是：

AI Image Generator

而是：

Lucky Wallpaper Generator

所以：

店長

↓

Lucky Theme

↓

Blessing

↓

Wallpaper

原則五：Deterministic before AI

能固定：

就不要 AI。

例如：

日期

尺寸

Logo

Composition

全部固定。

原則六：所有 Prompt 都必須 Version

例如：

wallpaper-v2

shopkeeper-v1

不得：

Hardcode。

Copilot Agent Definition of Done

每一個 Agent 完成前都必須回答：

Functional
有沒有完成需求？
UX
使用者真的需要這個欄位嗎？

例如：

Lucky Theme

答案：

不用。

那就應該刪。

AI

AI 是否知道：

吉祥物？
禮物？
日期？
店長祝福？

如果不知道：

不能 PASS。

Architecture

有沒有：

Schema
Validation
Unit Test
Future

是否支援：

新吉祥物
新禮物
新 Prompt Version