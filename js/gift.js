alert('現在吃到的是最新 gift.js');

document.addEventListener('DOMContentLoaded', () => {
  const giftGridEl = document.getElementById('giftGrid');

  if (!giftGridEl) {
    alert('找不到 giftGrid');
    return;
  }

  giftGridEl.innerHTML = `
    <div style="padding:20px; background:yellow; color:black; margin-bottom:12px;">
      giftGrid 測試成功
    </div>

    <div style="padding:20px; background:white; border:3px solid red; color:black;">
      這是最新 gift.js 直接寫死的商品卡
      <br><br>
      <button onclick="alert('測試按鈕可點')">測試兌換</button>
    </div>
  `;
});
