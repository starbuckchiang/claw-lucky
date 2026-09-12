"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

function getLocalStatus() {
  const stdout = execFileSync("supabase", ["status", "-o", "json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(stdout);
}

function assertLocalUrl(value, label) {
  const url = new URL(value);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), `${label} is not local`);
  return value.replace(/\/$/, "");
}

async function requestJson(url, options) {
  assertLocalUrl(url, "request URL");
  const response = await fetch(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch (_error) {
    body = null;
  }
  return { status: response.status, body };
}

async function main() {
  const status = getLocalStatus();
  const apiUrl = assertLocalUrl(status.API_URL, "API_URL");
  const functionUrl = `${apiUrl}/functions/v1/consent-ops/record`;
  const anonKey = status.ANON_KEY;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  assert.ok(anonKey && serviceRoleKey, "local keys unavailable");

  const testEmail = `web-home-01b1-${crypto.randomUUID()}@example.test`;
  const testPassword = crypto.randomBytes(24).toString("base64url");

  const signup = await requestJson(`${apiUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: testEmail, password: testPassword })
  });
  assert.equal(signup.status, 200, "local signup failed");
  const accessToken = signup.body?.access_token;
  const userId = signup.body?.user?.id;
  assert.ok(accessToken && userId, "local signup did not return a session");

  const validBody = {
    consentScope: "account_upgrade",
    source: "account_upgrade_form",
    idempotencyKey: `local-e2e-${crypto.randomUUID()}`
  };

  const unauthenticated = await requestJson(functionUrl, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(validBody)
  });
  assert.equal(unauthenticated.status, 401);

  const invalidJwt = await requestJson(functionUrl, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: "Bearer invalid-local-token",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(validBody)
  });
  assert.equal(invalidJwt.status, 401);

  const authHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };

  const first = await requestJson(functionUrl, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(validBody)
  });
  assert.equal(first.status, 200);
  assert.equal(first.body?.ok, true);
  assert.equal(first.body?.data?.consentScope, "account_upgrade");
  assert.equal(first.body?.data?.termsVersion, "2026-09-15");
  assert.equal(first.body?.data?.privacyVersion, "2026-09-15");
  assert.ok(Date.parse(first.body?.data?.acceptedAt));
  assert.equal(first.body?.data?.wasExisting, false);

  const retry = await requestJson(functionUrl, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(validBody)
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body?.data?.consentId, first.body?.data?.consentId);
  assert.equal(retry.body?.data?.acceptedAt, first.body?.data?.acceptedAt);
  assert.equal(retry.body?.data?.wasExisting, true);

  const forbiddenFields = {
    user_id: crypto.randomUUID(),
    accepted_at: new Date(0).toISOString(),
    terms_version: "client-value",
    privacy_content_sha256: "0".repeat(64)
  };
  for (const [field, value] of Object.entries(forbiddenFields)) {
    const injected = await requestJson(functionUrl, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ ...validBody, idempotencyKey: `inject-${field}-0001`, [field]: value })
    });
    assert.equal(injected.status, 400, `${field} injection was not rejected`);
  }

  const waiver = await requestJson(functionUrl, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      consentScope: "digital_content_waiver",
      source: "subscription_page",
      idempotencyKey: `waiver-${crypto.randomUUID()}`
    })
  });
  assert.equal(waiver.status, 400);

  const ownerRead = await requestJson(
    `${apiUrl}/rest/v1/user_consents?select=user_id,consent_scope,terms_version,privacy_version,terms_content_sha256,privacy_content_sha256,accepted_at,idempotency_key`,
    { method: "GET", headers: authHeaders }
  );
  assert.equal(ownerRead.status, 200);
  assert.equal(ownerRead.body.length, 1);
  assert.equal(ownerRead.body[0].user_id, userId);
  assert.equal(ownerRead.body[0].idempotency_key, validBody.idempotencyKey);
  assert.equal(ownerRead.body[0].terms_content_sha256, "e47b3fe0d205132087b862d28bdee9cf967b2108547f4319ead4b91a6e55329f");
  assert.equal(ownerRead.body[0].privacy_content_sha256, "dc04b9fd032869a7b5daa03b09427e841e8992e346b0178a703fd9bc4766ce02");

  const serializedResponses = JSON.stringify([
    unauthenticated.body,
    invalidJwt.body,
    first.body,
    retry.body,
    waiver.body
  ]);
  for (const sensitiveValue of [accessToken, testEmail, testPassword, anonKey, serviceRoleKey, userId]) {
    assert.ok(!serializedResponses.includes(sensitiveValue), "sensitive value leaked in API response");
  }

  const result = {
    targetHost: "127.0.0.1",
    unauthenticatedStatus: unauthenticated.status,
    invalidJwtStatus: invalidJwt.status,
    validJwtStatus: first.status,
    jwtUserMatch: true,
    idempotency: true,
    policyVersionHash: true,
    serverTime: true,
    fieldInjectionRejected: true,
    waiverRejected: true,
    responseSensitiveLeakage: false
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`LOCAL_FUNCTION_E2E_FAILED:${error.name}:${error.message}\n`);
  process.exitCode = 1;
});
