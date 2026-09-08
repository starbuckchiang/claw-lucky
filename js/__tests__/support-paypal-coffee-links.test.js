"use strict";

/**
 * Support-01: static shape checks for PayPal one-time coffee support links.
 * Reads support.html only — no network, no PayPal API, no secrets.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const HTML = fs.readFileSync(path.join(ROOT, "support.html"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "css", "pages", "support.css"), "utf8");

const EXPECTED_LINKS = [
  { amount: "3", href: "https://www.paypal.com/ncp/payment/JQ25F3VT4PZFN" },
  { amount: "5", href: "https://www.paypal.com/ncp/payment/BHAZGD34AZ65C" },
  { amount: "10", href: "https://www.paypal.com/ncp/payment/FDKVMN84X84PW" }
];

function extractPaypalSupportAnchors(html) {
  const anchors = [];
  const re = /<a\b([^>]*)>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const attrs = match[1];
    if (!/\bsupport-paypal-btn\b/.test(attrs) && !/使用 PayPal 支持 USD/.test(html.slice(match.index, match.index + 400))) {
      // Prefer class marker; fall through if aria/label nearby in opening tag context.
    }
    if (!/\bsupport-paypal-btn\b/.test(attrs)) continue;

    const href = (attrs.match(/\bhref\s*=\s*"([^"]*)"/i) || [])[1] || "";
    const target = (attrs.match(/\btarget\s*=\s*"([^"]*)"/i) || [])[1] || "";
    const rel = (attrs.match(/\brel\s*=\s*"([^"]*)"/i) || [])[1] || "";
    const aria = (attrs.match(/\baria-label\s*=\s*"([^"]*)"/i) || [])[1] || "";
    const amount = (attrs.match(/\bdata-support-amount\s*=\s*"([^"]*)"/i) || [])[1] || "";
    anchors.push({ href, target, rel, aria, amount });
  }
  return anchors;
}

test("support.html loads required one-time support disclosure copy", () => {
  assert.match(HTML, /請我們喝杯咖啡/);
  assert.match(HTML, /單次支持/);
  assert.match(HTML, /不會自動續訂/);
  assert.match(HTML, /不包含月訂或年訂權益/);
  assert.doesNotMatch(HTML, /捐款|慈善/);
  assert.doesNotMatch(HTML, /訂閱權益已啟用/);
  // Must not claim payment succeeded merely by opening PayPal.
  assert.match(HTML, /開啟付款頁不代表已付款成功/);
  assert.equal((HTML.match(/付款完成/g) || []).length, 0);
});

test("support.html shows three coffee amounts and labels", () => {
  assert.match(HTML, /小杯咖啡/);
  assert.match(HTML, /暖暖咖啡/);
  assert.match(HTML, /大杯咖啡/);
  assert.match(HTML, /USD 3/);
  assert.match(HTML, /USD 5/);
  assert.match(HTML, /USD 10/);
  assert.match(HTML, /請一杯小咖啡/);
  assert.match(HTML, /送上一杯暖暖咖啡/);
  assert.match(HTML, /請我們喝一杯大咖啡/);
});

test("support.html has exactly three distinct PayPal HTTPS payment links", () => {
  const anchors = extractPaypalSupportAnchors(HTML);
  assert.equal(anchors.length, 3);

  const hrefs = anchors.map((a) => a.href);
  assert.equal(new Set(hrefs).size, 3);

  for (const expected of EXPECTED_LINKS) {
    const found = anchors.find((a) => a.amount === expected.amount);
    assert.ok(found, `missing amount ${expected.amount}`);
    assert.equal(found.href, expected.href);
    assert.match(found.href, /^https:\/\/www\.paypal\.com\/ncp\/payment\/[A-Z0-9]+$/);
  }

  assert.doesNotMatch(HTML, /href\s*=\s*""/);
  assert.doesNotMatch(HTML, /href\s*=\s*"#"/);
  assert.doesNotMatch(HTML, /javascript:/i);
  assert.doesNotMatch(HTML, /paypal\.com\/ncp\/payment\/(?:TODO|PLACEHOLDER|xxx)/i);
  assert.doesNotMatch(HTML, /sandbox\.paypal\.com/i);
});

test("support.html PayPal buttons use safe new-tab attributes and distinct accessible names", () => {
  const anchors = extractPaypalSupportAnchors(HTML);
  assert.equal(anchors.length, 3);

  for (const anchor of anchors) {
    assert.equal(anchor.target, "_blank");
    const relParts = new Set(anchor.rel.split(/\s+/).filter(Boolean));
    assert.ok(relParts.has("noopener"));
    assert.ok(relParts.has("noreferrer"));
    assert.match(anchor.aria, /使用 PayPal 支持 USD \d+/);
    assert.match(anchor.aria, /新分頁/);
  }

  const ariaLabels = anchors.map((a) => a.aria);
  assert.equal(new Set(ariaLabels).size, 3);
});

test("support.html does not load PayPal SDK or inline scripts", () => {
  assert.doesNotMatch(HTML, /paypal\.com\/sdk/i);
  assert.doesNotMatch(HTML, /<script\b/i);
  assert.doesNotMatch(HTML, /\son\w+\s*=/);
});

test("support.css includes hover and focus-visible styles for support buttons", () => {
  assert.match(CSS, /\.btn-support:hover/);
  assert.match(CSS, /\.btn-support:focus-visible/);
  assert.match(CSS, /\.btn-support:active/);
});
