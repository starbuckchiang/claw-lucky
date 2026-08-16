你現在是 Claw Lucky 專案的資深產品設計師、前端工程師與 Supabase 工程師。

請將現有合作提案 PDF：

docs/proposals/Claw Lucky合作提案.pdf

轉換為一個可獨立分享、可蒐集合作名單、可追蹤瀏覽轉換的正式合作提案網站。

這不是把 PDF 逐頁搬到網頁，也不是做成投影片輪播。請將提案重新整理成適合網路閱讀與合作轉換的單頁 Landing Page。

## 一、開始前必須先做

請先閱讀並遵循：

1. 專案 AI Constitution
2. 現有架構文件
3. 現有 CSS、JavaScript 命名與目錄規範
4. Supabase client 初始化方式
5. 現有 RLS 規範
6. 現有測試與本機啟動方式
7. docs/proposals/Claw Lucky合作提案.pdf 的全部內容

先回報：

- PDF 核心內容摘要
- 現有專案中可以沿用的模組
- 預計新增及修改的檔案
- 是否發現與現有架構衝突

確認完成後再開始實作。

不得直接修改既有商品、抽獎、兌換、購物車與 AI 桌布功能。

## 二、任務目標

建立一個「無人店面壁掛數位看板與互動體驗 SaaS」合作提案網站，主要目標對象為：

- 無人選物店場主
- 夾娃娃機店主
- 自助商店經營者
- 商場或場域經營者
- 希望活化閒置牆面的合作夥伴

網站的主要轉換目標：

1. 讓場主理解牆面數位化方案
2. 說明 Claw Lucky 的軟硬體整合能力
3. 邀請前 5 家示範門市參加 30 天 PoC
4. 蒐集合作洽詢資料
5. 追蹤瀏覽、CTA 點擊與表單轉換

本階段完成本機可驗收版本，不要正式部署、不要 push、不要修改正式 Supabase。

## 三、建立檔案

依照現有專案結構調整，原則上建立：

- partner.html
- css/partner.css
- js/partner.js
- js/services/partner-inquiry-service.js
- js/services/partner-analytics-service.js
- supabase/migrations/[timestamp]_create_partner_proposal_tables.sql
- docs/features/partner-proposal-page.md
- docs/reviews/partner-proposal-review.md

如果已有相同服務或元件，優先沿用，不要重複建立。

不要把大量 CSS、JavaScript 或 Supabase 邏輯全部塞進 partner.html。

## 四、網站定位與視覺方向

網站應呈現：

- 專業
- 現代
- 可信任
- 具有數位互動感
- 保留 Claw Lucky 吉祥物與好運品牌特色
- 適合拿給實體店主與商業合作夥伴閱讀

避免：

- 看起來像學生簡報
- 把 PDF 灰底投影片直接貼上網站
- 過度卡通化
- 過多閃爍、漂浮或干擾閱讀的動畫
- 虛構合作門市、客戶、營收或使用人數
- 使用來源不明的網路圖片
- 引入不必要的大型 UI 套件

配色可沿用 Claw Lucky 的金色、橘色、暖色系，搭配深色背景或乾淨淺色區塊，提高商業感與可讀性。

## 五、網站內容結構

### 1. Hero 首屏

主標題：

「讓閒置牆面，成為會互動、會引流、會創造收益的數位入口」

副標題：

「Claw Lucky 以壁掛數位看板、好運互動遊戲、AI 桌布與會員引流，為無人店面注入數位體驗與第二營收來源。」

顯示以下重點標籤：

- 不占用地面坪數
- 不增加商品庫存
- 30 天 PoC 驗證
- 互動數據可追蹤

主要 CTA：

「申請 30 天免費試營運」

次要 CTA：

「查看合作方案」

首屏可使用 PDF 中的壁掛數位看板概念作為設計參考，但不要直接截取低解析度投影片當背景。

如果專案沒有可合法使用的圖片，先使用精緻的 CSS 裝置 mockup，並在文件列出待補圖片。

