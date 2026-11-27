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

  let loadedProducts = [];

  function isShopSim() {
    return Boolean(window.ShopSim?.isActive?.());
  }

  function showSimBanner(extra) {
    const el = document.getElementById("shopSimBanner");
    const text = el?.querySelector("[data-sim-banner-text]");
    if (!el || !text) return;
    const base = window.ShopSim?.BANNER_TEXT || "測試模擬：不扣款、不建立正式訂單、不開立發票、不建立物流單。";
    text.textContent = extra ? `${base}${extra}` : base;
    el.hidden = false;
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("商品列表逾時")), ms);
      promise.then((value) => {
        clearTimeout(timer);
        resolve(value);
      }, (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
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

  function getProductImage(product) {
    if (!product || typeof product !== "object") {
      return "";
    }

    return (
      product.thumbnail ||
      product.image ||
      product.cover ||
      product.image_url ||
      ""
    );
  }

  function buildProductImage(product) {
    const image = getProductImage(product);
    const name = product?.name || product?.title || "商品";

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
    const rawId = String(product?.id || "");
    const id = escapeHtml(rawId);
    const name = escapeHtml(product?.name || product?.title || "未命名商品");
    const subtitle = escapeHtml(product?.subtitle || product?.description || "");
    const badge = escapeHtml(product?.badge || product?.tag || "LIMITED");
    const price = formatPrice(product?.price ?? 0);
    const stock = Number(product?.stock ?? 0);
    const sim = isShopSim();

    const stockText =
      stock > 0 ? `剩餘 ${stock} 件` : "已售完";

    const buttonText =
      stock > 0 ? (sim ? "加入並結帳" : "查看商品") : "暫時售完";
    const action = sim ? "sim-checkout" : "view-product";
    const detailHref = escapeHtml(`./product.html?id=${encodeURIComponent(rawId)}&shopSim=1`);
    const detailLink = sim && stock > 0
      ? `<a class="good-sim-detail" href="${detailHref}">商品詳情</a>`
      : "";

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
            data-action="${action}"
            data-product-id="${id}"
            ${stock <= 0 ? "disabled" : ""}
          >
            ${buttonText}
          </button>
          ${detailLink}
        </div>
      </article>
    `;
  }

  function renderProducts(products) {
    const container = refs.productGridEl;
    console.log("[good] product container =", container);
    if (!container) return;

    if (!Array.isArray(products) || !products.length) {
      container.innerHTML = `
        <div class="good-product-empty">
          目前尚無上架商品，請稍後再回來逛逛。
        </div>
      `;
      return;
    }

    container.innerHTML = products.map(buildProductCard).join("");
  }

  function useDemoProducts(reason) {
    loadedProducts = window.ShopSim?.getDemoProducts?.() || [];
    renderProducts(loadedProducts);
    showSimBanner(reason);
  }

  async function loadProducts() {
    console.log("[good] loadProducts started");
    console.log("[good] ShopApi =", window.ShopApi);
    const sim = isShopSim();

    if (!window.ShopApi?.getProducts) {
      if (sim) {
        useDemoProducts("商品服務還沒載入，這次改顯示展示用測試商品。不會寫入正式訂單或庫存。");
        return;
      }
      throw new Error("ShopApi.getProducts 尚未載入");
    }

    try {
      const request = window.ShopApi.getProducts();
      const products = sim ? await withTimeout(request, 8000) : await request;
      console.log("[good] products =", products);
      if (sim && (!Array.isArray(products) || !products.length)) {
        useDemoProducts("目前沒有上架商品，這次改顯示展示用測試商品。不會寫入正式訂單或庫存。");
        return;
      }
      loadedProducts = Array.isArray(products) ? products : [];
      renderProducts(loadedProducts);
    } catch (error) {
      if (sim) {
        console.warn("[good] sim catalog fallback", error);
        useDemoProducts("商品服務讀取失敗，這次改顯示展示用測試商品。不會寫入正式訂單或庫存。");
        return;
      }
      throw error;
    }
  }

  function findLoadedProduct(productId) {
    return loadedProducts.find((item) => String(item?.id || "") === productId)
      || window.ShopSim?.getDemoProduct?.(productId)
      || null;
  }

  function handleProductClick(event) {
    const simButton = event.target.closest("button[data-action='sim-checkout'][data-product-id]");
    if (simButton) {
      event.preventDefault();
      event.stopPropagation();
      const product = findLoadedProduct(simButton.dataset.productId);
      if (!product || !window.ShopSim?.createDraftFromProduct) return;
      window.ShopSim.activate?.();
      window.ShopSim.writeDraft(window.ShopSim.createDraftFromProduct(product, 1));
      window.location.assign("./shop_sim_checkout.html");
      return;
    }

    const button = event.target.closest("button[data-action='view-product'][data-product-id]");
    if (!button) return;

    const productId = button.dataset.productId;
    if (!productId) return;

    event.preventDefault();
    event.stopPropagation();
    window.location.assign(`./product.html?id=${encodeURIComponent(productId)}`);
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
      console.log("[good] initGoodPage started");
      document.body.classList.add("page-ready");
      window.ShopSim?.activateFromUrl?.(window.location.search);
      if (isShopSim()) showSimBanner();

      if (window.UserStore?.initUser) {
        const userInit = Promise.resolve()
          .then(() => window.UserStore.initUser())
          .catch((error) => {
            console.warn("[good] user init failed, continue loading products", error);
          });
        if (isShopSim()) {
          userInit.catch(() => {});
        } else {
          await userInit;
        }
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
