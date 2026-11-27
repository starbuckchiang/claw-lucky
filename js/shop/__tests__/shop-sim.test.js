"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..", "..");
require(path.join(__dirname, "..", "shop-sim.js"));
const ShopSim = globalThis.ShopSim;

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

function useMemory() {
  ShopSim._localStorage = memoryStorage();
  ShopSim._sessionStorage = memoryStorage();
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("draft from a product stays local and validates the prefilled test profile", () => {
  useMemory();
  const draft = ShopSim.createDraftFromProduct(ShopSim.getDemoProducts()[0], 2);
  assert.equal(draft.items[0].quantity, 2);
  assert.equal(draft.recipientName, "測試人員");
  assert.equal(draft.phone, "0912000000");
  assert.equal(draft.email, "shop-sim@example.com");
  assert.equal(ShopSim.validateDraft(draft).ok, true);
});

test("quantity is capped by the smaller of 5 and stock", () => {
  const gift = ShopSim.getDemoProduct("sim-giftbox");
  const draft = ShopSim.createDraftFromProduct(gift, 99);
  assert.equal(draft.items[0].quantity, 4);
  const raised = ShopSim.setDraftQuantity(draft, 1);
  assert.equal(raised.items[0].quantity, 1);
});

test("company invoice requires an 8-digit test tax id", () => {
  useMemory();
  const draft = ShopSim.createDraftFromProduct(ShopSim.getDemoProduct("sim-chameleon"), 1);
  draft.invoiceOption = "company";
  draft.taxId = "12";
  assert.equal(ShopSim.validateDraft(draft).ok, false);
  draft.taxId = "00000000";
  assert.equal(ShopSim.validateDraft(draft).ok, true);
});

test("createOrder writes only localStorage and keeps the two payment statuses", () => {
  useMemory();
  let fetched = false;
  globalThis.fetch = () => {
    fetched = true;
    throw new Error("fetch must not run");
  };

  const card = ShopSim.createDraftFromProduct(ShopSim.getDemoProduct("sim-chameleon"), 1);
  card.paymentMethod = "card_cvs_nopay";
  const cardOrder = ShopSim.createOrder(card);
  assert.equal(cardOrder.payment_status, "模擬付款成功（未扣款）");
  assert.equal(cardOrder.logistics_status, "待出貨（模擬，未建立物流單）");
  assert.equal(cardOrder.invoice_status, "待處理（模擬，未開立發票）");
  assert.equal(cardOrder.simulated, true);
  assert.match(cardOrder.order_no, /^SIM-\d{8}-[A-Z0-9]{6}$/);
  assert.equal(ShopSim.readDraft(), null);
  assert.equal(ShopSim.findOrder(cardOrder.order_no).order_no, cardOrder.order_no);

  const cod = ShopSim.createDraftFromProduct(ShopSim.getDemoProduct("sim-giftbox"), 1);
  cod.paymentMethod = "cvs_cod";
  const codOrder = ShopSim.createOrder(cod);
  assert.equal(codOrder.payment_status, "取貨付款待付款（模擬，未扣款）");
  assert.equal(ShopSim.readOrders().length, 2);
  assert.equal(fetched, false);

  ShopSim.clearOrders();
  assert.deepEqual(ShopSim.readOrders(), []);
  delete globalThis.fetch;
});

test("orders survive a new storage reader and shop-sim never calls a backend", () => {
  useMemory();
  const draft = ShopSim.createDraftFromProduct(ShopSim.getDemoProduct("sim-chameleon"), 1);
  const order = ShopSim.createOrder(draft);
  const raw = ShopSim._localStorage.getItem(ShopSim.ORDERS_KEY);
  assert.match(raw, new RegExp(order.order_no));

  const source = read("js/shop/shop-sim.js");
  assert.equal(source.includes("supabase"), false);
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("shop-ops"), false);
  assert.equal(source.includes("newebpay"), false);
  assert.match(source, /測試模擬：不扣款、不建立正式訂單、不開立發票、不建立物流單。/);
});

test("pages keep the member branch, fake pay screen, and local order list", () => {
  const member = read("member_flow.html");
  assert.match(member, /href="\.\/gift\.html"/);
  assert.match(member, /購買實體商品/);
  assert.match(member, /good\.html\?shopSim=1/);

  const pay = read("shop_sim_pay.html");
  assert.match(pay, /測試模擬，不會扣款/);
  assert.match(pay, /模擬付款成功／送出取貨付款訂單/);
  assert.match(pay, /請不要輸入卡號/);
  assert.equal(/name="(card|cvv|pan)"|<input[^>]*type="password"/i.test(pay), false);

  const orders = read("orders.html");
  assert.match(orders, /id="simOrdersList"/);
  assert.match(orders, /清除模擬訂單並重跑/);

  const good = read("js/shop/good.js");
  assert.match(good, /sim-checkout/);
  assert.equal(good.includes("checkoutCart"), false);
  assert.equal(good.includes("addToCart"), false);

  const product = read("product.html");
  assert.match(product, /ShopApi\.addToCart/);
  assert.match(product, /shop_sim_checkout\.html/);
  assert.match(product, /isActive/);

  const cart = read("js/shop/shop_cart.js");
  assert.match(cart, /checkoutCart/);
});
