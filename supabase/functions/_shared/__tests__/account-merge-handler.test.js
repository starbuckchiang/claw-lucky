"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  handleBeginMergeRequest,
  handleFinalizeMergeRequest,
  validateBeginRequestShape,
  validateFinalizeRequestShape,
  generateClaimToken,
  classifyFinalizeFailureReason,
  toHttpStatus
} = require("../account-merge-handler");

function anonymousUser(id = "11111111-1111-1111-1111-111111111111") {
  return { id, is_anonymous: true };
}

function officialUser({ id = "22222222-2222-2222-2222-222222222222", email = "existing@example.com" } = {}) {
  return { id, is_anonymous: false, email };
}

function createFakeRepository({ createClaimResult, createClaimError, finalizeResult, finalizeError } = {}) {
  const createClaimCalls = [];
  const finalizeCalls = [];
  return {
    createClaimCalls,
    finalizeCalls,
    async createClaim(input) {
      createClaimCalls.push(input);
      if (createClaimError) throw createClaimError;
      return createClaimResult || { id: "claim-1", expires_at: "2026-01-01T00:15:00.000Z" };
    },
    async finalizeMerge(input) {
      finalizeCalls.push(input);
      if (finalizeError) throw finalizeError;
      return finalizeResult || { id: "req-1", result_json: { cartMerged: 0 } };
    }
  };
}

// --- Begin ---

test("validateBeginRequestShape: requires targetEmail and rejects any other field", () => {
  assert.deepEqual(validateBeginRequestShape({}), ["targetEmail is required."]);
  assert.deepEqual(validateBeginRequestShape({ targetEmail: "a@b.com", anonymousUserId: "x" }), [
    "anonymousUserId is not allowed in the request body."
  ]);
});

