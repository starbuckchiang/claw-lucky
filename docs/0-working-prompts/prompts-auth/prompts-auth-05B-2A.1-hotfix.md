先只讀：
#file docs/working-prompts/prompts-auth-05B-2A.1-hotfix.md
依照 copilot-instructions.md 執行。
不要掃描整個 Repository。
執行 P-AUTH-05B-2A.1 Hotfix，修正idempotency key的retry生命週期。

1. invokeWalletOpsFunction不得以「error.context存在」一律判定retryable:false。
2. 若Response JSON含error.retryable，必須尊重該值。
3. 餘額不足、庫存不足、商品/吉祥物不存在等確定性業務拒絕才是retryable:false。
4. HTTP 500/502/503/504、timeout、斷線、FunctionsFetchError、無法解析Response及未知RPC錯誤一律retryable:true，保留原idempotencyKey。
5. 成功或確定性業務拒絕才清除pending key；不確定結果必須讓下次點擊沿用同一key。
6. 補測「DB已commit但第一次回應500/502或遺失」：第二次用同一key應取得原結果，不得再次扣款、抽獎、扣庫存或寫ledger。
7. 補測error.context含retryable:true/false、無JSON body、解析失敗及網路完全中斷。
8. 更新review-auth-05B-2A.1-hotfix.md與threat model，執行verify-local.ps1。不得部署Production。