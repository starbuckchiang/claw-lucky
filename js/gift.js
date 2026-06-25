alert('gift.js 測試版已載入');

document.addEventListener('DOMContentLoaded', () => {
  const giftGridEl = document.getElementById('giftGrid');

  if (!giftGridEl) {
    alert('找不到 giftGrid');
    return;
  }

  giftGridEl.innerHTML = `
    <div style="padding:20px; background:yellow; color:black; font-size:18px;">
      giftGrid 測試成功
    </div>
  `;
});
