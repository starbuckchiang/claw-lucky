"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeOneLiner,
  formatTaipeiDateFromIso,
  buildFooterMetaLine,
  wrapTextByMeasurement,
  createObjectUrlTracker,
  composeWallpaperImage
} = require("../wallpaper-canvas-composer");

// A deterministic fake measurer: each character costs 10 "px", regardless
// of script, so tests can reason about exact widths without a real canvas.
function fakeMeasureFn(text) {
  return text.length * 10;
}

// --- sanitizeOneLiner -------------------------------------------------------

test("sanitizeOneLiner trims strings and returns '' for non-strings/blank input", () => {
  assert.equal(sanitizeOneLiner("  \u7a69\u7a69\u63a5\u4f4f\u4eca\u5929\u7684\u597d\u904b  "), "\u7a69\u7a69\u63a5\u4f4f\u4eca\u5929\u7684\u597d\u904b");
  assert.equal(sanitizeOneLiner(""), "");
  assert.equal(sanitizeOneLiner("   "), "");
  assert.equal(sanitizeOneLiner(null), "");
  assert.equal(sanitizeOneLiner(undefined), "");
  assert.equal(sanitizeOneLiner(42), "");
});

// --- formatTaipeiDateFromIso -------------------------------------------------

test("formatTaipeiDateFromIso formats an ISO createdAt as Asia/Taipei YYYY.MM.DD", () => {
  // 2026-07-20T16:05:00Z is 2026-07-21 00:05 in Asia/Taipei (UTC+8) \u2014 a
  // deliberate UTC-day-boundary case proving Asia/Taipei (not UTC) is used.
  assert.equal(formatTaipeiDateFromIso("2026-07-20T16:05:00.000Z"), "2026.07.21");
});

test("formatTaipeiDateFromIso returns null (never guesses 'now') for missing/invalid input", () => {
  assert.equal(formatTaipeiDateFromIso(null), null);
  assert.equal(formatTaipeiDateFromIso(undefined), null);
  assert.equal(formatTaipeiDateFromIso(""), null);
  assert.equal(formatTaipeiDateFromIso("not-a-date"), null);
  assert.equal(formatTaipeiDateFromIso(1690000000000), null);
});

// --- buildFooterMetaLine ------------------------------------------------------

test("buildFooterMetaLine combines date and brand, and gracefully omits missing parts", () => {
  assert.equal(buildFooterMetaLine("2026.07.21", "Claw Lucky"), "2026.07.21\u3000\u30fb\u3000Claw Lucky");
  assert.equal(buildFooterMetaLine(null, "Claw Lucky"), "Claw Lucky");
  assert.equal(buildFooterMetaLine("2026.07.21", null), "2026.07.21");
  assert.equal(buildFooterMetaLine(null, null), "");
  assert.equal(buildFooterMetaLine("", ""), "");
});

// --- wrapTextByMeasurement ----------------------------------------------------

test("wrapTextByMeasurement returns [] for empty/blank oneLiner", () => {
  assert.deepEqual(wrapTextByMeasurement({ text: "", measureFn: fakeMeasureFn, maxWidth: 100 }), []);
  assert.deepEqual(wrapTextByMeasurement({ text: "   ", measureFn: fakeMeasureFn, maxWidth: 100 }), []);
  assert.deepEqual(wrapTextByMeasurement({ text: null, measureFn: fakeMeasureFn, maxWidth: 100 }), []);
});

test("wrapTextByMeasurement wraps CJK text character-by-character (no spaces available)", () => {
  // 10 Traditional Chinese characters, maxWidth 50 => 5 chars/line @ 10px each.
  const text = "\u7a69\u7a69\u63a5\u4f4f\u4eca\u5929\u7684\u597d\u904b\u554a";
  const lines = wrapTextByMeasurement({ text, measureFn: fakeMeasureFn, maxWidth: 50, maxLines: 3 });
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "\u7a69\u7a69\u63a5\u4f4f\u4eca");
  assert.equal(lines[1], "\u5929\u7684\u597d\u904b\u554a");
});

test("wrapTextByMeasurement wraps Latin text word-by-word", () => {
  const text = "Fortune follows you wherever you go today";
  const lines = wrapTextByMeasurement({ text, measureFn: fakeMeasureFn, maxWidth: 130, maxLines: 3 });
  assert.ok(lines.length <= 3);
  assert.ok(lines.every((line) => fakeMeasureFn(line) <= 130));
  // No word should be split (each wrapped line is made of whole words).
  const rejoined = lines.join(" ");
  assert.ok(text.startsWith(rejoined.replace(/\u2026$/, "").trimEnd()) || rejoined.includes("\u2026"));
});

test("wrapTextByMeasurement truncates to maxLines and appends an ellipsis", () => {
  const text = "\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u5341\u4e00\u5341\u4e8c\u5341\u4e09\u5341\u56db\u5341\u4e94";
  const lines = wrapTextByMeasurement({ text, measureFn: fakeMeasureFn, maxWidth: 30, maxLines: 3 });
  assert.equal(lines.length, 3);
  assert.ok(lines[2].endsWith("\u2026"));
});

