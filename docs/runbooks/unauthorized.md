# Unauthorized Access Runbook

## 適用情境

- 前端收到：`error.code = UNAUTHORIZED_GENERATION_ACCESS`
- status/progress API 回 403

## 快速檢查

1. 查詢該請求的 auth context（requester user）。
2. 查 `generationId` 對應 owner（`generation.userId`）。
3. 比對 requester 與 owner 是否一致。
4. 以 `correlationId` 追查是否為重放舊連結、跨帳號查詢或 session 過期。

## 預期行為

- 非 owner 必須被拒絕
- 不得繞過 RLS / ownership enforcement
- 不得暴露他人 generation 詳細資料

## 常見原因

- 使用者切換帳號後仍持有舊 `generationId`
- 前端 session 失效但仍發送 polling
- 手動改 URL 查詢他人 id

## 升級條件

- 短時間大量 unauthorized 嘗試（疑似掃描/攻擊）
- 同一來源持續探測不同 `generationId`

