# Code Review Checklist

Version: 1.0

---

# Architecture

- [ ] 是否符合 Specification
- [ ] 是否符合 Plan
- [ ] 是否符合 Task

---

# Readability

- [ ] 命名一致
- [ ] Function 長度合理
- [ ] 無重複程式碼

---

# Database

- [ ] Migration 正確
- [ ] Index 合理
- [ ] Constraint 完整
- [ ] RLS 正確

---

# API

- [ ] Request Validation
- [ ] Error Handling
- [ ] Idempotency
- [ ] HTTP Status 正確

---

# AI

- [ ] Prompt 使用 Registry
- [ ] 無硬編碼 Prompt
- [ ] Provider Adapter 使用正確

---

# Security

- [ ] 無 Service Role Key
- [ ] Signed URL
- [ ] Input Validation
- [ ] RLS

---

# Observability

- [ ] request_id
- [ ] job_id
- [ ] structured logs
- [ ] failure code

---

# Performance

- [ ] 不阻塞
- [ ] 無重複 Query
- [ ] Retry 合理

---

# Testing

- [ ] Unit Test
- [ ] Integration Test
- [ ] Manual Test

---

# Backward Compatibility

- [ ] 不破壞舊功能