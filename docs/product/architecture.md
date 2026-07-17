# Product Architecture

Version: 1.0

---

# Purpose

本文件定義 claw-lucky 的產品架構。

目的不是描述程式技術，而是定義：

- 產品有哪些模組
- 模組彼此如何合作
- 使用者如何流動
- AI 在哪裡介入

任何新功能都應該放入這個架構，而不是獨立存在。

---

# Product Overview

```
                     +----------------------+
                     |      Home Page       |
                     +----------+-----------+
                                |
                                v
                     +----------------------+
                     |      Gacha Draw      |
                     +----------+-----------+
                                |
                +---------------+---------------+
                |                               |
                v                               v
      +------------------+          +----------------------+
      | Mascot Collection|          | Draw History         |
      +--------+---------+          +----------------------+
               |
               +---------------------------------------------------+
               |               |               |                   |
               v               v               v                   v
      +--------------+ +---------------+ +---------------+ +------------------+
      | Gift Center  | | Lucky Wallpaper| | AI Shopkeeper| | Daily Missions   |
      +------+-------+ +-------+-------+ +-------+-------+ +--------+---------+
             |                 |                 |                   |
             +--------+--------+-----------------+-------------------+
                      |
                      v
             +----------------------+
             | User Profile         |
             +----------+-----------+
                        |
                        v
             +----------------------+
             | Settings / History   |
             +----------------------+
```

---

# Core Modules

## 1. Home

首頁。

負責：

- 今日活動
- 最新公告
- Lucky Banner
- 入口導航

首頁不承載複雜功能。

主要任務是引導使用者開始今天的 Lucky Journey。

---

## 2. Gacha

抽吉祥物。

輸出：

- 吉祥物
- Lucky Event
- 抽卡動畫

所有收藏旅程從這裡開始。

---

## 3. Mascot Collection

圖鑑。

保存：

- 吉祥物
- 稀有度
- 收藏時間

提供：

- AI Wallpaper
- AI Shopkeeper
- Gift 搭配

圖鑑是所有 AI 功能的核心資料來源。

---

## 4. Gift Center

兌換中心。

提供：

- 禮物
- 收藏品
- Lucky Props

Gift 不因 AI Wallpaper 而消耗。

Gift 是 Lucky Story 的一部分。

---

## 5. AI Lucky Wallpaper

輸入：

- 吉祥物
- Gift
- Lucky Theme

輸出：

- 今日桌布
- AI 祝福
- PNG

未來：

- 動態桌布
- Live Wallpaper

---

## 6. AI Shopkeeper

AI 店長。

角色：

- 店長
- 收藏專家
- 幸運顧問

功能：

- 推薦 Gift
- 推薦 Wallpaper
- 生成祝福
- 分享故事

未來：

- 長期記憶
- 個人化聊天

---

## 7. Daily Mission

每天更新。

例如：

- 今日抽一次
- 今日分享
- 今日 Wallpaper

提供：

- Coins
- Tickets
- Lucky Points

---

## 8. Shop

商城。

提供：

- 商品
- Gift
- 周邊

與 Lucky Wallpaper 串聯。

例如：

購買吊飾

↓

AI Wallpaper 自動搭配

---

## 9. User Profile

保存：

- Coins
- Tickets
- Points
- 收藏
- Wallpaper
- Gift

所有個人資料集中管理。

---

## 10. Lucky History

保存：

- 抽卡
- Wallpaper
- Gift
- Lucky Record

讓使用者回顧自己的 Lucky Journey。

---

# AI Architecture

AI 不應該只有一個功能。

AI 存在於：

```
AI Shopkeeper

├── Daily Blessing
├── Lucky Wallpaper
├── Gift Recommendation
├── Story Generation
├── Daily Conversation
└── Future Companion
```

AI 是整個產品的陪伴者。

不是聊天室。

---

# User Journey

```
Home

↓

Gacha

↓

Collection

↓

Gift

↓

AI Wallpaper

↓

Download

↓

Share

↓

Return Tomorrow
```

所有功能都應該強化這條旅程。

---

# Data Relationships

```
User

├── Mascots
├── Gifts
├── Wallpapers
├── Orders
├── Daily Missions
├── Lucky History
└── AI Memories (Future)
```

---

# Product Growth Roadmap

Phase 1

- Gacha
- Gift
- Shop

Phase 2

- AI Wallpaper
- AI Shopkeeper

Phase 3

- Daily Mission
- Lucky Calendar
- Lucky Ranking

Phase 4

- Community
- Friend Gifts
- AI Companion
- Live Wallpaper

---

# Design Philosophy

所有新功能都應符合：

Collection

↓

Personalization

↓

Emotion

↓

Sharing

↓

Daily Habit

不要新增：

孤立功能。

每個功能都必須能回到 Lucky Journey。

---

# Architecture Decision Rules

新增功能前，請先回答：

1. 它屬於哪個模組？
2. 它會影響哪些模組？
3. AI 是否需要參與？
4. 是否增加每日回訪理由？
5. 是否增加收藏價值？
6. 是否增加分享價值？

如果無法回答，

表示功能尚未成熟。

---

# Final Architecture Principle

claw-lucky 不是由很多頁面組成。

而是由一段持續循環的 Lucky Journey 組成。

每個模組都應該讓使用者更期待下一次回來。