test("handleBeginMergeRequest: rejects a non-anonymous caller (session switching guard)", async () => {
  const repository = createFakeRepository();
  const result = await handleBeginMergeRequest({
    body: { targetEmail: "user@example.com" },
    user: officialUser(),
    correlationId: "corr-1",
    deps: { repository }
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, "MERGE_REQUIRES_ANONYMOUS_SESSION");
  assert.equal(repository.createClaimCalls.length, 0);
});

test("handleBeginMergeRequest: rejects when body has forbidden fields (anonymousUserId/email/emailHash/idempotencyKey)", async () => {
  const repository = createFakeRepository();

  for (const forbiddenField of ["anonymousUserId", "existingUserId", "emailHash", "idempotencyKey"]) {
    const result = await handleBeginMergeRequest({
      body: { targetEmail: "user@example.com", [forbiddenField]: "attacker-supplied" },
      user: anonymousUser(),
      correlationId: "corr-1",
      deps: { repository }
    });

    assert.equal(result.statusCode, 400, `expected 400 for forbidden field ${forbiddenField}`);
    assert.equal(result.body.error.code, "INVALID_REQUEST");
  }

  assert.equal(repository.createClaimCalls.length, 0);
});

test("handleBeginMergeRequest: success normalizes+hashes the email, generates a claim token, and returns it exactly once", async () => {
  const repository = createFakeRepository();
  const result = await handleBeginMergeRequest({
    body: { targetEmail: " User@Example.com " },
    user: anonymousUser("anon-1"),
    correlationId: "corr-1",
    deps: { repository }
  });

  assert.equal(result.statusCode, 201);
  assert.equal(result.body.ok, true);
  assert.match(result.body.data.claimToken, /^[0-9a-f]{64}$/);
  assert.equal(result.body.data.expiresAt, "2026-01-01T00:15:00.000Z");

  assert.equal(repository.createClaimCalls.length, 1);
  const call = repository.createClaimCalls[0];
  assert.equal(call.anonymousUserId, "anon-1");
  // Same email, different case/whitespace, must hash the same way as the
  // shared merge-claim-crypto utility (case/whitespace-insensitive).
  const { hashNormalizedEmail } = require("../../../../js/services/auth/merge-claim-crypto");
  assert.equal(call.targetEmailHash, hashNormalizedEmail("user@example.com"));
});

test("handleBeginMergeRequest: never logs or returns the raw claim token anywhere except the one response field", async () => {
  const repository = createFakeRepository();
  const result = await handleBeginMergeRequest({
    body: { targetEmail: "user@example.com" },
    user: anonymousUser(),
    correlationId: "corr-1",
    deps: { repository }
  });

  const rawToken = result.body.data.claimToken;
  const passedToRepository = repository.createClaimCalls[0];
  assert.notEqual(passedToRepository.claimTokenHash, rawToken);
  assert.equal(passedToRepository.claimTokenHash.length, 64);
});

test("handleBeginMergeRequest: repository/RPC failure is normalized to a generic MERGE_BEGIN_FAILED, never leaking the raw error", async () => {
  const repository = createFakeRepository({ createClaimError: new Error("relation account_merge_claims does not exist") });
  const result = await handleBeginMergeRequest({
    body: { targetEmail: "user@example.com" },
    user: anonymousUser(),
    correlationId: "corr-1",
    deps: { repository }
  });

  assert.equal(result.statusCode, 502);
  assert.equal(result.body.error.code, "MERGE_BEGIN_FAILED");
  assert.doesNotMatch(JSON.stringify(result.body), /relation|does not exist/);
});

// --- Finalize ---

test("validateFinalizeRequestShape: requires claimToken and rejects any other field", () => {
  assert.deepEqual(validateFinalizeRequestShape({}), ["claimToken is required."]);
  assert.deepEqual(validateFinalizeRequestShape({ claimToken: "abc", existingUserId: "x" }), [
    "existingUserId is not allowed in the request body."
  ]);
});

test("handleFinalizeMergeRequest: rejects a request body containing anonymousUserId/existingUserId/email/emailHash/idempotencyKey (requirement 1) even alongside a valid claimToken", async () => {
  const repository = createFakeRepository();

  for (const forbiddenField of ["anonymousUserId", "existingUserId", "email", "emailHash", "idempotencyKey"]) {
    const result = await handleFinalizeMergeRequest({
      body: { claimToken: "a".repeat(64), [forbiddenField]: "attacker-supplied" },
      user: officialUser(),
      correlationId: "corr-1",
      deps: { repository }
    });

    assert.equal(result.statusCode, 400, `expected 400 for forbidden field ${forbiddenField}`);
    assert.equal(result.body.error.code, "INVALID_REQUEST");
  }

  assert.equal(repository.finalizeCalls.length, 0);
});

test("handleFinalizeMergeRequest: rejects a still-anonymous caller (session switching guard — must be logged into the existing account)", async () => {
  const repository = createFakeRepository();
  const result = await handleFinalizeMergeRequest({
    body: { claimToken: "a".repeat(64) },
    user: anonymousUser(),
    correlationId: "corr-1",
    deps: { repository }
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, "MERGE_REQUIRES_OFFICIAL_SESSION");
  assert.equal(repository.finalizeCalls.length, 0);
});

test("handleFinalizeMergeRequest: resolves existingUserId/email SOLELY from the verified user object, never from the request body", async () => {
  const repository = createFakeRepository();
  await handleFinalizeMergeRequest({
    body: { claimToken: "a".repeat(64) },
    user: officialUser({ id: "existing-1", email: "Real@Example.com" }),
    correlationId: "corr-1",
    deps: { repository }
  });

  const { hashNormalizedEmail } = require("../../../../js/services/auth/merge-claim-crypto");
  assert.equal(repository.finalizeCalls[0].existingUserId, "existing-1");
  assert.equal(repository.finalizeCalls[0].existingUserEmailHash, hashNormalizedEmail("real@example.com"));
});

test("handleFinalizeMergeRequest: calls finalizeMerge with exactly claimTokenHash/existingUserId/existingUserEmailHash (never an idempotencyKey)", async () => {
  const repository = createFakeRepository();
  await handleFinalizeMergeRequest({
    body: { claimToken: "some-raw-token" },
    user: officialUser(),
    correlationId: "corr-1",
    deps: { repository }
  });

  const call = repository.finalizeCalls[0];
  assert.deepEqual(Object.keys(call).sort(), ["claimTokenHash", "existingUserEmailHash", "existingUserId"]);
});

test("handleFinalizeMergeRequest: success returns merged/mergeId/result", async () => {
  const repository = createFakeRepository({ finalizeResult: { id: "req-42", result_json: { cartMerged: 3 } } });
  const result = await handleFinalizeMergeRequest({
    body: { claimToken: "a".repeat(64) },
    user: officialUser(),
    correlationId: "corr-1",
    deps: { repository }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.data.merged, true);
  assert.equal(result.body.data.mergeId, "req-42");
  assert.deepEqual(result.body.data.result, { cartMerged: 3 });
});

// Requirement 7 / P-AUTH-05B-1 hotfix requirement 1+3: token expired /
// wrong email / garbage-forged token / a genuine data-inconsistency / a
// network-level RPC failure must ALL produce the exact same external
// 409 MERGE_CLAIM_INVALID error shape — this is the core "never leak
// which reason" guarantee for GENUINE failures.
//
// Resend (same claimToken, same official account, after a prior SUCCESS)
// and duplicate/rapid double-click are explicitly NOT part of this list —
// those are legitimate idempotent retries of an ALREADY-VALID claim and
// MUST return 200 with the identical cached mergeId/result (see the
// dedicated tests below), never 409. Lumping them into "failure
// scenarios" was a P-AUTH-05B-1 review documentation error, corrected by
// the P-AUTH-05B-1 hotfix — this comment/test split makes the distinction
// explicit and permanent.
const FINALIZE_FAILURE_SCENARIOS = [
  { name: "claim token expired", error: new Error("finalize_account_merge: claim has expired") },
  { name: "wrong email (email mismatch)", error: new Error("finalize_account_merge: existing account email does not match this claim's target email") },
  { name: "claim not found (garbage/forged token)", error: new Error("finalize_account_merge: claim not found") },
  { name: "data inconsistency (used but no matching request)", error: new Error("finalize_account_merge: claim is marked used but no matching completed request was found (data inconsistency)") },
  { name: "network/RPC failure", error: new Error("fetch failed") }
];

for (const scenario of FINALIZE_FAILURE_SCENARIOS) {
  test(`handleFinalizeMergeRequest: ${scenario.name} -> identical external MERGE_CLAIM_INVALID error (never leaks the reason)`, async () => {
    const repository = createFakeRepository({ finalizeError: scenario.error });
    const result = await handleFinalizeMergeRequest({
      body: { claimToken: "a".repeat(64) },
      user: officialUser(),
      correlationId: "corr-1",
      deps: { repository }
    });

    assert.equal(result.statusCode, 409);
    assert.equal(result.body.error.code, "MERGE_CLAIM_INVALID");
    assert.equal(result.body.error.message, "合併驗證失敗，請重新開始既有帳號登入流程。");
    assert.doesNotMatch(JSON.stringify(result.body), /expired|email|not found|inconsistency|fetch/);
  });
}

test("handleFinalizeMergeRequest: resend with the SAME claimToken after a successful merge returns 200 with the SAME cached result, never 409 (P-AUTH-05B-1 hotfix requirement 1)", async () => {
  const cachedResult = { id: "req-1", result_json: { cartMerged: 2 } };
  const repository = createFakeRepository({ finalizeResult: cachedResult });

  const first = await handleFinalizeMergeRequest({
    body: { claimToken: "a".repeat(64) },
    user: officialUser(),
    correlationId: "corr-1",
    deps: { repository }
  });
  const second = await handleFinalizeMergeRequest({
    body: { claimToken: "a".repeat(64) },
    user: officialUser(),
    correlationId: "corr-2",
    deps: { repository }
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(first.body.data, second.body.data);
});

test("handleFinalizeMergeRequest: duplicate/rapid double-click (two concurrent finalize calls) both resolve with 200, never 409, deferring true dedupe to the RPC's own atomicity (P-AUTH-05B-1 hotfix requirement 1)", async () => {
  const repository = createFakeRepository({ finalizeResult: { id: "req-1", result_json: {} } });

  const [first, second] = await Promise.all([
    handleFinalizeMergeRequest({ body: { claimToken: "a".repeat(64) }, user: officialUser(), correlationId: "corr-1", deps: { repository } }),
    handleFinalizeMergeRequest({ body: { claimToken: "a".repeat(64) }, user: officialUser(), correlationId: "corr-2", deps: { repository } })
  ]);

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(repository.finalizeCalls.length, 2);
});

// P-AUTH-05B-1 hotfix requirement 2: a STATEFUL fake repository that models
// the real `finalize_account_merge` RPC's canonical-key idempotency (the
// merge/points-transfer side effect is only ever "applied" ONCE for a given
// claimTokenHash+existingUserId+existingUserEmailHash triple; every later
// call — sequential resend after a lost response, OR concurrent duplicate
// clicks — returns the SAME cached row without re-applying anything). This
// proves the JS Handler/Repository layer forwards the RPC's result
// faithfully and never introduces its OWN double-execution — it does NOT,
// and cannot, prove Postgres's real `FOR UPDATE` lock/MVCC behavior under
// true concurrency (that remains a 05C Staging Gate concern, see
// review-auth-05B-1-hotfix.md).
function createStatefulFinalizeRepository({ mergeId = "req-1", resultOnFirstApply = { cartMerged: 2, pointsTransferred: 10 } } = {}) {
  let appliedCount = 0;
  let cachedRow = null;
  return {
    get appliedCount() {
      return appliedCount;
    },
    async finalizeMerge(_input) {
      if (cachedRow) {
        return cachedRow;
      }
      appliedCount += 1;
      cachedRow = { id: mergeId, result_json: resultOnFirstApply };
      return cachedRow;
    }
  };
}

test("handleFinalizeMergeRequest: resend after the first response was lost (sequential retries) applies the merge/points transfer exactly ONCE", async () => {
  const repository = createStatefulFinalizeRepository();

  const first = await handleFinalizeMergeRequest({ body: { claimToken: "a".repeat(64) }, user: officialUser(), correlationId: "corr-1", deps: { repository } });
  const second = await handleFinalizeMergeRequest({ body: { claimToken: "a".repeat(64) }, user: officialUser(), correlationId: "corr-2", deps: { repository } });
  const third = await handleFinalizeMergeRequest({ body: { claimToken: "a".repeat(64) }, user: officialUser(), correlationId: "corr-3", deps: { repository } });

  for (const result of [first, second, third]) {
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.mergeId, "req-1");
    assert.deepEqual(result.body.data.result, { cartMerged: 2, pointsTransferred: 10 });
  }
  assert.equal(repository.appliedCount, 1);
});

test("handleFinalizeMergeRequest: resend after concurrent duplicate clicks applies the merge/points transfer exactly ONCE", async () => {
  const repository = createStatefulFinalizeRepository();

  const results = await Promise.all([
    handleFinalizeMergeRequest({ body: { claimToken: "a".repeat(64) }, user: officialUser(), correlationId: "corr-1", deps: { repository } }),
    handleFinalizeMergeRequest({ body: { claimToken: "a".repeat(64) }, user: officialUser(), correlationId: "corr-2", deps: { repository } }),
    handleFinalizeMergeRequest({ body: { claimToken: "a".repeat(64) }, user: officialUser(), correlationId: "corr-3", deps: { repository } })
  ]);

  for (const result of results) {
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.data.mergeId, "req-1");
  }
  // NOTE: this fake repository is single-threaded (Node's event loop), so
  // this proves the Handler itself never adds a redundant call/mutation on
  // top of whatever the repository/RPC returns — it does NOT simulate a
  // true multi-connection Postgres race (see the 05C note above).
  assert.equal(repository.appliedCount, 1);
});

// P-AUTH-05B-1 hotfix requirement 6: classifyFinalizeFailureReason() must
// only ever return one of a small FIXED allowlist of reason codes — never
// the raw message itself — so a caller can safely log it.
test("classifyFinalizeFailureReason: maps known failure messages to a fixed allowlisted reason code", () => {
  assert.equal(classifyFinalizeFailureReason(new Error("finalize_account_merge: claim not found")), "CLAIM_NOT_FOUND");
  assert.equal(classifyFinalizeFailureReason(new Error("finalize_account_merge: claim has expired")), "CLAIM_EXPIRED");
  assert.equal(classifyFinalizeFailureReason(new Error("existing account email does not match this claim's target email")), "EMAIL_MISMATCH");
  assert.equal(classifyFinalizeFailureReason(new Error("... (data inconsistency)")), "DATA_INCONSISTENCY");
  assert.equal(classifyFinalizeFailureReason(new Error("fetch failed")), "UNKNOWN");
  assert.equal(classifyFinalizeFailureReason({}), "UNKNOWN");
});

// P-AUTH-05B-1 hotfix requirement 6: server logs must NEVER contain
// claimToken, token hash, email, Authorization, or the full request body —
// only correlationId + an allowlisted error code. Deliberately construct
// error messages that CONTAIN a fake email/claimToken-shaped string (as if
// a future bug/dependency put PII into `.message`) and prove the actual
// `console.error` output still never leaks it — defense in depth, not just
// "we didn't happen to log it in the happy path".
test("handleFinalizeMergeRequest: console.error output never leaks the raw error message, even when that message contains an email/claimToken-shaped string", async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);

  try {
    const repository = createFakeRepository({
      finalizeError: new Error("claim not found for token abcdef0123456789 (attacker@example.com)")
    });
    const result = await handleFinalizeMergeRequest({
      body: { claimToken: "a".repeat(64) },
      user: officialUser(),
      correlationId: "corr-log-1",
      deps: { repository }
    });

    assert.equal(result.statusCode, 409);
    assert.equal(logged.length, 1);
    const parsed = JSON.parse(logged[0]);
    assert.equal(parsed.correlationId, "corr-log-1");
    assert.equal(parsed.reason, "CLAIM_NOT_FOUND");
    assert.deepEqual(Object.keys(parsed).sort(), ["correlationId", "event", "level", "reason"]);
    assert.doesNotMatch(logged[0], /attacker@example\.com|abcdef0123456789/);
  } finally {
    console.error = originalConsoleError;
  }
});

test("handleBeginMergeRequest: console.error output never leaks the raw error message on an RPC failure", async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);

  try {
    const repository = createFakeRepository({
      createClaimError: new Error("duplicate key value violates unique constraint for victim@example.com")
    });
    const result = await handleBeginMergeRequest({
      body: { targetEmail: "user@example.com" },
      user: anonymousUser(),
      correlationId: "corr-log-2",
      deps: { repository }
    });

    assert.equal(result.statusCode, 502);
    assert.equal(logged.length, 1);
    const parsed = JSON.parse(logged[0]);
    assert.equal(parsed.correlationId, "corr-log-2");
    assert.equal(parsed.reason, "RPC_ERROR");
    assert.deepEqual(Object.keys(parsed).sort(), ["correlationId", "event", "level", "reason"]);
    assert.doesNotMatch(logged[0], /victim@example\.com|unique constraint/);
  } finally {
    console.error = originalConsoleError;
  }
});

test("generateClaimToken: produces a fresh, high-entropy (256-bit) token on every call", () => {
  const a = generateClaimToken();
  const b = generateClaimToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("toHttpStatus: maps known codes and falls back to 500", () => {
  assert.equal(toHttpStatus("MERGE_REQUIRES_ANONYMOUS_SESSION"), 403);
  assert.equal(toHttpStatus("MERGE_CLAIM_INVALID"), 409);
  assert.equal(toHttpStatus("SOMETHING_UNKNOWN"), 500);
});