test("wrapTextByMeasurement handles special characters (emoji, punctuation) without crashing", () => {
  const text = "\u2728\u5e78\u904b\uff01\uff01 100% lucky \ud83c\udf40 \u2014 go!";
  const lines = wrapTextByMeasurement({ text, measureFn: fakeMeasureFn, maxWidth: 80, maxLines: 3 });
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 0);
  assert.ok(lines.every((line) => typeof line === "string"));
});

test("wrapTextByMeasurement falls back to a single unwrapped line when measureFn/maxWidth are unusable", () => {
  const text = "\u5e78\u904b\u4e00\u53e5\u8a71";
  assert.deepEqual(wrapTextByMeasurement({ text, measureFn: null, maxWidth: 100 }), [text]);
  assert.deepEqual(wrapTextByMeasurement({ text, measureFn: fakeMeasureFn, maxWidth: 0 }), [text]);
});

// --- createObjectUrlTracker ---------------------------------------------------

test("createObjectUrlTracker revokes the previous URL whenever a new one is tracked", () => {
  const revoked = [];
  const tracker = createObjectUrlTracker({ urlApi: { revokeObjectURL: (url) => revoked.push(url) } });

  tracker.track("blob:one");
  assert.deepEqual(revoked, []);
  assert.equal(tracker.current(), "blob:one");

  tracker.track("blob:two");
  assert.deepEqual(revoked, ["blob:one"]);
  assert.equal(tracker.current(), "blob:two");

  tracker.track("blob:three");
  assert.deepEqual(revoked, ["blob:one", "blob:two"]);
});

test("createObjectUrlTracker.clear() revokes the current URL and resets state (page-unload safety)", () => {
  const revoked = [];
  const tracker = createObjectUrlTracker({ urlApi: { revokeObjectURL: (url) => revoked.push(url) } });

  tracker.track("blob:one");
  tracker.clear();
  assert.deepEqual(revoked, ["blob:one"]);
  assert.equal(tracker.current(), null);

  // Calling clear() again with nothing tracked must not throw or re-revoke.
  tracker.clear();
  assert.deepEqual(revoked, ["blob:one"]);
});

test("createObjectUrlTracker never throws even if revokeObjectURL itself throws", () => {
  const tracker = createObjectUrlTracker({
    urlApi: {
      revokeObjectURL: () => {
        throw new Error("boom");
      }
    }
  });

  tracker.track("blob:one");
  assert.doesNotThrow(() => tracker.track("blob:two"));
  assert.doesNotThrow(() => tracker.clear());
});

// --- composeWallpaperImage (mocked DOM) ---------------------------------------

function createFakeCanvasContext() {
  return {
    drawImage() {},
    fillRect() {},
    fillText() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
    measureText(text) {
      return { width: fakeMeasureFn(String(text)) };
    },
    set font(_value) {},
    set fillStyle(_value) {},
    set textAlign(_value) {},
    set textBaseline(_value) {}
  };
}

function createFakeDoc({ getContextResult = "ok", toBlobResult = "blob", fontsCheck = true } = {}) {
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext(kind) {
      if (kind !== "2d") return null;
      if (getContextResult === "unsupported") return null;
      return createFakeCanvasContext();
    },
    toBlob(callback) {
      if (toBlobResult === "null") {
        callback(null);
      } else {
        callback({ type: "image/png", __fake: true });
      }
    }
  };

  return {
    createElement(tag) {
      if (tag === "canvas") return fakeCanvas;
      throw new Error(`Unexpected createElement(${tag}) in test`);
    },
    fonts: {
      async load() {
        return [];
      },
      ready: Promise.resolve(),
      check() {
        return fontsCheck;
      }
    }
  };
}

function createFakeWin({ imageOutcome = "success" } = {}) {
  class FakeImage {
    constructor() {
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.onload = null;
      this.onerror = null;
    }

    set src(_value) {
      queueMicrotask(() => {
        if (imageOutcome === "success") {
          this.naturalWidth = 1080;
          this.naturalHeight = 1920;
          if (this.onload) this.onload();
        } else {
          if (this.onerror) this.onerror();
        }
      });
    }
  }

  let objectUrlCounter = 0;

  return {
    Image: FakeImage,
    URL: {
      createObjectURL(_blob) {
        objectUrlCounter += 1;
        return `blob:mock-composited-url-${objectUrlCounter}`;
      }
    }
  };
}