### 2. 場主面臨的問題

將 PDF 中的四個問題轉成容易掃讀的內容：

- 坪效受限：機台數量與店面坪數限制營收成長
- 牆面閒置：牆面多半只能張貼警語或靜態海報
- 流量斷頭：顧客消費後離開，難以進行後續互動
- 體驗單一：同質化嚴重，缺乏能被記住的互動體驗

不要過度放大恐懼，應以場主真實經營痛點呈現。

### 3. Claw Lucky 解決方案

主題：

「一面牆，串起動態視覺、娛樂互動與線上引流」

呈現三項價值：

- 輕資產壁掛設備：只需牆面、電源及必要網路
- 動態氛圍與 IP 注入：以變色龍店長等視覺內容增加店面溫度
- O2O 互動閉環：以 QR Code、今日好運抽獎及限定 AI 桌布，把現場訪客帶到線上

需清楚區分：

- 已完成能力
- PoC 驗證中的能力
- 未來規劃

不得把未完成的功能描述成已正式上線。

### 4. 三大核心模組

建立三個主要模組區塊：

#### 動態店招與時空感知

- 依日期、時間及情境切換視覺內容
- 範例：週一加油、節慶主題、雨天祝福
- 不得宣稱已串接天氣 API，除非現有程式確實完成

#### 好運抽獎與遊戲化互動

- 掃碼進入好運盲盒或互動活動
- 點數、代幣與數位獎勵
- 提高顧客停留及再次互動的意願

#### 私域引流與數位收藏

- AI 好運手機桌布
- LINE 官方帳號或會員綁定的未來整合
- 將一次性到店轉為後續線上互動

如果 LINE 綁定尚未實作，必須標為規劃中。

### 5. 使用流程

使用清楚的流程呈現：

1. 顧客在店內看到壁掛數位看板
2. 掃描該門市專屬 QR Code
3. 參加今日好運抽獎或互動
4. 解鎖 AI 好運桌布或數位收藏
5. 產生匿名互動與轉換數據
6. 場主依合作方案取得分潤

手機版必須改成直向流程，不可產生水平捲動。

### 6. 營收與分潤模型

呈現三種可能收入來源：

- C 端小額互動消費
- AI 桌布或數位商品
- 周邊商圈動態廣告

呈現場主分潤：

「依實際合作方案，場主可享 15%–30% 淨利分潤。」

必須加上說明：

「實際分潤比例、營收與成本依場地、設備、流量及合作內容另行評估。」

不得把財務預估寫成收益保證。

### 7. PoC 財務試算

依 PDF 顯示一個「提案試算範例」，資料為：

- 初始 CAPEX：約 NT$20,000
- 每月 OPEX：約 NT$2,500
- 預估每月總營收：約 NT$12,000
- 預估每月營運利潤：約 NT$9,500
- 試算設備回本週期：約 2.1 個月

必須明顯標示：

- 以上是提案情境試算，不是保證收益
- 尚未經 PoC 真實營運數據驗證
- 實際結果受門市流量、顧客轉換、廣告銷售及營運成本影響

桌機可使用表格，手機需保持容易閱讀。

### 8. 技術架構與安全

以非工程人員也能理解的方式說明：

- GitHub Pages 靜態前端
- Supabase 資料服務
- Row Level Security
- QR Code 門市來源識別
- 快取與斷網應變為設備端規劃

不要使用：

- 「百分之百安全」
- 「絕對不會斷線」
- 「保證秒級同步」

改用可驗證、保守且專業的表達。

如果斷網自動重連與快取播映尚未實作，標示為 PoC 設備需求或待驗證項目。

### 9. 發展階段

呈現三個階段：

#### Phase 1：現在

- 壁掛看板 PoC
- 線下 QR Code 引流
- 好運互動
- AI 桌布流程
- 基礎數據追蹤

#### Phase 2：近期規劃

- 遠端實體機台互動
- 實體機台預約及兌換
- 更完整的店家管理功能

#### Phase 3：長期方向

