Milestone 2
End-to-End AI Wallpaper Generation

驗收一：Architecture
## Architecture

- [Y] Prompt Registry 為唯一 Prompt 來源
- [Y] Provider 僅能透過 Provider Adapter 呼叫
- [Y] Business Layer 不直接操作 SQL
- [Y] Repository 僅負責 Persistence
- [Y] Controller 保持 Thin Controller
- [Y] Client 不直接查詢 Database
- [Y] Client 不直接依賴 AI Provider

驗收二：Business Flow
User
↓
Submit
↓
Generation Created
↓
GenerationId
↓
Polling
↓
Terminal
↓
Presenter
↓
Result
## Business Flow

- [Y] Submit Generation
- [Y] GenerationId 回傳
- [Y] Polling 啟動
- [Y] Status API 可查詢
- [Y] Terminal 可停止
- [Y] 成功顯示 Result
- [Y] Failure 顯示 Normalized Error

驗收三：API Contract
## API

- [ ] Generation API
- [ ] Status API
- [ ] Progress API
- [ ] DTO 穩定
- [ ] Status Mapping 正常
- [ ] Polling Interval 正常

驗收四：Client Capability
## Client

- [ ] Client 可 Submit
- [ ] Client 可 Polling
- [ ] Client 可停止 Polling
- [ ] Presenter 可回傳 Result
- [ ] 無 Provider Exception 外漏

驗收五：Security
## Security

- [ ] Owner Only
- [ ] Unauthorized = 403
- [ ] 無 Service Role
- [ ] 無 Raw SQL

驗收六：Quality
## Quality

- [Y] Syntax Check PASS
- [Y] Unit Tests PASS
- [Y] Smoke Test PASS
- [Y] Review Approved

驗收七：Documentation
## Documentation

- [ ] Review
- [ ] Review Notes
- [ ] ADR
- [ ] Technical Debt

驗收八：Capability
## Capability

- [ ] AI Pipeline
- [ ] Status Query
- [ ] Polling
- [ ] Presenter
- [ ] End-to-End Flow

驗收九：Known Limitations
## Deferred

- [ ] Storage Upload
- [ ] Signed URL
- [ ] Download
- [ ] Queue
- [ ] Worker
- [ ] Face Swap

驗收十：Release Readiness
## Release Readiness

- [ ] MVP Ready
- [ ] Git Tag
- [ ] Review Complete
- [ ] Architecture Approved

## Go / No-Go Decision

Release Readiness: GO

Reason:

- Architecture Approved
- Unit Tests Passed
- Capability Verified
- Documentation Completed
- Technical Debt Acceptable