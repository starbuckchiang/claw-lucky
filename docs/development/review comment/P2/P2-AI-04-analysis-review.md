## v1 修訂建議
分析方向正確，但目前報告中的「Stateless previewToken」有一個關鍵矛盾，不能直接進入實作：

純 Stateless Token 無法做到「舊 Token 立即失效」、「只能使用一次」或「每日 Preview 次數限制」。

只要 Token 簽章仍有效且未過期，使用者就能重複送出；加入 nonce 也無法知道 nonce 是否已使用，除非後端保存狀態。另外，方案 A 仍須修改 wallpaper-generate 的 confirm 流程，所以不能稱為「完全零風險」。


| 問題            | 決策                                    |
| ------------- | ------------------------------------- |
| Preview 架構    | 獨立 `shopkeeper-preview` Function      |
| Preview 保存    | DB 短效紀錄，不使用純 Stateless Token          |
| 前端憑證          | 只回傳不透明 `previewId`                    |
| 每個 Session    | 首次 1 次＋最多重抽 2 次，共 3 次                 |
| 每日 Preview 上限 | 每位使用者 20 次                            |
| 有效期限          | 10 分鐘                                 |
| Confirm       | Preview 只能成功消費一次                      |
| 舊 Preview     | 重抽後立即失效                               |
| 擁有權檢查         | Preview 與 Generate 都必須檢查              |
| 最終結果文字        | 保留顯示 story、oneLiner、shopkeeperMessage |
| 下載按鈕          | 納入 P2-AI-04                           |
| Kuromi 圖片     | 不納入，另案修資料                             |



建議資料模型

新增 shopkeeper_previews：

id
user_id
session_id
mascot_id
gift_id
wallpaper_style
context_snapshot
shopkeeper_version
source
created_at
expires_at
consumed_at
invalidated_at

這樣才能可靠實現：

使用者所有權
每日 20 次限制
每個 session 3 次
重抽後舊 Preview 失效
Confirm 一次性消費
10 分鐘過期
前端無法竄改 Context
完整稽核與除錯

## v2 修訂建議

修訂版比 v1 完整很多，但還不能直接開始寫功能。它已解決 Stateless Token 問題，卻又發現幾個新的並行與流程一致性風險。

Product Decision

Gift 在 P2-AI-04 採：

已兌換即可重複用於生成桌布，不消耗 redeem_history。

因為目前 Gift 沒有數量或剩餘次數機制。如果改成一次性消耗，會牽動兌換、退款、失敗返還等完整商業規則，應另立任務。

尚需修正的架構問題
每日 20 次仍可能被並發突破
兩個不同 Session 同時建立時沒有共同資料列可鎖，兩邊可能都讀到 19，再各新增一筆。
可能先花 Gemini 額度、才發現超過上限
如果 Handler 先呼叫 Shopkeeper Agent，之後 RPC 才檢查每日／Session 上限，被拒絕的請求仍已花掉 Text API 成本。
重抽失敗可能讓原祝福提前失效
應該等新 Preview 成功產生並保存後，再使舊 Preview 失效。
Consume 與 Job 並非同一交易
報告寫「同一段流程」不等於資料庫交易。若 Preview 已 consumed，但 Job／生成流程在下一步崩潰，就會留下無法恢復的孤兒狀態。
現有 Job 是否真的能重試圖片尚未證明
資料表有 retry_count 不代表目前已有可執行的重試 Worker，不能把失敗恢復建立在未證實的能力上。
過渡期策略需要改寫
舊版前端沒有 previewId。過渡期後端應保留目前「沒有 previewId 時，後端自行呼叫 Shopkeeper」的 legacy path，而不是接受舊欄位後又要求 Preview 來源。
最終文字 DTO 不只一處
Submit response、Polling status response、result presenter 都要確認，否則生成完成後仍可能拿不到文字。
建議的一致性方案

利用現有 jobId 做冪等綁定：

Orchestrator 先建立 Job。
Confirm RPC 用 previewId + userId + jobId 原子消費。
第一次使用：設定 consumed_at、consumed_job_id。
同一 jobId 重試：允許重新讀取相同 Context。
不同 jobId：拒絕 PREVIEW_ALREADY_CONSUMED。
如此即使 Function 中途崩潰，同一 Job 仍能安全恢復，不會重複消費 Preview。

Preview 則改為兩階段：

DB 原子預約額度與 sequence。
呼叫 Gemini Text。
成功或 Fallback 後 finalize Preview。
finalize 成功時才 invalidated 舊 Preview。
Agent 以外的系統錯誤則標記 reservation failed，舊 Preview 保持可用。