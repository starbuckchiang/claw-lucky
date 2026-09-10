"use strict";

/**
 * Auth-07C.5 — update Sandbox webhook event types (merge, never replace-only).
 * Does not print full webhook URL/ID/secret/token.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const API = "https://api-m.sandbox.paypal.com";
const WEBHOOK_ID = "4XX590475A807904W";

const REQUIRED_ORDERS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED"
];

const ADD_SUBSCRIPTION = [
  "BILLING.SUBSCRIPTION.CREATED",
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
  "PAYMENT.SALE.COMPLETED",
  "PAYMENT.SALE.REFUNDED",
  "PAYMENT.SALE.REVERSED"
];

function fp(s) {
  const t = String(s || "");
  return {
    exists: Boolean(t),
    length: t.length,
    prefix6: t.slice(0, 6),
    sha8: crypto.createHash("sha256").update(t, "utf8").digest("hex").slice(0, 8)
  };
}

function loadCreds() {
  const p = path.join(
    __dirname,
    "..",
    "..",
    "docs",
    "0-working-prompts",
    "prompts-auth",
    "paypel測試用帳號.txt"
  );
  const t = fs.readFileSync(p, "utf8");
  const clientId = t.match(/client ID[\s\S]*?\n([A-Za-z0-9_-]+)/i)[1].trim();
  const clientSecret = t.match(/secret key[\s\S]*?\n([A-Za-z0-9_-]+)/i)[1].trim();
  return { clientId, clientSecret };
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
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
  if (!res.ok || !data.access_token) {
    throw new Error(`OAUTH_FAILED status=${res.status}`);
  }
  return data.access_token;
}

async function main() {
  const { clientId, clientSecret } = loadCreds();
  out({ step: "env", api: API, webhook: fp(WEBHOOK_ID), client: fp(clientId) });
  const token = await oauth(clientId, clientSecret);
  out({ step: "oauth", ok: true });

  const getRes = await fetch(
    `${API}/v1/notifications/webhooks/${encodeURIComponent(WEBHOOK_ID)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
  );
  const before = await getRes.json().catch(() => ({}));
  if (!getRes.ok) {
    out({ step: "get_webhook_before", ok: false, status: getRes.status, name: before.name });
    process.exit(2);
  }

  const beforeEvents = (before.event_types || []).map((e) => e.name).sort();
  const urlFp = fp(before.url);
  const idFp = fp(before.id);
  out({
    step: "get_webhook_before",
    ok: true,
    id: idFp,
    url: urlFp,
    event_count: beforeEvents.length,
    events_masked: beforeEvents
  });

  for (const req of REQUIRED_ORDERS) {
    if (!beforeEvents.includes(req)) {
      out({ gate: "PARTIAL_WEBHOOK_CONFIG", reason: "missing_required_orders_event", event: req });
      process.exit(3);
    }
  }

  const merged = Array.from(new Set([...beforeEvents, ...ADD_SUBSCRIPTION])).sort();
  out({
    step: "merge_plan",
    before_count: beforeEvents.length,
    after_count: merged.length,
    added: ADD_SUBSCRIPTION.filter((e) => !beforeEvents.includes(e)),
    already_present: ADD_SUBSCRIPTION.filter((e) => beforeEvents.includes(e))
  });

  const patchRes = await fetch(
    `${API}/v1/notifications/webhooks/${encodeURIComponent(WEBHOOK_ID)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify([
        {
          op: "replace",
          path: "/event_types",
          value: merged.map((name) => ({ name }))
        }
      ])
    }
  );
  const patchBody = await patchRes.json().catch(() => ({}));
  if (!patchRes.ok) {
    out({
      step: "patch_webhook",
      ok: false,
      status: patchRes.status,
      name: patchBody.name,
      issue: patchBody.details?.[0]?.issue || null
    });
    process.exit(4);
  }
  out({ step: "patch_webhook", ok: true, status: patchRes.status });

  const getAfter = await fetch(
    `${API}/v1/notifications/webhooks/${encodeURIComponent(WEBHOOK_ID)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
  );
  const after = await getAfter.json().catch(() => ({}));
  if (!getAfter.ok) {
    out({ step: "get_webhook_after", ok: false, status: getAfter.status });
    process.exit(5);
  }

  const afterEvents = (after.event_types || []).map((e) => e.name).sort();
  const urlSame = after.url === before.url;
  const idSame = after.id === before.id;
  const ordersOk = REQUIRED_ORDERS.every((e) => afterEvents.includes(e));
  // Also preserve any other prior Orders events (CAPTURE.*)
  const priorPreserved = beforeEvents.every((e) => afterEvents.includes(e));
  const subsOk = ADD_SUBSCRIPTION.every((e) => afterEvents.includes(e));

  // Ensure no second webhook created — list count for this url fingerprint
  const listRes = await fetch(`${API}/v1/notifications/webhooks`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  const listBody = await listRes.json().catch(() => ({}));
  const webhooks = listBody.webhooks || [];
  out({
    step: "list_webhooks",
    count: webhooks.length,
    ids: webhooks.map((w) => fp(w.id))
  });

  out({
    step: "verify",
    webhook_id_changed: !idSame,
    webhook_url_changed: !urlSame,
    orders_events_preserved: ordersOk && priorPreserved,
    subscription_events_added: subsOk,
    duplicate_webhook_created: webhooks.length > 1 && webhooks.filter((w) => w.id === WEBHOOK_ID).length !== 1
      ? true
      : webhooks.length > 1
        ? "MULTIPLE_EXIST_BUT_UPDATED_EXISTING"
        : false,
    after_event_count: afterEvents.length,
    after_events_masked: afterEvents,
    id: fp(after.id),
    url: fp(after.url),
    gate: idSame && urlSame && ordersOk && priorPreserved && subsOk ? "PASS" : "PARTIAL_WEBHOOK_CONFIG"
  });
}

main().catch((e) => {
  out({ gate: "FAIL", error: String(e && e.message || e).slice(0, 200) });
  process.exit(1);
});
