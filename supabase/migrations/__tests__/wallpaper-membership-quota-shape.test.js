"use strict";

/**
 * PROD-RELEASE-DAY3C: static shape assertions for the wallpaper membership
 * quota migration (reserve/confirm/release two-phase, TTL self-expiry,
 * free-trial-window support).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SQL = fs.readFileSync(
  path.join(__dirname, "..", "20261011000100_wallpaper_membership_quota.sql"),
  "utf8"
);

function assertRevokeGrant(name, sig) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sigEscaped = sig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped}\\(\\s*${sigEscaped}\\s*\\) FROM PUBLIC`));
  assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped}\\(\\s*${sigEscaped}\\s*\\) FROM anon`));
  assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped}\\(\\s*${sigEscaped}\\s*\\) FROM authenticated`));
  assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped}\\(\\s*${sigEscaped}\\s*\\) TO service_role`));
}

test("01 wallpaper_quota_usage: PK(user_id, period_key), RLS owner-only SELECT, no client write grant", () => {
  assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.wallpaper_quota_usage/);
  assert.match(SQL, /CONSTRAINT pk_wallpaper_quota_usage PRIMARY KEY \(user_id, period_key\)/);
  assert.match(SQL, /ALTER TABLE public\.wallpaper_quota_usage ENABLE ROW LEVEL SECURITY;/);
  assert.match(SQL, /REVOKE ALL PRIVILEGES ON TABLE public\.wallpaper_quota_usage FROM anon, authenticated;/);
  assert.doesNotMatch(SQL, /GRANT (INSERT|UPDATE|DELETE) ON TABLE public\.wallpaper_quota_usage/);
});

test("02 reserve_wallpaper_quota: locks the row before checking/mutating", () => {
  const fn = SQL.match(/CREATE OR REPLACE FUNCTION public\.reserve_wallpaper_quota\([\s\S]*?\r?\nEND;\r?\n\$\$;/)[0];
  assert.match(fn, /FOR UPDATE;/);
  assert.match(fn, /ON CONFLICT \(user_id, period_key\) DO NOTHING;/);
  assertRevokeGrant("reserve_wallpaper_quota", "TEXT, TEXT, INTEGER, INTEGER, INTEGER");
});

test("03 reserve_wallpaper_quota: a stale pending reservation self-expires via TTL, never permanently blocking", () => {
  const fn = SQL.match(/CREATE OR REPLACE FUNCTION public\.reserve_wallpaper_quota\([\s\S]*?\r?\nEND;\r?\n\$\$;/)[0];
  assert.match(fn, /v_row\.pending_reserved_at < NOW\(\) - make_interval\(secs => p_ttl_seconds\)/);
});

test("04 reserve_wallpaper_quota: free-trial window closes generation access once expired, independent of remaining count", () => {
  const fn = SQL.match(/CREATE OR REPLACE FUNCTION public\.reserve_wallpaper_quota\([\s\S]*?\r?\nEND;\r?\n\$\$;/)[0];
  assert.match(fn, /p_trial_window_seconds IS NOT NULL/);
  assert.match(fn, /v_row\.created_at < NOW\(\) - make_interval\(secs => p_trial_window_seconds\)/);
});

test("05 reserve_wallpaper_quota: denies once confirmed+pending reaches the limit", () => {
  const fn = SQL.match(/CREATE OR REPLACE FUNCTION public\.reserve_wallpaper_quota\([\s\S]*?\r?\nEND;\r?\n\$\$;/)[0];
  assert.match(fn, /IF v_row\.confirmed_count \+ v_row\.pending_count >= p_limit THEN/);
});

test("06 confirm_wallpaper_quota_usage: moves exactly one pending slot to confirmed, service_role only", () => {
  const fn = SQL.match(/CREATE OR REPLACE FUNCTION public\.confirm_wallpaper_quota_usage\([\s\S]*?\r?\nEND;\r?\n\$\$;/)[0];
  assert.match(fn, /FOR UPDATE;/);
  assert.match(fn, /pending_count = pending_count - 1,\s+confirmed_count = confirmed_count \+ 1,/);
  assertRevokeGrant("confirm_wallpaper_quota_usage", "TEXT, TEXT");
});

test("07 release_wallpaper_quota_reservation: decrements pending without touching confirmed_count, service_role only", () => {
  const fn = SQL.match(/CREATE OR REPLACE FUNCTION public\.release_wallpaper_quota_reservation\([\s\S]*?\r?\nEND;\r?\n\$\$;/)[0];
  assert.match(fn, /pending_count = pending_count - 1,/);
  assert.doesNotMatch(fn, /confirmed_count = confirmed_count/);
  assertRevokeGrant("release_wallpaper_quota_reservation", "TEXT, TEXT");
});

test("08 no hardcoded free/paid limit numbers baked into the SQL itself (limits are passed in by the caller, not guessed here)", () => {
  assert.doesNotMatch(SQL, /p_limit\s*:=\s*\d/);
  assert.doesNotMatch(SQL, /limit_count\s+INTEGER\s+NOT NULL\s+DEFAULT\s+\d/);
});
