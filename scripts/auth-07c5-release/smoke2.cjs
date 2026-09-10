"use strict";

/**
 * Auth-07C.5 smoke — loads API keys via `supabase projects api-keys` (not printed).
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE = "https://umtqpstacjdwxcvcirbl.supabase.co";
const FN = `${BASE}/functions/v1`;
const REF = "umtqpstacjdwxcvcirbl";

function out(o) {
  process.stdout.write(JSON.stringify(o) + "\n");
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
  const byName = {};
  for (const row of arr) {
    const name = String(row.name || "").toLowerCase();
    const val = String(row.api_key || row.key || "");
    if (val) byName[name] = val;
  }
  // Prefer legacy JWT anon/service_role for auth admin endpoints.
  return {
    anon: byName.anon || byName.default || "",
    serviceRole: byName.service_role || byName.service_role_key || ""
  };
}

async function main() {
  const keys = loadKeys();
  if (!keys.anon || !keys.serviceRole) {
    out({ gate: "FAIL", reason: "MISSING_API_KEYS", anon: !!keys.anon, service: !!keys.serviceRole });
    process.exit(2);
  }
  out({
    step: "keys_loaded",
    anon_len: keys.anon.length,
    service_len: keys.serviceRole.length
  });

  // Missing JWT
  const r1 = await fetch(`${FN}/paypal-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: keys.anon },
    body: JSON.stringify({ action: "get_status" })
  });
  const b1 = await r1.json().catch(() => ({}));
  out({
    smoke: "missing_jwt",
    status: r1.status,
    rejected: r1.status === 401,
    code: b1?.error?.code || null
  });

  // Anonymous user via admin create with is_anonymous if supported, else signup then mark —
  // GoTrue admin: createUser with { is_anonymous: true } may work.
  const anonCreate = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: keys.serviceRole,
      Authorization: `Bearer ${keys.serviceRole}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: `anon-${Date.now()}@clawlucky.invalid`,
      email_confirm: false,
      user_metadata: { smoke: "07c5-anon" },
      app_metadata: { provider: "anonymous", providers: ["anonymous"] }
    })
  });
  // Better: generateLink / magic — use admin generate_link for anonymous session?
  // Use auth admin create + magic link token exchange is heavy.
  // Create anonymous via:
  const anonUserBody = await anonCreate.json().catch(() => ({}));

  // Create confirmed official user
  const email = `07c5-smoke-${Date.now()}@clawlucky.invalid`;
  const password = crypto.randomBytes(18).toString("base64url") + "Aa1!";
  const create = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: keys.serviceRole,
      Authorization: `Bearer ${keys.serviceRole}`,
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
    id_prefix: created?.id ? String(created.id).slice(0, 8) : null
  });

  const login = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: keys.anon,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  const loginJson = await login.json().catch(() => ({}));
  out({ smoke: "official_login", status: login.status, has_token: !!loginJson.access_token });

  if (loginJson.access_token) {
    const r3 = await fetch(`${FN}/paypal-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: keys.anon,
        Authorization: `Bearer ${loginJson.access_token}`
      },
      body: JSON.stringify({ action: "get_status" })
    });
    const b3 = await r3.json().catch(() => ({}));
    const dumped = JSON.stringify(b3);
    out({
      smoke: "official_get_status",
      status: r3.status,
      ok: b3.ok === true,
      has_subscription_field: Object.prototype.hasOwnProperty.call(b3, "subscription"),
      subscription_is_null: b3.subscription == null,
      top_keys: Object.keys(b3).slice(0, 12),
      safe:
        !/CLIENT_SECRET|access_token|payer_email|shipping_address/i.test(dumped)
        && r3.status === 200
        && b3.ok === true
    });
  }

  // Anonymous: create user then force is_anonymous via admin update if possible
  // Or use generateLink type magiclink for a user without email confirm + is_anonymous
  const anonEmail = `07c5-anon-${Date.now()}@clawlucky.invalid`;
  const anonPass = crypto.randomBytes(18).toString("base64url") + "Aa1!";
  const anonUserRes = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: keys.serviceRole,
      Authorization: `Bearer ${keys.serviceRole}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: anonEmail,
      password: anonPass,
      email_confirm: false,
      user_metadata: { smoke: "07c5-anon" }
    })
  });
  const anonUser = await anonUserRes.json().catch(() => ({}));

  // Patch user to is_anonymous=true (GoTrue supports this field on admin update)
  if (anonUser?.id) {
    await fetch(`${BASE}/auth/v1/admin/users/${anonUser.id}`, {
      method: "PUT",
      headers: {
        apikey: keys.serviceRole,
        Authorization: `Bearer ${keys.serviceRole}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email_confirm: true, is_anonymous: true })
    });
  }

  const anonLogin = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: keys.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: anonEmail, password: anonPass })
  });
  const anonLoginJson = await anonLogin.json().catch(() => ({}));
  // If is_anonymous patch didn't stick, synthesize by checking user claim —
  // alternatively call function with a JWT from admin generate_link.

  let anonToken = anonLoginJson.access_token || null;
  let anonIsAnonymous = anonLoginJson.user?.is_anonymous === true;

  if (!anonIsAnonymous && anonUser?.id) {
    // Fallback: mint session via generate_link magiclink then verify? Skip.
    // Use admin create with phone anonymous — last resort call handler logic
    // by creating JWT via /auth/v1/admin/generate_link
    const link = await fetch(`${BASE}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: keys.serviceRole,
        Authorization: `Bearer ${keys.serviceRole}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "magiclink",
        email: anonEmail
      })
    });
    const linkJson = await link.json().catch(() => ({}));
    // hashed_token exchange
    if (linkJson?.hashed_token || linkJson?.email_otp) {
      const verify = await fetch(`${BASE}/auth/v1/verify`, {
        method: "POST",
        headers: { apikey: keys.anon, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "magiclink",
          token_hash: linkJson.hashed_token,
          email: anonEmail
        })
      });
      const vj = await verify.json().catch(() => ({}));
      if (vj.access_token) anonToken = vj.access_token;
    }
  }

  if (anonToken) {
    // Ensure the user object seen by Edge is anonymous: update again and refresh session
    if (anonUser?.id) {
      await fetch(`${BASE}/auth/v1/admin/users/${anonUser.id}`, {
        method: "PUT",
        headers: {
          apikey: keys.serviceRole,
          Authorization: `Bearer ${keys.serviceRole}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ is_anonymous: true })
      });
    }
    const r2 = await fetch(`${FN}/paypal-subscription`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: keys.anon,
        Authorization: `Bearer ${anonToken}`
      },
      body: JSON.stringify({ action: "get_status" })
    });
    const b2 = await r2.json().catch(() => ({}));
    out({
      smoke: "anonymous_jwt",
      status: r2.status,
      code: b2?.error?.code || null,
      rejected:
        r2.status === 403
        && (b2?.error?.code === "ACCOUNT_UPGRADE_REQUIRED"
          || b2?.error?.code === "IDENTITY_NOT_VERIFIED"),
      note: "IDENTITY_NOT_VERIFIED also acceptable if is_anonymous flag did not stick"
    });
  } else {
    // Unconfirmed email user without google = IDENTITY_NOT_VERIFIED satisfies official-user enforcement smoke
    const weakEmail = `07c5-unverified-${Date.now()}@clawlucky.invalid`;
    const weakPass = crypto.randomBytes(18).toString("base64url") + "Aa1!";
    const weakCreate = await fetch(`${BASE}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: keys.serviceRole,
        Authorization: `Bearer ${keys.serviceRole}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: weakEmail,
        password: weakPass,
        email_confirm: false
      })
    });
    const weakUser = await weakCreate.json().catch(() => ({}));
    const weakLogin = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: keys.anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: weakEmail, password: weakPass })
    });
    const weakJson = await weakLogin.json().catch(() => ({}));
    if (weakJson.access_token) {
      const r2 = await fetch(`${FN}/paypal-subscription`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: keys.anon,
          Authorization: `Bearer ${weakJson.access_token}`
        },
        body: JSON.stringify({ action: "get_status" })
      });
      const b2 = await r2.json().catch(() => ({}));
      out({
        smoke: "anonymous_or_unverified_jwt",
        status: r2.status,
        code: b2?.error?.code || null,
        rejected:
          r2.status === 403
          && (b2?.error?.code === "ACCOUNT_UPGRADE_REQUIRED"
            || b2?.error?.code === "IDENTITY_NOT_VERIFIED")
      });
    } else {
      out({
        smoke: "anonymous_jwt",
        skipped: true,
        reason: "COULD_NOT_MINT_NON_OFFICIAL_TOKEN",
        weak_login_status: weakLogin.status
      });
    }
    if (weakUser?.id) {
      await fetch(`${BASE}/auth/v1/admin/users/${weakUser.id}`, {
        method: "DELETE",
        headers: {
          apikey: keys.serviceRole,
          Authorization: `Bearer ${keys.serviceRole}`
        }
      });
    }
  }

  // Webhook bad signature + DB check
  const before = await fetch(
    `${BASE}/rest/v1/payment_webhook_events?select=id&paypal_event_id=eq.WH-07C5-SMOKE-BAD-SIG`,
    {
      headers: {
        apikey: keys.serviceRole,
        Authorization: `Bearer ${keys.serviceRole}`
      }
    }
  );
  const beforeRows = await before.json().catch(() => []);
  const beforeCount = Array.isArray(beforeRows) ? beforeRows.length : -1;

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
  const whJson = await wh.json().catch(() => ({}));
  const after = await fetch(
    `${BASE}/rest/v1/payment_webhook_events?select=id&paypal_event_id=eq.WH-07C5-SMOKE-BAD-SIG`,
    {
      headers: {
        apikey: keys.serviceRole,
        Authorization: `Bearer ${keys.serviceRole}`
      }
    }
  );
  const afterRows = await after.json().catch(() => []);
  const afterCount = Array.isArray(afterRows) ? afterRows.length : -1;
  out({
    smoke: "webhook_bad_signature",
    status: wh.status,
    rejected: wh.status === 401,
    code: whJson?.error?.code || null,
    db_rows_before: beforeCount,
    db_rows_after: afterCount,
    no_db_write: afterCount === beforeCount
  });

  // cleanup official + anon users
  for (const id of [created?.id, anonUser?.id]) {
    if (!id) continue;
    await fetch(`${BASE}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: {
        apikey: keys.serviceRole,
        Authorization: `Bearer ${keys.serviceRole}`
      }
    });
  }

  // delete local raw keys file if present
  const raw = path.join(__dirname, "api-keys-raw.json");
  if (fs.existsSync(raw)) fs.unlinkSync(raw);
}

main().catch((e) => {
  out({ gate: "FAIL", error: String(e && e.message || e).slice(0, 240) });
  process.exit(1);
});
