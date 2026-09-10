"use strict";

/**
 * Auth-07C.7B — read-only paid_through diagnostic.
 * Never prints full IDs, tokens, secrets, or payer PII.
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE = "https://umtqpstacjdwxcvcirbl.supabase.co";
const REF = "umtqpstacjdwxcvcirbl";
const API = "https://api-m.sandbox.paypal.com";
const USER_PREFIX = "5020bf33";
const ROOT = path.resolve(__dirname, "../..");

function out(o) {
  console.log(JSON.stringify(o));
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
  return { serviceRole: by.service_role || "", anon: by.anon || by.default || "" };
}

function loadPaypalCreds() {
  const p = path.join(
    ROOT,
    "docs/0-working-prompts/prompts-auth/paypel測試用帳號.txt"
  );
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
    body = { raw_prefix: text.slice(0, 120) };
  }
  return { status: res.status, range: res.headers.get("content-range"), body };
}

async function main() {
  const keys = loadKeys();
  out({ step: "keys", service_len: keys.serviceRole.length });

  // Find subscriptions for known test user prefix (and all recent as fallback)
  const allSubs = await rest(
    keys.serviceRole,
    "paypal_subscriptions",
    "select=*&order=created_at.desc&limit=20"
  );
  const subRows = Array.isArray(allSubs.body) ? allSubs.body : [];
  out({
    step: "subs_list",
    http: allSubs.status,
    range: allSubs.range,
    count: subRows.length,
    rows: subRows.map((s) => ({
      id: fp(s.id),
      user: fp(s.user_id),
      user_matches_test: String(s.user_id || "").startsWith(USER_PREFIX),
      plan_code: s.plan_code,
      status: s.status,
      has_paypal_sub: Boolean(s.paypal_subscription_id),
      paypal_sub: fp(s.paypal_subscription_id),
      recurring_amount: s.recurring_amount,
      currency: s.currency,
      start_time: s.start_time || null,
      next_billing_time: s.next_billing_time || null,
      last_payment_time: s.last_payment_time || null,
      paid_through: s.paid_through || null,
      reconciliation_status: s.reconciliation_status || null,
      access_blocked_at: s.access_blocked_at || null,
      checkout: fp(s.checkout_session_id),
      created_at: s.created_at || null,
      updated_at: s.updated_at || null
    }))
  });

  const target =
    subRows.find((s) => String(s.user_id || "").startsWith(USER_PREFIX))
    || subRows[0]
    || null;

  if (!target) {
    out({ step: "fatal", reason: "NO_SUBSCRIPTION_ROW" });
    process.exit(2);
  }

  out({
    step: "target_sub",
    user: fp(target.user_id),
    id: fp(target.id),
    status: target.status,
    plan_code: target.plan_code,
    recurring_amount: target.recurring_amount,
    currency: target.currency,
    has_paypal_sub: Boolean(target.paypal_subscription_id),
    paypal_sub: fp(target.paypal_subscription_id),
    start_time: target.start_time || null,
    next_billing_time: target.next_billing_time || null,
    last_payment_time: target.last_payment_time || null,
    paid_through: target.paid_through || null,
    reconciliation_status: target.reconciliation_status || null,
    access_blocked_at: target.access_blocked_at || null,
    checkout: fp(target.checkout_session_id),
    updated_at: target.updated_at || null
  });

  const slots = await rest(
    keys.serviceRole,
    "user_subscription_slots",
    `user_id=eq.${target.user_id}&select=*`
  );
  const slotRows = Array.isArray(slots.body) ? slots.body : [];
  out({
    step: "slots",
    http: slots.status,
    count: slotRows.length,
    rows: slotRows.map((s) => ({
      user: fp(s.user_id),
      slot_state: s.slot_state,
      subscription_ref: fp(
        s.subscription_id || s.current_subscription_id || s.paypal_subscription_row_id
      ),
      keys: Object.keys(s)
    }))
  });

  const txs = await rest(
    keys.serviceRole,
    "paypal_subscription_transactions",
    `select=*&order=created_at.desc&limit=50`
  );
  const txRows = Array.isArray(txs.body) ? txs.body : [];
  const relatedTx = txRows.filter(
    (t) =>
      String(t.paypal_subscription_id || "") === String(target.paypal_subscription_id || "")
      || String(t.subscription_id || "") === String(target.id || "")
      || String(t.user_id || "") === String(target.user_id || "")
  );
  out({
    step: "transactions",
    http: txs.status,
    range: txs.range,
    total_returned: txRows.length,
    related_count: relatedTx.length,
    related: relatedTx.map((t) => ({
      id: fp(t.id),
      event_type: t.event_type || t.paypal_event_type || null,
      status: t.status || null,
      amount: t.amount ?? t.sale_amount ?? null,
      currency: t.currency || null,
      has_sale_id: Boolean(t.paypal_sale_id || t.sale_id),
      sale: fp(t.paypal_sale_id || t.sale_id),
      needs_review: t.needs_review ?? null,
      created_at: t.created_at || null
    }))
  });

  const wh = await rest(
    keys.serviceRole,
    "payment_webhook_events",
    "select=id,event_type,processing_status,verification_status,error_code,paypal_event_id,paypal_subscription_id,paypal_sale_id,paypal_order_id,created_at,updated_at&order=created_at.desc&limit=100"
  );
  const whRows = Array.isArray(wh.body) ? wh.body : [];
  const subId = String(target.paypal_subscription_id || "");
  const relatedWh = whRows.filter((e) => {
    const et = String(e.event_type || "");
    const linked =
      String(e.paypal_subscription_id || "") === subId
      || (subId && String(e.paypal_subscription_id || "").includes(subId.slice(0, 8)));
    const isSubEvent =
      et.startsWith("BILLING.SUBSCRIPTION")
      || et.startsWith("PAYMENT.SALE");
    return linked || (isSubEvent && !e.paypal_order_id);
  });

  // Also pull subscription-related events even if subscription id column empty
  const subLike = whRows.filter((e) => {
    const et = String(e.event_type || "");
    return (
      et.startsWith("BILLING.SUBSCRIPTION")
      || et.startsWith("PAYMENT.SALE")
    );
  });

  out({
    step: "webhooks",
    http: wh.status,
    range: wh.range,
    total_returned: whRows.length,
    subscription_like_count: subLike.length,
    related_count: relatedWh.length,
    subscription_like: subLike.map((e) => ({
      id: fp(e.id),
      event_type: e.event_type,
      processing_status: e.processing_status,
      verification_status: e.verification_status,
      error_code: e.error_code || null,
      has_sub_id: Boolean(e.paypal_subscription_id),
      sub: fp(e.paypal_subscription_id),
      has_sale_id: Boolean(e.paypal_sale_id),
      sale: fp(e.paypal_sale_id),
      created_at: e.created_at || null
    })),
    flags: {
      has_CREATED: subLike.some((e) => e.event_type === "BILLING.SUBSCRIPTION.CREATED"),
      has_ACTIVATED: subLike.some((e) => e.event_type === "BILLING.SUBSCRIPTION.ACTIVATED"),
      has_SALE_COMPLETED: subLike.some((e) => e.event_type === "PAYMENT.SALE.COMPLETED"),
      pending_resolution: subLike.some((e) => e.processing_status === "pending_resolution"),
      reconciliation_pending: subLike.some(
        (e) => e.processing_status === "reconciliation_pending"
      ),
      failed: subLike.filter((e) =>
        ["failed", "error", "rejected"].includes(String(e.processing_status || "").toLowerCase())
      ).map((e) => ({
        event_type: e.event_type,
        processing_status: e.processing_status,
        error_code: e.error_code || null
      }))
    }
  });

  // PayPal GET
  if (!target.paypal_subscription_id) {
    out({ step: "paypal", skipped: true, reason: "NO_PAYPAL_SUBSCRIPTION_ID" });
    return;
  }

  const creds = loadPaypalCreds();
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const tokRes = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const tok = await tokRes.json().catch(() => ({}));
  out({ step: "oauth", ok: tokRes.ok && !!tok.access_token, status: tokRes.status });
  if (!tok.access_token) process.exit(2);

  const sid = target.paypal_subscription_id;
  const g = await fetch(`${API}/v1/billing/subscriptions/${sid}`, {
    headers: { Authorization: `Bearer ${tok.access_token}` }
  });
  const sub = await g.json().catch(() => ({}));
  const lastPayment = sub?.billing_info?.last_payment || null;
  const planId = sub?.plan_id || null;
  const customId = sub?.custom_id || null;
  const payee =
    lastPayment?.amount
      ? null
      : null;

  out({
    step: "paypal_subscription",
    http: g.status,
    status: sub.status || null,
    plan: fp(planId),
    plan_matches_db_allowlist_prefix: planId ? String(planId).startsWith("P-5KH0") : false,
    custom_id: fp(customId),
    custom_matches_checkout:
      customId && target.checkout_session_id
        ? String(customId) === String(target.checkout_session_id)
        : null,
    next_billing_time: sub?.billing_info?.next_billing_time || null,
    last_payment: lastPayment
      ? {
          status: lastPayment.status || null,
          time: lastPayment.time || null,
          amount: lastPayment.amount?.value || null,
          currency: lastPayment.amount?.currency_code || null
        }
      : null,
    failed_payments_count: sub?.billing_info?.failed_payments_count ?? null,
    cycle_executions: Array.isArray(sub?.billing_info?.cycle_executions)
      ? sub.billing_info.cycle_executions.map((c) => ({
          tenure_type: c.tenure_type,
          sequence: c.sequence,
          cycles_completed: c.cycles_completed,
          cycles_remaining: c.cycles_remaining
        }))
      : null,
    subscriber_present: Boolean(sub?.subscriber),
    // never dump subscriber/payer
  });

  const start = target.start_time || target.created_at || new Date(Date.now() - 7 * 864e5).toISOString();
  const end = new Date().toISOString();
  const startDay = start.slice(0, 10);
  const endDay = end.slice(0, 10);
  const txUrl =
    `${API}/v1/billing/subscriptions/${sid}/transactions`
    + `?start_time=${encodeURIComponent(startDay + "T00:00:00Z")}`
    + `&end_time=${encodeURIComponent(end)}`;
  const tr = await fetch(txUrl, {
    headers: { Authorization: `Bearer ${tok.access_token}` }
  });
  const trBody = await tr.json().catch(() => ({}));
  const transactions = Array.isArray(trBody.transactions) ? trBody.transactions : [];
  const completed = transactions.filter((t) =>
    String(t.status || "").toUpperCase() === "COMPLETED"
  );
  out({
    step: "paypal_transactions",
    http: tr.status,
    range: { startDay, endDay },
    total: transactions.length,
    completed_count: completed.length,
    transactions: transactions.map((t) => ({
      id: fp(t.id),
      status: t.status || null,
      time: t.time || null,
      amount: t.amount?.value || t.amount_with_breakdown?.gross_amount?.value || null,
      currency:
        t.amount?.currency_code
        || t.amount_with_breakdown?.gross_amount?.currency_code
        || null
    }))
  });

  // Classify
  const paypalHasSale = completed.length > 0 || (lastPayment && lastPayment.amount);
  const dbHasTx = relatedTx.some(
    (t) => String(t.status || "").toLowerCase() === "completed"
  );
  const saleWh = subLike.filter((e) => e.event_type === "PAYMENT.SALE.COMPLETED");
  const salePending = saleWh.some((e) => e.processing_status === "pending_resolution");
  const saleRecon = saleWh.some((e) => e.processing_status === "reconciliation_pending");
  const saleFailed = saleWh.some((e) =>
    ["failed", "error", "rejected"].includes(String(e.processing_status || "").toLowerCase())
  );

  let root = "UNKNOWN";
  if (paypalHasSale && saleWh.length === 0) root = "WEBHOOK_NOT_RECEIVED_OR_NOT_SUBSCRIBED";
  else if (saleWh.length > 0 && salePending) root = "WEBHOOK_BINDING_PENDING";
  else if (saleWh.length > 0 && saleRecon) root = "PAID_THROUGH_RECONCILIATION_PENDING";
  else if (saleWh.length > 0 && saleFailed) root = "WEBHOOK_PROCESSING_FAILED";
  else if (!paypalHasSale) root = "INITIAL_PAYMENT_NOT_COMPLETED_OR_DELAYED";
  else if (dbHasTx && !target.paid_through) root = "RPC_PAID_THROUGH_UPDATE_DEFECT";
  else if (paypalHasSale && saleWh.length > 0 && !target.paid_through && !dbHasTx) {
    root = "WEBHOOK_PROCESSING_FAILED"; // received but no tx / no paid_through
  }

  out({
    step: "classification",
    paypalHasSale: Boolean(paypalHasSale),
    dbHasTx,
    saleWebhookCount: saleWh.length,
    salePending,
    saleRecon,
    saleFailed,
    paid_through_null: target.paid_through == null,
    root
  });
}

main().catch((e) => {
  out({ step: "fatal", message: String(e && e.message ? e.message : e) });
  process.exit(1);
});
