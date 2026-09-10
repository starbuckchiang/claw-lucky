"use strict";

/**
 * Auth-07C.3 — Sandbox Product/Plans create-or-reuse.
 * Never prints access tokens, client secret, or full product/plan IDs.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const API = "https://api-m.sandbox.paypal.com";
const PRODUCT_NAME = "Lucky Buddies Subscription (Sandbox)";
const PRODUCT_DESC = "Lucky Buddies recurring membership";
const MONTHLY_NAME = "Lucky Buddies Monthly USD 5";
const YEARLY_NAME = "Lucky Buddies Yearly USD 48";

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
  const out = {
    clientId: process.env.PAYPAL_CLIENT_ID || "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
    merchantId: process.env.PAYPAL_MERCHANT_ID || ""
  };
  const p = path.join(__dirname, "..", "..", "docs", "0-working-prompts", "prompts-auth", "paypel測試用帳號.txt");
  if (fs.existsSync(p)) {
    const t = fs.readFileSync(p, "utf8");
    const idM = t.match(/client ID[\s\S]*?\n([A-Za-z0-9_-]+)/i);
    const secM = t.match(/secret key[\s\S]*?\n([A-Za-z0-9_-]+)/i);
    const acctM = t.match(/Account ID\s*\n([A-Z0-9]+)/i);
    if (!out.clientId && idM) out.clientId = idM[1].trim();
    if (!out.clientSecret && secM) out.clientSecret = secM[1].trim();
    if (!out.merchantId && acctM) out.merchantId = acctM[1].trim();
  }
  const cfg = fs.readFileSync(path.join(__dirname, "..", "..", "config.js"), "utf8");
  const cfgId = cfg.match(/PAYPAL_CLIENT_ID\s*=\s*"([^"]+)"/);
  const cfgEnv = cfg.match(/PAYPAL_ENV\s*=\s*"([^"]+)"/);
  return {
    ...out,
    cfgClientId: cfgId ? cfgId[1] : "",
    cfgEnv: cfgEnv ? cfgEnv[1] : ""
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

function findExactProducts(list, name) {
  return (list || []).filter((p) => p && p.name === name);
}

function findExactPlans(list, name) {
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
  if (cycles.length !== 1) {
    return { ok: false, reason: "cycle_count", detail: { cycles: cycles.length } };
  }
  const c = cycles[0];
  if (String(c.tenure_type).toUpperCase() !== "REGULAR") {
    return { ok: false, reason: "tenure", detail: { tenure: c.tenure_type } };
  }
  if (Number(c.sequence) !== 1) return { ok: false, reason: "sequence", detail: { sequence: c.sequence } };
  if (Number(c.total_cycles) !== 0) {
    return { ok: false, reason: "total_cycles", detail: { total_cycles: c.total_cycles } };
  }
  if (String(c.frequency?.interval_unit).toUpperCase() !== expect.unit) {
    return { ok: false, reason: "interval_unit", detail: { unit: c.frequency?.interval_unit } };
  }
  if (Number(c.frequency?.interval_count) !== 1) {
    return { ok: false, reason: "interval_count", detail: { count: c.frequency?.interval_count } };
  }
  const price = c.pricing_scheme?.fixed_price;
  if (!moneyEq(price?.value, expect.value)) {
    return {
      ok: false,
      reason: "price",
      detail: { value: price?.value, expected: expect.value }
    };
  }
  if (String(price?.currency_code).toUpperCase() !== "USD") {
    return { ok: false, reason: "currency", detail: { currency: price?.currency_code } };
  }
  const prefs = plan.payment_preferences || {};
  if (prefs.auto_bill_outstanding !== true) {
    return { ok: false, reason: "auto_bill", detail: { auto_bill_outstanding: prefs.auto_bill_outstanding } };
  }
  if (Number(prefs.payment_failure_threshold) !== 3) {
    return {
      ok: false,
      reason: "failure_threshold",
      detail: { payment_failure_threshold: prefs.payment_failure_threshold }
    };
  }
  // Setup fee must be absent or zero-amount (create payload omitted it).
  if (prefs.setup_fee != null && !moneyEq(prefs.setup_fee.value, 0)) {
    return { ok: false, reason: "setup_fee_present", detail: { setup_fee: prefs.setup_fee } };
  }
  if (String(plan.status).toUpperCase() !== "ACTIVE") {
    return { ok: false, reason: "status", detail: { status: plan.status } };
  }
  return { ok: true, reason: "ok" };
}

function resultLine(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function main() {
  const creds = loadCreds();
  if (creds.cfgEnv !== "sandbox") {
    resultLine({ gate: "BLOCKED_ENVIRONMENT", reason: "PAYPAL_ENV_NOT_SANDBOX" });
    process.exit(2);
  }
  if (!creds.clientId || !creds.clientSecret) {
    resultLine({ gate: "BLOCKED_ENVIRONMENT", reason: "CREDENTIALS_MISSING" });
    process.exit(2);
  }
  if (creds.cfgClientId && creds.cfgClientId !== creds.clientId) {
    resultLine({
      gate: "BLOCKED_ENVIRONMENT",
      reason: "CLIENT_ID_CONFIG_MISMATCH",
      config: fp(creds.cfgClientId),
      cred: fp(creds.clientId)
    });
    process.exit(2);
  }

  const merchantFp = fp(creds.merchantId);
  resultLine({
    step: "env",
    paypal_env: "sandbox",
    api_host: API,
    client_id: fp(creds.clientId),
    merchant: merchantFp,
    merchant_vs_07b_note: "compare_to_supabase_secret_digest_externally"
  });

  const token = await oauth(creds.clientId, creds.clientSecret);
  resultLine({ step: "oauth", ok: true });

  // List products (paginate)
  let products = [];
  let page = 1;
  for (;;) {
    const r = await api(token, "GET", `/v1/catalogs/products?page_size=20&page=${page}&total_required=true`);
    if (!r.ok) {
      resultLine({ step: "list_products", ok: false, status: r.status, name: r.data?.name });
      process.exit(3);
    }
    products = products.concat(r.data.products || []);
    const total = Number(r.data.total_items || products.length);
    if (products.length >= total || !(r.data.products || []).length) break;
    page += 1;
    if (page > 20) break;
  }

  const matchedProducts = findExactProducts(products, PRODUCT_NAME);
  resultLine({
    step: "list_products",
    total: products.length,
    name_matches: matchedProducts.length,
    match_fps: matchedProducts.map((p) => ({ ...fp(p.id), status: p.status, type: p.type }))
  });

  if (matchedProducts.length > 1) {
    resultLine({ gate: "BLOCKED_DUPLICATE_RESOURCE", resource: "product" });
    process.exit(4);
  }

  let productId = null;
  let productCreated = false;
  if (matchedProducts.length === 1) {
    const p = matchedProducts[0];
    const g = await api(token, "GET", `/v1/catalogs/products/${p.id}`);
    if (!g.ok) {
      resultLine({ step: "get_existing_product", ok: false, status: g.status });
      process.exit(3);
    }
    const typeOk = String(g.data.type).toUpperCase() === "SERVICE";
    const nameOk = g.data.name === PRODUCT_NAME;
    if (!typeOk || !nameOk) {
      resultLine({
        gate: "BLOCKED_EXISTING_RESOURCE_MISMATCH",
        resource: "product",
        type: g.data.type,
        name_match: nameOk
      });
      process.exit(5);
    }
    productId = g.data.id;
    resultLine({ step: "reuse_product", validation: "MATCH", id: fp(productId) });
  } else {
    const reqId = `lb-prod-${crypto.randomUUID()}`;
    const created = await api(
      token,
      "POST",
      "/v1/catalogs/products",
      {
        name: PRODUCT_NAME,
        description: PRODUCT_DESC,
        type: "SERVICE",
        category: "SOFTWARE"
      },
      reqId
    );
    if (!created.ok) {
      resultLine({
        step: "create_product",
        ok: false,
        status: created.status,
        name: created.data?.name,
        issue: created.data?.details?.[0]?.issue || null
      });
      process.exit(3);
    }
    productId = created.data.id;
    productCreated = true;
    resultLine({ step: "create_product", ok: true, id: fp(productId) });
  }

  // List plans
  let plans = [];
  page = 1;
  for (;;) {
    const r = await api(token, "GET", `/v1/billing/plans?page_size=20&page=${page}&total_required=true`);
    if (!r.ok) {
      resultLine({ step: "list_plans", ok: false, status: r.status, name: r.data?.name });
      process.exit(3);
    }
    plans = plans.concat(r.data.plans || []);
    const total = Number(r.data.total_items || plans.length);
    if (plans.length >= total || !(r.data.plans || []).length) break;
    page += 1;
    if (page > 50) break;
  }

  async function ensurePlan(name, expect, createBody) {
    const matches = findExactPlans(plans, name);
    resultLine({ step: "list_plan_name", name, matches: matches.length, fps: matches.map((p) => fp(p.id)) });
    if (matches.length > 1) {
      resultLine({ gate: "BLOCKED_DUPLICATE_RESOURCE", resource: name });
      process.exit(4);
    }
    if (matches.length === 1) {
      const g = await api(token, "GET", `/v1/billing/plans/${matches[0].id}`);
      if (!g.ok) {
        resultLine({ step: "get_plan", name, ok: false, status: g.status });
        process.exit(3);
      }
      if (g.data.product_id !== productId) {
        resultLine({ gate: "BLOCKED_EXISTING_RESOURCE_MISMATCH", resource: name, reason: "product_id" });
        process.exit(5);
      }
      const chk = planBillingOk(g.data, expect);
      if (!chk.ok) {
        resultLine({
          gate: "BLOCKED_EXISTING_RESOURCE_MISMATCH",
          resource: name,
          reason: chk.reason,
          status: g.data.status
        });
        process.exit(5);
      }
      resultLine({ step: "reuse_plan", name, validation: "MATCH", id: fp(g.data.id), status: g.data.status });
      return { id: g.data.id, created: false, get: g.data };
    }

    const reqId = `lb-plan-${crypto.randomUUID()}`;
    const created = await api(token, "POST", "/v1/billing/plans", createBody, reqId);
    if (!created.ok) {
      resultLine({
        step: "create_plan",
        name,
        ok: false,
        status: created.status,
        err: created.data?.name,
        issue: created.data?.details?.[0]?.issue || created.data?.message || null
      });
      process.exit(3);
    }
    const g = await api(token, "GET", `/v1/billing/plans/${created.data.id}`);
    const chk = planBillingOk(g.data, expect);
    resultLine({
      step: "create_plan",
      name,
      ok: true,
      id: fp(created.data.id),
      status: g.data.status,
      validation: chk.ok ? "MATCH" : "NOT_MATCH",
      reason: chk.reason,
      detail: chk.detail || null
    });
    if (!chk.ok || g.data.product_id !== productId) {
      resultLine({ gate: "FAIL", reason: "created_plan_validation" });
      process.exit(6);
    }
    return { id: created.data.id, created: true, get: g.data };
  }

  const monthlyBody = {
    product_id: productId,
    name: MONTHLY_NAME,
    description: "Lucky Buddies monthly membership USD 5",
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
    payment_preferences: {
      auto_bill_outstanding: true,
      payment_failure_threshold: 3
    }
  };

  const yearlyBody = {
    product_id: productId,
    name: YEARLY_NAME,
    description: "Lucky Buddies yearly membership USD 48",
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
    payment_preferences: {
      auto_bill_outstanding: true,
      payment_failure_threshold: 3
    }
  };

  const monthly = await ensurePlan(MONTHLY_NAME, { unit: "MONTH", value: "5.00" }, monthlyBody);
  const yearly = await ensurePlan(YEARLY_NAME, { unit: "YEAR", value: "48.00" }, yearlyBody);

  // Authority GET product again
  const gp = await api(token, "GET", `/v1/catalogs/products/${productId}`);
  resultLine({
    step: "get_product_final",
    validation: gp.ok && gp.data.type === "SERVICE" && gp.data.name === PRODUCT_NAME ? "MATCH" : "NOT_MATCH",
    id: fp(productId),
    type: gp.data.type
  });

  // Write secrets via supabase CLI without echoing values
  const secrets = {
    PAYPAL_SUBSCRIPTION_PRODUCT_ID: productId,
    PAYPAL_PLAN_ID_MONTHLY: monthly.id,
    PAYPAL_PLAN_ID_YEARLY: yearly.id
  };

  const secretResults = {};
  for (const [k, v] of Object.entries(secrets)) {
    // supabase secrets set KEY=value — do not print command with value
    const r = spawnSync(
      "supabase",
      ["secrets", "set", `${k}=${v}`],
      { encoding: "utf8", shell: true }
    );
    const ok = r.status === 0;
    secretResults[k] = ok ? "SET" : "FAIL";
    if (!ok) {
      resultLine({
        step: "secret_set",
        name: k,
        ok: false,
        stderr: String(r.stderr || "").slice(0, 200)
      });
    } else {
      resultLine({ step: "secret_set", name: k, ok: true });
    }
  }

  // Confirm names exist (list returns digests only)
  const list = spawnSync("supabase", ["secrets", "list", "-o", "json"], {
    encoding: "utf8",
    shell: true
  });
  let names = [];
  try {
    const m = String(list.stdout).match(/\[[\s\S]*\]/);
    names = m ? JSON.parse(m[0]).map((x) => x.name) : [];
  } catch (_) {
    names = [];
  }
  const nameCheck = {};
  for (const k of Object.keys(secrets)) {
    nameCheck[k] = names.includes(k) ? "PRESENT" : "MISSING";
  }
  resultLine({ step: "secret_names", names: nameCheck });

  const allSecretsOk = Object.values(secretResults).every((x) => x === "SET")
    && Object.values(nameCheck).every((x) => x === "PRESENT");

  resultLine({
    step: "summary",
    productCreated,
    monthlyCreated: monthly.created,
    yearlyCreated: yearly.created,
    monthlyStatus: monthly.get.status,
    yearlyStatus: yearly.get.status,
    trial: "NONE",
    setup_fee: "NONE",
    auto_bill_outstanding: true,
    payment_failure_threshold: 3,
    product: fp(productId),
    monthly: fp(monthly.id),
    yearly: fp(yearly.id),
    secrets_ok: allSecretsOk,
    gate: allSecretsOk ? "PASS" : "PARTIAL_SECRETS_NOT_SET"
  });
}

main().catch((err) => {
  resultLine({ gate: "FAIL", error: String(err && err.message || err).slice(0, 300) });
  process.exit(1);
});