- 線上抽獎
- 線下取貨與換貨
- 跨門市無人選物聯盟

Phase 2、Phase 3 必須清楚標示為規劃，不可讓訪客誤認為已完成。

### 10. 創始示範門市方案

建立高轉換 CTA 區塊：

標題：

「邀請您成為第一批牆面數位化示範門市」

內容：

- 限前 5 家合作門市
- 免收裝設費
- 提供一套專屬無人店數位店招設計
- 提供 30 天免費 PoC 試營運
- 以真實互動與轉換資料評估是否繼續合作

加入必要條件說明：

- 實際設備、施工與場地條件需先評估
- 優惠內容以雙方確認的合作文件為準
- 不得只靠前端顯示「剩餘名額」製造虛假稀缺感
- 如果沒有真實名額資料，不顯示動態倒數或剩餘數字

CTA：

「申請示範門市評估」

### 11. FAQ

至少包含：

- 需要提供多少牆面空間？
- 店家需要負擔哪些費用？
- 30 天 PoC 會驗證哪些數據？
- 顧客需要下載 App 嗎？
- 如何計算門市帶來的收益與分潤？
- 斷網時數位看板是否仍能使用？
- 是否能使用店家自己的品牌角色與活動？
- 試營運結束後是否一定要簽約？

答案必須依提案內容撰寫；不確定的內容應使用「需依場地評估」或列為待確認，不可自行承諾。

### 12. 聯絡與 Footer

聯絡資料：

- 專案負責人：漁仁婕 & Claw Lucky Team
- Email / LINE ID：sabrina114114@gmail.com
- 線上 Demo：
  https://starbuckchiang.github.io/claw-lucky/index.html

Email 必須使用 mailto 連結。

Demo 使用新分頁開啟並加上安全的 rel 屬性。

頁面標示：

「Claw Lucky 合作提案｜僅供合作洽談使用」

不要加入未確認的公司統編、公司地址、合作品牌或法律實體資料。

## 六、合作洽詢表單

建立完整表單，欄位包含：

- 姓名，必填
- 公司或店名，必填
- 職稱，選填
- Email，必填
- 電話或 LINE ID，選填
- 門市地址或主要營運地區，必填
- 門市類型，必填
- 門市數量，選填
- 可使用牆面的大約尺寸，選填
- 希望合作方式，必填
- 預計開始時間，選填
- 合作需求或問題，必填
- 同意為合作洽談目的使用所填資料，必填

合作方式選項：

- 申請30天PoC
- 壁掛數位看板
- 好運抽獎與AI桌布
- 區域廣告合作
- 多門市合作
- 其他

表單要求：

1. 使用語意化 HTML 與正確 label
2. 驗證必填欄位
3. 驗證 Email 格式
4. 顯示欄位錯誤原因
5. 錯誤訊息不得只以顏色表示
6. 加入隱藏 honeypot
7. 防止連續快速重複送出
8. 送出時顯示 loading
9. 成功時顯示案件編號或成功訊息
10. 成功後清除表單
11. 失敗時保留使用者已填內容
12. 不得在 console、URL或 analytics 中記錄表單個資
13. 不得把 Supabase service_role key 放到前端
14. 不得只存 localStorage 假裝已送出

## 七、Supabase 資料設計

建立 migration。

### partner_inquiries

至少包含：

- id uuid primary key default gen_random_uuid()
- name text not null
- company_name text not null
- job_title text
- email text not null
- contact_method text
- business_area text not null
- store_type text not null
- store_count integer
- wall_size text
- cooperation_type text not null
- expected_start text
- message text not null
- consent boolean not null
- proposal_version text
- source_page text
- utm_source text
- utm_medium text
- utm_campaign text
- created_at timestamptz not null default now()

### partner_analytics_events

至少包含：

- id uuid primary key default gen_random_uuid()
- visitor_id text
- session_id text
- event_name text not null
- page_path text
- referrer_domain text
- utm_source text
- utm_medium text
- utm_campaign text
- event_metadata jsonb not null default '{}'::jsonb
- created_at timestamptz not null default now()

