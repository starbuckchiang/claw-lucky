/* ============================================================
   Lucky Shop / good.js
   ------------------------------------------------------------
   負責：
   1. 從 Supabase shop_products 載入商品
   2. 渲染 Lucky Shop 商品卡
   3. 顯示商品圖片
   4. 點商品進入 product.html?id=...
   ============================================================ */

(function () {
  const refs = {
    productGridEl: document.getElementById("productGrid"),
    askShopkeeperBtnEl: document.getElementById("askShopkeeperBtn"),
    floatingRobotEl: document.querySelector(".good-floating-robot")
  };

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

  function getProductImage(product) {
    return product.thumbnail || product.image || product.cover || "";
  }

  function buildProductImage(product) {
    const image = getProductImage(product);
    const name = product.name || "商品";

    if (!image) {
      return `
        <div class="good-product-image-placeholder">
          ${escapeHtml(name)}
        </div>
      `;
    }

    return `
      <img
        src="${escapeHtml(image)}"
        alt="${escapeHtml(name)}"
        loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <div class="good-product-image-placeholder" style="display:none;">
        ${escapeHtml(name)}
      </div>
    `;
  }

  function buildProductCard(product) {
    const id = escapeHtml(product.id);
    const name = escapeHtml(product.name || "未命名商品");
    const subtitle = escapeHtml(product.subtitle || product.description || "");
    const badge = escapeHtml(product.badge || "LIMITED");
    const price = formatPrice(product.price);
    const stock = Number(product.stock || 0);

    const stockText =
      stock > 0 ? `剩餘 ${stock} 件` : "已售完";

    const buttonText =
      stock > 0 ? "查看商品" : "暫時售完";

    return `
      <article class="good-product-card">
        <div class="good-product-image">
          ${buildProductImage(product)}
        </div>

        <div class="good-product-body">
          <span class="good-product-tag">${badge}</span>

          <h3 class="good-product-name">${name}</h3>

          <p class="good-product-desc">${subtitle}</p>

          <div class="good-product-meta">
            <strong class="good-price">${price}</strong>
            <span class="good-stock">${stockText}</span>
          </div>

          <button
            class="good-btn ${stock > 0 ? "good-btn-primary" : "good-btn-secondary"}"
            type="button"
            data-product-id="${id}"
            ${stock <= 0 ? "disabled" : ""}
          >
            ${buttonText}
          </button>
        </div>
      </article>
    `;
  }

  function renderProducts(products) {
    if (!refs.productGridEl) return;

    if (!Array.isArray(products) || !products.length) {
      refs.productGridEl.innerHTML = `
        <div class="good-product-empty">
          目前尚無上架商品，請稍後再回來逛逛。
        </div>
      `;
      return;
    }

    refs.productGridEl.innerHTML = products.map(buildProductCard).join("");
  }

  async function loadProducts() {
    if (!window.ShopApi?.getProducts) {
      throw new Error("ShopApi.getProducts 尚未載入");
    }

    const products = await window.ShopApi.getProducts();
    renderProducts(products);
  }

  function handleProductClick(event) {
    const button = event.target.closest("[data-product-id]");
    if (!button) return;

    const productId = button.dataset.productId;
    if (!productId) return;

    location.href = `./product.html?id=${encodeURIComponent(productId)}`;
  }

  function handleAskShopkeeper() {
    alert("🦎 Lucky 店長準備中：之後可以幫你推薦商品、查訂單與物流。");
  }

  function bindEvents() {
    if (refs.productGridEl) {
      refs.productGridEl.addEventListener("click", handleProductClick);
    }

    if (refs.askShopkeeperBtnEl) {
      refs.askShopkeeperBtnEl.addEventListener("click", handleAskShopkeeper);
    }

    if (refs.floatingRobotEl) {
      refs.floatingRobotEl.addEventListener("click", handleAskShopkeeper);
    }
  }

  async function initGoodPage() {
    try {
      document.body.classList.add("page-ready");

      if (window.UserStore?.initUser) {
        await window.UserStore.initUser();
      }

      await loadProducts();
      bindEvents();
    } catch (error) {
      console.error("[good] init failed =", error);

      if (refs.productGridEl) {
        refs.productGridEl.innerHTML = `
          <div class="good-product-empty">
            商品讀取失敗：${escapeHtml(error.message)}
          </div>
        `;
      }
    }
  }

  document.addEventListener("DOMContentLoaded", initGoodPage);
})();
