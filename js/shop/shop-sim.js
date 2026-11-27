/* ============================================================
   Lucky Shop / shop-sim.js
   Day 1 實體商品純模擬流程。
   只讀寫瀏覽器 storage。沒有金流、發票、物流或訂單 API。
   ============================================================ */

(function (root) {
  const MODE_KEY = "clawLucky.shopSim.mode";
  const DRAFT_KEY = "clawLucky.shopSim.draft.v1";
  const ORDERS_KEY = "clawLucky.shopSim.orders.v1";
  const BANNER_TEXT = "測試模擬：不扣款、不建立正式訂單、不開立發票、不建立物流單。";
  const MAX_QTY = 5;

  const TEST_PROFILE = {
    recipientName: "測試人員",
    phone: "0912000000",
    email: "shop-sim@example.com"
  };

  const DEMO_PRODUCTS = [
    {
      id: "sim-chameleon",
      name: "幻彩變色龍吊飾",
      subtitle: "展示用測試商品，不會扣庫存。",
      description: "展示用測試商品，不會扣庫存。",
      badge: "測試商品",
      price: 280,
      stock: 8,
      enabled: true,
      image: "./images/chameleon.jpg",
      thumbnail: "./images/chameleon.jpg"
    },
    {
      id: "sim-giftbox",
      name: "期間限定好運禮盒",
      subtitle: "展示用測試商品，不會扣庫存。",
      description: "展示用測試商品，不會扣庫存。",
      badge: "測試商品",
      price: 640,
      stock: 4,
      enabled: true,
      image: "./images/mascot.jpg",
      thumbnail: "./images/mascot.jpg"
    }
  ];

  const STORES = [
    { id: "711-xinyi-sim", label: "7-ELEVEN 測試門市｜台北信義（模擬）" },
    { id: "fami-daan-sim", label: "全家 測試門市｜台北大安（模擬）" }
  ];

  const PAYMENTS = [
    {
      id: "card_cvs_nopay",
      label: "藍新信用卡預付＋超商取貨不付款",
      status: "模擬付款成功（未扣款）"
    },
    {
      id: "cvs_cod",
      label: "超商取貨付款",
      status: "取貨付款待付款（模擬，未扣款）"
    }
  ];

  const INVOICES = [
    { id: "donate", label: "捐贈（模擬，不開立）" },
    { id: "carrier", label: "個人載具（模擬，不開立）" },
    { id: "company", label: "公司統編（模擬，不開立）" }
  ];

  function localStore() {
    return ShopSim._localStorage || root.localStorage;
  }

  function sessionStore() {
    return ShopSim._sessionStorage || root.sessionStorage;
  }

  function readJson(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (_error) {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    storage.setItem(key, JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatPrice(value) {
    return `NT$ ${Number(value || 0).toLocaleString("zh-TW")}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function activate() {
    sessionStore().setItem(MODE_KEY, "1");
    return true;
  }

  function isActive() {
    try {
      return sessionStore().getItem(MODE_KEY) === "1";
    } catch (_error) {
      return false;
    }
  }

  function activateFromUrl(search) {
    const params = new URLSearchParams(String(search || ""));
    if (params.get("shopSim") === "1") activate();
    return isActive();
  }

  function getDemoProducts() {
    return DEMO_PRODUCTS.map((product) => clone(product));
  }

  function getDemoProduct(productId) {
    const id = String(productId || "");
    const found = DEMO_PRODUCTS.find((product) => product.id === id);
    return found ? clone(found) : null;
  }

  function findStore(storeId) {
    return STORES.find((store) => store.id === storeId) || null;
  }

  function findPayment(paymentId) {
    return PAYMENTS.find((payment) => payment.id === paymentId) || null;
  }

  function findInvoice(invoiceId) {
    return INVOICES.find((invoice) => invoice.id === invoiceId) || null;
  }

  function maxQuantity(item) {
    const stock = Number(item?.stock || 0);
    if (stock > 0) return Math.min(MAX_QTY, stock);
    return MAX_QTY;
  }

  function createDraftFromProduct(product, quantity) {
    const stock = Number(product?.stock || 0);
    const requested = Number(quantity || 1);
    const item = {
      productId: String(product?.id || ""),
      name: String(product?.name || product?.title || "未命名商品"),
      subtitle: String(product?.subtitle || product?.description || ""),
      price: Number(product?.price || 0),
      quantity: 1,
      image: String(product?.image || product?.thumbnail || product?.cover || ""),
      stock
    };
    item.quantity = Math.max(1, Math.min(maxQuantity(item), requested || 1));
    return {
      items: [item],
      recipientName: TEST_PROFILE.recipientName,
      phone: TEST_PROFILE.phone,
      email: TEST_PROFILE.email,
      storeId: STORES[0].id,
      paymentMethod: PAYMENTS[0].id,
      invoiceOption: INVOICES[0].id,
      taxId: ""
    };
  }

  function readDraft() {
    const draft = readJson(sessionStore(), DRAFT_KEY, null);
    if (!draft || !Array.isArray(draft.items)) return null;
    return draft;
  }

  function writeDraft(draft) {
    writeJson(sessionStore(), DRAFT_KEY, draft);
    return draft;
  }

  function clearDraft() {
    sessionStore().removeItem(DRAFT_KEY);
  }

  function setDraftQuantity(draft, quantity) {
    const next = clone(draft);
    const item = next.items && next.items[0];
    if (!item) return next;
    const qty = Number(quantity);
    item.quantity = Math.max(1, Math.min(maxQuantity(item), Number.isFinite(qty) ? qty : 1));
    return next;
  }

  function validateDraft(draft) {
    if (!draft || !Array.isArray(draft.items) || !draft.items.length) {
      return { ok: false, message: "請先從好運商城加入商品。" };
    }

    const item = draft.items[0];
    if (!item?.productId || !String(item.name || "").trim()) {
      return { ok: false, message: "商品資料不完整。" };
    }
    if (Number(item.stock) === 0) {
      return { ok: false, message: "這項商品目前沒有可模擬的庫存。" };
    }
    if (Number(item.quantity) < 1 || Number(item.quantity) > maxQuantity(item)) {
      return { ok: false, message: "請調整數量後再繼續。" };
    }
    if (!Number.isFinite(Number(item.price)) || Number(item.price) < 0) {
      return { ok: false, message: "商品價格不正確。" };
    }

    const name = String(draft.recipientName || "").trim();
    if (!name || name.length > 40) {
      return { ok: false, message: "請填寫收件人（測試姓名即可）。" };
    }
    if (!/^09\d{8}$/.test(String(draft.phone || "").trim())) {
      return { ok: false, message: "請填寫 09 開頭的 10 碼測試手機。" };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(draft.email || "").trim())) {
      return { ok: false, message: "請填寫測試用電子郵件。" };
    }
    if (!findStore(draft.storeId)) {
      return { ok: false, message: "請選擇模擬超商門市。" };
    }
    if (!findPayment(draft.paymentMethod)) {
      return { ok: false, message: "請選擇付款方式。" };
    }
    if (!findInvoice(draft.invoiceOption)) {
      return { ok: false, message: "請選擇發票選項。" };
    }
    if (draft.invoiceOption === "company" && !/^\d{8}$/.test(String(draft.taxId || "").trim())) {
      return { ok: false, message: "公司統編請填 8 碼測試數字。" };
    }

    return { ok: true, message: "" };
  }

  function readOrders() {
    const orders = readJson(localStore(), ORDERS_KEY, []);
    return Array.isArray(orders) ? orders : [];
  }

  function writeOrders(orders) {
    writeJson(localStore(), ORDERS_KEY, orders);
  }

  function clearOrders() {
    localStore().removeItem(ORDERS_KEY);
  }

  function makeOrderNo(date) {
    const when = date instanceof Date ? date : new Date();
    const y = when.getFullYear();
    const m = String(when.getMonth() + 1).padStart(2, "0");
    const d = String(when.getDate()).padStart(2, "0");
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let suffix = "";
    const cryptoObj = root.crypto;
    if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
      const bytes = new Uint8Array(6);
      cryptoObj.getRandomValues(bytes);
      suffix = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
    } else {
      for (let index = 0; index < 6; index += 1) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
    }
    return `SIM-${y}${m}${d}-${suffix}`;
  }

  function createOrder(draft) {
    const check = validateDraft(draft);
    if (!check.ok) {
      const error = new Error(check.message);
      error.code = "INVALID_DRAFT";
      throw error;
    }

    const payment = findPayment(draft.paymentMethod);
    const store = findStore(draft.storeId);
    const invoice = findInvoice(draft.invoiceOption);
    const items = draft.items.map((item) => ({
      productId: String(item.productId),
      name: String(item.name),
      subtitle: String(item.subtitle || ""),
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 0),
      image: String(item.image || "")
    }));
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const orderNo = makeOrderNo(new Date());
    const order = {
      id: `sim_${orderNo.slice(4)}`,
      order_no: orderNo,
      created_at: new Date().toISOString(),
      simulated: true,
      items,
      total_amount: totalAmount,
      total_items: totalItems,
      shipping_fee: 0,
      recipient_name: String(draft.recipientName).trim(),
      phone: String(draft.phone).trim(),
      email: String(draft.email).trim(),
      store_id: store.id,
      store_label: store.label,
      payment_method: payment.id,
      payment_label: payment.label,
      payment_status: payment.status,
      logistics_status: "待出貨（模擬，未建立物流單）",
      invoice_option: invoice.id,
      invoice_label: invoice.label,
      invoice_status: "待處理（模擬，未開立發票）",
      tax_id: invoice.id === "company" ? String(draft.taxId).trim() : ""
    };

    const orders = readOrders();
    orders.unshift(order);
    writeOrders(orders);
    clearDraft();
    return order;
  }

  function findOrder(orderNo) {
    const key = String(orderNo || "");
    return readOrders().find((order) => order.order_no === key) || null;
  }

  function draftTotal(draft) {
    const item = draft?.items?.[0];
    if (!item) return 0;
    return Number(item.price || 0) * Number(item.quantity || 0);
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value == null ? "" : String(value);
  }

  function showAlert(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || "";
    el.hidden = !message;
  }

  function renderSummary(draft) {
    const item = draft.items[0];
    const lines = document.getElementById("simSummaryLines");
    if (lines) {
      const image = item.image
        ? `<img src="${escapeHtml(item.image)}" alt="" />`
        : "";
      lines.innerHTML = `
        <article class="shop-sim-line">
          ${image}
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(item.subtitle || "測試商品")}</p>
            <p>單價 ${escapeHtml(formatPrice(item.price))} × ${escapeHtml(item.quantity)}</p>
          </div>
          <strong>${escapeHtml(formatPrice(item.price * item.quantity))}</strong>
        </article>
      `;
    }
    setText("simQtyValue", item.quantity);
    setText("simSummarySubtotal", formatPrice(draftTotal(draft)));
    setText("simSummaryShipping", formatPrice(0));
    setText("simSummaryTotal", formatPrice(draftTotal(draft)));
  }

  function readCheckoutForm(draft) {
    const next = clone(draft);
    const form = document.getElementById("shopSimCheckoutForm");
    if (!form) return next;
    const data = new FormData(form);
    next.recipientName = String(data.get("recipientName") || "");
    next.phone = String(data.get("phone") || "");
    next.email = String(data.get("email") || "");
    next.storeId = String(data.get("storeId") || "");
    next.paymentMethod = String(data.get("paymentMethod") || "");
    next.invoiceOption = String(data.get("invoiceOption") || "");
    next.taxId = String(data.get("taxId") || "");
    return next;
  }

  function fillCheckoutForm(draft) {
    const form = document.getElementById("shopSimCheckoutForm");
    if (!form) return;
    form.recipientName.value = draft.recipientName || "";
    form.phone.value = draft.phone || "";
    form.email.value = draft.email || "";
    form.storeId.value = draft.storeId || STORES[0].id;
    const payment = form.querySelector(`input[name="paymentMethod"][value="${draft.paymentMethod}"]`);
    if (payment) payment.checked = true;
    const invoice = form.querySelector(`input[name="invoiceOption"][value="${draft.invoiceOption}"]`);
    if (invoice) invoice.checked = true;
    form.taxId.value = draft.taxId || "";
    const taxRow = document.getElementById("simTaxRow");
    if (taxRow) taxRow.hidden = draft.invoiceOption !== "company";
  }

  function initCheckout() {
    activate();
    let draft = readDraft();
    if (!draft) {
      document.getElementById("shopSimCheckoutForm")?.setAttribute("hidden", "");
      const empty = document.getElementById("simCheckoutEmpty");
      if (empty) empty.hidden = false;
      return;
    }

    fillCheckoutForm(draft);
    renderSummary(draft);

    document.getElementById("simQtyMinus")?.addEventListener("click", () => {
      draft = setDraftQuantity(readCheckoutForm(draft), Number(draft.items[0].quantity) - 1);
      draft = writeDraft(draft);
      renderSummary(draft);
    });
    document.getElementById("simQtyPlus")?.addEventListener("click", () => {
      draft = setDraftQuantity(readCheckoutForm(draft), Number(draft.items[0].quantity) + 1);
      draft = writeDraft(draft);
      renderSummary(draft);
    });

    document.getElementById("shopSimCheckoutForm")?.addEventListener("change", (event) => {
      if (event.target?.name === "invoiceOption") {
        const taxRow = document.getElementById("simTaxRow");
        if (taxRow) taxRow.hidden = event.target.value !== "company";
      }
    });

    document.getElementById("shopSimCheckoutForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      draft = readCheckoutForm(draft);
      draft = setDraftQuantity(draft, draft.items[0].quantity);
      const check = validateDraft(draft);
      if (!check.ok) {
        showAlert("simCheckoutAlert", check.message);
        return;
      }
      writeDraft(draft);
      window.location.assign("./shop_sim_pay.html");
    });
  }

  function initPay() {
    activate();
    const draft = readDraft();
    if (!draft) {
      document.getElementById("simPayReady")?.setAttribute("hidden", "");
      const empty = document.getElementById("simPayEmpty");
      if (empty) empty.hidden = false;
      return;
    }

    const payment = findPayment(draft.paymentMethod);
    const store = findStore(draft.storeId);
    setText("simPayMethod", payment ? payment.label : "");
    setText("simPayStore", store ? store.label : "");
    setText("simPayTotal", formatPrice(draftTotal(draft)));
    setText("simPayHint", payment?.id === "cvs_cod"
      ? "這筆是超商取貨付款的模擬送出，不會向門市或物流商建單。"
      : "這筆是藍新信用卡預付的模擬結果，不會連到藍新，也不會扣款。");

    document.getElementById("simPayButton")?.addEventListener("click", () => {
      const button = document.getElementById("simPayButton");
      if (button) button.disabled = true;
      try {
        const order = createOrder(readDraft());
        window.location.assign(`./shop_sim_complete.html?order=${encodeURIComponent(order.order_no)}`);
      } catch (error) {
        if (button) button.disabled = false;
        showAlert("simPayAlert", error?.message || "模擬訂單建立失敗。");
      }
    });
  }

  function renderOrderCard(order, current) {
    const items = (order.items || []).map((item) => `
      <li>${escapeHtml(item.name)} × ${escapeHtml(item.quantity)}　${escapeHtml(formatPrice(item.price * item.quantity))}</li>
    `).join("");
    return `
      <article class="shop-sim-order${current ? " is-current" : ""}" ${current ? "id=\"sim-order-current\"" : ""}>
        <p class="shop-sim-pill">測試模擬</p>
        <h3>模擬訂單 ${escapeHtml(order.order_no)}</h3>
        <p>${escapeHtml(new Date(order.created_at).toLocaleString("zh-TW"))}</p>
        <dl class="shop-sim-kv">
          <dt>付款方式</dt><dd>${escapeHtml(order.payment_label)}</dd>
          <dt>付款狀態</dt><dd>${escapeHtml(order.payment_status)}</dd>
          <dt>取貨門市</dt><dd>${escapeHtml(order.store_label)}</dd>
          <dt>物流狀態</dt><dd>${escapeHtml(order.logistics_status)}</dd>
          <dt>發票</dt><dd>${escapeHtml(order.invoice_label)}／${escapeHtml(order.invoice_status)}</dd>
          <dt>金額</dt><dd>${escapeHtml(formatPrice(order.total_amount))}（運費 ${escapeHtml(formatPrice(order.shipping_fee || 0))}）</dd>
        </dl>
        <ul class="shop-sim-order-items">${items}</ul>
      </article>
    `;
  }

  function initComplete() {
    activate();
    const orderNo = new URLSearchParams(window.location.search).get("order");
    const order = findOrder(orderNo);
    if (!order) {
      document.getElementById("simCompleteReady")?.setAttribute("hidden", "");
      const empty = document.getElementById("simCompleteEmpty");
      if (empty) empty.hidden = false;
      return;
    }

    setText("simCompleteNo", order.order_no);
    setText("simCompletePay", `${order.payment_label}／${order.payment_status}`);
    setText("simCompleteStore", order.store_label);
    setText("simCompleteLogistics", order.logistics_status);
    setText("simCompleteInvoice", `${order.invoice_label}／${order.invoice_status}`);
    setText("simCompleteTotal", formatPrice(order.total_amount));
    const link = document.getElementById("simCompleteOrdersLink");
    if (link) {
      link.href = `./orders.html?shopSim=1&order=${encodeURIComponent(order.order_no)}`;
    }
  }

  function initOrders() {
    if (new URLSearchParams(window.location.search).get("shopSim") === "1") activate();
    const list = document.getElementById("simOrdersList");
    if (!list) return;

    const paint = () => {
      const current = new URLSearchParams(window.location.search).get("order");
      const orders = readOrders();
      if (!orders.length) {
        list.innerHTML = `
          <div class="good-product-empty">目前沒有模擬訂單。可以從會員入口重新開始。</div>
        `;
        return;
      }
      list.innerHTML = orders.map((order) => renderOrderCard(order, order.order_no === current)).join("");
      document.getElementById("sim-order-current")?.scrollIntoView({ block: "nearest" });
    };

    paint();
    const clearButton = document.getElementById("simOrdersClear");
    clearButton?.addEventListener("click", () => {
      if (clearButton.dataset.armed !== "1") {
        clearButton.dataset.armed = "1";
        clearButton.textContent = "再按一次，確認清除模擬訂單";
        return;
      }
      clearOrders();
      clearDraft();
      clearButton.dataset.armed = "0";
      clearButton.textContent = "清除模擬訂單並重跑";
      const url = new URL(window.location.href);
      url.searchParams.delete("order");
      window.history.replaceState({}, "", url);
      paint();
    });
  }

  function bootShopSimPages() {
    const page = document.body?.getAttribute("data-shop-sim-page");
    if (page === "checkout") initCheckout();
    else if (page === "pay") initPay();
    else if (page === "complete") initComplete();
    else if (page === "orders" || document.getElementById("simOrdersList")) initOrders();
  }

  const ShopSim = {
    MODE_KEY,
    DRAFT_KEY,
    ORDERS_KEY,
    BANNER_TEXT,
    MAX_QTY,
    TEST_PROFILE,
    STORES,
    PAYMENTS,
    INVOICES,
    _localStorage: null,
    _sessionStorage: null,
    activate,
    isActive,
    activateFromUrl,
    getDemoProducts,
    getDemoProduct,
    createDraftFromProduct,
    readDraft,
    writeDraft,
    clearDraft,
    setDraftQuantity,
    validateDraft,
    readOrders,
    clearOrders,
    createOrder,
    findOrder,
    makeOrderNo,
    maxQuantity,
    draftTotal,
    formatPrice,
    escapeHtml
  };

  root.ShopSim = ShopSim;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootShopSimPages);
    } else {
      bootShopSimPages();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