依專案現有 Supabase 架構調整，但必須：

- 啟用 RLS
- 匿名訪客只能 INSERT 合作洽詢
- 匿名訪客不可 SELECT 洽詢名單
- 匿名訪客不可 UPDATE 或 DELETE 洽詢資料
- analytics 只允許白名單事件
- event_metadata 不得包含姓名、Email、電話、地址或表單訊息
- 對文字長度、store_count 與 event_name 加入合理約束
- 不可只依賴前端驗證
- 不可將敏感資料放進 SQL 註解或測試資料

如果公開 anon INSERT 的濫用風險無法妥善處理，請在 review 中標示正式上線前應改用 Supabase Edge Function 搭配 Cloudflare Turnstile。

本階段不要自行建立尚未設定完成的 Edge Function。

## 八、瀏覽與轉換追蹤

建立第一方、低侵入式追蹤，不加入 Google Analytics、Meta Pixel 或其他第三方追蹤器。

追蹤事件：

- partner_page_view
- pain_points_view
- solution_view
- revenue_model_view
- poc_offer_view
- demo_click
- primary_cta_click
- inquiry_form_start
- inquiry_form_validation_error
- inquiry_form_submit_success
- inquiry_form_submit_error

追蹤規則：

- visitor_id 儲存在 localStorage
- session_id 儲存在 sessionStorage
- 使用 crypto.randomUUID()
- 同一 session 的 page view 只送一次
- 區塊事件只在第一次進入視窗時送出一次
- 使用 IntersectionObserver
- 儲存 utm_source、utm_medium、utm_campaign
- referrer 只保存網域，不保存完整 query string
- CTA metadata 只能保存按鈕位置與類型
- 不得記錄表單欄位值
- analytics 失敗不得阻止頁面或表單運作
- 使用者開啟 Do Not Track 時停止非必要分析事件
- 表單送出仍需正常運作

測試網址：

partner.html?utm_source=line&utm_medium=direct_message&utm_campaign=poc_store_recruitment_2026

## 九、SEO 與分享設定

加入：

- 正確的中文 title
- meta description
- canonical placeholder
- Open Graph title
- Open Graph description
- Open Graph image placeholder
- Twitter Card
- favicon 沿用現有專案

建議 title：

「無人店面壁掛數位看板與互動體驗合作｜Claw Lucky」

建議 description：

「以壁掛數位看板、好運互動、AI桌布與QR Code引流，協助無人店面活化閒置牆面並驗證第二營收來源。」

不要虛構 Organization 結構化資料。

在 review 文件列出正式部署前需要替換的：

- canonical URL
- Open Graph image
- 正式隱私權說明
- 聯絡資料
- 正式提案版本
- 表單後端防濫用措施

## 十、響應式與無障礙

必須支援：

- 360px 手機
- 768px 平板
- 1440px 桌機

要求：

- 不得水平捲動
- 文字不可重疊或被裁切
- 財務表格手機版可正常閱讀
- 所有操作可用鍵盤完成
- focus 狀態清楚
- 色彩對比足夠
- 圖片有合適 alt
- 裝飾圖片使用空 alt
- FAQ 使用正確的 button 與 aria-expanded
- 表單錯誤與狀態使用 aria-live
- 支援 prefers-reduced-motion
- CTA 捲動定位不得被固定導覽列遮住

## 十一、測試與驗收

至少驗證：

1. localhost:5500/partner.html 可正常開啟
2. PDF 的核心提案內容已正確轉換
3. 頁面不是 PDF iframe 或逐頁圖片
4. Console 無未處理錯誤
5. 360px、768px、1440px 版面正常
6. 主 CTA 可正確到達表單
7. Demo 連結正確
8. Email 連結正確
9. Email 格式錯誤時不能送出
10. 未同意個資使用時不能送出
11. honeypot 有值時拒絕送出
12. 快速連按不會重複建立資料
13. 送出失敗時保留表單內容
14. 成功後 Supabase 僅建立一筆資料
15. UTM 參數正確保存
16. page view 同一 session 不重複
17. 區塊曝光事件不重複
18. analytics 不保存表單個資
19. analytics 失敗不影響表單
20. 匿名使用者不能讀取合作洽詢名單
21. 匿名使用者不能修改或刪除洽詢
22. 現有專案頁面與測試不受影響
23. 未完成能力均有標示「PoC」或「規劃中」
24. 財務試算具有明顯免責說明
25. 沒有「保證獲利」或「百分之百安全」等不實敘述

