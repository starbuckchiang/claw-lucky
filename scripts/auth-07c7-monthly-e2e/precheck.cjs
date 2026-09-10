"use strict";

/**
 * Auth-07C.7 precheck only — no payment, no DB writes.
 * Masked IDs only; never prints secrets/tokens.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API = "https://api-m.sandbox.paypal.com";
const ROOT = path.resolve(__dirname, "../..");

function fp(id) {
  if (!id) return { exists: false };
  const s = String(id);
  return {
    exists: true,
    length: s.length,
    prefix6: s.slice(0, 6),
    sha8: crypto.createHash("sha256").update(s).digest("hex").slice(0, 8)
  };
}

function out(o) {
  console.log(JSON.stringify(o));
}

async function main() {
  const credPath = path.join(
    ROOT,
    "docs/0-working-prompts/prompts-auth/paypel測試用帳號.txt"
  );
  const t = fs.readFileSync(credPath, "utf8");
  const idM = t.match(/client ID[\s\S]*?\n([A-Za-z0-9_-]+)/i);
  const secM = t.match(/secret key[\s\S]*?\n([A-Za-z0-9_-]+)/i);
  const clientId = idM[1].trim();
  const clientSecret = secM[1].trim();
  out({ step: "creds", client: fp(clientId), secret_len: clientSecret.length });

  const cfg = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  const envM = cfg.match(/PAYPAL_ENV\s*=\s*"([^"]+)"/);
  const cfgIdM = cfg.match(/PAYPAL_CLIENT_ID\s*=\s*"([^"]+)"/);
  out({
    step: "config",
    paypal_env: envM ? envM[1] : null,
    client_prefix6: cfgIdM ? cfgIdM[1].slice(0, 6) : null
  });

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
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

  const list = await fetch(`${API}/v1/billing/plans?page_size=20&total_required=true`, {
    headers: { Authorization: `Bearer ${tok.access_token}` }
  });
  const listBody = await list.json().catch(() => ({}));
  const plans = Array.isArray(listBody.plans) ? listBody.plans : [];
  const monthly =
    plans.find((p) => /Monthly USD 5/i.test(p.name || ""))
    || plans.find((p) => String(p.id || "").startsWith("P-5KH0"));
  out({
    step: "list_plans",
    http: list.status,
    total: plans.length,
    monthly_found: !!monthly,
    monthly_id: monthly ? fp(monthly.id) : null,
    monthly_status: monthly?.status || null
  });

  if (monthly?.id) {
    const g = await fetch(`${API}/v1/billing/plans/${monthly.id}`, {
      headers: { Authorization: `Bearer ${tok.access_token}` }
    });
    const plan = await g.json().catch(() => ({}));
    const cycle = plan?.billing_cycles?.[0] || {};
    const freq = cycle?.frequency || {};
    const pricing = cycle?.pricing_scheme?.fixed_price || {};
    out({
      step: "get_monthly_plan",
      http: g.status,
      status: plan.status,
      id: fp(plan.id),
      interval_unit: freq.interval_unit,
      interval_count: freq.interval_count,
      tenure_type: cycle.tenure_type,
      total_cycles: cycle.total_cycles,
      amount: pricing.value,
      currency: pricing.currency_code,
      auto_renew_implied: cycle.total_cycles === 0 || cycle.total_cycles == null
    });
  }

  const html = fs.readFileSync(path.join(ROOT, "subscription.html"), "utf8");
  const entry = fs.readFileSync(path.join(ROOT, "js/pages/subscription-entry.js"), "utf8");
  const flow = fs.readFileSync(
    path.join(ROOT, "js/services/subscription/paypal-subscription-flow.js"),
    "utf8"
  );
  out({
    step: "frontend_static",
    has_checkout_service: /paypal-checkout-service/.test(html),
    has_subscription_service: /paypal-subscription-service/.test(html),
    has_createOrder: /\bcreateOrder\b/.test(entry),
    has_createSubscription: /createSubscription/.test(entry),
    sdk_intent: (flow.match(/SDK_INTENT = "([^"]+)"/) || [])[1] || null,
    sdk_vault: (flow.match(/SDK_VAULT = "([^"]+)"/) || [])[1] || null
  });
}

main().catch((e) => {
  out({ step: "fatal", message: String(e && e.message ? e.message : e) });
  process.exit(1);
});
