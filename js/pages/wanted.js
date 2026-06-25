document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("page-ready");

  setupEntryLinkEffects();
  applyCategoryFromQuery();
  setupWantedForm();
});

function setupEntryLinkEffects() {
  const entryButtons = document.querySelectorAll("[data-entry-link]");

  entryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      button.classList.add("is-clicked");
      setTimeout(() => {
        button.classList.remove("is-clicked");
      }, 180);
    });
  });
}

function applyCategoryFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("category");
  const categorySelect = document.getElementById("wanted-category");

  if (!slug || !categorySelect) return;

  const categoryMap = {
    skates: "冰刀鞋",
    "shoe-covers": "鞋套",
    spinner: "旋轉板",
    clothes: "服飾 / T-shirt / 夾克",
    plush: "絨毛娃娃 / 可愛小物",
    hockey: "Hockey 球鞋與裝備"
  };

  const mappedValue = categoryMap[slug];
  if (mappedValue) {
    categorySelect.value = mappedValue;
  }
}

function setupWantedForm() {
  const form = document.getElementById("wantedForm");
  const statusEl = document.getElementById("wantedFormStatus");
  const submitBtn = document.getElementById("submitWantedBtn");

  const categoryInput = document.getElementById("wanted-category");
  const descInput = document.getElementById("wanted-desc");
  const nicknameInput = document.getElementById("wanted-nickname");
  const contactInput = document.getElementById("wanted-contact");
  const dateInput = document.getElementById("wanted-date");
  const timeInput = document.getElementById("wanted-time");

  const gfDateYear = document.getElementById("gf-date-year");
  const gfDateMonth = document.getElementById("gf-date-month");
  const gfDateDay = document.getElementById("gf-date-day");
  const gfTimeHour = document.getElementById("gf-time-hour");
  const gfTimeMinute = document.getElementById("gf-time-minute");

  if (
    !form ||
    !statusEl ||
    !submitBtn ||
    !categoryInput ||
    !descInput ||
    !nicknameInput ||
    !contactInput ||
    !dateInput ||
    !timeInput ||
    !gfDateYear ||
    !gfDateMonth ||
    !gfDateDay ||
    !gfTimeHour ||
    !gfTimeMinute
  ) {
    return;
  }

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function syncDateTimeToGoogleForm() {
    const dateValue = dateInput.value;
    const timeValue = timeInput.value;

    gfDateYear.value = "";
    gfDateMonth.value = "";
    gfDateDay.value = "";
    gfTimeHour.value = "";
    gfTimeMinute.value = "";

    if (dateValue) {
      const parts = dateValue.split("-");
      gfDateYear.value = parts[0] || "";
      gfDateMonth.value = parts[1] || "";
      gfDateDay.value = parts[2] || "";
    }

    if (timeValue) {
      const parts = timeValue.split(":");
      gfTimeHour.value = parts[0] || "";
      gfTimeMinute.value = parts[1] || "";
    }
  }

  function validateForm() {
    if (!(categoryInput.value || "").trim()) {
      setStatus("請先選擇物品分類。");
      categoryInput.focus();
      return false;
    }

    if (!(descInput.value || "").trim()) {
      setStatus("請填寫徵求物品敘述。");
      descInput.focus();
      return false;
    }

    if (!(nicknameInput.value || "").trim()) {
      setStatus("請填寫暱稱或呼號。");
      nicknameInput.focus();
      return false;
    }

    if (!(contactInput.value || "").trim()) {
      setStatus("請填寫聯絡方式。");
      contactInput.focus();
      return false;
    }

    if (!(dateInput.value || "").trim()) {
      setStatus("請選擇日期。");
      dateInput.focus();
      return false;
    }

    if (!(timeInput.value || "").trim()) {
      setStatus("請選擇時間。");
      timeInput.focus();
      return false;
    }

    return true;
  }

  dateInput.addEventListener("change", syncDateTimeToGoogleForm);
  timeInput.addEventListener("change", syncDateTimeToGoogleForm);
  dateInput.addEventListener("input", syncDateTimeToGoogleForm);
  timeInput.addEventListener("input", syncDateTimeToGoogleForm);

  form.addEventListener("submit", (event) => {
    if (!validateForm()) {
      event.preventDefault();
      return;
    }

    syncDateTimeToGoogleForm();

    setTimeout(() => {
      syncDateTimeToGoogleForm();
    }, 0);

    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    setStatus("正在整理日期時間並送出 Google Form，請稍候…");
  });
}
