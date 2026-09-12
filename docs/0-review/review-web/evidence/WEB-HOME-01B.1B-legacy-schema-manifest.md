# WEB-HOME-01B.1B Legacy Schema Manifest

日期：2026-09-12
來源：linked Supabase default project，project ref SHA-256 prefix `5158b2f6`
分類：`READ_ONLY_SCHEMA_METADATA`
範圍：九個 legacy public tables、order-number dependencies、直接 schema dependencies

本文件只包含 DDL/catalog metadata 摘要，不包含 raw dump、table rows、row count、使用者識別資料、Email、JWT、credential、商品內容、訂單內容或付款內容。

## 共通屬性

- 九個 tables 的 owner 均為 platform database owner role `postgres`；這是角色分類，不是 credential。
- 九個 tables 均已 `ENABLE ROW LEVEL SECURITY`，均未 `FORCE ROW LEVEL SECURITY`。
- 九個 tables 對 `anon`、`authenticated`、`service_role` 均有 table-level `ALL` grant；實際 Data API 能力仍受 RLS/policies 約束。
- 九個 tables 沒有 enum 欄位，也沒有 generated column。
- 九個 tables 沒有 captured CHECK constraint。
- UUID defaults 使用 restore context 可解析的 `pg_catalog.gen_random_uuid()`。Production 同時安裝 `pgcrypto` variant，但 catalog dependency 未顯示九個 tables 直接依賴該 extension。

## `public.users`

| # | Column | Type | Nullable | Default | Identity |
|---:|---|---|---|---|---|
| 1 | `id` | `uuid` | NO | `gen_random_uuid()` | NO |
| 2 | `user_id` | `uuid` | NO | none | NO |
| 3 | `nickname` | `text` | YES | none | NO |
| 4 | `coins` | `bigint` | YES | `0` | NO |
| 5 | `points` | `bigint` | YES | `0` | NO |
| 6 | `tickets` | `bigint` | YES | `0` | NO |
| 7 | `status` | `text` | YES | `'active'` | NO |
| 8 | `created_at` | `timestamptz` | YES | `now()` | NO |
| 9 | `updated_at` | `timestamptz` | YES | `now()` | NO |
| 10 | `legacy_user_id` | `text` | YES | none | NO |

- Primary key: `users_pkey (id)`.
- Unique: `users_user_id_key (user_id)`.
- Outbound FKs/indexes/triggers: none beyond PK/UNIQUE implicit indexes.
- Incoming FKs:
  - `coin_transactions.user_id -> users.user_id ON DELETE RESTRICT`.
  - `daily_generation_usage.user_id -> users.user_id ON DELETE RESTRICT`.
  - `point_transactions.user_id -> users.user_id ON DELETE RESTRICT`.
  - `ticket_transactions.user_id -> users.user_id ON DELETE RESTRICT`.
  - `wallpaper_generation_jobs.user_id -> users.user_id ON DELETE CASCADE`.
  - `wallpaper_generations.user_id -> users.user_id ON DELETE RESTRICT`.
  - `prompt_versions.created_by -> users.id ON DELETE RESTRICT`.
- Policies: `p_users_select_owner`; restrictive authenticated deny policies for INSERT/UPDATE/DELETE; legacy `users_insert_own`, `users_select_own`, `users_update_own`.

## `public.mascots`

| # | Column | Type | Nullable | Default | Identity |
|---:|---|---|---|---|---|
| 1 | `id` | `text` | NO | none | NO |
| 2 | `name` | `text` | NO | none | NO |
| 3 | `rarity` | `text` | NO | none | NO |
| 4 | `title` | `text` | YES | none | NO |
| 5 | `description` | `text` | YES | none | NO |
| 6 | `image` | `text` | YES | none | NO |
| 7 | `silhouette` | `text` | YES | none | NO |
| 8 | `points` | `integer` | YES | `0` | NO |
| 9 | `tickets` | `integer` | YES | `0` | NO |
| 10 | `duplicate_bonus` | `integer` | YES | `0` | NO |
| 11 | `enabled` | `boolean` | YES | `true` | NO |
| 12 | `sort_order` | `integer` | YES | `0` | NO |
| 13 | `created_at` | `timestamptz` | YES | `now()` | NO |
| 14 | `updated_at` | `timestamptz` | YES | `now()` | NO |

