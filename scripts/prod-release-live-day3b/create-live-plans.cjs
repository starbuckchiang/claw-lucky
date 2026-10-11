"use strict";

/**
 * PROD-RELEASE-LIVE (Day3B/3C) — Live Product/Plans create-or-reuse.
 * Never prints access tokens, client secret, or full product/plan IDs.
 * Does NOT write any Supabase secrets — catalog creation only. The
 * coordinated Production secrets switch is a separate, explicitly
 * confirmed step (pause payment entry -> switch -> verify -> reopen).
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const API = "https://api-m.paypal.com";
const PRODUCT_NAME = "Claw Lucky Subscription";
const PRODUCT_DESC = "Claw Lucky recurring membership";
const MONTHLY_NAME = "Claw Lucky Monthly USD 5";
const YEARLY_NAME = "Claw Lucky Yearly USD 48";

function fp(id) {
  if (!id) return { exists: false, length: 0, prefix6: null, sha8: null };
  const s = String(id);
  return {
    exists: true,
    length: s.length,
    prefix6: s.slice(0, 6),
    sha8: crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 8)
  };
}

function loadCreds() {
  const p = path.join(__dirname, "..", "..", "不要上傳", "paypel.txt");
  const t = fs.readFileSync(p, "utf8");
  const lines = t.split(/\r?\n/);
  return {
    clientId: (lines[2] || "").trim(),
    clientSecret: (lines[4] || "").trim()
  };
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
    throw new Error(`OAUTH_FAILED status=${res.status} name=${data?.error || data?.name || "unknown"}`);
  }
  return data.access_token;
}

async function api(token, method, urlPath, body, requestId) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

function findExact(list, name) {
  return (list || []).filter((p) => p && p.name === name);
}

function moneyEq(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) < 0.001;
}

function planBillingOk(plan, expect) {
  const cycles = plan.billing_cycles || [];
  if (cycles.length !== 1) return { ok: false, reason: "cycle_count" };
  const c = cycles[0];
  if (String(c.tenure_type).toUpperCase() !== "REGULAR") return { ok: false, reason: "tenure" };
  if (Number(c.sequence) !== 1) return { ok: false, reason: "sequence" };
  if (Number(c.total_cycles) !== 0) return { ok: false, reason: "total_cycles" };
  if (String(c.frequency?.interval_unit).toUpperCase() !== expect.unit) return { ok: false, reason: "interval_unit" };
  if (Number(c.frequency?.interval_count) !== 1) return { ok: false, reason: "interval_count" };
  const price = c.pricing_scheme?.fixed_price;
  if (!moneyEq(price?.value, expect.value)) return { ok: false, reason: "price" };
  if (String(price?.currency_code).toUpperCase() !== "USD") return { ok: false, reason: "currency" };
  const prefs = plan.payment_preferences || {};
  if (prefs.auto_bill_outstanding !== true) return { ok: false, reason: "auto_bill" };
  if (Number(prefs.payment_failure_threshold) !== 3) return { ok: false, reason: "failure_threshold" };
  if (prefs.setup_fee != null && !moneyEq(prefs.setup_fee.value, 0)) return { ok: false, reason: "setup_fee_present" };
  if (String(plan.status).toUpperCase() !== "ACTIVE") return { ok: false, reason: "status" };
  return { ok: true };
}

function resultLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function main() {
  const creds = loadCreds();
  if (!creds.clientId || !creds.clientSecret) {
    resultLine({ gate: "BLOCKED_ENVIRONMENT", reason: "CREDENTIALS_MISSING" });
    process.exit(2);
  }

  resultLine({ step: "env", api_host: API, client_id: fp(creds.clientId) });

  const token = await oauth(creds.clientId, creds.clientSecret);
  resultLine({ step: "oauth", ok: true });

  let products = [];
  let page = 1;
  for (;;) {
    const r = await api(token, "GET", `/v1/catalogs/products?page_size=20&page=${page}&total_required=true`);
    if (!r.ok) {
      resultLine({ step: "list_products", ok: false, status: r.status });
      process.exit(3);
    }
    products = products.concat(r.data.products || []);
    const total = Number(r.data.total_items || products.length);
    if (products.length >= total || !(r.data.products || []).length) break;
    page += 1;
    if (page > 20) break;
  }

  const matchedProducts = findExact(products, PRODUCT_NAME);
  resultLine({ step: "list_products", total: products.length, name_matches: matchedProducts.length });

  if (matchedProducts.length > 1) {
    resultLine({ gate: "BLOCKED_DUPLICATE_RESOURCE", resource: "product" });
    process.exit(4);
  }

  let productId = null;
  let productCreated = false;
  if (matchedProducts.length === 1) {
    const g = await api(token, "GET", `/v1/catalogs/products/${matchedProducts[0].id}`);
    if (!g.ok || String(g.data.type).toUpperCase() !== "SERVICE" || g.data.name !== PRODUCT_NAME) {
      resultLine({ gate: "BLOCKED_EXISTING_RESOURCE_MISMATCH", resource: "product" });
      process.exit(5);
    }
    productId = g.data.id;
    resultLine({ step: "reuse_product", id: fp(productId) });
  } else {
    const reqId = `cl-prod-${crypto.randomUUID()}`;
    const created = await api(
      token,
      "POST",
      "/v1/catalogs/products",
      { name: PRODUCT_NAME, description: PRODUCT_DESC, type: "SERVICE", category: "SOFTWARE" },
      reqId
    );
    if (!created.ok) {
      resultLine({ step: "create_product", ok: false, status: created.status, issue: created.data?.details?.[0]?.issue || null });
      process.exit(3);
    }
    productId = created.data.id;
    productCreated = true;
    resultLine({ step: "create_product", ok: true, id: fp(productId) });
  }

  let plans = [];
  page = 1;
  for (;;) {
    const r = await api(token, "GET", `/v1/billing/plans?page_size=20&page=${page}&total_required=true`);
    if (!r.ok) {
      resultLine({ step: "list_plans", ok: false, status: r.status });
      process.exit(3);
    }
    plans = plans.concat(r.data.plans || []);
    const total = Number(r.data.total_items || plans.length);
    if (plans.length >= total || !(r.data.plans || []).length) break;
    page += 1;
    if (page > 50) break;
  }

  async function ensurePlan(name, expect, createBody) {
    const matches = findExact(plans, name);
    resultLine({ step: "list_plan_name", name, matches: matches.length });
    if (matches.length > 1) {
      resultLine({ gate: "BLOCKED_DUPLICATE_RESOURCE", resource: name });
      process.exit(4);
    }
    if (matches.length === 1) {
      const g = await api(token, "GET", `/v1/billing/plans/${matches[0].id}`);
      if (!g.ok || g.data.product_id !== productId) {
        resultLine({ gate: "BLOCKED_EXISTING_RESOURCE_MISMATCH", resource: name, reason: "product_id" });
        process.exit(5);
      }
      const chk = planBillingOk(g.data, expect);
      if (!chk.ok) {
        resultLine({ gate: "BLOCKED_EXISTING_RESOURCE_MISMATCH", resource: name, reason: chk.reason });
        process.exit(5);
      }
      resultLine({ step: "reuse_plan", name, id: fp(g.data.id), status: g.data.status });
      return { id: g.data.id, created: false, get: g.data };
    }

    const reqId = `cl-plan-${crypto.randomUUID()}`;
    const created = await api(token, "POST", "/v1/billing/plans", createBody, reqId);
    if (!created.ok) {
      resultLine({ step: "create_plan", name, ok: false, status: created.status, issue: created.data?.details?.[0]?.issue || created.data?.message || null });
      process.exit(3);
    }
    const g = await api(token, "GET", `/v1/billing/plans/${created.data.id}`);
    const chk = planBillingOk(g.data, expect);
    resultLine({ step: "create_plan", name, ok: true, id: fp(created.data.id), status: g.data.status, validation: chk.ok ? "MATCH" : "NOT_MATCH" });
    if (!chk.ok || g.data.product_id !== productId) {
      resultLine({ gate: "FAIL", reason: "created_plan_validation" });
      process.exit(6);
    }
    return { id: created.data.id, created: true, get: g.data };
  }

  const monthlyBody = {
    product_id: productId,
    name: MONTHLY_NAME,
    description: "Claw Lucky monthly membership USD 5",
    status: "ACTIVE",
    billing_cycles: [
      {
        frequency: { interval_unit: "MONTH", interval_count: 1 },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: "5.00", currency_code: "USD" } }
      }
    ],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 }
  };

  const yearlyBody = {
    product_id: productId,
    name: YEARLY_NAME,
    description: "Claw Lucky yearly membership USD 48",
    status: "ACTIVE",
    billing_cycles: [
      {
        frequency: { interval_unit: "YEAR", interval_count: 1 },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: "48.00", currency_code: "USD" } }
      }
    ],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 }
  };

  const monthly = await ensurePlan(MONTHLY_NAME, { unit: "MONTH", value: "5.00" }, monthlyBody);
  const yearly = await ensurePlan(YEARLY_NAME, { unit: "YEAR", value: "48.00" }, yearlyBody);

  resultLine({
    step: "summary",
    productCreated,
    product_id_fp: fp(productId),
    monthly_id_fp: fp(monthly.id),
    monthly_status: monthly.get.status,
    yearly_id_fp: fp(yearly.id),
    yearly_status: yearly.get.status,
    note: "No Supabase secrets written by this script — coordinated switch is a separate step."
  });
}

main().catch((err) => {
  resultLine({ step: "fatal", ok: false, message: String(err && err.message || err) });
  process.exit(1);
});
