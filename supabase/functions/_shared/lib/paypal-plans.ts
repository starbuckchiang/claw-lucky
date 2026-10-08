// ESM twin of paypal-plans.js — Auth-07 / Auth-07C.4 server plan whitelist.

export const PAYPAL_PLANS = Object.freeze({
  monthly: Object.freeze({
    planCode: "monthly",
    name: "月方案",
    amount: "5.00",
    currency: "USD",
  }),
  yearly: Object.freeze({
    planCode: "yearly",
    name: "年方案",
    amount: "48.00",
    currency: "USD",
  }),
});

export function getPaypalPlan(planCode: string) {
  const key = String(planCode || "").trim();
  return (PAYPAL_PLANS as Record<string, (typeof PAYPAL_PLANS)["monthly"]>)[key] || null;
}

export function listPaypalPlanCodes() {
  return Object.keys(PAYPAL_PLANS);
}

export function resolveSubscriptionPlanAllowlist(
  planCode: string,
  // deno-lint-ignore no-explicit-any
  env: Record<string, string | undefined> | any = {},
) {
  const plan = getPaypalPlan(planCode);
  if (!plan) return null;

  const code = plan.planCode;
  const envKeyPrimary = code === "monthly"
    ? "PAYPAL_PLAN_ID_MONTHLY"
    : "PAYPAL_PLAN_ID_YEARLY";
  const envKeySandbox = `${envKeyPrimary}_SANDBOX`;

  // Live MUST use the bare (non-suffixed) var only -- never silently fall
  // back to a sandbox-suffixed plan id while charging against the Live API.
  // Sandbox prefers its own suffixed var, falling back to the bare var only
  // for backward compatibility with deployments that never added the
  // suffixed alias (the bare var historically held the Sandbox plan id).
  const isLive = String(env?.PAYPAL_ENV || "sandbox").trim().toLowerCase() === "live";
  const planId = String(
    isLive ? (env[envKeyPrimary] || "") : (env[envKeySandbox] || env[envKeyPrimary] || ""),
  ).trim();

  if (!planId) return null;

  return Object.freeze({
    ...plan,
    paypalPlanId: planId,
  });
}

export function isAllowlistedPaypalPlanId(
  paypalPlanId: string,
  // deno-lint-ignore no-explicit-any
  env: Record<string, string | undefined> | any = {},
) {
  const id = String(paypalPlanId || "").trim();
  if (!id) return false;
  for (const code of listPaypalPlanCodes()) {
    const resolved = resolveSubscriptionPlanAllowlist(code, env);
    if (resolved && resolved.paypalPlanId === id) return true;
  }
  return false;
}

export function planCodeForPaypalPlanId(
  paypalPlanId: string,
  // deno-lint-ignore no-explicit-any
  env: Record<string, string | undefined> | any = {},
) {
  const id = String(paypalPlanId || "").trim();
  if (!id) return null;
  for (const code of listPaypalPlanCodes()) {
    const resolved = resolveSubscriptionPlanAllowlist(code, env);
    if (resolved && resolved.paypalPlanId === id) return code;
  }
  return null;
}
