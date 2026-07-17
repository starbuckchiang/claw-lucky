(function () {
  const selectionService = window.WallpaperSelectionService;
  const generationClientApi = window.WallpaperGenerationClient;

  const refs = {
    form: document.getElementById("wallpaperForm"),
    submitBtn: document.getElementById("submitGenerationBtn"),
    resetBtn: document.getElementById("resetGenerationBtn"),
    wallpaperStyle: document.getElementById("wallpaperStyle"),
    luckyTheme: document.getElementById("luckyTheme"),
    blessing: document.getElementById("blessing"),
    promptType: document.getElementById("promptType"),
    selectionPreviewText: document.getElementById("selectionPreviewText"),
    collectionCards: document.getElementById("collectionCards"),
    giftCards: document.getElementById("giftCards"),
    collectionStatus: document.getElementById("collectionStatus"),
    giftStatus: document.getElementById("giftStatus"),
    collectionEmpty: document.getElementById("collectionEmpty"),
    giftEmpty: document.getElementById("giftEmpty"),
    collectionError: document.getElementById("collectionError"),
    giftError: document.getElementById("giftError"),
    progressText: document.getElementById("progressText"),
    progressBar: document.getElementById("progressBar"),
    metaGenerationId: document.getElementById("metaGenerationId"),
    metaStatus: document.getElementById("metaStatus"),
    metaPollInterval: document.getElementById("metaPollInterval"),
    resultEmpty: document.getElementById("resultEmpty"),
    resultFigure: document.getElementById("resultFigure"),
    resultImage: document.getElementById("resultImage"),
    resultProvider: document.getElementById("resultProvider"),
    resultModel: document.getElementById("resultModel"),
    resultPromptVersion: document.getElementById("resultPromptVersion"),
    errorBox: document.getElementById("errorBox"),
    errorMessage: document.getElementById("errorMessage"),
    debugProvider: document.getElementById("debugProvider"),
    debugModel: document.getElementById("debugModel"),
    debugCorrelationId: document.getElementById("debugCorrelationId"),
    debugGenerationId: document.getElementById("debugGenerationId")
  };

  // Last correlation id observed from the `X-Correlation-Id` response header
  // (ADR-008). Debug-only; never used for business logic.
  let lastCorrelationId = "";

  function updateDebugPanel(info) {
    const data = info || {};
    if (refs.debugProvider && data.provider !== undefined) refs.debugProvider.textContent = data.provider || "—";
    if (refs.debugModel && data.model !== undefined) refs.debugModel.textContent = data.model || "—";
    if (refs.debugCorrelationId && data.correlationId !== undefined) refs.debugCorrelationId.textContent = data.correlationId || "—";
    if (refs.debugGenerationId && data.generationId !== undefined) refs.debugGenerationId.textContent = data.generationId || "—";
  }

  async function authorizedFetch(url, options) {
    const fetchOptions = options || {};
    let accessToken = "";

    try {
      const sessionResult = await (window.supabaseClient && window.supabaseClient.auth && window.supabaseClient.auth.getSession
        ? window.supabaseClient.auth.getSession()
        : null);
      accessToken = (sessionResult && sessionResult.data && sessionResult.data.session && sessionResult.data.session.access_token) || "";
    } catch (_error) {
      accessToken = "";
    }

    const headers = new Headers(fetchOptions.headers || {});
    if (window.SUPABASE_ANON_KEY) headers.set("apikey", window.SUPABASE_ANON_KEY);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

    const response = await fetch(url, Object.assign({}, fetchOptions, { headers }));

    const correlationId = response.headers.get("X-Correlation-Id");
    if (correlationId) {
      lastCorrelationId = correlationId;
      updateDebugPanel({ correlationId });
    }

    return response;
  }

  function createEdgeFunctionGenerationApi() {
    const functionsBaseUrl = String(window.SUPABASE_FUNCTIONS_URL || "").replace(/\/+$/, "");

    return generationClientApi.createWallpaperHttpApiClient({
      postGenerationUrl: `${functionsBaseUrl}/wallpaper-generate`,
      getProgressUrl(generationId) {
        return `${functionsBaseUrl}/wallpaper-status?id=${encodeURIComponent(generationId)}`;
      },
      fetchImpl: authorizedFetch
    });
  }

  const dataState = {
    userId: "",
    collection: [],
    gifts: [],
    selection: selectionService.createSelectionState()
  };

  function setSubmitting(submitting) {
    if (refs.submitBtn) refs.submitBtn.disabled = submitting;
    if (refs.resetBtn) refs.resetBtn.disabled = submitting;
  }

  function setProgress(progressText, progressPercent, status, pollIntervalText) {
    if (refs.progressText) refs.progressText.textContent = progressText;
    if (refs.progressBar) refs.progressBar.style.width = `${Math.max(0, Math.min(100, Number(progressPercent || 0)))}%`;
    if (refs.metaStatus) refs.metaStatus.textContent = status || "unknown";
    if (refs.metaPollInterval) refs.metaPollInterval.textContent = pollIntervalText || "—";
  }

  function showError(error) {
    if (refs.errorBox) refs.errorBox.classList.remove("hidden");
    if (refs.errorMessage) {
      const code = String(error?.code || "GENERATION_FAILED");
      const message = String(error?.message || "生成失敗，請稍後再試。");
      refs.errorMessage.textContent = `[${code}] ${message}`;
    }
  }

  function clearError() {
    if (refs.errorBox) refs.errorBox.classList.add("hidden");
    if (refs.errorMessage) refs.errorMessage.textContent = "—";
  }

  function clearResult() {
    if (refs.resultEmpty) refs.resultEmpty.classList.remove("hidden");
    if (refs.resultFigure) refs.resultFigure.classList.add("hidden");
    if (refs.resultImage) refs.resultImage.removeAttribute("src");
    if (refs.resultProvider) refs.resultProvider.textContent = "—";
    if (refs.resultModel) refs.resultModel.textContent = "—";
    if (refs.resultPromptVersion) refs.resultPromptVersion.textContent = "—";
  }

  function showResult(data) {
    if (refs.resultEmpty) refs.resultEmpty.classList.add("hidden");
    if (refs.resultFigure) refs.resultFigure.classList.remove("hidden");
    if (refs.resultImage) refs.resultImage.src = data.imageUrl;
    if (refs.resultProvider) refs.resultProvider.textContent = data.provider || "unknown";
    if (refs.resultModel) refs.resultModel.textContent = data.model || "—";
    if (refs.resultPromptVersion) refs.resultPromptVersion.textContent = data.promptVersion || "—";
    updateDebugPanel({
      provider: data.provider,
      model: data.model,
      generationId: data.generationId,
      correlationId: lastCorrelationId
    });
  }

  function setLoadingStates() {
    refs.collectionStatus.textContent = "載入中...";
    refs.giftStatus.textContent = "載入中...";
    refs.collectionEmpty.classList.add("hidden");
    refs.giftEmpty.classList.add("hidden");
    refs.collectionError.classList.add("hidden");
    refs.giftError.classList.add("hidden");
  }

  function updatePreview() {
    const preview = selectionService.buildPreview({
      state: dataState.selection,
      collection: dataState.collection,
      gifts: dataState.gifts
    });

    if (!preview.mascot && !preview.gift) {
      refs.selectionPreviewText.textContent = "尚未選擇吉祥物與 Gift。";
      return;
    }

    const mascotText = preview.mascot ? preview.mascot.name : "未選擇吉祥物";
    const giftText = preview.gift ? preview.gift.name : "未選擇 Gift";
    refs.selectionPreviewText.textContent = `已選擇：${mascotText} + ${giftText}`;
  }

  function createCard({ item, selected, subtitleText, onClick }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wallpaper-card";
    button.setAttribute("role", "option");
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.dataset.id = item.id;
    button.innerHTML = `
      <div class="wallpaper-card-media">
        ${item.image ? `<img src="${item.image}" alt="${item.name}" />` : ""}
      </div>
      <div class="wallpaper-card-title">${item.name}</div>
      <div class="wallpaper-card-subtitle">${subtitleText}</div>
    `;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderCollectionCards() {
    refs.collectionCards.innerHTML = "";
    for (const mascot of dataState.collection) {
      const card = createCard({
        item: mascot,
        selected: dataState.selection.mascotId === mascot.id,
        subtitleText: `稀有度：${mascot.rarity}`,
        onClick() {
          selectionService.selectMascot(dataState.selection, mascot.id);
          renderCollectionCards();
          updatePreview();
        }
      });
      refs.collectionCards.appendChild(card);
    }
  }

  function renderGiftCards() {
    refs.giftCards.innerHTML = "";
    for (const gift of dataState.gifts) {
      const card = createCard({
        item: gift,
        selected: dataState.selection.giftId === gift.id,
        subtitleText: `Gift ID：${gift.id}`,
        onClick() {
          selectionService.selectGift(dataState.selection, gift.id);
          renderGiftCards();
          updatePreview();
        }
      });
      refs.giftCards.appendChild(card);
    }
  }

  async function resolveCurrentUserId() {
    if (!window.userReadyPromise && window.UserStore?.initUser) {
      window.userReadyPromise = window.UserStore.initUser();
    }

    const user = window.userReadyPromise ? await window.userReadyPromise : null;
    let userId = String(user?.user_id || "").trim();

    if (!userId && window.ClawUser?.getUserId) {
      userId = String((await window.ClawUser.getUserId()) || "").trim();
    }

    return userId;
  }

  async function loadSelectionData() {
    setLoadingStates();

    dataState.userId = await resolveCurrentUserId();
    if (!dataState.userId) {
      showError({
        code: "UNAUTHORIZED_GENERATION_ACCESS",
        message: "請先登入再使用桌布生成功能。"
      });
      refs.collectionStatus.textContent = "未登入";
      refs.giftStatus.textContent = "未登入";
      return;
    }

    const [collectionResult, giftResult] = await Promise.all([
      selectionService.loadCollection({ api: window.Api, userId: dataState.userId }),
      selectionService.loadGifts({ api: window.Api })
    ]);

    if (!collectionResult.ok) {
      refs.collectionError.textContent = `[${collectionResult.error.code}] ${collectionResult.error.message}`;
      refs.collectionError.classList.remove("hidden");
      refs.collectionStatus.textContent = "載入失敗";
      dataState.collection = [];
    } else {
      dataState.collection = collectionResult.data;
      refs.collectionStatus.textContent = `${dataState.collection.length} 筆`;
      refs.collectionEmpty.classList.toggle("hidden", dataState.collection.length > 0);
    }

    if (!giftResult.ok) {
      refs.giftError.textContent = `[${giftResult.error.code}] ${giftResult.error.message}`;
      refs.giftError.classList.remove("hidden");
      refs.giftStatus.textContent = "載入失敗";
      dataState.gifts = [];
    } else {
      dataState.gifts = giftResult.data;
      refs.giftStatus.textContent = `${dataState.gifts.length} 筆`;
      refs.giftEmpty.classList.toggle("hidden", dataState.gifts.length > 0);
    }

    renderCollectionCards();
    renderGiftCards();
    updatePreview();
  }

  function createGenerationRequest() {
    // NOTE: `userId` is intentionally omitted — the Edge Function derives the
    // authenticated user from the verified Supabase session (Authorization
    // header), never from client-supplied request fields.
    return {
      mascotId: dataState.selection.mascotId,
      giftId: dataState.selection.giftId,
      wallpaperStyle: String(refs.wallpaperStyle?.value || "").trim(),
      luckyTheme: String(refs.luckyTheme?.value || "").trim(),
      blessing: String(refs.blessing?.value || "").trim(),
      promptType: String(refs.promptType?.value || "wallpaper_generation").trim()
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearError();
    clearResult();

    if (!dataState.selection.mascotId || !dataState.selection.giftId) {
      showError({
        code: "INVALID_REQUEST",
        message: "請先選擇吉祥物與 Gift。"
      });
      return;
    }

    setSubmitting(true);
    setProgress("準備送出生成請求...", 0, "submitting", "—");

    try {
      const generationClient = generationClientApi.createWallpaperGenerationClient({
        generationApi: createEdgeFunctionGenerationApi()
      });

      const result = await selectionService.submitGenerationSelection({
        generationClient,
        request: createGenerationRequest(),
        onProgress(progressData) {
          if (refs.metaGenerationId) refs.metaGenerationId.textContent = progressData?.generationId || "—";
          setProgress(
            `生成中 (${progressData?.progressStage || progressData?.status || "processing"})...`,
            progressData?.progressPercent || 0,
            progressData?.status || "processing",
            progressData?.terminal ? "terminal" : `${progressData?.recommendedPollIntervalMs || 0}ms`
          );
          updateDebugPanel({
            provider: progressData?.provider,
            model: progressData?.model,
            generationId: progressData?.generationId
          });
        }
      });

      if (!result.ok) {
        showError(result.error);
        updateDebugPanel({ correlationId: lastCorrelationId });
        return;
      }

      if (refs.metaGenerationId) refs.metaGenerationId.textContent = result.data.generationId || "—";
      setProgress("生成完成。", 100, "succeeded", "terminal");
      showResult(result.data);
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    refs.form?.reset();
    clearError();
    clearResult();
    selectionService.selectMascot(dataState.selection, null);
    selectionService.selectGift(dataState.selection, null);
    renderCollectionCards();
    renderGiftCards();
    updatePreview();
    if (refs.metaGenerationId) refs.metaGenerationId.textContent = "—";
    setProgress("尚未開始。", 0, "idle", "—");
    updateDebugPanel({ provider: null, model: null, correlationId: null, generationId: null });
  }

  function bindEvents() {
    refs.form?.addEventListener("submit", handleSubmit);
    refs.resetBtn?.addEventListener("click", handleReset);
  }

  async function initWallpaperPage() {
    bindEvents();
    handleReset();
    await loadSelectionData();
  }

  document.addEventListener("DOMContentLoaded", initWallpaperPage);
})();