自動測試無法涵蓋的項目，請在 review 文件中提供精確的人工驗收步驟。

不得把沒有執行的測試標為 PASS。

## 十二、執行順序

請依序：

1. 閱讀 PDF 與專案規範
2. 盤點現有程式
3. 提出檔案修改計畫
4. 實作頁面
5. 實作表單服務
6. 實作 analytics 服務
7. 建立 migration 與 RLS
8. 執行自動測試
9. 啟動 localhost:5500
10. 使用瀏覽器實際測試
11. 測試三種響應式尺寸
12. 修正問題
13. 產出 partner-proposal-review.md

## 十三、禁止事項

- 不要正式部署
- 不要自行 git push
- 不要 merge
- 不要修改正式 Supabase
- 不要暴露 API key
- 不要加入第三方追蹤碼
- 不要虛構合作門市或營運數據
- 不要聲稱 PoC 尚未驗證的結果
- 不要使用來源不明圖片
- 不要破壞現有功能
- 不要把 PDF 當 iframe 嵌入
- 不要只做靜態畫面而省略表單與追蹤
- 不要虛構測試結果

## 十四、完成後回報格式

完成後只依以下格式回報：

### 1. 實作摘要
說明完成了什麼。

### 2. 新增與修改檔案
逐一列出檔案與用途。

### 3. 本機入口
提供 localhost 網址。

### 4. 自動測試
列出實際執行的指令與結果。

### 5. 手動驗收
列出已實際驗證的項目與結果。

### 6. Supabase
說明 migration 檔案、RLS 設計及套用方式，但不要實際套用正式環境。

### 7. 待補資料
列出正式圖片、網址、隱私權內容及其他待確認資料。

### 8. 已知風險
說明防濫用、個資、財務試算與尚未完成能力的風險。

### 9. 部署判定
只能回覆以下其中一項：

- READY FOR GATE REVIEW
- NOT READY FOR GATE REVIEW

並附上具體理由。
## 補充需求：全站改為中英文對照版

請將本次建立的 partner.html 合作提案網站製作成「繁體中文＋英文對照版」。

這不是只提供語言切換，也不是建立兩套重複頁面。預設畫面必須能同時看到繁體中文與對應英文，方便台灣場主及國際合作對象閱讀與核對內容。

## 一、雙語呈現方式

### 桌機版

在適合對照閱讀的內容區塊採用雙欄：

- 左欄：繁體中文
- 右欄：英文
- 中文與英文必須位於同一個內容單元
- 中英文標題、段落、項目必須保持上下或左右對齊
- 不要把全頁中文放完後，才接一整份英文

### 手機版

在 767px 以下改為直向排列：

1. 繁體中文
2. 對應英文

每組中英文內容之間需有適當間距或視覺分隔。

不得產生水平捲動，也不得因雙語內容造成文字過小。

### 簡短介面文字

以下內容可採同一行呈現：

- 查看合作方案 / Explore Partnership
- 申請示範門市評估 / Apply for a Pilot Store
- 送出合作洽詢 / Submit Inquiry
- 查看線上 Demo / View Live Demo

如果手機版同一行過長，可改成上下兩行，但必須維持同一個按鈕，不能建立兩個功能相同的按鈕。

## 二、翻譯原則

英文必須是自然、專業的商務英文，不可逐字翻譯，也不可使用不符合國際商務語境的中式英文。

統一使用以下翻譯：

