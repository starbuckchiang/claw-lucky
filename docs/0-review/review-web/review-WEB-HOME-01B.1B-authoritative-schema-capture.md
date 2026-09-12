# review-WEB-HOME-01B.1B — Authoritative Production Schema-Only Capture

日期：2026-09-12
分支：`release/auth-07c-sandbox`
狀態：**PASS — READ_ONLY_SCHEMA_METADATA_CAPTURED**

---

## 一、結論

已從目前 linked Supabase default project 完成一次只讀、只限 `public` schema 的 authoritative metadata capture。Linked project ref 只記錄 SHA-256 prefix `5158b2f6`；project list 與 branch metadata 證實它是唯一匹配的既有 default project。

Supabase CLI 2.109.1 的 `supabase db dump --help` 證實 schema dump 預設不是 data-only。本次命令使用 `--linked --schema public --file`，未使用 `--data-only`、未提供 password/connection string，也沒有 credential prompt。Raw dump 只寫入 `.gitignore` 已覆蓋的 `.tmp/schema-audit/public-schema.sql`。

Dump 在任何 DDL 分析前先通過內容 gate：`COPY ... FROM stdin` 0、`INSERT INTO` 0、auth/storage data statements 0、Email/JWT/Supabase secret/connection-string signatures 0。檔案未被 Git 追蹤。完成 sanitized manifest 後 raw dump 已刪除，不保留於 workspace。

九個 legacy tables、order-number functions/trigger、constraints、indexes、RLS/policies、grants、owner classification、identity sequences與 built-in dependencies 均已記錄於：

`docs/0-review/review-web/evidence/WEB-HOME-01B.1B-legacy-schema-manifest.md`

本階段沒有建立 baseline migration。Metadata 已解除 01B.1A 的「完全沒有 authoritative shape」阻擋，但 legacy permissive policies/grants、duplicate unique constraint 與 exact production-vs-clean-baseline convergence 仍須下一階段設計決策；不能把 raw dump 或 bootstrap 直接轉成 migration。

## 二、身分與安全 Gate

| 檢查 | 結果 |
|---|---|
| Current branch | PASS — `release/auth-07c-sandbox` |
| Supabase CLI | 2.109.1 |
| Linked project found | PASS — exactly one match |
| Default project identity | PASS — default ref and parent ref match linked project |
| Project ref disclosure | SHA-256 prefix only: `5158b2f6` |
| Remote access | read-only project/branch metadata, schema dump, pg_catalog metadata |
| Application table SELECT | none |
| Remote DDL/DML | none |
| Credential prompt | none |

## 三、Capture 與 sanitization

Capture scope was `public` only. Raw dump size was 187,969 bytes and was used only as temporary schema evidence.

| Unsafe-content check | Count |
|---|---:|
| `COPY ... FROM stdin` | 0 |
| `INSERT INTO` | 0 |
| auth users data statements | 0 |
| storage data statements | 0 |
| Email-shaped values | 0 |
| JWT-shaped values | 0 |
| Supabase secret-shaped values | 0 |
| PostgreSQL connection strings | 0 |

`git check-ignore -v -- .tmp/schema-audit/public-schema.sql` matched `.gitignore` rule `.tmp/`. `git ls-files` confirmed the raw dump was untracked. No raw DDL was copied into Git; only the sanitized metadata manifest was retained.

The only additional remote SQL calls queried `pg_catalog.pg_proc`, `pg_namespace`, `pg_depend`, `pg_extension`, `pg_attrdef`, `pg_class`, and `pg_attribute` to classify function/extension dependencies. They did not query application tables or rows.

## 四、Authoritative findings

### Identity and core types

- `users.id` is UUID primary key; `users.user_id` is a separate UUID UNIQUE identity column.
- All seven captured foreign keys into `users` target `users.user_id`, except `prompt_versions.created_by`, which targets `users.id`.
- `users.coins`, `points`, and `tickets` are nullable BIGINT with default 0.
- `mascots.id` and `gifts.id` are TEXT.
- `shop_products.id`, `shop_cart.id/product_id`, `orders.id`, and `order_items.id/order_id/product_id` are UUID.
- `redeem_history.id` and `user_mascots.id` are BIGINT `GENERATED ALWAYS` identity columns.
- `orders.total_amount` and `order_items.price/subtotal` are `numeric(10,2)`.

### Order-number contract

Production uses two functions, not the bootstrap's single random trigger function:

