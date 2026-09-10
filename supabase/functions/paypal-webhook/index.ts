// Auth-07: PayPal webhook (server-to-server). verify_jwt=false in config.toml
// but signature verification is MANDATORY inside this function.
// Uses RAW request body for PayPal verify API (never re-stringify).
// NOT deployed by this task. No browser CORS.

import { createServiceClient } from "../_shared/supabase-clients.ts";
import {
  handlePaypalWebhookRequest,
  createWebhookRepositoryFromSupabase,
} from "../_shared/paypal-webhook-handler.ts";
import { createPaypalClient } from "../_shared/lib/paypal-client.ts";

function jsonNoCors(statusCode: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}

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
    webhookId: Deno.env.get("PAYPAL_WEBHOOK_ID") || "",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "POST") {
    return jsonNoCors(405, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Only POST is supported." },
    });
  }

  // CRITICAL: keep original bytes/text for signature verification.
  const rawBody = await req.text();

  try {
    const paypalEnv = readPaypalEnv();
    if (
      !paypalEnv.clientId
      || !paypalEnv.clientSecret
      || !paypalEnv.merchantId
      || !paypalEnv.webhookId
    ) {
      return jsonNoCors(503, {
        ok: false,
        error: { code: "PAYPAL_CONFIG", message: "PayPal Sandbox webhook secrets are not configured." },
      });
    }

    const serviceClient = createServiceClient();
    const planEnv = {
      PAYPAL_PLAN_ID_MONTHLY: Deno.env.get("PAYPAL_PLAN_ID_MONTHLY") || "",
      PAYPAL_PLAN_ID_YEARLY: Deno.env.get("PAYPAL_PLAN_ID_YEARLY") || "",
      PAYPAL_PLAN_ID_MONTHLY_SANDBOX: Deno.env.get("PAYPAL_PLAN_ID_MONTHLY_SANDBOX") || "",
      PAYPAL_PLAN_ID_YEARLY_SANDBOX: Deno.env.get("PAYPAL_PLAN_ID_YEARLY_SANDBOX") || "",
    };
    const result = await handlePaypalWebhookRequest({
      rawBody,
      headers: req.headers,
      deps: {
        paypalClient: createPaypalClient({
          clientId: paypalEnv.clientId,
          clientSecret: paypalEnv.clientSecret,
          env: paypalEnv.env,
        }),
        paypalWebhookId: paypalEnv.webhookId,
        paypalMerchantId: paypalEnv.merchantId,
        planEnv,
        webhookRepository: createWebhookRepositoryFromSupabase(serviceClient),
      },
    });

    return jsonNoCors(result.statusCode, result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const code = message === "PAYPAL_ENV_NOT_SANDBOX" ? "PAYPAL_CONFIG" : "INTERNAL_ERROR";
    return jsonNoCors(code === "PAYPAL_CONFIG" ? 503 : 500, {
      ok: false,
      error: {
        code,
        message: code === "PAYPAL_CONFIG" ? "Live PayPal is not allowed." : "Unexpected error.",
      },
    });
  }
});
