"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  TERMS_CONTENT_SHA256,
  PRIVACY_CONTENT_SHA256,
  canonicalizePolicyText
} = require("../policy-versions");

const termsConsent = require("../terms-consent");

const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");
const TERMS_DOC = path.join(REPO_ROOT, "docs", "policies", "claw-lucky-terms-v2026-09-15.md");
const PRIVACY_DOC = path.join(REPO_ROOT, "docs", "policies", "claw-lucky-privacy-v2026-09-15.md");

function hashDoc(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return crypto.createHash("sha256").update(canonicalizePolicyText(raw), "utf8").digest("hex");
}

test("unified policy versions are 2026-09-15 for both terms and privacy", () => {
  assert.equal(CURRENT_TERMS_VERSION, "2026-09-15");
  assert.equal(CURRENT_PRIVACY_VERSION, "2026-09-15");
});

test("terms-consent.js version constants stay in sync with policy-versions.js", () => {
  assert.equal(termsConsent.CURRENT_TERMS_VERSION, CURRENT_TERMS_VERSION);
  assert.equal(termsConsent.CURRENT_PRIVACY_VERSION, CURRENT_PRIVACY_VERSION);
});

test("terms content hash is reproducible from the canonical terms document", () => {
  assert.equal(hashDoc(TERMS_DOC), TERMS_CONTENT_SHA256);
});

test("privacy content hash is reproducible from the canonical privacy document", () => {
  assert.equal(hashDoc(PRIVACY_DOC), PRIVACY_CONTENT_SHA256);
});

test("hashes are well-formed sha256 hex and distinct", () => {
  assert.match(TERMS_CONTENT_SHA256, /^[0-9a-f]{64}$/);
  assert.match(PRIVACY_CONTENT_SHA256, /^[0-9a-f]{64}$/);
  assert.notEqual(TERMS_CONTENT_SHA256, PRIVACY_CONTENT_SHA256);
});

test("canonicalization normalizes CRLF to LF so hashes are line-ending independent", () => {
  const lf = "line1\nline2\n";
  const crlf = "line1\r\nline2\r\n";
  assert.equal(canonicalizePolicyText(crlf), lf);
  const h1 = crypto.createHash("sha256").update(canonicalizePolicyText(lf), "utf8").digest("hex");
  const h2 = crypto.createHash("sha256").update(canonicalizePolicyText(crlf), "utf8").digest("hex");
  assert.equal(h1, h2);
});

test("canonical documents contain Subscriptions API copy, never Orders v2 one-time payment copy", () => {
  const termsText = fs.readFileSync(TERMS_DOC, "utf8");
  assert.match(termsText, /PayPal Subscriptions API/);
  assert.match(termsText, /自動續訂/);
  assert.doesNotMatch(termsText, /Orders v2/);
  assert.doesNotMatch(termsText, /一次性付款/);
});

test("canonical documents carry the unified display date 2026年9月15日", () => {
  for (const doc of [TERMS_DOC, PRIVACY_DOC]) {
    const text = fs.readFileSync(doc, "utf8");
    assert.match(text, /生效日期：2026年9月15日/);
    assert.match(text, /版本：2026-09-15/);
  }
});

test("terms.html/privacy.html display the unified effective date and subscription copy", () => {
  const termsHtml = fs.readFileSync(path.join(REPO_ROOT, "terms.html"), "utf8");
  const privacyHtml = fs.readFileSync(path.join(REPO_ROOT, "privacy.html"), "utf8");

  assert.match(termsHtml, /生效日期：2026年9月15日/);
  assert.match(privacyHtml, /生效日期：2026年9月15日/);

  // Payment copy must describe PayPal Subscriptions API auto-renewal —
  // never Orders v2 one-time payment.
  assert.match(termsHtml, /PayPal Subscriptions API/);
  assert.match(termsHtml, /取消後仍可使用至已付款期間結束/);
  assert.match(termsHtml, /付款 Webhook 為準/);
  assert.doesNotMatch(termsHtml, /Orders v2/);
  assert.doesNotMatch(termsHtml, /一次性付款/);
});

test("subscription checkboxes are present and not pre-checked; frontend uses createSubscription, never createOrder", () => {
  const subscriptionHtml = fs.readFileSync(path.join(REPO_ROOT, "subscription.html"), "utf8");
  const entryJs = fs.readFileSync(path.join(REPO_ROOT, "js", "pages", "subscription-entry.js"), "utf8");

  const termsCheckbox = subscriptionHtml.match(/<input type="checkbox" id="termsConsentCheckbox"[^>]*>/);
  const paymentCheckbox = subscriptionHtml.match(/<input type="checkbox" id="paymentConsentCheckbox"[^>]*>/);
  assert.ok(termsCheckbox);
  assert.ok(paymentCheckbox);
  assert.doesNotMatch(termsCheckbox[0], /\bchecked\b/);
  assert.doesNotMatch(paymentCheckbox[0], /\bchecked\b/);

  assert.match(entryJs, /actions\.subscription\.create|handlers\.createSubscription/);
  assert.doesNotMatch(entryJs, /actions\.order\.create|\bcreateOrder\b/);
});
