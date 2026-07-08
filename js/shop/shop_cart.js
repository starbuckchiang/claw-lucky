(function () {
  const refs = {
    cartListEl: document.getElementById("cartList"),
    cartSubtotalEl: document.getElementById("cartSubtotal"),
    cartTotalEl: document.getElementById("cartTotal")
  };

  let cartItems = [];

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

  function getCheckoutSummary(items) {
    const totalAmount = (Array.isArray(items) ? items : []).reduce((sum, item) => {
      const product = item?.product || {};
      const price = Number(product.price || 0);
      const quantity = Number(item?.quantity || 0);
      return sum + price * quantity;
    }, 0);

    const totalItems = (Array.isArray(items) ? items : []).reduce((sum, item) => {
      return sum + Number(item?.quantity || 0);
    }, 0);

    return {
      totalAmount: Number(totalAmount.toFixed(2)),
      totalItems
    };
  }

  async function handleCheckout() {
    if (!Array.isArray(cartItems) || !cartItems.length) {
      window.alert("好運籃還是空的，先把商品加入好運籃吧。");
      return;
    }

    const checkoutBtn = document.querySelector(".shop-cart-submit");
    if (checkoutBtn) {
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = "建立訂單中...";
    }

    try {
      if (!window.supabaseClient) {
        throw new Error("Supabase 尚未初始化");
      }

      if (window.UserStore?.initUser) {
        await window.UserStore.initUser();
      }

      const profile = window.UserStore?.getUserProfile ? window.UserStore.getUserProfile() : {};
      const userId = profile?.userId;

      if (!userId) {
        throw new Error("找不到使用者資料");
      }

      const { totalAmount, totalItems } = getCheckoutSummary(cartItems);

      const orderPayload = {
        user_id: userId,
        total_amount: totalAmount,
        total_items: totalItems,
        status: "pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data: order, error: orderError } = await window.supabaseClient
        .from("orders")
        .insert(orderPayload)
        .select()
        .single();

      if (orderError) {
        throw orderError;
      }

      const orderItems = cartItems.map((item) => {
        const product = item?.product || {};
        const quantity = Number(item?.quantity || 0);
        const unitPrice = Number(product.price || 0);
        const totalPrice = Number((unitPrice * quantity).toFixed(2));

        return {
          order_id: order.id,
          product_id: item?.product_id || product?.id || "",
          product_name: product.name || product.title || "未命名商品",
          product_image: product.image || product.thumbnail || product.cover || "",
          price: unitPrice,
          quantity,
          subtotal: totalPrice,
          created_at: new Date().toISOString()
        };
      });

      const { error: itemsError } = await window.supabaseClient
        .from("order_items")
        .insert(orderItems);

      if (itemsError) {
        throw itemsError;
      }

      const { error: clearError } = await window.supabaseClient
        .from("shop_cart")
        .delete()
        .eq("user_id", userId);

      if (clearError) {
        throw clearError;
      }

      cartItems = [];
      renderCart();
      window.location.assign(`./luck_complete.html?order_id=${encodeURIComponent(order.id)}`);
    } catch (error) {
      console.error("[shop cart] checkout failed", error);
      window.alert(`帶回好運失敗：${error?.message || "請稍後再試"}`);

      if (checkoutBtn) {
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = "🍀 帶回好運";
      }
    }
  }

  function buildCartItem(item) {
    const product = item?.product || {};
    const image = product.image || product.thumbnail || product.cover || "";
    const name = product.name || product.title || "未命名商品";
    const description = product.description || product.subtitle || "把好運帶回生活。";
    const price = Number(product.price || 0);
    const quantity = Number(item?.quantity || 0);
    const subtotal = price * quantity;
    const cartId = item?.id || "";
    const productId = item?.product_id || product?.id || "";
    const productDetailHref = productId ? `./product.html?id=${encodeURIComponent(productId)}` : "./product.html?id=0";

    console.log("item =", item);
    console.log("product =", product);
    console.log("productId =", productId);
    console.log("productDetailHref =", productDetailHref);

    return `
      <article class="good-product-card good-cart-item">
        <div class="good-product-image">
          ${image
            ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" />`
            : `<div class="good-product-image-placeholder">${escapeHtml(name)}</div>`}
        </div>
        <div class="good-product-body">
          <div class="good-cart-top">
            <div>
              <h3 class="good-product-name">${escapeHtml(name)}</h3>
              <a class="good-cart-link" href="${escapeHtml(productDetailHref)}">商品詳情</a>
            </div>
            <button class="good-cart-remove" data-action="remove" data-cart-id="${escapeHtml(cartId)}" type="button">🗑️ 刪除</button>
          </div>
          <p class="good-product-desc">${escapeHtml(description)}</p>
          <div class="good-product-meta">
            <span class="good-stock">單價 ${formatPrice(price)}</span>
            <strong class="good-price">${formatPrice(subtotal)}</strong>
          </div>
          <div class="good-cart-quantity">
            <button class="good-btn good-btn-secondary good-cart-qty-btn" data-action="decrement" data-cart-id="${escapeHtml(cartId)}" type="button">−</button>
            <span class="good-cart-qty-value">${quantity}</span>
            <button class="good-btn good-btn-primary good-cart-qty-btn" data-action="increment" data-cart-id="${escapeHtml(cartId)}" type="button">+</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderCart() {
    if (!refs.cartListEl) {
      return;
    }

    if (!Array.isArray(cartItems) || !cartItems.length) {
      refs.cartListEl.innerHTML = '<div class="good-product-empty">目前好運籃裡還沒有商品。</div>';
      if (refs.cartSubtotalEl) {
        refs.cartSubtotalEl.textContent = formatPrice(0);
      }
      if (refs.cartTotalEl) {
        refs.cartTotalEl.textContent = formatPrice(0);
      }
      return;
    }

    refs.cartListEl.innerHTML = cartItems.map(buildCartItem).join("");

    const total = cartItems.reduce((sum, item) => {
      const product = item?.product || {};
      return sum + Number(product.price || 0) * Number(item?.quantity || 0);
    }, 0);

    if (refs.cartSubtotalEl) {
      refs.cartSubtotalEl.textContent = formatPrice(total);
    }

    if (refs.cartTotalEl) {
      refs.cartTotalEl.textContent = formatPrice(total);
    }
  }

  async function loadCart() {
    if (!window.ShopApi?.getCart) {
      if (refs.cartListEl) {
        refs.cartListEl.innerHTML = '<div class="good-product-empty">購物車載入失敗。</div>';
      }
      return;
    }

    try {
      const data = await window.ShopApi.getCart();
      cartItems = Array.isArray(data) ? data : [];
      renderCart();
    } catch (error) {
      console.error("[shop cart] load failed", error);
      if (refs.cartListEl) {
        refs.cartListEl.innerHTML = '<div class="good-product-empty">購物車讀取失敗。</div>';
      }
      if (refs.cartTotalEl) {
        refs.cartTotalEl.textContent = formatPrice(0);
      }
    }
  }

  async function changeQuantity(cartId, delta) {
    const target = cartItems.find((item) => String(item?.id) === String(cartId));

    if (!target) {
      return;
    }

    const currentQuantity = Number(target?.quantity || 0);
    const nextQuantity = currentQuantity + delta;

    if (nextQuantity < 1) {
      await removeItem(cartId);
      return;
    }

    try {
      const updated = await window.ShopApi.updateCartItem(cartId, { quantity: nextQuantity });
      target.quantity = Number(updated?.quantity || nextQuantity);
      renderCart();
    } catch (error) {
      console.error("[shop cart] update failed", error);
    }
  }

  async function removeItem(cartId) {
    try {
      await window.ShopApi.removeCartItem(cartId);
      cartItems = cartItems.filter((item) => String(item?.id) !== String(cartId));
      renderCart();
    } catch (error) {
      console.error("[shop cart] remove failed", error);
    }
  }

  function attachEvents() {
    const checkoutBtn = document.querySelector(".shop-cart-submit");
    if (checkoutBtn) {
      checkoutBtn.addEventListener("click", handleCheckout);
    }

    if (!refs.cartListEl) {
      return;
    }

    refs.cartListEl.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");

      if (!button) {
        return;
      }

      const action = button.dataset.action;
      const cartId = button.dataset.cartId;

      if (!cartId) {
        return;
      }

      if (action === "increment") {
        await changeQuantity(cartId, 1);
      } else if (action === "decrement") {
        await changeQuantity(cartId, -1);
      } else if (action === "remove") {
        await removeItem(cartId);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    if (window.UserStore?.initUser) {
      await window.UserStore.initUser();
    }
    attachEvents();
    await loadCart();
  });
})();