- Primary key: `mascots_pkey (id)`; no other indexes, FKs or triggers.
- Incoming FK: `wallpaper_generations.mascot_id -> mascots.id ON DELETE RESTRICT`.
- Policies: legacy `allow anon read mascots`; `mascots_public_select` for authenticated/anon, both unrestricted SELECT.

## `public.gifts`

| # | Column | Type | Nullable | Default | Identity |
|---:|---|---|---|---|---|
| 1 | `id` | `text` | NO | none | NO |
| 2 | `name` | `text` | NO | none | NO |
| 3 | `description` | `text` | YES | none | NO |
| 4 | `image` | `text` | YES | none | NO |
| 5 | `points_cost` | `integer` | YES | `0` | NO |
| 6 | `tickets_cost` | `integer` | YES | `0` | NO |
| 7 | `coins_cost` | `integer` | YES | `0` | NO |
| 8 | `stock` | `integer` | YES | `999999` | NO |
| 9 | `enabled` | `boolean` | YES | `true` | NO |
| 10 | `sort_order` | `integer` | YES | `0` | NO |
| 11 | `created_at` | `timestamptz` | YES | `now()` | NO |
| 12 | `updated_at` | `timestamptz` | YES | `now()` | NO |

- Primary key: `gifts_pkey (id)`; no other indexes, FKs or triggers.
- Incoming FK: `wallpaper_generations.gift_id -> gifts.id ON DELETE RESTRICT`.
- Policy: `gifts_public_select`, authenticated/anon may SELECT only `enabled = true` rows.

## `public.user_mascots`

| # | Column | Type | Nullable | Default | Identity |
|---:|---|---|---|---|---|
| 1 | `id` | `bigint` | NO | identity sequence | `GENERATED ALWAYS` |
| 2 | `user_id` | `text` | NO | none | NO |
| 3 | `mascot_id` | `text` | NO | none | NO |
| 4 | `mascot_name` | `text` | YES | none | NO |
| 5 | `rarity` | `text` | YES | none | NO |
| 6 | `image` | `text` | YES | none | NO |
| 7 | `first_obtained_at` | `timestamptz` | YES | `now()` | NO |
| 8 | `last_obtained_at` | `timestamptz` | YES | `now()` | NO |
| 9 | `obtain_count` | `integer` | YES | `1` | NO |

- Sequence: `user_mascots_id_seq`, start 1/increment 1/cache 1.
- Primary key: `user_mascots_pkey (id)`.
- Duplicate logical unique constraints: `uq_user_mascots_user_mascot (user_id, mascot_id)` and `user_mascots_user_id_mascot_id_key (user_id, mascot_id)`.
- No FK or trigger.
- Policies: `p_user_mascots_select_owner`; restrictive authenticated deny policies for INSERT/UPDATE/DELETE; legacy own-row INSERT/SELECT/UPDATE/DELETE policies.

## `public.redeem_history`

| # | Column | Type | Nullable | Default | Identity |
|---:|---|---|---|---|---|
| 1 | `id` | `bigint` | NO | identity sequence | `GENERATED ALWAYS` |
| 2 | `user_id` | `text` | NO | none | NO |
| 3 | `nickname` | `text` | YES | none | NO |
| 4 | `gift_id` | `text` | NO | none | NO |
| 5 | `gift_name` | `text` | NO | none | NO |
| 6 | `quantity` | `integer` | YES | `1` | NO |
| 7 | `points_cost` | `integer` | YES | `0` | NO |
| 8 | `tickets_cost` | `integer` | YES | `0` | NO |
| 9 | `coins_cost` | `integer` | YES | `0` | NO |
| 10 | `status` | `text` | YES | `'pending'` | NO |
| 11 | `note` | `text` | YES | none | NO |
| 12 | `created_at` | `timestamptz` | YES | `now()` | NO |
| 13 | `updated_at` | `timestamptz` | YES | `now()` | NO |

- Sequence: `redeem_history_id_seq`, start 1/increment 1/cache 1.
- Primary key: `redeem_history_pkey (id)`; no FK, extra index or trigger.
- Policies: legacy anon unrestricted SELECT; `p_redeem_history_select_owner`; restrictive authenticated deny policies for INSERT/UPDATE/DELETE; legacy authenticated own-row INSERT/SELECT policies.

