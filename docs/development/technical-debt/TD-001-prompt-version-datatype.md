# TD-001

Title

prompt_version datatype mismatch

Current

prompt_versions.version = TEXT

wallpaper_generations.prompt_version = UUID

Impact

Business Layer must temporarily store version in metadata_json.

Recommendation

Change wallpaper_generations.prompt_version to TEXT.

Priority

High

Target

Before P2
# Technical Debt Register

Version: 1.0

Purpose

本文件用於追蹤開發過程中刻意延後處理的技術債。

原則：

- 不記錄 Bug。
- 不記錄未來功能。
- 僅記錄已知且經 Review 核准延期處理的技術問題。
- 每一項 Technical Debt 必須具有明確原因與處理時機。

---

# Status

| ID | Title | Priority | Status | Target |
|----|-------|----------|--------|--------|
| TD-001 | prompt_version datatype mismatch | High | Open | Before Phase 2 |

---

# TD-001

## Title

prompt_version datatype mismatch

---

## Status

Open

---

## Priority

High

---

## Identified During

P1-BIZ-01 Review

---

## Problem

目前：

prompt_versions.version

使用：

TEXT

例如：

v1

v2

v3

但：

wallpaper_generations.prompt_version

使用：

UUID

導致目前 Business Layer 無法直接保存 Prompt Version。

暫時將 Prompt Version 寫入：

metadata_json.promptVersion

作為替代方案。

---

## Impact

目前功能正常。

但：

Business Layer 必須額外維護 metadata_json。

增加：

- Query Complexity
- Maintenance Cost
- Future Migration Cost

---

## Recommendation

新增 Migration：

修改：

wallpaper_generations.prompt_version

型別：

UUID

↓

TEXT

並同步更新：

- Repository
- DTO
- Tests

Migration 必須包含：

Rollback Strategy。

---

## Deferred Reason

避免：

修改已完成且核准的 Infrastructure Migration。

目前：

metadata_json

可安全支援 MVP。

因此：

延後處理。

---

## Target

Before Phase 2

---

## Owner

Backend

---

## Related Tasks

- P1-INF-01
- P1-BIZ-01

---

## Review History

2026-07-12

Architecture Review

Decision：

Accepted as Technical Debt.

Approved for temporary workaround.
## References

Architecture

- ADR-001 Provider Adapter

Reviews

- P1-INF-01
- P1-BIZ-01