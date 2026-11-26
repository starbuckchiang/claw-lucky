"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const page = fs.readFileSync(path.resolve(__dirname, "../../../pages/subscription-entry.js"), "utf8");
const gift = page.slice(
  page.indexOf("const MPG_GIFT_URL"),
  page.indexOf("async function readChosenSubscription")
);

test("gift shipping card payment is a one-time production MPG charge", () => {
  assert.match(gift, /https:\/\/core\.newebpay\.com\/MPG\/mpg_gateway/);
  assert.match(gift, /data\.amount !== 44/);
  assert.match(gift, /body: \{\}/);
  assert.match(gift, /MerchantID", "TradeInfo", "TradeSha", "Version"/);
  assert.match(gift, /createGiftShippingFeeButtonHandlers/);
  assert.doesNotMatch(gift, /\/MPG\/period/);
  assert.doesNotMatch(page, /sandbox-mpg-gift-shipping\.html/);
});
