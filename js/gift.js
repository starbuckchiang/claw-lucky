document.documentElement.classList.add('page-ready');

const fallbackImage = './image/image.png';

function applyImageFallback() {
  document.querySelectorAll('img').forEach((img) => {
    img.addEventListener(
      'error',
      () => {
        if (!img.dataset.fallbackApplied) {
          img.dataset.fallbackApplied = 'true';
          img.src = fallbackImage;
        }
      },
      { once: true }
    );
  });
}

function bindGiftLinks() {
  document.querySelectorAll('[data-entry-link]').forEach((link) => {
    link.addEventListener('click', () => {
      link.classList.add('is-pressed');
      setTimeout(() => {
        link.classList.remove('is-pressed');
      }, 180);
    });
  });
}

function bindGiftButtons() {
  const buttons = document.querySelectorAll('[data-gift-action]');

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const statusTarget = document.querySelector(button.dataset.statusTarget || '[data-gift-status]');

      if (statusTarget) {
        const actionType = button.dataset.giftAction || 'default';

        if (actionType === 'redeem') {
          statusTarget.textContent = '已收到兌換操作，請依活動規則完成後續流程。';
        } else if (actionType === 'wish') {
          statusTarget.textContent = '即將前往送出願望頁面。';
        } else {
          statusTarget.textContent = '操作已執行。';
        }
      }
    });
  });
}

function initGiftPage() {
  applyImageFallback();
  bindGiftLinks();
  bindGiftButtons();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGiftPage);
} else {
  initGiftPage();
}
