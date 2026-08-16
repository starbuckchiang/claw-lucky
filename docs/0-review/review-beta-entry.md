# review-beta-entry.md

## 任務
建立 `beta.html` 作為封閉測試導覽入口，僅新增檔案，不重構/搬移/改寫任何既有程式或商業邏輯。

## 變更檔案（只新增，未修改既有檔案）
- `beta.html`（新增）
- `css/pages/beta.css`（新增，獨立樣式檔，不影響其他頁面）

## 真實路由確認（未猜測）
於實作前直接讀取以下既有檔案確認真實檔名/標題：
- `gacha.html`（title: 好運蛋扭扭樂）→「開始抽幸運扭蛋」按鈕目標
- `gift.html`（title: 舊社選物｜好運商品兌換）→「前往兌換禮物」按鈕目標
- `wallpaper.html`（title: Lucky Wallpaper Studio，功能為 AI 幸運桌布生成）→「製作今日幸運桌布」按鈕目標

## 內容/限制符合性檢查
- 三顆按鈕皆為單純 `<a href>` 導頁，無 JS、無資格驗證、無資料修改、無 UID 傳遞、無 query 參數、無自動執行。
- 顯示流程說明「抽扭蛋 → 兌換禮物 → 製作桌布」，並顯示封閉測試提醒（不會真正付款、資料可能清除）。
- `<meta name="robots" content="noindex,nofollow" />` 已加入 `<head>`。
- 未從 `index.html`、任何導覽列或 sitemap 加入 beta 入口連結（`index.html` 未變更）。
- 沿用既有品牌配色（沿用 `css/gift.css` 同色系數值：焦糖棕 `#8b5734`/`#6c4024`、米黃紙色 `#ecd9af`），字型與底色沿用既有 `css/base.css`（未修改該檔案，僅連結引用）。
- 版面為手機優先（單欄、`max-width:480px` 置中），按鈕為原生 `<a>` 元素，可用 Tab 鍵聚焦並有 `:focus-visible` 外框，鍵盤可操作。
- 全繁體中文文案。

## git diff 確認
執行 `git status --porcelain` 檢查：本次任務只新增了 `beta.html` 與 `css/pages/beta.css` 兩個檔案（皆為 `??` 未追蹤新檔）。工作區另外存在大量與本任務無關的既有未提交變更（先前工作階段留下的 auth/subscription/migrations 等），**這些並非本次任務所產生**，也未被本次操作觸碰或修改。

## 自動化驗證
執行既有 `scripts/verify-local.ps1`：
```
== Syntax Check ==
== Unit Tests ==
Verification Complete
tests 414
pass 414
fail 0
```
全數通過，無因新增檔案造成回歸。

## 本機手動測試（真實瀏覽器點擊）
使用本機靜態伺服器（`python -m http.server 5588`，測試後已關閉）+ 瀏覽器實際開啟與點擊驗證：

| 步驟 | 按鈕文字 | 期望目標 | 實測結果 |
|---|---|---|---|
| 1 | 開始抽幸運扭蛋 | `./gacha.html` | ✅ 點擊後成功導向 `gacha.html`（標題「好運蛋扭扭樂」正常渲染） |
| 2 | 前往兌換禮物 | `./gift.html` | ✅ 點擊後成功導向 `gift.html`（標題「舊社選物｜好運商品兌換」正常渲染） |
| 3 | 製作今日幸運桌布 | `./wallpaper.html` | ✅ 點擊後成功導向 `wallpaper.html`（標題「Lucky Wallpaper Studio」正常渲染） |

`beta.html`／`css/pages/beta.css` 皆回應 HTTP 200，樣式正確載入（截圖確認深棕底、米色卡片、三顆按鈕版面）。

## 既有流程缺陷（僅記錄，未修改）
- 無新發現缺陷需記錄；本次任務範圍內僅新增導覽頁，未觸及既有頁面邏輯。
