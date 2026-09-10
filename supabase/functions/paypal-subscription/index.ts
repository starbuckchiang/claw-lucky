// Auth-07C.4: PayPal Subscriptions Edge Function.
// verify_jwt=true (see supabase/config.toml). NOT deployed by this task.

import { handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";
import {
  resolveAuthenticatedUser,
  createServiceClient,
} from "../_shared/supabase-clients.ts";
import {
  handlePaypalSubscriptionRequest,
  createSubscriptionRepositoryFromSupabase,
  createPaypalClient,
} from "../_shared/paypal-subscription-handler.ts";

function readPaypalEnv() {
  const env = (Deno.env.get("PAYPAL_ENV") || "sandbox").trim().toLowerCase();
  if (env !== "sandbox") {
    throw new Error("PAYPAL_ENV_NOT_SANDBOX");
  }
  return {
    env,
    clientId: Deno.env.get("PAYPAL_CLIENT_ID") || "",
    clientSecret: Deno.env.get("PAYPAL_CLIENT_SECRET") || "",
    merchantId: Deno.env.get("PAYPAL_MERCHANT_ID") || "",
  };
}

function readPlanEnv() {
  return {
    PAYPAL_PLAN_ID_MONTHLY: Deno.env.get("PAYPAL_PLAN_ID_MONTHLY") || "",
    PAYPAL_PLAN_ID_YEARLY: Deno.env.get("PAYPAL_PLAN_ID_YEARLY") || "",
    PAYPAL_PLAN_ID_MONTHLY_SANDBOX: Deno.env.get("PAYPAL_PLAN_ID_MONTHLY_SANDBOX") || "",
    PAYPAL_PLAN_ID_YEARLY_SANDBOX: Deno.env.get("PAYPAL_PLAN_ID_YEARLY_SANDBOX") || "",
  };
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  const correlationId = crypto.randomUUID();

  if (req.method !== "POST") {
    return jsonResponse(405, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Only POST is supported." },
    }, correlationId, req);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch (_error) {
    return jsonResponse(400, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." },
    }, correlationId, req);
  }

  const user = await resolveAuthenticatedUser(req);

  try {
    const paypalEnv = readPaypalEnv();
    if (!paypalEnv.clientId || !paypalEnv.clientSecret || !paypalEnv.merchantId) {
      return jsonResponse(503, {
        ok: false,
        error: { code: "PAYPAL_CONFIG", message: "PayPal Sandbox secrets are not configured." },
      }, correlationId, req);
    }

    const serviceClient = createServiceClient();
    const result = await handlePaypalSubscriptionRequest({
      body,
      user,
      correlationId,
      deps: {
        subscriptionRepository: createSubscriptionRepositoryFromSupabase(serviceClient),
        paypalClient: createPaypalClient({
          clientId: paypalEnv.clientId,
          clientSecret: paypalEnv.clientSecret,
          env: paypalEnv.env,
        }),
        paypalMerchantId: paypalEnv.merchantId,
        planEnv: readPlanEnv(),
      },
    });

    return jsonResponse(result.statusCode, result.body, correlationId, req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const code = message === "PAYPAL_ENV_NOT_SANDBOX" ? "PAYPAL_CONFIG" : "INTERNAL_ERROR";
    return jsonResponse(code === "PAYPAL_CONFIG" ? 503 : 500, {
      ok: false,
      error: {
        code,
        message: code === "PAYPAL_CONFIG" ? "Live PayPal is not allowed." : "Unexpected error.",
      },
    }, correlationId, req);
  }
});
