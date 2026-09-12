"use strict";

/**
 * Consent Write Service (WEB-HOME-01A) — browser client for consent-ops
 *
 * Calls POST /functions/v1/consent-ops/record via supabase-js
 * `functions.invoke()`. The browser sends ONLY
 * { consentScope, source, idempotencyKey } — user_id / accepted_at /
 * versions / hashes are all decided server-side.
 *
 * Error normalization ports the invokeWalletOpsFunction pattern from
 * js/api.js verbatim (P-AUTH-05B-2A.1): `retryable:false` ONLY when a
 * successfully-parsed `{error:{retryable:false}}` came back from our own
 * handler; every other case (parse failure, unrecognized shape, no HTTP
 * response at all) defaults to retryable:true so the caller keeps its
 * idempotency key alive for a safe resend.
 *
 * Dual-export (Node CJS for tests + window for browser <script>).
 */

function createConsentWriteService({ invokeFunction } = {}) {
  if (typeof invokeFunction !== "function") {
    throw new Error("createConsentWriteService requires invokeFunction.");
  }

  return {
    async recordConsent({ consentScope, source, idempotencyKey } = {}) {
      return invokeFunction("record", { consentScope, source, idempotencyKey });
    }
  };
}

// Default invoker used by pages: wraps supabase-js functions.invoke with
// the standard retryable-classification rules.
function createConsentOpsInvoker({ supabaseClient } = {}) {
  if (!supabaseClient?.functions?.invoke) {
    throw new Error("createConsentOpsInvoker requires a supabaseClient with functions.invoke().");
  }

  return async function invokeConsentOpsFunction(path, body) {
    const { data, error } = await supabaseClient.functions.invoke(`consent-ops/${path}`, { body });

    if (error) {
      if (error.context) {
        let parsedBody = null;
        try {
          parsedBody = await error.context.json();
        } catch (_parseError) {
          // Unparseable body (proxy error page etc.) — unknown outcome,
          // always retryable.
          return {
            ok: false,
            error: { code: "CONSENT_REQUEST_FAILED", message: "同意紀錄儲存失敗，請再試一次。", retryable: true }
          };
        }

        const serverError = parsedBody && typeof parsedBody === "object" ? parsedBody.error : null;

        if (serverError && typeof serverError === "object") {
          const retryable = typeof serverError.retryable === "boolean" ? serverError.retryable : true;
          return { ok: false, error: { ...serverError, retryable } };
        }

        return {
          ok: false,
          error: { code: "CONSENT_REQUEST_FAILED", message: "同意紀錄儲存失敗，請再試一次。", retryable: true }
        };
      }

      // No HTTP response at all — network-layer failure, always retryable.
      return {
        ok: false,
        error: { code: "NETWORK_ERROR", message: "網路連線失敗，請稍後再試一次。", retryable: true }
      };
    }

    return data;
  };
}

const consentWriteServiceApi = {
  createConsentWriteService,
  createConsentOpsInvoker
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = consentWriteServiceApi;
}

if (typeof window !== "undefined") {
  window.ConsentWriteService = consentWriteServiceApi;
}
