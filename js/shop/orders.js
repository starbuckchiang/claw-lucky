(function () {
  const refs = {
    ordersListEl: document.getElementById("ordersList")
  };

  function formatPrice(value) {
    return `NT$ ${Number(value || 0).toLocaleString("zh-TW")}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-TW");
  }

  function buildOrderCard(order) {
    const orderId = order?.id || "";
    const orderNo = String(order?.order_no || "").trim();
    const legacyCode = String(orderId || "").slice(0, 8);
    const displayOrderNo = orderNo || (legacyCode ? `舊訂單 ${legacyCode}` : "舊訂單");
    const totalAmount = formatPrice(order?.total_amount || 0);
    const totalItems = Number(order?.total_items || 0);
    const status = order?.status || "pending";
    const createdAt = formatDate(order?.created_at);

    return `
      <article class="orders-card">
        <div class="orders-meta">
          <div>
            <h3>訂單 ${escapeHtml(displayOrderNo)}</h3>
            <div>${escapeHtml(createdAt)}</div>
          </div>
          <div>
            <div>狀態：${escapeHtml(status)}</div>
            <div>總額：${escapeHtml(totalAmount)}</div>
            <div>共 ${totalItems} 件</div>
          </div>
        </div>
        <div class="orders-items" id="order-items-${escapeHtml(orderId)}"></div>
        <button class="orders-toggle" type="button" data-order-id="${escapeHtml(orderId)}">查看詳情</button>
      </article>
    `;
  }

  async function loadOrderItems(orderId) {
    if (!window.supabaseClient) return [];

    const { data, error } = await window.supabaseClient
      .from("order_items")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[orders] load items failed", error);
      return [];
    }

    return Array.isArray(data) ? data : [];
  }

  async function toggleOrderItems(button) {
    const orderId = button?.dataset?.orderId;
    if (!orderId) return;

    const container = document.getElementById(`order-items-${orderId}`);
    if (!container) return;

    if (container.dataset.loaded === "true") {
      container.style.display = container.style.display === "none" ? "grid" : "none";
      return;
    }

    const items = await loadOrderItems(orderId);

    if (!items.length) {
      container.innerHTML = '<div class="good-product-empty">這筆訂單沒有商品。</div>';
      container.dataset.loaded = "true";
      container.style.display = "grid";
      return;
    }

    container.innerHTML = items.map((item) => {
      const image = item.product_image || "";
      const name = item.product_name || "未命名商品";
      const quantity = Number(item.quantity || 0);
      const price = formatPrice(item.price || 0);
      const subtotal = formatPrice(item.subtotal || 0);
      const description = item.description || "把好運帶回生活。";

      return `
        <div class="orders-item">
          ${image ? `<img class="orders-item-image" src="${escapeHtml(image)}" alt="${escapeHtml(name)}" />` : `<div class="orders-item-image"></div>`}
          <div class="orders-item-body">
            <div class="orders-item-name">${escapeHtml(name)}</div>
            <div class="orders-item-desc">${escapeHtml(description)}</div>
            <div class="orders-item-footer">
              <span>數量 ${quantity}</span>
              <span>${escapeHtml(price)}</span>
              <strong>${escapeHtml(subtotal)}</strong>
            </div>
          </div>
        </div>
      `;
    }).join("");

    container.dataset.loaded = "true";
    container.style.display = "grid";
  }

  async function loadOrders() {
    if (!refs.ordersListEl) return;

    if (!window.supabaseClient) {
      refs.ordersListEl.innerHTML = '<div class="good-product-empty">載入好運紀錄失敗。</div>';
      return;
    }

    try {
      if (!window.userReadyPromise && window.UserStore?.initUser) {
        window.userReadyPromise = window.UserStore.initUser();
      }

      const user = window.userReadyPromise
        ? await window.userReadyPromise
        : null;

      let userId = String(user?.user_id || "").trim();

      if (!userId && window.ClawUser?.getUserId) {
        userId = String(await window.ClawUser.getUserId() || "").trim();
      }

      if (!userId) {
        refs.ordersListEl.innerHTML = '<div class="good-product-empty">目前沒有可用的使用者資料。</div>';
        return;
      }

      const { data, error } = await window.supabaseClient
        .from("orders")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      if (!Array.isArray(data) || !data.length) {
        refs.ordersListEl.innerHTML = '<div class="good-product-empty">目前還沒有好運紀錄。</div>';
        return;
      }

      refs.ordersListEl.innerHTML = data.map(buildOrderCard).join("");
      refs.ordersListEl.className = "orders-list";

      refs.ordersListEl.querySelectorAll(".orders-toggle").forEach((button) => {
        button.addEventListener("click", async () => {
          await toggleOrderItems(button);
        });
      });
    } catch (error) {
      console.error("[orders] load failed", error);
      refs.ordersListEl.innerHTML = '<div class="good-product-empty">載入好運紀錄失敗。</div>';
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (window.UserStore?.initUser) {
      await window.UserStore.initUser();
    }
    await loadOrders();
  });
})();
