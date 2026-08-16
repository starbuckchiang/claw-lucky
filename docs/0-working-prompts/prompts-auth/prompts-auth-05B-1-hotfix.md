先只讀：
#file docs/working-prompts/prompts-auth-05B-1-hotfix.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。
執行 P-AUTH-05B-1 Hotfix：

1. 統一 Finalize 冪等語意：同一正式帳號持有同一有效/已使用 claimToken 重送時，必須回傳200及完全相同的mergeId/result，不得映射成409；錯誤token、過期、Email不符才回409。
2. 新增Handler/Repository測試，模擬第一次成功、回應遺失後重送、併發後重送，確認不會再次合併或重複增加點數。
3. 修正review中的duplicate click與05C失敗案例矛盾。
4. Gate狀態改為05B-1完成候選，禁止宣告整體05B完成；列出05B-2尚缺的mascot、redeem、points、cart、orders安全寫入API。
5. 修正staging部署順序：00100～00400可先部署測試；00000 RLS必須等05B-2完成、前端改接及回歸通過後最後部署。
6. 伺服器log不得輸出claimToken、token hash、Email、Authorization或完整request body；只記correlationId及白名單錯誤碼。
7. 執行verify-local.ps1，產出review-auth-05B-1-hotfix.md。不得部署Production。