## `public.shop_products`

| # | Column | Type | Nullable | Default | Identity |
|---:|---|---|---|---|---|
| 1 | `id` | `uuid` | NO | `gen_random_uuid()` | NO |
| 2 | `name` | `text` | NO | none | NO |
| 3 | `subtitle` | `text` | YES | none | NO |
| 4 | `description` | `text` | YES | none | NO |
| 5 | `image` | `text` | YES | none | NO |
| 6 | `category` | `text` | YES | `'general'` | NO |
| 7 | `price` | `integer` | YES | `0` | NO |
| 8 | `stock` | `integer` | YES | `0` | NO |
| 9 | `weight` | `integer` | YES | `0` | NO |
| 10 | `enabled` | `boolean` | YES | `true` | NO |
| 11 | `featured` | `boolean` | YES | `false` | NO |
| 12 | `unlock_type` | `text` | YES | `'none'` | NO |
| 13 | `unlock_value` | `text` | YES | none | NO |
| 14 | `badge` | `text` | YES | none | NO |
| 15 | `sort_order` | `integer` | YES | `0` | NO |
| 16 | `created_at` | `timestamptz` | YES | `now()` | NO |
| 17 | `updated_at` | `timestamptz` | YES | `now()` | NO |
| 18 | `required_mascot_id` | `text` | YES | none | NO |
| 19 | `required_mascot_count` | `integer` | YES | `1` | NO |
| 20 | `thumbnail` | `text` | YES | none | NO |
| 21 | `cover` | `text` | YES | none | NO |

- Primary key: `shop_products_pkey (id)`; no FK, extra index or trigger.
- Incoming FK: `shop_cart.product_id -> shop_products.id ON DELETE CASCADE`.
- Policy: `shop_products_public_select`, authenticated/anon may SELECT only `enabled = true` rows.

## `public.shop_cart`

| # | Column | Type | Nullable | Default | Identity |
|---:|---|---|---|---|---|
| 1 | `id` | `uuid` | NO | `gen_random_uuid()` | NO |
| 2 | `user_id` | `text` | NO | none | NO |
| 3 | `product_id` | `uuid` | NO | none | NO |
| 4 | `quantity` | `integer` | NO | `1` | NO |
| 5 | `selected` | `boolean` | YES | `true` | NO |
| 6 | `created_at` | `timestamptz` | YES | `now()` | NO |
| 7 | `updated_at` | `timestamptz` | YES | `now()` | NO |
| 8 | `unlock_verified` | `boolean` | YES | `false` | NO |

- Primary key: `shop_cart_pkey (id)`.
- Unique: `shop_cart_user_id_product_id_key (user_id, product_id)`.
- FK: `product_id -> shop_products.id ON UPDATE NO ACTION ON DELETE CASCADE`.
- No explicit extra index or trigger.
- Policies: `p_shop_cart_select_owner`; restrictive authenticated deny policies for INSERT/UPDATE/DELETE; legacy own-row INSERT/SELECT/UPDATE/DELETE policies.

## `public.orders`

| # | Column | Type | Nullable | Default | Identity |
|---:|---|---|---|---|---|
| 1 | `id` | `uuid` | NO | `gen_random_uuid()` | NO |
| 2 | `user_id` | `text` | NO | none | NO |
| 3 | `order_no` | `text` | YES | none | NO |
| 4 | `total_amount` | `numeric(10,2)` | NO | `0` | NO |
| 5 | `total_items` | `integer` | NO | `0` | NO |
| 6 | `status` | `text` | NO | `'pending'` | NO |
| 7 | `created_at` | `timestamptz` | NO | `now()` | NO |
| 8 | `updated_at` | `timestamptz` | NO | `now()` | NO |
| 9 | `lucky_message` | `text` | YES | none | NO |
| 10 | `payment_provider` | `text` | YES | none | NO |
| 11 | `payment_method` | `text` | YES | none | NO |
| 12 | `payment_status` | `text` | NO | `'unpaid'` | NO |
| 13 | `merchant_trade_no` | `text` | YES | none | NO |
| 14 | `provider_trade_no` | `text` | YES | none | NO |
| 15 | `paid_at` | `timestamptz` | YES | none | NO |
| 16 | `payment_raw` | `jsonb` | YES | none | NO |

