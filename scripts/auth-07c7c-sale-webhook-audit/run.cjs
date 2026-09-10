"use strict";

/**
 * Auth-07C.7C — SALE webhook delivery audit + conditional one-time official Resend.
 * Never prints full IDs, tokens, secrets, payloads, or payer PII.
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const API = "https://api-m.sandbox.paypal.com";
const BASE = "https://umtqpstacjdwxcvcirbl.supabase.co";
const REF = "umtqpstacjdwxcvcirbl";
const EXPECTED_WEBHOOK_ID = "4XX590475A807904W";
const EXPECTED_WEBHOOK_SHA8 = "f582b0e7";
const EXPECTED_URL_SHA8 = "7c9bd465"; // from 07C.5
const START = "2026-09-07T14:30:00Z";
const END = "2026-09-07T14:45:00Z";
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

function loadPaypalCreds() {
  const p = path.join(
    ROOT,
    "docs/0-working-prompts/prompts-auth/paypel測試用帳號.txt"
  );
  const t = fs.readFileSync(p, "utf8");
  return {
    clientId: t.match(/client ID[\s\S]*?\n([A-Za-z0-9_-]+)/i)[1].trim(),
    clientSecret: t.match(/secret key[\s\S]*?\n([A-Za-z0-9_-]+)/i)[1].trim()
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
  return { serviceRole: by.service_role || "" };
}

async function oauth(clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`OAUTH_FAILED ${res.status}`);
  return data.access_token;
}

async function paypal(token, method, urlPath, body) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
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
    body = { err: text.slice(0, 160) };
  }
  return { status: res.status, range: res.headers.get("content-range"), body };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sanitizeEventSummary(ev, saleId, subId) {
  const resource = ev.resource || {};
  const amount = resource.amount || {};
  const resourceId = String(resource.id || "");
  const billingAgreementId = String(
    resource.billing_agreement_id || resource.billing_agreement || ""
  );
  const value = String(amount.total || amount.value || "");
  const currency = String(amount.currency || amount.currency_code || "");
  return {
    event: fp(ev.id),
    event_type: ev.event_type || null,
    create_time: ev.create_time || null,
    resource_type: ev.resource_type || null,
    summary: ev.summary ? String(ev.summary).slice(0, 80) : null,
    sale_id_match: Boolean(saleId) && resourceId === String(saleId),
    subscription_id_match: Boolean(subId) && billingAgreementId === String(subId),
    amount_value: value || null,
    currency: currency || null,
    amount_match:
      (value === "5.00" || value === "5.0" || value === "5")
      && (currency === "USD" || currency === ""),
    resource_id: fp(resourceId),
    billing_agreement_id: fp(billingAgreementId),
    links: Array.isArray(ev.links)
      ? ev.links.map((l) => ({ rel: l.rel || null, method: l.method || null }))
      : []
  };
}

async function main() {
  const creds = loadPaypalCreds();
  const keys = loadKeys();
  const token = await oauth(creds.clientId, creds.clientSecret);
  out({ step: "oauth", ok: true });

  // --- 1) Webhook config ---
  const listWh = await paypal(token, "GET", "/v1/notifications/webhooks");
  const webhooks = Array.isArray(listWh.data.webhooks) ? listWh.data.webhooks : [];
  out({
    step: "list_webhooks",
    http: listWh.status,
    count: webhooks.length,
    ids: webhooks.map((w) => fp(w.id)),
    urls: webhooks.map((w) => fp(w.url))
  });

  const whGet = await paypal(
    token,
    "GET",
    `/v1/notifications/webhooks/${encodeURIComponent(EXPECTED_WEBHOOK_ID)}`
  );
  if (!whGet.status || whGet.status >= 400) {
    out({ step: "get_webhook", ok: false, status: whGet.status, name: whGet.data.name });
    out({ step: "gate", gate: "BLOCKED_WEBHOOK_CONFIG", root: "WEBHOOK_GET_FAILED" });
    process.exit(2);
  }
  const events = (whGet.data.event_types || []).map((e) => e.name).sort();
  const hasSale = events.includes("PAYMENT.SALE.COMPLETED");
  const idFp = fp(whGet.data.id);
  const urlFp = fp(whGet.data.url);
  out({
    step: "webhook_config",
    id_match_07c5: idFp.sha8 === EXPECTED_WEBHOOK_SHA8 && idFp.prefix6 === "4XX590",
    url_match_07c5: urlFp.sha8 === EXPECTED_URL_SHA8,
    id: idFp,
    url: urlFp,
    event_count: events.length,
    has_PAYMENT_SALE_COMPLETED: hasSale,
    subscription_events_present: [
      "BILLING.SUBSCRIPTION.CREATED",
      "BILLING.SUBSCRIPTION.ACTIVATED",
      "PAYMENT.SALE.COMPLETED"
    ].every((n) => events.includes(n)),
    duplicate_webhook: webhooks.length !== 1
  });

  if (!hasSale) {
    out({
      step: "gate",
      gate: "BLOCKED_WEBHOOK_CONFIG",
      root: "SALE_EVENT_NOT_SUBSCRIBED",
      resend: false
    });
    return;
  }

  // --- Load local subscription + PayPal sale id ---
  const subs = await rest(
    keys.serviceRole,
    "paypal_subscriptions",
    "select=*&order=created_at.desc&limit=5"
  );
  const subRows = Array.isArray(subs.body) ? subs.body : [];
  const target = subRows[0];
  if (!target?.paypal_subscription_id) {
    out({ step: "fatal", reason: "NO_LOCAL_SUBSCRIPTION" });
    process.exit(2);
  }
  const subId = String(target.paypal_subscription_id);
  out({
    step: "local_sub",
    status: target.status,
    paid_through: target.paid_through || null,
    last_payment_time: target.last_payment_time || null,
    next_billing_time: target.next_billing_time || null,
    paypal_sub: fp(subId),
    checkout: fp(target.checkout_session_id)
  });

  const txGet = await paypal(
    token,
    "GET",
    `/v1/billing/subscriptions/${encodeURIComponent(subId)}/transactions`
      + `?start_time=${encodeURIComponent("2026-09-07T00:00:00Z")}`
      + `&end_time=${encodeURIComponent(new Date().toISOString())}`
  );
  const transactions = Array.isArray(txGet.data.transactions) ? txGet.data.transactions : [];
  const completed = transactions.filter((t) => String(t.status).toUpperCase() === "COMPLETED");
  const sale = completed[0] || null;
  const saleId = sale ? String(sale.id) : "";
  out({
    step: "paypal_sale",
    http: txGet.status,
    completed_count: completed.length,
    sale: sale
      ? {
          id: fp(saleId),
          status: sale.status,
          time: sale.time || null,
          amount: sale.amount?.value || sale.amount_with_breakdown?.gross_amount?.value || null,
          currency:
            sale.amount?.currency_code
            || sale.amount_with_breakdown?.gross_amount?.currency_code
            || null
        }
      : null
  });
  if (!saleId) {
    out({ step: "gate", gate: "BLOCKED_EVENT_NOT_FOUND", root: "NO_PAYPAL_SALE", resend: false });
    return;
  }

  // Local still no SALE webhook / transaction?
  const whDb = await rest(
    keys.serviceRole,
    "payment_webhook_events",
    "event_type=eq.PAYMENT.SALE.COMPLETED&select=id,event_type,processing_status,verification_status,error_code,paypal_sale_id,paypal_subscription_id,received_at&order=received_at.desc&limit=20"
  );
  const saleWhRows = Array.isArray(whDb.body) ? whDb.body : [];
  const txDb = await rest(
    keys.serviceRole,
    "paypal_subscription_transactions",
    "select=*&limit=20"
  );
  const txRows = Array.isArray(txDb.body) ? txDb.body : [];
  out({
    step: "local_before",
    sale_webhook_count: saleWhRows.length,
    sale_webhooks: saleWhRows.map((e) => ({
      id: fp(e.id),
      processing_status: e.processing_status,
      verification_status: e.verification_status,
      error_code: e.error_code || null,
      sale: fp(e.paypal_sale_id),
      sub: fp(e.paypal_subscription_id),
      received_at: e.received_at || null
    })),
    transaction_count: txRows.length
  });

  // --- 2) Event history ---
  const qs = new URLSearchParams({
    page_size: "20",
    start_time: START,
    end_time: END,
    event_type: "PAYMENT.SALE.COMPLETED"
  });
  const list1 = await paypal(
    token,
    "GET",
    `/v1/notifications/webhooks-events?${qs.toString()}`
  );
  const events1 = Array.isArray(list1.data.events) ? list1.data.events : [];
  out({
    step: "list_events_by_type",
    http: list1.status,
    count: events1.length,
    name: list1.data.name || null,
    message: list1.data.message ? String(list1.data.message).slice(0, 120) : null,
    events: events1.map((e) => sanitizeEventSummary(e, saleId, subId))
  });

  const qs2 = new URLSearchParams({
    page_size: "20",
    start_time: START,
    end_time: END,
    transaction_id: saleId
  });
  const list2 = await paypal(
    token,
    "GET",
    `/v1/notifications/webhooks-events?${qs2.toString()}`
  );
  const events2 = Array.isArray(list2.data.events) ? list2.data.events : [];
  out({
    step: "list_events_by_transaction",
    http: list2.status,
    count: events2.length,
    name: list2.data.name || null,
    events: events2.map((e) => sanitizeEventSummary(e, saleId, subId))
  });

  // Broader window fallback if empty
  let allCandidates = [...events1, ...events2];
  if (allCandidates.length === 0) {
    const qs3 = new URLSearchParams({
      page_size: "50",
      start_time: "2026-09-07T14:00:00Z",
      end_time: "2026-09-07T16:00:00Z",
      event_type: "PAYMENT.SALE.COMPLETED"
    });
    const list3 = await paypal(
      token,
      "GET",
      `/v1/notifications/webhooks-events?${qs3.toString()}`
    );
    const events3 = Array.isArray(list3.data.events) ? list3.data.events : [];
    out({
      step: "list_events_wider",
      http: list3.status,
      count: events3.length,
      events: events3.map((e) => sanitizeEventSummary(e, saleId, subId))
    });
    allCandidates = events3;
  }

  // Exact match
  const matched = allCandidates.find((e) => {
    const r = e.resource || {};
    const rid = String(r.id || "");
    const ba = String(r.billing_agreement_id || "");
    const amount = r.amount || {};
    const value = String(amount.total || amount.value || "");
    const currency = String(amount.currency || amount.currency_code || "USD");
    return (
      e.event_type === "PAYMENT.SALE.COMPLETED"
      && rid === saleId
      && ba === subId
      && (value === "5.00" || value === "5.0" || value === "5")
      && currency === "USD"
    );
  });

  if (!matched) {
    out({
      step: "match",
      found: false,
      gate: "BLOCKED_EVENT_NOT_FOUND",
      root: "SALE_EVENT_NOT_GENERATED_OR_DELAYED",
      resend: false
    });
    return;
  }

  const eventId = String(matched.id);
  out({ step: "match", found: true, event: fp(eventId), summary: sanitizeEventSummary(matched, saleId, subId) });

  // GET event details
  const detail = await paypal(
    token,
    "GET",
    `/v1/notifications/webhooks-events/${encodeURIComponent(eventId)}`
  );
  out({
    step: "event_detail",
    http: detail.status,
    summary: sanitizeEventSummary(detail.data, saleId, subId),
    // PayPal may not expose delivery HTTP here; record available status-like fields only
    status_fields: {
      status: detail.data.status || null,
      event_version: detail.data.event_version || null
    }
  });

  // Classify delivery (limited API surface)
  // If event exists in history, PayPal generated it. Local DB has no SALE → either
  // never delivered, delivery failed, or delivered but not persisted.
  // Without transmission API, use presence + local absence.
  let classification = "DELIVERY_FAILED"; // default when event exists but not in DB
  // If detail has explicit status
  const st = String(detail.data.status || matched.status || "").toUpperCase();
  if (st === "PENDING") classification = "PENDING";
  else if (["SUCCESS", "DELIVERED", "COMPLETED"].includes(st)) {
    classification = "WEBHOOK_RECEIVED_BEFORE_PERSIST_OR_HANDLER_CRASH";
  }

  out({ step: "classification_pre_resend", classification, event_status: st || null });

  if (classification === "PENDING") {
    out({ step: "wait_pending", seconds: 45 });
    await sleep(45000);
    const recheck = await rest(
      keys.serviceRole,
      "payment_webhook_events",
      "event_type=eq.PAYMENT.SALE.COMPLETED&select=id,processing_status,verification_status,paypal_sale_id,received_at&order=received_at.desc&limit=10"
    );
    const rows = Array.isArray(recheck.body) ? recheck.body : [];
    out({
      step: "pending_recheck",
      sale_webhook_count: rows.length,
      rows: rows.map((e) => ({
        id: fp(e.id),
        processing_status: e.processing_status,
        verification_status: e.verification_status,
        sale: fp(e.paypal_sale_id),
        received_at: e.received_at
      })),
      resend: false,
      gate: rows.length ? "PARTIAL" : "BLOCKED_EVENT_NOT_FOUND",
      root: rows.length ? "ARRIVED_AFTER_WAIT" : "SALE_EVENT_STILL_PENDING"
    });
    return;
  }

  // --- 4) Conditional resend ---
  const localStillMissing =
    saleWhRows.length === 0
    && !txRows.some((t) => String(t.paypal_sale_id || "") === saleId);

  const canResend =
    matched.event_type === "PAYMENT.SALE.COMPLETED"
    && localStillMissing
    && classification !== "PENDING"
    && urlFp.sha8 === EXPECTED_URL_SHA8;

  out({
    step: "resend_gate",
    canResend,
    localStillMissing,
    url_match: urlFp.sha8 === EXPECTED_URL_SHA8,
    classification
  });

  if (!canResend) {
    out({
      step: "gate",
      gate: "PARTIAL",
      root: classification,
      ConditionalResendPerformed: false
    });
    return;
  }

  const resend = await paypal(
    token,
    "POST",
    `/v1/notifications/webhooks-events/${encodeURIComponent(eventId)}/resend`,
    { webhook_ids: [EXPECTED_WEBHOOK_ID] }
  );
  out({
    step: "resend",
    http: resend.status,
    ok: resend.status === 202 || resend.status === 200,
    event: fp(resend.data.id || eventId),
    name: resend.data.name || null,
    message: resend.data.message ? String(resend.data.message).slice(0, 120) : null,
    count: 1
  });

  if (!(resend.status === 202 || resend.status === 200)) {
    out({
      step: "gate",
      gate: "FAIL_DELIVERY",
      root: "RESEND_REJECTED",
      ConditionalResendPerformed: true,
      ResendCount: 1
    });
    return;
  }

  // --- 5) Wait and verify ---
  out({ step: "wait_after_resend", seconds: 20 });
  await sleep(20000);

  async function snapshot(label) {
    const wh = await rest(
      keys.serviceRole,
      "payment_webhook_events",
      "event_type=eq.PAYMENT.SALE.COMPLETED&select=id,event_type,processing_status,verification_status,error_code,paypal_sale_id,paypal_subscription_id,received_at,processed_at&order=received_at.desc&limit=10"
    );
    const txs = await rest(
      keys.serviceRole,
      "paypal_subscription_transactions",
      "select=*&limit=20"
    );
    const sub = await rest(
      keys.serviceRole,
      "paypal_subscriptions",
      `id=eq.${target.id}&select=*`
    );
    const slots = await rest(
      keys.serviceRole,
      "user_subscription_slots",
      `user_id=eq.${target.user_id}&select=*`
    );
    const whRows = Array.isArray(wh.body) ? wh.body : [];
    const txList = Array.isArray(txs.body) ? txs.body : [];
    const subRow = Array.isArray(sub.body) ? sub.body[0] : null;
    const slotRow = Array.isArray(slots.body) ? slots.body[0] : null;
    out({
      step: label,
      sale_webhooks: whRows.map((e) => ({
        id: fp(e.id),
        processing_status: e.processing_status,
        verification_status: e.verification_status,
        error_code: e.error_code || null,
        sale: fp(e.paypal_sale_id),
        sub: fp(e.paypal_subscription_id),
        sale_match: String(e.paypal_sale_id || "") === saleId,
        received_at: e.received_at
      })),
      transactions: txList.map((t) => ({
        id: fp(t.id),
        status: t.status,
        amount: t.amount,
        currency: t.currency,
        needs_review: t.needs_review,
        sale: fp(t.paypal_sale_id),
        sale_match: String(t.paypal_sale_id || "") === saleId
      })),
      subscription: subRow
        ? {
            status: subRow.status,
            last_payment_time: subRow.last_payment_time || null,
            paid_through: subRow.paid_through || null,
            next_billing_time: subRow.next_billing_time || null,
            reconciliation_status: subRow.reconciliation_status || null,
            access_blocked_at: subRow.access_blocked_at || null
          }
        : null,
      slot: slotRow
        ? { slot_state: slotRow.slot_state, subscription_ref: fp(slotRow.subscription_id) }
        : null,
      counts: {
        sale_webhooks: whRows.length,
        transactions: txList.length,
        subscriptions: subRows.length
      }
    });
    return { whRows, txList, subRow, slotRow };
  }

  let snap = await snapshot("verify_20s");
  if (snap.whRows.length === 0) {
    out({ step: "wait_more", seconds: 40 });
    await sleep(40000);
    snap = await snapshot("verify_60s");
  }

  const saleWh = snap.whRows.find((e) => String(e.paypal_sale_id || "") === saleId) || snap.whRows[0];
  const tx = snap.txList.find((t) => String(t.paypal_sale_id || "") === saleId) || snap.txList[0];

  let gate = "PARTIAL";
  let root = classification;
  if (!saleWh) {
    gate = "FAIL_DELIVERY";
    root = "RESEND_NO_DB_EVENT";
  } else if (saleWh.verification_status !== "SUCCESS") {
    gate = "FAIL_HANDLER";
    root = "WEBHOOK_VERIFY_FAILED";
  } else if (saleWh.processing_status === "failed") {
    gate = "FAIL_HANDLER";
    root = saleWh.error_code || "HANDLER_FAILED";
  } else if (
    saleWh.processing_status === "processed"
    && tx
    && snap.subRow?.paid_through
  ) {
    gate = "PASS";
    root = "DELIVERY_FAILED_FIXED_BY_RESEND";
  } else if (saleWh.processing_status === "processed" && !snap.subRow?.paid_through) {
    gate = "FAIL_HANDLER";
    root = "PROCESSED_BUT_PAID_THROUGH_NULL";
  } else {
    gate = "PARTIAL";
    root = `PROCESSING_${saleWh.processing_status}`;
  }

  out({
    step: "final",
    gate,
    root,
    ConditionalResendPerformed: true,
    ResendCount: 1,
    DatabaseWebhookFound: Boolean(saleWh),
    WebhookSignature: saleWh?.verification_status || null,
    WebhookProcessing: saleWh?.processing_status || null,
    TransactionCount: snap.txList.length,
    DatabaseStatus: snap.subRow?.status || null,
    LastPaymentTime: snap.subRow?.last_payment_time || null,
    PaidThrough: snap.subRow?.paid_through || null,
    NextBillingTime: snap.subRow?.next_billing_time || null,
    SlotState: snap.slotRow?.slot_state || null
  });
}

main().catch((e) => {
  out({ step: "fatal", message: String(e && e.message ? e.message : e) });
  process.exit(1);
});
