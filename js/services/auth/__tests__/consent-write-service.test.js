"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createConsentWriteService,
  createConsentOpsInvoker
} = require("../consent-write-service");

function makeClient(invokeImpl) {
  return { functions: { invoke: invokeImpl } };
}

test("recordConsent sends ONLY consentScope/source/idempotencyKey — never user id/versions/times", async () => {
  let captured = null;
  const service = createConsentWriteService({
    invokeFunction: async (path, body) => {
      captured = { path, body };
      return { ok: true, data: {} };
    }
  });

  await service.recordConsent({
    consentScope: "account_upgrade",
    source: "account_upgrade_form",
    idempotencyKey: "key-1234567890"
  });

  assert.equal(captured.path, "record");
  assert.deepEqual(Object.keys(captured.body).sort(), ["consentScope", "idempotencyKey", "source"]);
});

test("invoker: success passthrough", async () => {
  const invoke = createConsentOpsInvoker({
    supabaseClient: makeClient(async () => ({ data: { ok: true, data: { consentId: "c1" } }, error: null }))
  });
  const result = await invoke("record", {});
  assert.equal(result.ok, true);
  assert.equal(result.data.consentId, "c1");
});

test("invoker: server's explicit retryable:false is respected", async () => {
  const invoke = createConsentOpsInvoker({
    supabaseClient: makeClient(async () => ({
      data: null,
      error: { context: { json: async () => ({ ok: false, error: { code: "INVALID_REQUEST", retryable: false } }) } }
    }))
  });
  const result = await invoke("record", {});
  assert.equal(result.ok, false);
  assert.equal(result.error.retryable, false);
});

test("invoker: parsed error WITHOUT boolean retryable defaults to retryable:true", async () => {
  const invoke = createConsentOpsInvoker({
    supabaseClient: makeClient(async () => ({
      data: null,
      error: { context: { json: async () => ({ ok: false, error: { code: "WEIRD" } }) } }
    }))
  });
  const result = await invoke("record", {});
  assert.equal(result.error.retryable, true);
});

test("invoker: unparseable body (proxy error page) defaults to retryable:true", async () => {
  const invoke = createConsentOpsInvoker({
    supabaseClient: makeClient(async () => ({
      data: null,
      error: { context: { json: async () => { throw new Error("not json"); } } }
    }))
  });
  const result = await invoke("record", {});
  assert.equal(result.error.retryable, true);
});

test("invoker: JSON body without our error shape defaults to retryable:true", async () => {
  const invoke = createConsentOpsInvoker({
    supabaseClient: makeClient(async () => ({
      data: null,
      error: { context: { json: async () => ({ someOtherShape: 1 }) } }
    }))
  });
  const result = await invoke("record", {});
  assert.equal(result.error.retryable, true);
});

test("invoker: no HTTP response at all (network error) defaults to retryable:true", async () => {
  const invoke = createConsentOpsInvoker({
    supabaseClient: makeClient(async () => ({ data: null, error: { message: "fetch failed" } }))
  });
  const result = await invoke("record", {});
  assert.equal(result.error.code, "NETWORK_ERROR");
  assert.equal(result.error.retryable, true);
});
