05B-1 的主要實作方向正確，414/414 PASS，但目前不能宣告 05B Implementation 完成，有三個問題需要修正。

1. 冪等重送的預期互相矛盾

文件前面寫：

重複 Finalize → 409 MERGE_CLAIM_INVALID

後面又要求：

重複 Finalize → 200，回傳相同 mergeId/result

依 05A.1 的設計，正確答案是後者：

第一次成功：200
相同帳號＋相同 claimToken 重送：200，回傳相同結果
不同 Email／錯誤 token／過期 token：409

否則前端遇到「第一次已成功、但 HTTP 回應遺失」時無法安全恢復。

2. 05B 還不能宣告完成

目前只完成：

Merge Begin
Merge Finalize
訂閱流程接線

但 RLS 部署前必須完成的安全寫入 API 尚未實作：

吉祥物
禮物兌換
點數
購物車
訂單

因此只能判定：

05B-1：Conditional PASS
05B Implementation：尚未完成
3. 05C 部署順序錯誤

文件一方面說不能部署 20260816000000，另一方面又在 05C 第一步要求一次套用 00000～00400。

正確順序應為：

先部署純新增的 00100～00400 至 staging
→ 部署 account-merge Edge Function
→ 測試 merge
→ 完成 05B-2 安全寫入 API
→ 前端改接並回歸
→ 最後才部署 00000 RLS
→ 執行完整 RLS 測試