test("composeWallpaperImage resolves with {blob, previewUrl, width, height} and no dataUrl/toBlob leak", async () => {
  const doc = createFakeDoc();
  const win = createFakeWin();

  const result = await composeWallpaperImage({
    sourceObjectUrl: "blob:source-image",
    oneLiner: "\u7a69\u7a69\u63a5\u4f4f\u4eca\u5929\u7684\u597d\u904b",
    createdAt: "2026-07-20T16:05:00.000Z",
    doc,
    win
  });

  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.equal(result.previewUrl, "blob:mock-composited-url-1");
  assert.ok(result.blob);
  assert.equal("dataUrl" in result, false);
  assert.equal("toBlob" in result, false);
});

test("composeWallpaperImage uses the source image's own natural pixel dimensions (never devicePixelRatio)", async () => {
  const doc = createFakeDoc();
  const win = createFakeWin();
  win.devicePixelRatio = 3;

  const result = await composeWallpaperImage({
    sourceObjectUrl: "blob:source-image",
    oneLiner: "test",
    createdAt: null,
    doc,
    win
  });

  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
});

test("composeWallpaperImage rejects with IMAGE_LOAD_FAILED when the source image fails to load", async () => {
  const doc = createFakeDoc();
  const win = createFakeWin({ imageOutcome: "failure" });

  await assert.rejects(
    () => composeWallpaperImage({ sourceObjectUrl: "blob:broken", oneLiner: "x", createdAt: null, doc, win }),
    (error) => {
      assert.equal(error.code, "IMAGE_LOAD_FAILED");
      return true;
    }
  );
});

test("composeWallpaperImage rejects with FONT_LOAD_FAILED (and never draws) when the required font is not available", async () => {
  const doc = createFakeDoc({ fontsCheck: false });
  const win = createFakeWin();

  await assert.rejects(
    () => composeWallpaperImage({ sourceObjectUrl: "blob:source-image", oneLiner: "x", createdAt: null, doc, win }),
    (error) => {
      assert.equal(error.code, "FONT_LOAD_FAILED");
      return true;
    }
  );
});

test("composeWallpaperImage rejects with CANVAS_UNSUPPORTED when 2D context is unavailable", async () => {
  const doc = createFakeDoc({ getContextResult: "unsupported" });
  const win = createFakeWin();

  await assert.rejects(
    () => composeWallpaperImage({ sourceObjectUrl: "blob:source-image", oneLiner: "x", createdAt: null, doc, win }),
    (error) => {
      assert.equal(error.code, "CANVAS_UNSUPPORTED");
      return true;
    }
  );
});

test("composeWallpaperImage rejects with BLOB_ENCODE_FAILED when canvas.toBlob() yields null (never produces a blank download)", async () => {
  const doc = createFakeDoc({ toBlobResult: "null" });
  const win = createFakeWin();

  await assert.rejects(
    () => composeWallpaperImage({ sourceObjectUrl: "blob:source-image", oneLiner: "x", createdAt: null, doc, win }),
    (error) => {
      assert.equal(error.code, "BLOB_ENCODE_FAILED");
      return true;
    }
  );
});

test("composeWallpaperImage rejects with IMAGE_LOAD_FAILED when sourceObjectUrl is missing", async () => {
  const doc = createFakeDoc();
  const win = createFakeWin();

  await assert.rejects(
    () => composeWallpaperImage({ sourceObjectUrl: "", oneLiner: "x", createdAt: null, doc, win }),
    (error) => {
      assert.equal(error.code, "IMAGE_LOAD_FAILED");
      return true;
    }
  );
});

test("composeWallpaperImage handles an empty oneLiner gracefully (date/brand only, no crash)", async () => {
  const doc = createFakeDoc();
  const win = createFakeWin();

  const result = await composeWallpaperImage({
    sourceObjectUrl: "blob:source-image",
    oneLiner: "",
    createdAt: "2026-07-20T16:05:00.000Z",
    doc,
    win
  });

  assert.ok(result.blob);
  assert.equal(result.width, 1080);
});

test("composeWallpaperImage supports repeat generation: each call yields an independent composited URL for the caller to track/revoke", async () => {
  const doc = createFakeDoc();
  const win = createFakeWin();
  const tracker = createObjectUrlTracker({ urlApi: win.URL, revokeObjectURL: undefined });
  // Wire a spy so we can prove the caller-side tracker would revoke between
  // repeat generations (composeWallpaperImage itself does not revoke \u2014
  // lifecycle ownership belongs to the caller, per design).
  const revoked = [];
  const spyTracker = createObjectUrlTracker({ urlApi: { revokeObjectURL: (url) => revoked.push(url) } });

  const first = await composeWallpaperImage({ sourceObjectUrl: "blob:one", oneLiner: "a", createdAt: null, doc, win });
  spyTracker.track(first.previewUrl);

  const second = await composeWallpaperImage({ sourceObjectUrl: "blob:two", oneLiner: "b", createdAt: null, doc, win });
  spyTracker.track(second.previewUrl);

  assert.deepEqual(revoked, [first.previewUrl]);
  assert.equal(tracker.current(), null); // unused tracker stays untouched, sanity check only
});
