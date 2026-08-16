建立beta.html作為封閉測試導覽入口。嚴禁重構、搬移、改寫或抽象化任何既有程式；不得修改Auth、gacha、gift、wallpaper服務、資料庫、migration、RLS、API、localStorage或商業邏輯。

僅允許：

1. 新增beta.html及必要的獨立beta CSS。
2. 在beta.html放置三個步驟按鈕：
   ①「開始抽幸運扭蛋」→現有gacha.html
   ②「前往兌換禮物」→現有gift.html
   ③「製作今日幸運桌布」→現有桌布製作頁。
3. 先查明現有真實路由後再設定href，禁止猜測、建立新流程或複製既有功能。
4. 按鈕只負責導頁，不驗證資格、不改資料、不傳送UID、不新增query參數、不自動執行任何功能。
5. 顯示流程說明：抽扭蛋→兌換禮物→製作桌布，以及「封閉測試、不會真正付款、資料可能清除」提醒。
6. 加入noindex,nofollow；不得從index.html、導覽列或sitemap加入beta入口。
7. 沿用現有品牌色，手機優先、繁中、鍵盤可操作。
8. 不得順手修正其他問題；若發現既有流程缺陷，只記錄於review，不得修改。
9. 提交前列出git diff，確認除beta.html及beta專用CSS外沒有其他檔案變更。
10. 執行既有verify-local.ps1，產出review-beta-entry.md及三個按鈕的本機手動測試結果。

## 修正beta.html導頁後無法返回的問題。

僅修改beta.html，不得修改gacha.html、gift.html、桌布頁、JS服務、Auth、資料庫或任何商業邏輯。

將三個步驟連結改為在新分頁開啟：

target="_blank"
rel="noopener noreferrer"

適用按鈕：

1. 開始抽幸運扭蛋
2. 前往兌換禮物
3. 製作今日幸運桌布

在按鈕區加入簡短提示：「各步驟會在新分頁開啟；完成後關閉分頁，即可回到此測試流程。」

不得加入query參數、localStorage、returnTo、流程狀態或返回邏輯。確認鍵盤操作及螢幕閱讀器可辨識「在新分頁開啟」。完成後檢查git diff，除beta.html外不得有其他檔案變更。

## 更新beta.html封閉測試入口，補上第四步「測試訂閱」。僅允許修改beta.html，不得修改任何其他HTML、CSS、JS、Auth、Supabase、資料庫或商業邏輯。

四個步驟按鈕依序為：
1.「開始抽幸運扭蛋」→現有gacha.html
2.「前往兌換禮物」→現有gift.html
3.「製作今日幸運桌布」→現有桌布製作頁
4.「測試訂閱流程」→subscription.html

四個連結全部使用：
target="_blank"
rel="noopener noreferrer"

在第四步標示：「目前僅測試Email驗證、身分判定及Checkout Ready，不會進行真實付款。」

頁面流程說明同步改為：
抽扭蛋→兌換禮物→製作桌布→測試訂閱。

保留提示：「各步驟會在新分頁開啟；完成後關閉分頁，即可回到此測試流程。」

不得加入query參數、localStorage、流程守衛、完成狀態、UID傳遞或返回邏輯。先確認第三步現有桌布頁的真實路徑，不得猜測。完成後檢查git diff，除beta.html外不得有其他檔案變更。

