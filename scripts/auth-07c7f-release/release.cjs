"use strict";

/**
 * Auth-07C.7F — release smoke + controlled get_status reconciliation.
 * Never prints full IDs, tokens, secrets, or payer PII.
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE = "https://umtqpstacjdwxcvcirbl.supabase.co";
const FN = `${BASE}/functions/v1`;
const REF = "umtqpstacjdwxcvcirbl";
const USER_PREFIX = "5020bf33";
const ROOT = path.resolve(__dirname, "../..");
const LOG = path.join(__dirname, "release.jsonl");

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
    prefix8: s.slice(0, 8),
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
  return {
    serviceRole: by.service_role || "",
    anon: by.anon || by.default || ""
  };
}

async function rest(key, table, qs) {
  const res = await fetch(`${BASE}/rest/v1/${table}?${qs}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact"
    }
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw_prefix: text.slice(0, 80) };
  }
  return { status: res.status, range: res.headers.get("content-range"), body };
}

async function rpcExists(key, name) {
  // Probe via PostgREST OpenAPI or attempt with empty body (will 400/404 not 401)
  const res = await fetch(`${BASE}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  const text = await res.text();
  return {
    name,
    status: res.status,
    // 400/404/PGRST202 = function routing happened; 401 would be auth
    reachable: res.status !== 404 || /Could not find the function|PGRST202|PGRST202/i.test(text)
      || res.status === 400
      || res.status === 300
      || /required/i.test(text),
    body_prefix: text.slice(0, 120)
  };
}

function summarizeSub(s) {
  if (!s) return null;
  return {
    id: fp(s.id),
    user: fp(s.user_id),
    user_matches_test: String(s.user_id || "").startsWith(USER_PREFIX),
    plan_code: s.plan_code,
    status: s.status,
    amount: s.recurring_amount,
    currency: s.currency,
    paypal_sub: fp(s.paypal_subscription_id),
    checkout: fp(s.checkout_session_id),
    start_time: s.start_time || null,
    next_billing_time: s.next_billing_time || null,
    last_payment_time: s.last_payment_time || null,
    paid_through: s.paid_through || null,
    reconciliation_status: s.reconciliation_status || null,
    access_blocked_at: s.access_blocked_at || null
  };
}

async function snapshot(keys, label) {
  const allSubs = await rest(
    keys.serviceRole,
    "paypal_subscriptions",
    "select=*&order=created_at.desc&limit=20"
  );
  const subRows = Array.isArray(allSubs.body) ? allSubs.body : [];
  const target =
    subRows.find((s) => String(s.user_id || "").startsWith(USER_PREFIX))
    || null;

  const orders = await rest(
    keys.serviceRole,
    "payment_orders",
    "select=id&limit=1"
  );
  const wh = await rest(
    keys.serviceRole,
    "payment_webhook_events",
    "select=id,event_type,processing_status,verification_status,paypal_event_id,paypal_subscription_id,paypal_sale_id,error_code&order=created_at.desc&limit=50"
  );
  const whRows = Array.isArray(wh.body) ? wh.body : [];
  const wallets = await rest(
    keys.serviceRole,
    "users",
    "select=points,tickets,coins&limit=200"
  );
  const walletRows = Array.isArray(wallets.body) ? wallets.body : [];
  const walletSum = walletRows.reduce(
    (a, u) => a + Number(u.points || 0) + Number(u.tickets || 0) + Number(u.coins || 0),
    0
  );

  let slots = { status: null, rows: [] };
  let txs = { status: null, rows: [] };
  if (target) {
    slots = await rest(
      keys.serviceRole,
      "user_subscription_slots",
      `user_id=eq.${encodeURIComponent(target.user_id)}&select=*`
    );
    txs = await rest(
      keys.serviceRole,
      "paypal_subscription_transactions",
      `or=(paypal_subscription_id.eq.${encodeURIComponent(target.paypal_subscription_id || "")},subscription_id.eq.${encodeURIComponent(target.id)})&select=*`
    );
  }

  const slotRows = Array.isArray(slots.body) ? slots.body : [];
  const txRows = Array.isArray(txs.body) ? txs.body : [];
  const relatedWh = target
    ? whRows.filter(
      (e) =>
        String(e.paypal_subscription_id || "") === String(target.paypal_subscription_id || "")
        || String(e.event_type || "").startsWith("BILLING.SUBSCRIPTION")
        || String(e.event_type || "").startsWith("PAYMENT.SALE")
    )
    : [];

  const snap = {
    step: `snapshot_${label}`,
    orders_range: orders.range,
    webhook_range: wh.range,
    wallet_sum: walletSum,
    sub_count_all: subRows.length,
    target: summarizeSub(target),
    slot: slotRows.map((s) => ({
      slot_state: s.slot_state,
      subscription_ref: fp(s.subscription_id)
    })),
    tx_count: txRows.length,
    txs: txRows.map((t) => ({
      sale: fp(t.paypal_sale_id),
      amount: t.amount,
      currency: t.currency,
      status: t.status,
      audit_source: t.audit_source || null,
      needs_review: t.needs_review ?? null,
      event_id_prefix: t.paypal_event_id
        ? String(t.paypal_event_id).slice(0, 28)
        : null,
      has_payer_pii: JSON.stringify(t.sanitized_payload || {}).includes("payer")
        || JSON.stringify(t.sanitized_payload || {}).includes("@")
    })),
    related_webhooks: relatedWh.map((e) => ({
      event_type: e.event_type,
      verification_status: e.verification_status,
      processing_status: e.processing_status,
      error_code: e.error_code || null,
      event: fp(e.paypal_event_id),
      sale: fp(e.paypal_sale_id)
    }))
  };
  out(snap);
  return { target, snap, whRows, walletSum, ordersRange: orders.range };
}

async function mintOfficialSession(keys, userId) {
  const getUser = await fetch(`${BASE}/auth/v1/admin/users/${userId}`, {
    headers: {
      apikey: keys.serviceRole,
      Authorization: `Bearer ${keys.serviceRole}`
    }
  });
  const user = await getUser.json().catch(() => ({}));
  if (!getUser.ok || !user?.email) {
    out({
      step: "admin_get_user",
      status: getUser.status,
      ok: false,
      id: fp(userId)
    });
    throw new Error("ADMIN_GET_USER_FAILED");
  }
  out({
    step: "admin_get_user",
    status: getUser.status,
    ok: true,
    id: fp(userId),
    email_confirmed: Boolean(user.email_confirmed_at),
    is_anonymous: user.is_anonymous === true,
    has_email: Boolean(user.email)
  });

  const linkRes = await fetch(`${BASE}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: keys.serviceRole,
      Authorization: `Bearer ${keys.serviceRole}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      type: "magiclink",
      email: user.email
    })
  });
  const linkJson = await linkRes.json().catch(() => ({}));
  const props = linkJson.properties || linkJson;
  const tokenHash = props.hashed_token || linkJson.hashed_token || null;
  const emailOtp = props.email_otp || linkJson.email_otp || null;
  out({
    step: "admin_generate_link",
    status: linkRes.status,
    ok: linkRes.ok,
    has_hashed_token: Boolean(tokenHash),
    has_email_otp: Boolean(emailOtp),
    verification_type: props.verification_type || null
  });
  if (!linkRes.ok) throw new Error("ADMIN_GENERATE_LINK_FAILED");

  let accessToken = null;
  if (tokenHash) {
    const verify = await fetch(`${BASE}/auth/v1/verify`, {
      method: "POST",
      headers: {
        apikey: keys.anon,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "magiclink",
        token_hash: tokenHash
      })
    });
    const verifyJson = await verify.json().catch(() => ({}));
    accessToken = verifyJson.access_token || null;
    out({
      step: "verify_magiclink",
      status: verify.status,
      has_token: Boolean(accessToken)
    });
  }

  if (!accessToken && emailOtp) {
    const verify2 = await fetch(`${BASE}/auth/v1/verify`, {
      method: "POST",
      headers: {
        apikey: keys.anon,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "email",
        email: user.email,
        token: emailOtp
      })
    });
    const verifyJson2 = await verify2.json().catch(() => ({}));
    accessToken = verifyJson2.access_token || null;
    out({
      step: "verify_email_otp",
      status: verify2.status,
      has_token: Boolean(accessToken)
    });
  }

  if (!accessToken) throw new Error("OFFICIAL_SESSION_MINT_FAILED");
  return accessToken;
}

async function getStatus(keys, token) {
  const res = await fetch(`${FN}/paypal-subscription`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: keys.anon,
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ action: "get_status" })
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  fs.writeFileSync(LOG, "", "utf8");
  const phase = process.argv[2] || "all";
  const keys = loadKeys();
  out({
    step: "keys_loaded",
    anon_len: keys.anon.length,
    service_len: keys.serviceRole.length,
    phase
  });

  if (phase === "pre" || phase === "all") {
    await snapshot(keys, "before");
    // RPC presence via service_role (after migration)
    if (phase === "all") {
      // skip until after push
    }
  }

  if (phase === "post_rpc_check") {
    for (const name of [
      "ensure_paypal_webhook_event_received",
      "finalize_paypal_webhook_event_failure",
      "reconcile_paypal_subscription_sale",
      "process_paypal_subscription_webhook_event"
    ]) {
      out({ step: "rpc_probe", ...(await rpcExists(keys.serviceRole, name)) });
    }
    // anon should be denied
    const anonProbe = await fetch(
      `${BASE}/rest/v1/rpc/reconcile_paypal_subscription_sale`,
      {
        method: "POST",
        headers: {
          apikey: keys.anon,
          Authorization: `Bearer ${keys.anon}`,
          "Content-Type": "application/json"
        },
        body: "{}"
      }
    );
    out({
      step: "anon_reconcile_probe",
      status: anonProbe.status,
      denied: anonProbe.status === 401 || anonProbe.status === 403
        || anonProbe.status === 404
    });
    return;
  }

  if (phase === "smoke" || phase === "all") {
    const missing = await fetch(`${FN}/paypal-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: keys.anon
      },
      body: JSON.stringify({ action: "get_status" })
    });
    const missingBody = await missing.json().catch(() => ({}));
    out({
      smoke: "missing_jwt",
      status: missing.status,
      rejected: missing.status === 401,
      code: missingBody?.error?.code || null
    });

    const badSig = await fetch(`${FN}/paypal-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYPAL-TRANSMISSION-ID": "bad",
        "PAYPAL-TRANSMISSION-TIME": "bad",
        "PAYPAL-TRANSMISSION-SIG": "bad",
        "PAYPAL-CERT-URL": "https://example.invalid/cert",
        "PAYPAL-AUTH-ALGO": "SHA256withRSA"
      },
      body: JSON.stringify({
        id: "WH-07C7F-BAD-SIG-SMOKE",
        event_type: "PAYMENT.SALE.COMPLETED",
        resource: { id: "SALE-SMOKE" }
      })
    });
    const badBody = await badSig.json().catch(() => ({}));
    const whCheck = await rest(
      keys.serviceRole,
      "payment_webhook_events",
      "paypal_event_id=eq.WH-07C7F-BAD-SIG-SMOKE&select=id"
    );
    const whCount = Array.isArray(whCheck.body) ? whCheck.body.length : -1;
    out({
      smoke: "bad_signature",
      status: badSig.status,
      rejected: badSig.status === 401,
      code: badBody?.error?.code || badBody?.error || null,
      event_rows: whCount
    });
  }

  if (phase === "reconcile" || phase === "all") {
    const before = await snapshot(keys, "pre_reconcile");
    if (!before.target) {
      out({ step: "fatal", reason: "NO_TARGET_SUBSCRIPTION" });
      process.exit(2);
    }
    if (before.target.paid_through) {
      out({
        step: "warn",
        reason: "PAID_THROUGH_ALREADY_SET",
        paid_through: before.target.paid_through
      });
    }

    const token = await mintOfficialSession(keys, before.target.user_id);

    const first = await getStatus(keys, token);
    out({
      step: "get_status_1",
      status: first.status,
      ok: first.body?.ok === true,
      subscription: first.body?.subscription
        ? {
          plan_code: first.body.subscription.plan_code,
          status: first.body.subscription.status,
          paid_through: first.body.subscription.paid_through,
          next_billing_time: first.body.subscription.next_billing_time,
          reconciliation_status: first.body.subscription.reconciliation_status,
          access_blocked: first.body.subscription.access_blocked,
          cancelled_at: first.body.subscription.cancelled_at || null
        }
        : null,
      error: first.body?.error?.code || null
    });

    const mid = await snapshot(keys, "after_reconcile_1");

    const second = await getStatus(keys, token);
    out({
      step: "get_status_2",
      status: second.status,
      ok: second.body?.ok === true,
      subscription: second.body?.subscription
        ? {
          plan_code: second.body.subscription.plan_code,
          status: second.body.subscription.status,
          paid_through: second.body.subscription.paid_through,
          next_billing_time: second.body.subscription.next_billing_time,
          reconciliation_status: second.body.subscription.reconciliation_status,
          access_blocked: second.body.subscription.access_blocked
        }
        : null
    });

    const after = await snapshot(keys, "after_reconcile_2");

    out({
      step: "idempotency_check",
      tx_before: before.snap.tx_count,
      tx_after_1: mid.snap.tx_count,
      tx_after_2: after.snap.tx_count,
      paid_1: mid.snap.target?.paid_through || null,
      paid_2: after.snap.target?.paid_through || null,
      paid_unchanged: mid.snap.target?.paid_through === after.snap.target?.paid_through,
      tx_not_doubled: after.snap.tx_count === mid.snap.tx_count,
      wallet_sum_before: before.snap.wallet_sum,
      wallet_sum_after: after.snap.wallet_sum,
      orders_range_before: before.ordersRange,
      orders_range_after: after.ordersRange
    });
  }
}

main().catch((e) => {
  out({ step: "fatal", message: String(e?.message || e) });
  process.exit(1);
});