| 繁體中文 | 英文 |
|---|---|
| 爪爪好運 | Claw Lucky |
| 無人店面 | Unstaffed Retail Store |
| 無人選物店 | Unstaffed Amusement Retail Store |
| 壁掛數位看板 | Wall-Mounted Digital Signage |
| 互動體驗 SaaS | Interactive Experience SaaS |
| 場主 | Store Operator |
| 示範門市 | Pilot Store |
| 概念驗證 | Proof of Concept (PoC) |
| 坪效 | Revenue per Unit of Floor Space |
| 閒置牆面 | Underutilized Wall Space |
| 私域引流 | First-Party Audience Engagement |
| 今日好運抽獎 | Daily Lucky Draw |
| AI 好運桌布 | AI-Generated Lucky Wallpaper |
| 數位收藏 | Digital Keepsake |
| 動態店招 | Dynamic Digital Signage |
| 場主分潤 | Revenue Share for Store Operators |
| 試營運 | Pilot Operation |
| 合作洽詢 | Partnership Inquiry |
| 淨利分潤 | Net Profit Sharing |
| 線上引流 | Online Engagement |
| 互動轉換 | Engagement Conversion |

避免直接將「私域流量」翻譯成 private traffic。

英文內容中第一次出現專有概念時應完整說明，後續才可使用簡稱。

品牌名稱一律使用：

中文：爪爪好運  
英文：Claw Lucky

不要任意改為 Claw-Lucky、ClawLucky 或其他拼法。

## 三、主要雙語文案

### Hero 主標題

中文：

「讓閒置牆面，成為會互動、會引流、會創造收益的數位入口」

英文：

“Turn Underutilized Walls into Interactive Digital Touchpoints That Engage Customers and Create New Revenue Opportunities”

### Hero 副標題

中文：

「Claw Lucky 以壁掛數位看板、好運互動遊戲、AI 桌布與會員引流，為無人店面注入數位體驗與第二營收來源。」

英文：

“Claw Lucky combines wall-mounted digital signage, lucky-draw experiences, AI-generated wallpapers, and first-party audience engagement to help unstaffed retail stores create richer customer experiences and explore additional revenue streams.”

### Hero 主要 CTA

中文：

「申請 30 天免費試營運」

英文：

“Apply for a 30-Day Free Pilot”

### Hero 次要 CTA

中文：

「查看合作方案」

英文：

“Explore the Partnership”

### 核心定位

中文：

「一面牆，串起動態視覺、娛樂互動與線上引流」

英文：

“One Wall Connecting Dynamic Content, Interactive Entertainment, and Online Engagement”

### PoC 招募標題

中文：

「邀請您成為第一批牆面數位化示範門市」

英文：

“Become One of Our First Wall-Digitalization Pilot Stores”

### PoC CTA

中文：

「申請示範門市評估」

英文：

“Apply for a Pilot Store Assessment”

## 四、痛點區塊雙語文案

### 坪效受限

中文：

「機台數量與店面坪數限制營收成長。」

英文：

“Revenue growth is constrained by limited floor space and the number of machines that can be installed.”

### 牆面閒置

中文：

「牆面多半只能張貼警語或靜態海報，尚未形成可衡量的商業價值。」

英文：

“Most wall space is used only for notices or static posters, leaving its commercial potential largely untapped.”

### 流量斷頭

中文：

「顧客完成消費後離開，店家難以持續互動或建立長期顧客關係。」

英文：

“Once customers complete their visit, store operators have limited opportunities to continue the relationship or encourage repeat engagement.”

### 體驗單一

中文：

「同質化程度高，缺乏能讓顧客記住並願意分享的互動體驗。」

英文：

“Highly similar store experiences make it difficult to create memorable interactions that customers want to revisit or share.”

## 五、三大核心模組雙語名稱

### 動態店招與時空感知

英文：

“Context-Aware Dynamic Signage”

英文說明：

“Digital content can be scheduled or adapted to dates, time periods, holidays, and verified contextual data sources.”

如果天氣 API 尚未完成，不得翻譯成系統已經能依天氣自動運作。