- `generate_order_no() RETURNS text` computes `LUCK-YYMMDD-NNNNNN` in `Asia/Taipei`.
- It takes `pg_advisory_xact_lock(hashtext('orders-' || date))`, then increments the maximum same-day sequence.
- `set_order_no() RETURNS trigger` fills only null/blank order numbers.
- `trigger_set_order_no` runs BEFORE INSERT on `orders`.
- `orders_order_no_key` enforces uniqueness.

There is no order-number sequence object; serialization is advisory-lock plus same-day maximum. All called helpers are `pg_catalog` built-ins.

### Constraints and indexes

- All primary keys and unique constraints were captured.
- Outbound legacy FKs are limited to `shop_cart.product_id -> shop_products.id ON DELETE CASCADE` and `order_items.order_id -> orders.id ON DELETE CASCADE`.
- `user_mascots` has two separate constraints enforcing the same `(user_id, mascot_id)` uniqueness.
- Explicit legacy indexes are `idx_orders_user`, `idx_order_items_order`, and `idx_order_items_product`; PK/UNIQUE constraints provide their implicit indexes.
- None of the nine tables has a captured CHECK constraint.

### RLS, policies and grants

- RLS is enabled and not forced on all nine tables.
- `20260816000000_core_user_tables_owner_rls.sql` owns the later `p_*` owner SELECT and restrictive authenticated write-deny policies for six user-owned tables.
- Catalog SELECT policies for gifts, mascots and shop products have no repository creating migration and are required legacy baseline behavior.
- Additional legacy permissive anon/auth policies remain in production alongside later restrictive policies. Examples include unrestricted order/order-item reads and legacy direct-write policies.
- All nine tables, both identity sequences, and both order-number functions currently have broad grants to client roles.

The final two findings are metadata facts, not endorsement. Reproducing them in a clean baseline versus converging production to least privilege requires an explicit security design decision.

## 五、Bootstrap comparison

`scripts/auth-07c7e1-local-pg/00-bootstrap.sql` is not a faithful production schema source:

- `users.user_id` is TEXT instead of UUID; wallet/default/nullability and columns differ.
- `user_mascots.id` is UUID instead of BIGINT identity.
- `gifts` uses nonexistent `cost_points` in place of the production cost columns.
- `shop_products.price`, `orders.total_amount`, and order-item monetary precision differ.
- Every catalog/shop/history table omits production columns, constraints, indexes or nullability details.
- Cascade actions are missing from bootstrap FKs.
- Bootstrap order numbers are random `ORD-*`; production uses serialized `LUCK-YYMMDD-NNNNNN` daily numbering.
- Bootstrap does not model production RLS/policies/grants accurately.

The manifest classifies each mismatch as `BOOTSTRAP_INCORRECT`, `BOOTSTRAP_INCOMPLETE`, `PRODUCTION_LEGACY_ONLY`, `REQUIRED_BASELINE_OBJECT`, `TEST_ONLY_OBJECT`, or `REQUIRES_DESIGN_DECISION`.

## 六、Scope and prohibited actions

- No application table rows or row counts were queried.
- No data-only dump, COPY data, INSERT data, auth users data or storage object data was captured.
- No DDL/DML, `db push`, migration repair/history marking or production test migration was executed.
- No baseline migration or modification to an existing migration was made.
- No Function was deployed; no Secret changed; no PayPal/OTP/Subscription action occurred.
- No commit/push, main modification, `git add .`, or `git add -A` occurred.

## 七、Verification

`npm run verify-local` completed successfully: 935 passed, 0 failed.

## 八、完整結果

```text
WEB-HOME-01B.1B Result: PASS
Remote Access Classification: READ_ONLY_SCHEMA_METADATA
Linked Project Verified: YES — SHA-256 prefix 5158b2f6; existing default project
Application Rows Queried: NO
Data-only Dump Used: NO
COPY Data Found: NO
INSERT Data Found: NO
Sensitive Data Found: NO
Legacy Tables Captured: 9/9
Order Number Function Captured: YES — generate_order_no() and set_order_no()
Triggers Captured: YES
Constraints Captured: YES
Indexes Captured: YES
RLS/Policies Captured: YES
Grants Captured: YES
Bootstrap Differences: CAPTURED — incorrect types/defaults/functions plus incomplete columns/constraints/indexes/RLS
Authoritative Manifest: docs/0-review/review-web/evidence/WEB-HOME-01B.1B-legacy-schema-manifest.md
Raw Dump Tracked: NO
Raw Dump Retained: NO
Production Database Mutated: NO
Migration History Changed: NO
Baseline Migration Created: NO
Functions Deployed: NONE
Secrets Changed: NO
PayPal Called: NO
Tests Passed: 935
Tests Failed: 0
Commit/Push Performed: NO
Gate: PASS
```