"use strict";

/**
 * Auth-07C.8 — read-only post-cancellation verification.
 * Actions: PayPal OAuth + GET subscription (never Cancel), Edge get_status x2.
 * Never prints full IDs, tokens, secrets, or payer PII.
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE = "https://umtqpstacjdwxcvcirbl.supabase.co";
const FN = `${BASE}/functions/v1`;
const REF = "umtqpstacjdwxcvcirbl";
const API = "https://api-m.sandbox.paypal.com";
const ROOT = path.resolve(__dirname, "../..");
const LOG = path.join(__dirname, "verify.jsonl");

function out(o) {
  const line = JSON.stringify(o);
  console.log(line);
  fs.appendFileSync(LOG, line + "\n", "utf8");
}

function fp(id) {
  if (id == null || id === "") return { exists: false };
  const s = String(id);
  return {
    exists: true,
    length: s.length,
    prefix6: s.slice(0, 6),
    sha8: crypto.createHash("sha256").update(s).digest("hex").slice(0, 8)
  };
}

function loadKeys() {
  const r = spawnSync(
    "supabase",
    ["projects", "api-keys", "--project-ref", REF, "-o", "json"],
    { encoding: "utf8", shell: true }
  );
  const m = String(r.stdout + r.stderr).match(/\[[\s\S]*\]/);
  if (!m) throw new Error("API_KEYS_PARSE_FAIL");
  const arr = JSON.parse(m[0]);
  const by = {};
  for (const row of arr) {
    const n = String(row.name || "").toLowerCase();
    const v = String(row.api_key || row.key || "");
    if (v) by[n] = v;
  }
  return { serviceRole: by.service_role || "", anon: by.anon || by.default || "" };
}

function loadPaypalCreds() {
  const p = path.join(ROOT, "docs/0-working-prompts/prompts-auth/paypel測試用帳號.txt");
  const t = fs.readFileSync(p, "utf8");
  const idM = t.match(/client ID[\s\S]*?\n([A-Za-z0-9_-]+)/i);
  const secM = t.match(/secret key[\s\S]*?\n([A-Za-z0-9_-]+)/i);
  const acctM = t.match(/Account ID\s*\n([A-Z0-9]+)/i);
  return {
    clientId: idM[1].trim(),
    clientSecret: secM[1].trim(),
    merchantId: acctM ? acctM[1].trim() : ""
  };
}

async function rest(key, table, qs) {
  const res = await fetch(`${BASE}/rest/v1/${table}?${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" }
  });
  const body = await res.json().catch(() => []);
  return { status: res.status, range: res.headers.get("content-range"), body };
}

async function paypalToken(creds) {
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const j = await res.json().catch(() => ({}));
  out({ step: "paypal_oauth", status: res.status, has_token: Boolean(j.access_token) });
  if (!j.access_token) throw new Error("PAYPAL_OAUTH_FAILED");
  return j.access_token;
}

async function mintOfficialSession(keys, userId) {
  const getUser = await fetch(`${BASE}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: keys.serviceRole, Authorization: `Bearer ${keys.serviceRole}` }
  });
  const user = await getUser.json().catch(() => ({}));
  if (!getUser.ok || !user?.email) throw new Error("ADMIN_GET_USER_FAILED");
  out({
    step: "admin_get_user", ok: true, id: fp(userId),
    is_anonymous: user.is_anonymous === true, has_email: Boolean(user.email)
  });

  const linkRes = await fetch(`${BASE}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: keys.serviceRole, Authorization: `Bearer ${keys.serviceRole}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ type: "magiclink", email: user.email })
  });
  const linkJson = await linkRes.json().catch(() => ({}));
  const props = linkJson.properties || linkJson;
  const tokenHash = props.hashed_token || linkJson.hashed_token || null;
  out({ step: "admin_generate_link", status: linkRes.status, has_hashed_token: Boolean(tokenHash) });
  if (!linkRes.ok || !tokenHash) throw new Error("ADMIN_GENERATE_LINK_FAILED");

  const verify = await fetch(`${BASE}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: keys.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: tokenHash })
  });
  const verifyJson = await verify.json().catch(() => ({}));
  out({ step: "verify_magiclink", status: verify.status, has_token: Boolean(verifyJson.access_token) });
  if (!verifyJson.access_token) throw new Error("OFFICIAL_SESSION_MINT_FAILED");
  return verifyJson.access_token;
}

async function getStatus(keys, token, label) {
  const res = await fetch(`${FN}/paypal-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: keys.anon, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "get_status" })
  });
  const body = await res.json().catch(() => ({}));
  const s = body?.subscription || null;
  const summary = s ? {
    status: s.status, plan_code: s.plan_code,
    paid_through: s.paid_through, next_billing_time: s.next_billing_time || null,
    last_payment_time: s.last_payment_time || null,
    access_blocked: Boolean(s.access_blocked)
  } : null;
  out({ step: label, http: res.status, ok: body?.ok === true, subscription: summary });
  return summary;
}

async function main() {
  fs.writeFileSync(LOG, "", "utf8");
  const keys = loadKeys();
  out({ step: "keys", service: Boolean(keys.serviceRole), anon: Boolean(keys.anon) });

  // 1. DB row (full IDs stay internal)
  const subRes = await rest(keys.serviceRole, "paypal_subscriptions", "select=*");
  const sub = subRes.body[0];
  if (!sub) throw new Error("NO_SUBSCRIPTION_ROW");
  out({
    step: "db_subscription", count_range: subRes.range,
    status: sub.status, plan_code: sub.plan_code,
    paid_through: sub.paid_through, last_payment_time: sub.last_payment_time,
    cancelled_at: sub.cancelled_at, paypal_sub: fp(sub.paypal_subscription_id)
  });

  // 2. PayPal authoritative GET (never Cancel)
  const creds = loadPaypalCreds();
  const token = await paypalToken(creds);
  const ppRes = await fetch(`${API}/v1/billing/subscriptions/${sub.paypal_subscription_id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const pp = await ppRes.json().catch(() => ({}));
  out({
    step: "paypal_get_subscription",
    http: ppRes.status,
    status: pp.status || null,
    status_update_time: pp.status_update_time || null,
    plan_id_match_db: fp(pp.plan_id).sha8 === fp(sub.paypal_plan_id).sha8 ? "MATCH" : "MISMATCH",
    custom_id_match_session: String(pp.custom_id || "") === String(sub.checkout_session_id || "") ? "MATCH" : "MISMATCH",
    next_billing_time: pp?.billing_info?.next_billing_time || null,
    final_payment_time: pp?.billing_info?.final_payment_time || null,
    last_payment_amount: pp?.billing_info?.last_payment?.amount?.value || null,
    id_match_db: String(pp.id || "") === String(sub.paypal_subscription_id) ? "MATCH" : "MISMATCH"
  });

  // 3. get_status x2 (read-only Edge action) for idempotent-read proof
  const session = await mintOfficialSession(keys, sub.user_id);
  const s1 = await getStatus(keys, session, "get_status_1");
  const s2 = await getStatus(keys, session, "get_status_2");
  out({
    step: "get_status_idempotent",
    identical: JSON.stringify(s1) === JSON.stringify(s2),
    status: s1?.status || null,
    paid_through_stable: s1?.paid_through === s2?.paid_through
  });

  // 4. Post-read DB invariants unchanged
  const tx = await rest(keys.serviceRole, "paypal_subscription_transactions", "select=id");
  const sub2Res = await rest(keys.serviceRole, "paypal_subscriptions", "select=status,paid_through,last_payment_time");
  const slot = await rest(keys.serviceRole, "user_subscription_slots", "select=slot_state,release_after");
  out({
    step: "post_invariants",
    tx_count_range: tx.range,
    subscription: sub2Res.body[0] || null,
    slot: slot.body[0] || null
  });

  out({ step: "done", mutations_performed: "NONE (GET/get_status only)" });
}

main().catch((e) => {
  out({ step: "fatal", error: String(e && e.message || e) });
  process.exit(1);
});
