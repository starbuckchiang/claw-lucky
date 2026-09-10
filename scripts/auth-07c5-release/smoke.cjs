"use strict";
const fs = require("fs");
const crypto = require("crypto");

const BASE = "https://umtqpstacjdwxcvcirbl.supabase.co";
const ANON = "sb_publishable_PtWhyYhKGUVxph4o80oGbg_aeZVnUyk";
const FN = `${BASE}/functions/v1`;

function out(o) {
  process.stdout.write(JSON.stringify(o) + "\n");
}

async function main() {
  // 1) Missing JWT
  const r1 = await fetch(`${FN}/paypal-subscription`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON
    },
    body: JSON.stringify({ action: "get_status" })
  });
  const b1 = await r1.text();
  out({
    smoke: "missing_jwt",
    status: r1.status,
    rejected: r1.status === 401 || /auth|jwt|unauthorized/i.test(b1),
    body_prefix: b1.slice(0, 120)
  });

  // 2) Anonymous JWT
  const anonAuth = await fetch(`${BASE}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data: {}, gotrue_meta_security: {} })
  }).catch(() => null);

  // Prefer anonymous sign-in endpoint
  const anonSign = await fetch(`${BASE}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      "Content-Type": "application/json",
      "X-Supabase-Api-Version": "2024-01-01"
    },
    body: JSON.stringify({})
  });

  // Try /auth/v1/token?grant_type=anonymous if available via GoTrue
  let anonToken = null;
  const anonTry = await fetch(`${BASE}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: ANON,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: `anon-smoke-${Date.now()}@example.invalid`,
      password: crypto.randomBytes(16).toString("hex")
    })
  });
  // Actually for anonymous users:
  const a2 = await fetch(`${BASE}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: ANON,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data: {} })
  });

  // Official path using supabase-js style anonymous:
  // POST /auth/v1/token?grant_type=password won't work.
  // Use: POST /auth/v1/signup with options create anonymous via:
  const anonRes = await fetch(`${BASE}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: ANON,
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON}`
    },
    body: JSON.stringify({})
  });
  const anonJson = await anonRes.json().catch(() => ({}));

  // Newer GoTrue anonymous:
  const anonGrant = await fetch(`${BASE}/auth/v1/token?grant_type=anonymous`, {
    method: "POST",
    headers: {
      apikey: ANON,
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON}`
    },
    body: "{}"
  });
  const anonGrantJson = await anonGrant.json().catch(() => ({}));
  anonToken = anonGrantJson.access_token || anonJson.access_token || null;

  out({
    smoke: "anonymous_token_acquire",
    grant_status: anonGrant.status,
    signup_status: anonRes.status,
    has_token: Boolean(anonToken),
    is_anonymous: anonGrantJson.user?.is_anonymous === true || anonJson.user?.is_anonymous === true
  });

  if (anonToken) {
    const r2 = await fetch(`${FN}/paypal-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON,
        Authorization: `Bearer ${anonToken}`
      },
      body: JSON.stringify({ action: "get_status" })
    });
    const b2t = await r2.text();
    let b2;
    try { b2 = JSON.parse(b2t); } catch { b2 = { raw: b2t.slice(0, 160) }; }
    out({
      smoke: "anonymous_jwt",
      status: r2.status,
      code: b2?.error?.code || null,
      rejected: r2.status === 403 || b2?.error?.code === "ACCOUNT_UPGRADE_REQUIRED"
    });
  } else {
    out({ smoke: "anonymous_jwt", skipped: true, reason: "NO_ANON_TOKEN" });
  }

  // 3) Official get_status — try service role from env if present to create confirmed user
  let serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!serviceRole && fs.existsSync(".env")) {
    const env = fs.readFileSync(".env", "utf8");
    const m = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m);
    if (m) serviceRole = m[1].trim().replace(/^["']|["']$/g, "");
  }

  if (!serviceRole) {
    out({ smoke: "official_get_status", skipped: true, reason: "NO_SERVICE_ROLE_LOCAL" });
  } else {
    const email = `07c5-smoke-${Date.now()}@clawlucky.invalid`;
    const password = crypto.randomBytes(18).toString("base64url");
    const create = await fetch(`${BASE}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { smoke: "07c5" }
      })
    });
    const created = await create.json().catch(() => ({}));
    out({
      smoke: "official_user_create",
      status: create.status,
      ok: create.ok,
      has_id: Boolean(created?.id),
      id_prefix: created?.id ? String(created.id).slice(0, 8) : null
    });

    const login = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: ANON,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });
    const loginJson = await login.json().catch(() => ({}));
    const officialToken = loginJson.access_token;
    out({
      smoke: "official_login",
      status: login.status,
      has_token: Boolean(officialToken)
    });

    if (officialToken) {
      const r3 = await fetch(`${FN}/paypal-subscription`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON,
          Authorization: `Bearer ${officialToken}`
        },
        body: JSON.stringify({ action: "get_status" })
      });
      const b3t = await r3.text();
      let b3;
      try { b3 = JSON.parse(b3t); } catch { b3 = { raw: b3t.slice(0, 160) }; }
      const keys = b3 && typeof b3 === "object" ? Object.keys(b3) : [];
      const safe =
        r3.ok
        && b3.ok === true
        && !("payer" in (b3.subscription || {}))
        && !JSON.stringify(b3).includes("CLIENT_SECRET");
      out({
        smoke: "official_get_status",
        status: r3.status,
        ok: b3.ok === true,
        has_subscription: Boolean(b3.subscription),
        subscription_null_or_summary: b3.subscription == null || typeof b3.subscription === "object",
        top_keys: keys.slice(0, 12),
        safe_summary: safe,
        // do not dump full body
        message: b3.message || b3.error?.code || null
      });

      // cleanup smoke user
      if (created?.id) {
        await fetch(`${BASE}/auth/v1/admin/users/${created.id}`, {
          method: "DELETE",
          headers: {
            apikey: serviceRole,
            Authorization: `Bearer ${serviceRole}`
          }
        });
      }
    }
  }

  // 4) Webhook invalid signature — count events before/after via REST if possible (service role)
  const beforeCount = serviceRole
    ? await (async () => {
      const r = await fetch(
        `${BASE}/rest/v1/payment_webhook_events?select=id&paypal_event_id=eq.WH-07C5-SMOKE-BAD-SIG`,
        {
          headers: {
            apikey: serviceRole,
            Authorization: `Bearer ${serviceRole}`
          }
        }
      );
      const rows = await r.json().catch(() => []);
      return Array.isArray(rows) ? rows.length : -1;
    })()
    : -1;

  const wh = await fetch(`${FN}/paypal-webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PAYPAL-AUTH-ALGO": "SHA256withRSA",
      "PAYPAL-CERT-URL": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-fake",
      "PAYPAL-TRANSMISSION-ID": "smoke-bad-sig",
      "PAYPAL-TRANSMISSION-SIG": "not-a-real-signature",
      "PAYPAL-TRANSMISSION-TIME": new Date().toISOString()
    },
    body: JSON.stringify({
      id: "WH-07C5-SMOKE-BAD-SIG",
      event_type: "PAYMENT.SALE.COMPLETED",
      resource: { id: "SALE-SMOKE", billing_agreement_id: "I-SMOKE" }
    })
  });
  const whBody = await wh.text();
  let whJson;
  try { whJson = JSON.parse(whBody); } catch { whJson = {}; }

  const afterCount = serviceRole
    ? await (async () => {
      const r = await fetch(
        `${BASE}/rest/v1/payment_webhook_events?select=id&paypal_event_id=eq.WH-07C5-SMOKE-BAD-SIG`,
        {
          headers: {
            apikey: serviceRole,
            Authorization: `Bearer ${serviceRole}`
          }
        }
      );
      const rows = await r.json().catch(() => []);
      return Array.isArray(rows) ? rows.length : -1;
    })()
    : -1;

  out({
    smoke: "webhook_bad_signature",
    status: wh.status,
    rejected: wh.status === 401,
    code: whJson?.error?.code || null,
    db_rows_before: beforeCount,
    db_rows_after: afterCount,
    no_db_write: beforeCount >= 0 ? afterCount === beforeCount : null
  });
}

main().catch((e) => {
  out({ gate: "FAIL", error: String(e && e.message || e).slice(0, 200) });
  process.exit(1);
});
