"use strict";

/**
 * Account Merge Service (P-AUTH-04.3, revised P-AUTH-05B-1)
 *
 * specs/003-spec-auth-subscription.md Section 7 (Existing Account Login)
 * requires that, once an Anonymous User logs into a DIFFERENT, already
 * existing official account, that official account's Cart / Mascot /
 * Gift / Points / Subscription data is merged with the anonymous user's
 * own data (dedupe Cart/Mascot/Gift, Points via a transaction record
 * rather than a raw sum, at most one active Subscription).
 *
 * P-AUTH-05B-1 wires this up for real, against the Begin/Finalize
 * contract in docs/0-review/review-auth/review-auth-05A.1-hotfix.md:
 * `supabase/functions/account-merge/{begin,finalize}` (implementation not
 * deployed by this task — see review-auth-05B-1.md).
 *
 * Contract (claimToken-based, NOT idempotencyKey-based):
 *   beginMergeApiClient({ email }) => Promise<{
 *     ok: true, data: { claimToken: string, expiresAt: string }
 *   } | { ok: false, error: { code, message } }>
 *
 *   finalizeMergeApiClient({ claimToken }) => Promise<{
 *     ok: true, data: { merged: boolean, mergeId: string, result: object }
 *   } | { ok: false, error: { code, message, retryable } }>
 *
 * Hotfix (P-AUTH-05A.1): the idempotency key is no longer a concept this
 * module (or its caller) ever computes/forwards — the database computes
 * its own canonical key internally from the claim + the caller's own
 * verified existing-account id (see `finalize_account_merge`'s 3-arg
 * signature). This service's ONLY job now is to pass the `claimToken` —
 * obtained once from `beginAccountMerge()` and held in the page's own
 * in-memory state (never localStorage/sessionStorage, per requirement 3)
 * — through to Finalize unchanged.
 *
 * `beginMergeApiClient`/`finalizeMergeApiClient` are intentionally NOT the
 * browser's raw Supabase client / a raw RPC call — per this codebase's
 * Supabase rules, a merge across two different Auth UUIDs must never be
 * performed by the browser with the anon key, and the service-role key
 * this merge's RPCs require must NEVER reach the browser. Both are
 * expected to be thin wrappers around
 * `window.supabaseClient.functions.invoke("account-merge/begin"|
 * "account-merge/finalize", { body })` — an authenticated HTTP call to the
 * Edge Function, which resolves identity server-side and invokes the
 * SECURITY DEFINER RPCs itself.
 */

function errorDto(code, message, { retryable = false, rawMessage = null } = {}) {
  return {
    ok: false,
    error: {
      code: String(code),
      message: String(message),
      retryable: Boolean(retryable),
      rawMessage: rawMessage || null
    }
  };
}

function createAccountMergeService({ beginMergeApiClient = null, finalizeMergeApiClient = null } = {}) {
  if (beginMergeApiClient !== null && typeof beginMergeApiClient !== "function") {
    throw new Error("createAccountMergeService: beginMergeApiClient, when provided, must be a function.");
  }

  if (finalizeMergeApiClient !== null && typeof finalizeMergeApiClient !== "function") {
    throw new Error("createAccountMergeService: finalizeMergeApiClient, when provided, must be a function.");
  }

  // Begin Merge (spec Section 7): must be called BEFORE the Existing
  // Account Login OTP is sent (requirement 3), while the caller still
  // holds its ANONYMOUS session — the resulting `claimToken` is the only
  // thing carried across the login round trip, and must be held ONLY in
  // page memory (never localStorage/sessionStorage).
  async function beginAccountMerge({ email } = {}) {
    const normalizedEmail = String(email || "").trim();

    if (!normalizedEmail) {
      return errorDto("INVALID_EMAIL", "請輸入正確的 Email 格式。", { retryable: false });
    }

    if (typeof beginMergeApiClient !== "function") {
      return errorDto(
        "MERGE_NOT_SUPPORTED",
        "目前尚未支援自動合併匿名身份的資料，請改用「訂閱」按鈕以此帳號手動繼續。",
        { retryable: false }
      );
    }

    let result;
    try {
      result = await beginMergeApiClient({ email: normalizedEmail });
    } catch (error) {
      return errorDto(
        "MERGE_BEGIN_FAILED",
        "無法建立合併請求，請稍後再試一次。",
        { retryable: true, rawMessage: error?.message || null }
      );
    }

    if (!result?.ok) {
      return errorDto(
        result?.error?.code || "MERGE_BEGIN_FAILED",
        "無法建立合併請求，請稍後再試一次。",
        { retryable: true, rawMessage: result?.error?.message || null }
      );
    }

    return {
      ok: true,
      data: result.data
    };
  }

  // Finalize Merge: `claimToken` is the RAW token returned by
  // `beginAccountMerge()` (never its hash — the Edge Function hashes it
  // server-side before ever touching the database). NEVER accepts or
  // forwards an idempotencyKey/anonymousUserId/existingUserId/emailHash —
  // those concepts no longer exist at this layer (P-AUTH-05A.1).
  async function mergeAnonymousIntoExistingAccount({ claimToken } = {}) {
    const normalizedToken = String(claimToken || "").trim();

    if (!normalizedToken) {
      return errorDto(
        "MERGE_CLAIM_TOKEN_REQUIRED",
        "合併資料時發生內部錯誤，請重新整理頁面後再試一次。",
        { retryable: true }
      );
    }

    // No merge Edge Function configured yet in this deployment. Report
    // this honestly instead of pretending the merge happened. `retryable:
    // false` because retrying right now cannot help — this requires new
    // backend infrastructure, not a transient failure.
    if (typeof finalizeMergeApiClient !== "function") {
      return errorDto(
        "MERGE_NOT_SUPPORTED",
        "目前尚未支援自動合併匿名身份的資料，請改用「訂閱」按鈕以此帳號手動繼續。",
        { retryable: false }
      );
    }

    let result;
    try {
      result = await finalizeMergeApiClient({ claimToken: normalizedToken });
    } catch (error) {
      return errorDto(
        "MERGE_FAILED",
        "合併資料時發生錯誤，請稍後再試一次。",
        { retryable: true, rawMessage: error?.message || null }
      );
    }

    if (!result?.ok) {
      const code = result?.error?.code || "MERGE_FAILED";
      const retryable = result?.error?.retryable !== false;
      return errorDto(code, "合併資料時發生錯誤，請稍後再試一次。", {
        retryable,
        rawMessage: result?.error?.message || null
      });
    }

    return {
      ok: true,
      data: result.data || { merged: true }
    };
  }

  return {
    beginAccountMerge,
    mergeAnonymousIntoExistingAccount
  };
}

const accountMergeServiceApi = {
  createAccountMergeService
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = accountMergeServiceApi;
}

if (typeof window !== "undefined") {
  window.AccountMergeService = accountMergeServiceApi;
}
