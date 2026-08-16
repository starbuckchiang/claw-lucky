# P2-UI-02 Review

## UI Flow
- 載入我的吉祥物（owned mascots）
- 載入可使用 gifts
- 卡片選擇 mascot + gift
- Preview 即時更新
- Generate 送出既有 Generation Client

## Component Tree
- wallpaper-app
  - Collection section
  - Gifts section
  - Preview section
  - Generate section

## Selection Flow
- 點選卡片更新 selectedMascotId / selectedGiftId
- 按鈕 disabled 條件：未同時選定 mascot/gift

## Empty State
- Collection empty: 顯示「目前沒有已擁有的吉祥物」
- Gift empty: 顯示「目前沒有可使用的 Gift」

## Accessibility
- radiogroup + radio role
- status / alert ARIA
- button 可鍵盤操作（Tab + Enter/Space）

## Responsive
- Desktop: 4 欄
- Tablet: 3/2 欄
- Mobile: 1 欄

## Tests
- Collection Success / Empty
- Gift Success / Empty
- Selection
- Preview
- Generation Submit
- 全 mock，未連 Supabase

## Known Limitations
- card 鍵盤方向鍵切換尚未做 roving tabindex（目前仍可 Tab 導覽）