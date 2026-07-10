(function () {
  function getOrderId() {
    const params = new URLSearchParams(location.search);
    return String(params.get("order_id") || "").trim();
  }

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

  async function loadCompletePage() {
    const orderId = getOrderId();
    const orderNoEl = document.getElementById("completeOrderNo");
    const totalEl = document.getElementById("completeTotal");
    const countEl = document.getElementById("completeCount");
    const itemsEl = document.getElementById("completeItems");

    if (!orderId) {
      if (totalEl) totalEl.textContent = "NT$ 0";
      if (countEl) countEl.textContent = "0 件商品";
      if (orderNoEl) orderNoEl.textContent = "訂單編號：—";
      if (itemsEl) {
        itemsEl.innerHTML = '<div class="good-product-empty">沒有找到這筆好運紀錄。</div>';
      }
      return;
    }

    try {
      if (!window.supabaseClient) {
        throw new Error("Supabase 尚未初始化");
      }

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
        throw new Error("找不到使用者資料");
      }

      const { data: order, error: orderError } = await window.supabaseClient
        .from("orders")
        .select("id,order_no,user_id,total_amount,total_items,status,created_at")
        .eq("id", orderId)
        .eq("user_id", userId)
        .maybeSingle();

      if (orderError) throw orderError;

      if (!order) {
        if (itemsEl) {
          itemsEl.innerHTML = '<div class="good-product-empty">沒有找到這筆好運紀錄。</div>';
        }
        if (totalEl) totalEl.textContent = "NT$ 0";
        if (countEl) countEl.textContent = "0 件商品";
        if (orderNoEl) orderNoEl.textContent = "訂單編號：—";
        return;
      }

      if (orderNoEl) {
        const orderNo = String(order?.order_no || "").trim();
        const legacyCode = String(order?.id || "").slice(0, 8);
        const displayNo = orderNo || (legacyCode ? `舊訂單 ${legacyCode}` : "舊訂單");
        orderNoEl.textContent = `訂單編號：${displayNo}`;
      }

      const { data: items, error: itemsError } = await window.supabaseClient
        .from("order_items")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      if (itemsError) throw itemsError;

      if (totalEl) {
        totalEl.textContent = formatPrice(order?.total_amount || 0);
      }

      if (countEl) {
        const totalItems = Number(order?.total_items || 0);
        countEl.textContent = `${totalItems} 件商品`;
      }

      if (!itemsEl) return;

      if (!Array.isArray(items) || !items.length) {
        itemsEl.innerHTML = '<div class="good-product-empty">這次沒有帶回任何商品。</div>';
        return;
      }

      itemsEl.innerHTML = items.map((item) => {
        const name = escapeHtml(item.product_name || "未命名商品");
        const description = escapeHtml(item.description || "把好運帶回生活。" );
        const unitPrice = formatPrice(item.unit_price || 0);
        const quantity = Number(item.quantity || 0);
        const totalPrice = formatPrice(item.total_price || 0);

        return `
          <article class="good-product-card">
            <div class="good-product-body">
              <h3 class="good-product-name">${name}</h3>
              <p class="good-product-desc">${description}</p>
              <div class="good-product-meta">
                <span class="good-stock">${quantity} 件・單價 ${unitPrice}</span>
                <strong class="good-price">${totalPrice}</strong>
              </div>
            </div>
          </article>
        `;
      }).join("");
    } catch (error) {
      console.error("[luck complete] load failed", error);
      if (itemsEl) {
        itemsEl.innerHTML = '<div class="good-product-empty">載入好運紀錄失敗。</div>';
      }
    }
  }

  function bindEvents() {
    const viewOrdersBtn = document.getElementById("viewOrdersBtn");
    if (!viewOrdersBtn) return;

    viewOrdersBtn.addEventListener("click", () => {
      window.location.assign("./orders.html");
    });
  }

  document.addEventListener("DOMContentLoaded", loadCompletePage);
  document.addEventListener("DOMContentLoaded", bindEvents);
})();
