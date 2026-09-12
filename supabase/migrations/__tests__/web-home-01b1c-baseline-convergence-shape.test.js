"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrations = path.join(__dirname, "..");
const baseline = fs.readFileSync(path.join(migrations, "20260712000000_legacy_application_schema_baseline.sql"), "utf8");
const alignment = fs.readFileSync(path.join(migrations, "20260912000000_legacy_user_fk_alignment.sql"), "utf8");
const convergence = fs.readFileSync(path.join(migrations, "20260912000100_legacy_rls_grants_convergence.sql"), "utf8");
const checker = fs.readFileSync(path.join(__dirname, "..", "..", "..", "scripts", "web-home-01b1c-local-pg", "production-compatibility-check.sql"), "utf8");

function statements(sql) {
  return sql.split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join("\n");
}

test("formal baseline creates exactly the nine authoritative legacy tables without drift masking or rows", () => {
  const tableNames = [...baseline.matchAll(/^CREATE TABLE public\.([a-z_]+) \(/gm)].map((match) => match[1]);
  assert.deepEqual(tableNames, ["users", "mascots", "gifts", "user_mascots", "redeem_history", "shop_products", "shop_cart", "orders", "order_items"]);
  assert.doesNotMatch(statements(baseline), /CREATE TABLE IF NOT EXISTS/i);
  assert.doesNotMatch(statements(baseline), /^\s*(?:INSERT|COPY)\b/im);
});

test("formal baseline enables RLS on all nine tables and grants clients read only", () => {
  for (const table of ["users", "mascots", "gifts", "user_mascots", "redeem_history", "shop_products", "shop_cart", "orders", "order_items"]) {
    assert.match(baseline, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.doesNotMatch(statements(baseline), /GRANT (?:ALL|INSERT|UPDATE|DELETE)[^;]*TO (?:anon|authenticated)/i);
});

test("order-number contract pins Taipei date, transaction lock, daily max, format, trigger, and function revokes", () => {
  assert.match(baseline, /RETURNS TEXT[\s\S]*?Asia\/Taipei[\s\S]*?pg_advisory_xact_lock[\s\S]*?MAX\([\s\S]*?LUCK-[\s\S]*?lpad/);
  assert.match(baseline, /IF NEW\.order_no IS NULL OR btrim\(NEW\.order_no\) = ''/);
  assert.match(baseline, /CREATE TRIGGER trigger_set_order_no\s+BEFORE INSERT ON public\.orders/);
  assert.match(baseline, /REVOKE ALL ON FUNCTION public\.generate_order_no\(\) FROM PUBLIC, anon, authenticated/);
});

test("alignment migration targets users.user_id and preserves delete actions", () => {
  assert.equal((alignment.match(/REFERENCES public\.users\(user_id\)/g) || []).length, 3);
  assert.match(alignment, /fk_wallpaper_generation_jobs_user[\s\S]*?ON DELETE CASCADE/);
  assert.match(alignment, /fk_wallpaper_generations_user[\s\S]*?ON DELETE RESTRICT/);
  assert.doesNotMatch(statements(alignment), /REFERENCES public\.users\(id\)/);
});

test("convergence removes every manifest-named permissive policy and preserves p_* ownership", () => {
  for (const policy of ["users_insert_own", "users_select_own", "users_update_own", "orders_insert_all", "orders_select_all", "orders_update_all", "order_items_insert_all", "order_items_select_all"]) {
    assert.match(convergence, new RegExp(`DROP POLICY IF EXISTS (?:\\\"|)${policy}`));
  }
  assert.doesNotMatch(statements(convergence), /DROP POLICY[^;]*p_(?:users|user_mascots|redeem_history|shop_cart|orders|order_items)_/i);
});

test("convergence retains catalog SELECT, revokes client writes, and validates duplicate uniqueness", () => {
  for (const policy of ["mascots_public_select", "gifts_public_select", "shop_products_public_select"]) {
    assert.match(convergence, new RegExp(`CREATE POLICY ${policy}`));
  }
  assert.match(convergence, /REVOKE ALL PRIVILEGES ON TABLE[\s\S]*?FROM PUBLIC, anon, authenticated/);
  assert.match(convergence, /v_duplicate_definition IS DISTINCT FROM v_survivor_definition/);
  assert.match(convergence, /DROP CONSTRAINT user_mascots_user_id_mascot_id_key/);
  assert.doesNotMatch(statements(convergence), /\b(INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)\b/i);
});

test("compatibility checker is read-only, catalog-only, and fail-closed", () => {
  assert.match(checker, /BEGIN TRANSACTION READ ONLY/);
  assert.match(checker, /information_schema\.columns/);
  assert.match(checker, /pg_constraint/);
  assert.match(checker, /pg_get_functiondef/);
  assert.match(checker, /RAISE EXCEPTION 'Legacy column mismatch/);
  assert.doesNotMatch(statements(checker), /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/im);
});