"use strict";

/**
 * PROD-RELEASE-DAY3C (line 151-198): minimal admin backend page controller.
 * Admin status is NEVER trusted client-side — every admin-ops call is
 * re-checked server-side via is_admin_user(); a non-admin simply gets a
 * generic 403 and sees an error message here, nothing more.
 */

(function () {
  const refs = {
    authStatus: document.getElementById("adminAuthStatus"),
    content: document.getElementById("adminContent"),
    refundList: document.getElementById("refundList"),
    giftList: document.getElementById("giftList"),
    refreshBtn: document.getElementById("refreshBtn")
  };

  async function invokeAdminOps(body) {
    const { data, error } = await window.supabaseClient.functions.invoke("admin-ops", { body });
    if (error) {
      try {
        const parsed = await error.context?.json?.();
        if (parsed && typeof parsed === "object") return parsed;
      } catch (_e) {
        // fall through
      }
      return { ok: false, error: { code: "REQUEST_FAILED", message: "請求失敗，請稍後再試。" } };
    }
    return data;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    children.forEach((c) => node.appendChild(c));
    return node;
  }

  function renderRefundRow(row) {
    const li = el("li", { className: "admin-row" });
    li.appendChild(el("div", {
      textContent: `#${row.id} user=${row.user_id} sub退款=${row.subscription_refund_amount ?? "—"} ${row.subscription_refund_currency ?? ""} 運費退款=${row.shipping_refund_amount ?? "—"} 贈品須退回=${row.gift_return_required ? "是" : "否"}`
    }));

    const approveBtn = el("button", { className: "btn", textContent: "核准" });
    approveBtn.addEventListener("click", async () => {
      const note = window.prompt("審核備註（可留白）：", "") || "";
      const result = await invokeAdminOps({ action: "review_refund", requestId: row.id, decision: "approved", note });
      alert(result?.ok ? "已核准" : (result?.error?.message || "操作失敗"));
      if (result?.ok) loadAll();
    });

    const rejectBtn = el("button", { className: "btn", textContent: "拒絕" });
    rejectBtn.addEventListener("click", async () => {
      const note = window.prompt("拒絕原因（可留白）：", "") || "";
      const result = await invokeAdminOps({ action: "review_refund", requestId: row.id, decision: "rejected", note });
      alert(result?.ok ? "已拒絕" : (result?.error?.message || "操作失敗"));
      if (result?.ok) loadAll();
    });

    const confirmBtn = el("button", { className: "btn", textContent: "確認已退款（需 PayPal 退款單號）" });
    confirmBtn.addEventListener("click", async () => {
      const paypalRefundId = window.prompt("請輸入 PayPal 實際退款交易編號：", "");
      if (!paypalRefundId) return;
      const result = await invokeAdminOps({ action: "confirm_refund_success", requestId: row.id, paypalRefundId });
      alert(result?.ok ? "已標記退款成功" : (result?.error?.message || "操作失敗"));
      if (result?.ok) loadAll();
    });

    li.appendChild(approveBtn);
    li.appendChild(rejectBtn);
    li.appendChild(confirmBtn);
    return li;
  }

  function renderGiftRow(row) {
    const li = el("li", { className: "admin-row" });
    li.appendChild(el("div", {
      textContent: `#${row.id} user=${row.user_id} ${row.recipient_name ?? ""} ${row.city ?? ""}${row.region ?? ""}${row.address_line1 ?? ""}`
    }));

    const shipBtn = el("button", { className: "btn", textContent: "標記已出貨（需掛號號碼）" });
    shipBtn.addEventListener("click", async () => {
      const trackingNumber = window.prompt("請輸入中華郵政掛號號碼：", "");
      if (!trackingNumber) return;
      const result = await invokeAdminOps({ action: "mark_shipped", entitlementId: row.id, trackingNumber });
      alert(result?.ok ? "已標記出貨" : (result?.error?.message || "操作失敗"));
      if (result?.ok) loadAll();
    });

    li.appendChild(shipBtn);
    return li;
  }

  async function loadAll() {
    refs.refundList.innerHTML = "";
    refs.giftList.innerHTML = "";

    const refunds = await invokeAdminOps({ action: "list_pending_refunds" });
    if (!refunds?.ok) {
      refs.authStatus.textContent = refunds?.error?.message || "無法載入退款審核清單。";
      refs.content.hidden = true;
      return;
    }
    refs.content.hidden = false;
    refs.authStatus.textContent = "";

    if (!refunds.refund_requests.length) {
      refs.refundList.appendChild(el("li", { textContent: "目前沒有待審核退款申請。" }));
    } else {
      refunds.refund_requests.forEach((row) => refs.refundList.appendChild(renderRefundRow(row)));
    }

    const gifts = await invokeAdminOps({ action: "list_shippable_gifts" });
    if (gifts?.ok) {
      if (!gifts.gifts.length) {
        refs.giftList.appendChild(el("li", { textContent: "目前沒有待出貨贈品。" }));
      } else {
        gifts.gifts.forEach((row) => refs.giftList.appendChild(renderGiftRow(row)));
      }
    }
  }

  async function init() {
    const { data } = await window.supabaseClient.auth.getSession();
    const user = data?.session?.user || null;

    if (!user || user.is_anonymous) {
      refs.authStatus.innerHTML = "請先於<a href=\"./subscription.html?return=admin\">訂閱方案頁登入</a>您的正式帳號，登入後會自動返回這裡。";
      refs.content.hidden = true;
      return;
    }

    refs.authStatus.textContent = "載入中…";
    await loadAll();
  }

  async function handleGrantEntitlementClick() {
    const targetUserId = window.prompt("請輸入要授與人工測試權益的使用者 ID（Supabase Auth UID）：", "");
    if (!targetUserId) return;
    const expiresAtInput = window.prompt(
      "到期時間（台灣時間，格式 YYYY-MM-DD HH:MM:SS）：",
      "2026-10-31 23:59:59"
    );
    if (!expiresAtInput) return;
    const expiresAtMatch = String(expiresAtInput).trim().match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
    );
    if (!expiresAtMatch) {
      alert("時間格式錯誤，請使用 YYYY-MM-DD HH:MM:SS（台灣時間）。");
      return;
    }
    const expiresAtIso = `${expiresAtMatch[1]}-${expiresAtMatch[2]}-${expiresAtMatch[3]}T${expiresAtMatch[4]}:${expiresAtMatch[5]}:${expiresAtMatch[6]}+08:00`;
    const reason = window.prompt("授權原因（會記錄於稽核紀錄）：", "manual test entitlement") || "";

    const result = await invokeAdminOps({
      action: "grant_manual_wallpaper_entitlement",
      targetUserId,
      expiresAt: expiresAtIso,
      reason
    });
    alert(
      result?.ok
        ? `已授與人工測試權益，至 ${result.expires_at} 止。`
        : (result?.error?.message || "操作失敗")
    );
  }

  if (refs.refreshBtn) {
    refs.refreshBtn.addEventListener("click", loadAll);
  }
  if (refs.grantEntitlementBtn) {
    refs.grantEntitlementBtn.addEventListener("click", handleGrantEntitlementClick);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
