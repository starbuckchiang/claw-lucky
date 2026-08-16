"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createAccountMergeService } = require("../account-merge-service");

test("createAccountMergeService: throws if beginMergeApiClient or finalizeMergeApiClient is provided but not a function", () => {
  assert.throws(() => createAccountMergeService({ beginMergeApiClient: "not-a-function" }));
  assert.throws(() => createAccountMergeService({ finalizeMergeApiClient: "not-a-function" }));
});

test("createAccountMergeService: does not throw when both clients are omitted (defaults to the honest not-supported behavior)", () => {
  assert.doesNotThrow(() => createAccountMergeService());
  assert.doesNotThrow(() => createAccountMergeService({}));
});

// --- beginAccountMerge ---

test("beginAccountMerge: rejects an empty/missing email without calling the API client", async () => {
  let called = false;
  const service = createAccountMergeService({ beginMergeApiClient: async () => { called = true; return { ok: true, data: {} }; } });

  const result = await service.beginAccountMerge({ email: "" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_EMAIL");
  assert.equal(called, false);
});

test("beginAccountMerge: with no beginMergeApiClient configured, ALWAYS reports MERGE_NOT_SUPPORTED (never pretends success)", async () => {
  const service = createAccountMergeService();

  const result = await service.beginAccountMerge({ email: "user@example.com" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MERGE_NOT_SUPPORTED");
  assert.equal(result.error.retryable, false);
});

test("beginAccountMerge: success returns the claimToken/expiresAt unchanged", async () => {
  const service = createAccountMergeService({
    beginMergeApiClient: async ({ email }) => ({ ok: true, data: { claimToken: `token-for-${email}`, expiresAt: "2026-01-01T00:15:00.000Z" } })
  });

  const result = await service.beginAccountMerge({ email: "user@example.com" });

  assert.equal(result.ok, true);
  assert.equal(result.data.claimToken, "token-for-user@example.com");
  assert.equal(result.data.expiresAt, "2026-01-01T00:15:00.000Z");
});

test("beginAccountMerge: API failure is normalized as retryable MERGE_BEGIN_FAILED", async () => {
  const service = createAccountMergeService({
    beginMergeApiClient: async () => ({ ok: false, error: { code: "MERGE_BEGIN_FAILED", message: "server error" } })
  });

  const result = await service.beginAccountMerge({ email: "user@example.com" });

  assert.equal(result.ok, false);
  assert.equal(result.error.retryable, true);
});

test("beginAccountMerge: thrown exception (network failure) is normalized as retryable MERGE_BEGIN_FAILED", async () => {
  const service = createAccountMergeService({
    beginMergeApiClient: async () => {
      throw new Error("network down");
    }
  });

  const result = await service.beginAccountMerge({ email: "user@example.com" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MERGE_BEGIN_FAILED");
  assert.equal(result.error.retryable, true);
});

// --- mergeAnonymousIntoExistingAccount (Finalize) ---

test("mergeAnonymousIntoExistingAccount: requires a claimToken (never an idempotencyKey — P-AUTH-05A.1)", async () => {
  const service = createAccountMergeService();

  const result = await service.mergeAnonymousIntoExistingAccount({});

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MERGE_CLAIM_TOKEN_REQUIRED");
  assert.equal(result.error.retryable, true);
});

// The core honesty guarantee (P-AUTH-04.3 requirement 4): with no Finalize
// API client wired in (current production state), this must NEVER report
// success. It must always be the SAME non-retryable "not supported" code,
// never a silent no-op success.
test("mergeAnonymousIntoExistingAccount: with no finalizeMergeApiClient configured, ALWAYS reports MERGE_NOT_SUPPORTED (never pretends success), non-retryable", async () => {
  const service = createAccountMergeService();

  const result = await service.mergeAnonymousIntoExistingAccount({ claimToken: "raw-claim-token" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MERGE_NOT_SUPPORTED");
  assert.equal(result.error.retryable, false);
});

test("mergeAnonymousIntoExistingAccount: success passes through the API's data unchanged, forwarding the claimToken unchanged", async () => {
  let capturedInput = null;
  const service = createAccountMergeService({
    finalizeMergeApiClient: async (input) => {
      capturedInput = input;
      return { ok: true, data: { merged: true, mergeId: `m-${input.claimToken}`, result: { cartMerged: 1 } } };
    }
  });

  const result = await service.mergeAnonymousIntoExistingAccount({ claimToken: "raw-claim-token" });

  assert.equal(result.ok, true);
  assert.equal(result.data.merged, true);
  assert.equal(result.data.mergeId, "m-raw-claim-token");
  assert.deepEqual(capturedInput, { claimToken: "raw-claim-token" });
});

test("mergeAnonymousIntoExistingAccount: never forwards an idempotencyKey/anonymousUserId/existingUserId/emailHash to the API client", async () => {
  let capturedInput = null;
  const service = createAccountMergeService({
    finalizeMergeApiClient: async (input) => {
      capturedInput = input;
      return { ok: true, data: { merged: true } };
    }
  });

  await service.mergeAnonymousIntoExistingAccount({ claimToken: "raw-claim-token" });

  assert.deepEqual(Object.keys(capturedInput), ["claimToken"]);
});

test("mergeAnonymousIntoExistingAccount: API-reported failure with retryable:false is forwarded as non-retryable", async () => {
  const service = createAccountMergeService({
    finalizeMergeApiClient: async () => ({ ok: false, error: { code: "MERGE_CLAIM_INVALID", message: "invalid", retryable: false } })
  });

  const result = await service.mergeAnonymousIntoExistingAccount({ claimToken: "raw-claim-token" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MERGE_CLAIM_INVALID");
  assert.equal(result.error.retryable, false);
});

test("mergeAnonymousIntoExistingAccount: API-reported failure with retryable:true is forwarded as retryable", async () => {
  const service = createAccountMergeService({
    finalizeMergeApiClient: async () => ({ ok: false, error: { code: "MERGE_TIMEOUT", message: "timed out", retryable: true } })
  });

  const result = await service.mergeAnonymousIntoExistingAccount({ claimToken: "raw-claim-token" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MERGE_TIMEOUT");
  assert.equal(result.error.retryable, true);
});

test("mergeAnonymousIntoExistingAccount: thrown exception (network failure) is normalized as retryable MERGE_FAILED", async () => {
  const service = createAccountMergeService({
    finalizeMergeApiClient: async () => {
      throw new Error("network down");
    }
  });

  const result = await service.mergeAnonymousIntoExistingAccount({ claimToken: "raw-claim-token" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "MERGE_FAILED");
  assert.equal(result.error.retryable, true);
});

// Resend (P-AUTH-05B-1 requirement 7): calling with the SAME claimToken
// twice must be safe to retry — this proves the contract shape using a
// fake API client that only performs its one-time side effect once per
// token (matching the RPC's own canonical-key idempotency), never
// duplicating it on a second call with the same token.
test("mergeAnonymousIntoExistingAccount: repeated calls with the SAME claimToken never duplicate the underlying merge side effect", async () => {
  const appliedTokens = new Set();
  let sideEffectCount = 0;

  const service = createAccountMergeService({
    finalizeMergeApiClient: async ({ claimToken }) => {
      if (!appliedTokens.has(claimToken)) {
        appliedTokens.add(claimToken);
        sideEffectCount += 1;
      }
      return { ok: true, data: { merged: true, mergeId: claimToken } };
    }
  });

  const first = await service.mergeAnonymousIntoExistingAccount({ claimToken: "raw-claim-token" });
  const second = await service.mergeAnonymousIntoExistingAccount({ claimToken: "raw-claim-token" });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.data, second.data);
  assert.equal(sideEffectCount, 1);
});