- Primary key: `orders_pkey (id)`.
- Unique: `orders_order_no_key (order_no)`; `orders_merchant_trade_no_key (merchant_trade_no)`.
- Explicit index: `idx_orders_user (user_id)`.
- No FK or CHECK constraint.
- Trigger: `trigger_set_order_no`, BEFORE INSERT, each row, executes `set_order_no()`.
- Policies: `p_orders_select_owner`; restrictive authenticated deny policies for INSERT/UPDATE/DELETE; legacy unrestricted authenticated/anon INSERT, SELECT and UPDATE policies.

## `public.order_items`

| # | Column | Type | Nullable | Default | Identity |
|---:|---|---|---|---|---|
| 1 | `id` | `uuid` | NO | `gen_random_uuid()` | NO |
| 2 | `order_id` | `uuid` | NO | none | NO |
| 3 | `product_id` | `uuid` | NO | none | NO |
| 4 | `product_name` | `text` | NO | none | NO |
| 5 | `product_image` | `text` | YES | none | NO |
| 6 | `price` | `numeric(10,2)` | NO | none | NO |
| 7 | `quantity` | `integer` | NO | `1` | NO |
| 8 | `subtotal` | `numeric(10,2)` | NO | none | NO |
| 9 | `created_at` | `timestamptz` | NO | `now()` | NO |

- Primary key: `order_items_pkey (id)`.
- FK: `order_id -> orders.id ON UPDATE NO ACTION ON DELETE CASCADE`.
- Explicit indexes: `idx_order_items_order (order_id)`, `idx_order_items_product (product_id)`.
- No FK from `product_id` to `shop_products.id`; no trigger.
- Policies: `p_order_items_select_owner` via parent order; restrictive authenticated deny policies for INSERT/UPDATE/DELETE; legacy unrestricted authenticated/anon INSERT and SELECT policies.

## Order-number contract

- `generate_order_no() RETURNS text`, PL/pgSQL, SECURITY DEFINER, `search_path = public`.
- Date component: `to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYMMDD')`.
- Transaction serialization: `pg_advisory_xact_lock(hashtext('orders-' || date_component))`.
- Sequence computation: maximum third `-`-delimited integer among same-day `orders.order_no`, plus one.
- Output contract: `LUCK-YYMMDD-NNNNNN`, six-digit zero-padded daily sequence.
- `set_order_no() RETURNS trigger`, SECURITY DEFINER, fills only null/blank `NEW.order_no`.
- `trigger_set_order_no`: BEFORE INSERT on `orders`, each row, calls `set_order_no()`.
- `orders_order_no_key` provides the final uniqueness constraint.
- Both functions are owned by platform role `postgres` and have function-level `ALL` grants to `anon`, `authenticated`, `service_role`.
- `to_char`, `pg_advisory_xact_lock`, `hashtext`, `split_part`, and `lpad` are `pg_catalog` built-ins. There is no database sequence object for order numbers.

## Sequence and extension dependencies

| Object | Dependency | Classification |
|---|---|---|
| `user_mascots.id` | `user_mascots_id_seq`, BIGINT identity | REQUIRED_BASELINE_OBJECT |
| `redeem_history.id` | `redeem_history_id_seq`, BIGINT identity | REQUIRED_BASELINE_OBJECT |
| UUID PK defaults | `pg_catalog.gen_random_uuid()` | built-in dependency |
| `pgcrypto` | installed variant of `gen_random_uuid()` also exists | REQUIRES_DESIGN_DECISION; not a captured direct dependency of these defaults |
| `dblink` | no dependency from captured objects | TEST_ONLY_OBJECT in current bootstrap |

Both identity sequences currently grant `ALL` to `anon`, `authenticated`, and `service_role`; exact grant convergence requires a security design decision.

## Bootstrap difference matrix

