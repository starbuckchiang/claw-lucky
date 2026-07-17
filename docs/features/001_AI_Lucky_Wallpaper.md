# AI Lucky Wallpaper Studio

Version: 1.0
Status: Draft
Owner: claw-lucky Product Team

---

# 1. Vision

AI Lucky Wallpaper Studio 將「抽吉祥物」延伸成每天都值得回來使用的體驗。

使用者可以利用自己收藏的吉祥物、兌換的禮物，以及 AI 店長每日產生的幸運祝福，生成一張屬於自己的今日幸運手機桌布。

每一張桌布都是唯一的，也代表今天的幸運紀錄。

---

# 2. Background

目前 claw-lucky 已完成：

- 吉祥物抽獎（Gacha）
- 吉祥物圖鑑（Collection）
- 禮物兌換（Gift）
- 商品商城（Shop）
- 購物車
- Supabase 使用者系統

目前使用者完成抽獎後，缺乏持續回訪網站的理由。

本功能希望將：

抽獎

↓

收藏

↓

AI 客製化

↓

每日幸運

↓

分享

串成完整體驗。

---

# 3. Product Goals

本功能目標：

- 提升每日回訪率（Daily Active User）
- 提升吉祥物收藏價值
- 提升禮物兌換率
- 提升分享率
- 建立 AI 店長角色

---

# 4. Target Users

主要：

- 喜歡抽獎
- 喜歡收藏
- 喜歡可愛角色
- 喜歡手機桌布

次要：

- 喜歡 AI 圖片
- 喜歡每日占卜
- 喜歡分享社群

---

# 5. User Journey

Step 1

進入：

Lucky Wallpaper Studio

↓

Step 2

選擇一隻已收藏吉祥物

↓

Step 3

選擇一件已兌換禮物

↓

Step 4

AI 店長產生：

- 今日祝福
- 今日幸運主題

↓

Step 5

選擇桌布風格

↓

Step 6

AI 生成桌布

↓

Step 7

預覽

↓

Step 8

下載 PNG

↓

Step 9

分享

---

# 6. Functional Requirements

## 6.1 吉祥物

使用者只能選擇：

自己已收藏的吉祥物。

系統需顯示：

- 名稱
- 圖片
- 稀有度

---

## 6.2 禮物

只能選擇：

已成功兌換的禮物。

系統需顯示：

- 商品圖片
- 商品名稱

禮物不會因生成桌布而消耗。

---

## 6.3 AI 店長

AI 店長需要生成：

- 今日祝福
- 今日一句話
- 今日幸運主題

祝福需根據：

- 吉祥物
- 禮物
- 日期
- 今日 Lucky Theme

每天應有所不同。

---

## 6.4 Lucky Information

每張桌布需包含：

- 今日日期
- 今日 Lucky Theme
- AI 店長祝福

未來可擴充：

- 幸運色
- 幸運數字
- Lucky Score

---

## 6.5 Wallpaper

AI 生成內容包含：

- 吉祥物
- 禮物
- AI 祝福
- 日期浮水印
- 裝飾元素

生成尺寸：

1080 × 1920

未來：

1440 × 2560

---

## 6.6 Wallpaper Style

第一版提供：

- Retro（預設）
- Cute
- Japanese
- Fantasy
- Minimal

後續可新增：

- Cyberpunk
- Christmas
- Halloween
- Lunar New Year

---

## 6.7 Selfie（Optional）

使用者可：

上傳自拍。

AI 可：

將吉祥物臉替換成使用者。

限制：

僅支援單人自拍。

---

## 6.8 Download

生成完成：

立即下載。

格式：

PNG

---

## 6.9 History

建立：

My Lucky Wallpapers

使用者可以：

- 查看歷史
- 重新下載
- 查看生成日期

---

# 7. Business Rules

## Gift

生成桌布：

不消耗禮物。

---

## Mascot

吉祥物：

永久可重複使用。

---

## Download

生成圖片：

保存 30 天。

30 天後：

自動刪除。

---

## Selfie

原始自拍：

加密保存 24 小時。

24 小時後：

自動刪除。

不可用於：

- AI 模型訓練
- 廣告
- 二次用途

---

# 8. AI Rules

AI 必須生成：

- 今日祝福
- 今日桌布

祝福不得每天完全相同。

AI 應避免：

- 政治
- 宗教
- 成人內容
- 攻擊性內容

---

# 9. Failure Handling

若 AI 生成失敗：

顯示：

重新生成。

不得扣除任何點數。

---

若下載失敗：

可重新下載。

---

若 AI Timeout：

提示稍後再試。

---

# 10. Privacy

自拍：

不得永久保存。

不得提供第三方模型訓練。

不得人工查看。

---

# 11. Success Metrics

三個月內：

- DAU +30%
- Wallpaper Download +40%
- Gift Redemption +20%
- Returning User +25%

---

# 12. Future Roadmap

未來可加入：

- Lucky Score
- 每日幸運色
- 每日幸運數字
- Live Wallpaper
- AI Animation
- AI Sticker
- 分享到 Threads
- 分享到 Instagram
- 分享到 LINE
- AI Shopkeeper Chat
- AI 每日任務

---

# 13. Out of Scope (MVP)

第一版不包含：

- 多人合照
- 影片生成
- Live Wallpaper
- NFT
- Marketplace
- 使用者自行輸入 Prompt