### 好運抽獎與遊戲化互動

英文：

“Lucky Draws and Gamified Experiences”

英文說明：

“Customers scan a QR code to access lucky draws, digital rewards, points, tokens, or other interactive experiences.”

### 私域引流與數位收藏

英文：

“First-Party Audience Engagement and Digital Keepsakes”

英文說明：

“AI-generated lucky wallpapers and digital keepsakes extend the customer experience beyond the physical store.”

## 六、營收模式雙語內容

### C 端小額互動消費

英文：

“Customer Microtransactions”

### AI 桌布與數位商品

英文：

“AI-Generated Wallpapers and Digital Products”

### 周邊商圈動態廣告

英文：

“Local Business Advertising”

### 場主分潤說明

中文：

「依實際合作方案，場主可享 15%–30% 淨利分潤。」

英文：

“Depending on the final partnership structure, store operators may receive a 15%–30% share of applicable net profit.”

### 分潤免責說明

中文：

「實際分潤比例、營收與成本依場地、設備、流量及合作內容另行評估。」

英文：

“Actual revenue share, revenue, and operating costs will vary based on the location, equipment requirements, customer traffic, and agreed partnership scope.”

不得將 “may receive” 改成 “will receive”。

## 七、財務試算雙語內容

區塊標題：

中文：

「PoC 財務情境試算」

英文：

“Illustrative PoC Financial Scenario”

欄位名稱：

| 繁體中文 | 英文 |
|---|---|
| 初始設備與裝設成本 | Initial Equipment and Installation Cost |
| 每月固定營運成本 | Estimated Monthly Operating Cost |
| 預估每月總營收 | Illustrative Monthly Gross Revenue |
| 預估每月營運利潤 | Illustrative Monthly Operating Profit |
| 試算設備回本週期 | Illustrative Equipment Payback Period |

數值維持：

- 約 NT$20,000
- 約 NT$2,500
- 約 NT$12,000
- 約 NT$9,500
- 約 2.1 個月

英文金額格式：

- Approx. NT$20,000
- Approx. NT$2,500
- Approx. NT$12,000
- Approx. NT$9,500
- Approx. 2.1 months

中文免責聲明：

「以上數字僅為提案情境試算，尚未經實際 PoC 營運數據驗證，不構成營收、獲利或回本保證。」

英文免責聲明：

“These figures are provided solely as an illustrative proposal scenario and have not yet been validated through live PoC operations. They do not constitute a guarantee of revenue, profit, or investment payback.”

中英文免責聲明必須同時顯示，而且在視覺上清楚可見，不可放在難以閱讀的小字區域。

## 八、發展階段雙語名稱

### Phase 1：現在

英文：

“Phase 1: Current PoC”

### Phase 2：近期規劃

英文：

“Phase 2: Near-Term Development Plan”

### Phase 3：長期方向

英文：

“Phase 3: Long-Term Vision”

Phase 2、Phase 3 的中英文內容都必須標示為尚未完成的發展規劃。

英文不得使用會讓讀者認為功能已經正式上線的現在式敘述。

## 九、PoC 方案雙語內容

中文：

- 限前 5 家合作門市
- 免收裝設費
- 提供專屬無人店數位店招設計
- 提供 30 天免費 PoC 試營運
- 使用實際數據評估後續合作

英文：

- Available to the first five qualified pilot stores
- Installation fee waived during the founding pilot program
- One customized digital signage design package
- A 30-day PoC pilot operation at no charge
- Post-pilot evaluation based on actual engagement and conversion data

中文條件：

「實際設備、施工與場地條件需先行評估，優惠內容以雙方最終確認的合作文件為準。」

英文條件：

“Equipment, installation, connectivity, and site conditions are subject to prior assessment. Final pilot terms will be governed by the partnership documents agreed upon by both parties.”

## 十、雙語合作表單

每個欄位都要顯示中文與英文名稱。

例如：

```html
<label for="partner-name">
  姓名
  <span lang="en">Name</span>
</label>