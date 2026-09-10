"use strict";

/**
 * Auth-07 / Auth-07C.4: Server-side plan whitelist.
 * Orders v2 one-time amounts + Subscriptions allowlisted PayPal plan IDs
 * (from Edge env — never trust browser-supplied plan_id for pricing).
 */

const PAYPAL_PLANS = Object.freeze({
  monthly: Object.freeze({
    planCode: "monthly",
    name: "月方案",
    amount: "5.00",
    currency: "USD"
  }),
  yearly: Object.freeze({
    planCode: "yearly",
    name: "年方案",
    amount: "48.00",
    currency: "USD"
  })
});

function getPaypalPlan(planCode) {
  const key = String(planCode || "").trim();
  return PAYPAL_PLANS[key] || null;
}

function listPaypalPlanCodes() {
  return Object.keys(PAYPAL_PLANS);
}

/**
 * Resolve allowlisted subscription plan for Edge runtime.
 * Env keys (07C.3): PAYPAL_PLAN_ID_MONTHLY / PAYPAL_PLAN_ID_YEARLY
 * Optional sandbox-suffixed aliases accepted.
 */
function resolveSubscriptionPlanAllowlist(planCode, env = {}) {
  const plan = getPaypalPlan(planCode);
  if (!plan) return null;

  const code = plan.planCode;
  const envKeyPrimary = code === "monthly"
    ? "PAYPAL_PLAN_ID_MONTHLY"
    : "PAYPAL_PLAN_ID_YEARLY";
  const envKeySandbox = `${envKeyPrimary}_SANDBOX`;

  const planId = String(
    env[envKeyPrimary] || env[envKeySandbox] || ""
  ).trim();

  if (!planId) return null;

  return Object.freeze({
    ...plan,
    paypalPlanId: planId
  });
}

function isAllowlistedPaypalPlanId(paypalPlanId, env = {}) {
  const id = String(paypalPlanId || "").trim();
  if (!id) return false;
  for (const code of listPaypalPlanCodes()) {
    const resolved = resolveSubscriptionPlanAllowlist(code, env);
    if (resolved && resolved.paypalPlanId === id) return true;
  }
  return false;
}

function planCodeForPaypalPlanId(paypalPlanId, env = {}) {
  const id = String(paypalPlanId || "").trim();
  if (!id) return null;
  for (const code of listPaypalPlanCodes()) {
    const resolved = resolveSubscriptionPlanAllowlist(code, env);
    if (resolved && resolved.paypalPlanId === id) return code;
  }
  return null;
}

module.exports = {
  PAYPAL_PLANS,
  getPaypalPlan,
  listPaypalPlanCodes,
  resolveSubscriptionPlanAllowlist,
  isAllowlistedPaypalPlanId,
  planCodeForPaypalPlanId
};