| Object/Area | Authoritative production metadata vs bootstrap | Classification |
|---|---|---|
| all nine tables | No repository creating migration exists | REQUIRED_BASELINE_OBJECT |
| `users.user_id` | production `uuid UNIQUE`; bootstrap `text UNIQUE` | BOOTSTRAP_INCORRECT |
| `users` wallet/defaults | production wallet BIGINT columns nullable/default 0, including coins 0; bootstrap marks NOT NULL and coins default 20 | BOOTSTRAP_INCORRECT |
| `users` shape | bootstrap omits `status`, `legacy_user_id` and production nullability | BOOTSTRAP_INCOMPLETE |
| `mascots` | bootstrap adds rarity default/NOT NULL assumptions and omits title, description, silhouette, sort/timestamp columns | BOOTSTRAP_INCORRECT; BOOTSTRAP_INCOMPLETE |
| `gifts` | bootstrap uses `cost_points`; production uses `points_cost`, `tickets_cost`, `coins_cost`; stock default also differs | BOOTSTRAP_INCORRECT |
| `gifts` | bootstrap omits description, tickets cost, sort/timestamp columns | BOOTSTRAP_INCOMPLETE |
| `user_mascots.id` | production BIGINT GENERATED ALWAYS identity; bootstrap UUID default | BOOTSTRAP_INCORRECT |
| `user_mascots` unique | production has two logically duplicate unique constraints; bootstrap has neither | BOOTSTRAP_INCOMPLETE; REQUIRES_DESIGN_DECISION |
| `redeem_history` | bootstrap omits nickname, quantity, three cost snapshots, note, updated_at; gift_name nullability and status default differ | BOOTSTRAP_INCORRECT; BOOTSTRAP_INCOMPLETE |
| `shop_products.price` | production integer; bootstrap numeric(12,2) | BOOTSTRAP_INCORRECT |
| `shop_products` | bootstrap omits 15 production columns/defaults | BOOTSTRAP_INCOMPLETE |
| `shop_cart` | bootstrap omits selected/unlock_verified; timestamps/nullability and FK delete action differ | BOOTSTRAP_INCORRECT; BOOTSTRAP_INCOMPLETE |
| `orders` | production numeric(10,2), extra payment/message columns, two unique constraints and user index; bootstrap numeric(12,2) and narrower shape | BOOTSTRAP_INCORRECT; BOOTSTRAP_INCOMPLETE |
| `order_items` | production numeric(10,2), stricter required columns, created_at, cascade FK and two indexes; bootstrap differs/omits | BOOTSTRAP_INCORRECT; BOOTSTRAP_INCOMPLETE |
| order-number functions | production has separate TEXT generator + trigger wrapper with advisory lock/timezone/daily sequence; bootstrap defines one random trigger function named `generate_order_no` | BOOTSTRAP_INCORRECT |
| `p_*` owner/deny policies | recreated by `20260816000000_core_user_tables_owner_rls.sql` | repository-managed after baseline |
| catalog SELECT policies | no creating migration for `gifts_public_select`, `mascots_public_select`, `shop_products_public_select` | PRODUCTION_LEGACY_ONLY; REQUIRED_BASELINE_OBJECT |
| other legacy policies | permissive anon/auth policies coexist with later owner/restrictive policies | PRODUCTION_LEGACY_ONLY; REQUIRES_DESIGN_DECISION |
| table/sequence/function grants | production grants are broader than a least-privilege baseline would normally choose | PRODUCTION_LEGACY_ONLY; REQUIRES_DESIGN_DECISION |
| roles/auth/storage stubs, local tracker, `dblink` | local harness infrastructure, not application baseline | TEST_ONLY_OBJECT |

## Baseline design blockers carried forward

This manifest is authoritative metadata evidence, not executable baseline SQL. Before a later baseline may be authored, design must resolve:

1. Whether to reproduce legacy permissive policies/grants exactly or add a forward-only convergence migration. They must not be copied blindly.
2. Whether the duplicate `user_mascots(user_id, mascot_id)` unique constraints should both exist on clean rebuild.
3. Whether nullable production columns should remain nullable or be tightened only through a separately reviewed data-safe migration.
4. Whether order-number functions should remain directly executable by client roles or be revoked while preserving trigger execution.
5. Whether `pgcrypto` is a platform prerequisite for other repository objects; it is not established as a direct dependency of these nine table defaults.
