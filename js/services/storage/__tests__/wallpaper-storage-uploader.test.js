"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createWallpaperStorageUploader } = require("../wallpaper-storage-uploader");

function createMockSupabaseClient({ uploadError = null, signedUrlError = null, signedUrl = "https://signed.example/file.png" } = {}) {
  const calls = { upload: [], createSignedUrl: [] };

  const storageApi = {
    from(bucket) {
      return {
        async upload(path, bytes, options) {
          calls.upload.push({ bucket, path, byteLength: bytes.length, options });
          if (uploadError) return { data: null, error: uploadError };
          return { data: { path }, error: null };
        },
        async createSignedUrl(path, expirySeconds) {
          calls.createSignedUrl.push({ bucket, path, expirySeconds });
          if (signedUrlError) return { data: null, error: signedUrlError };
          return { data: { signedUrl }, error: null };
        }
      };
    }
  };

  return { storage: storageApi, calls };
}

test("uploadWallpaperImage builds a server-controlled path and returns a signed URL", async () => {
  const { storage, calls } = createMockSupabaseClient();
  const uploader = createWallpaperStorageUploader({
    supabaseClient: { storage },
    idFactory: () => "asset-123"
  });

  const result = await uploader.uploadWallpaperImage({
    userId: "user-1",
    base64: Buffer.from("hello").toString("base64"),
    mimeType: "image/png",
    correlationId: "corr-1"
  });

  assert.equal(result.path, "user-1/asset-123/wallpaper.png");
  assert.equal(result.bucket, "wallpapers");
  assert.equal(result.signedUrl, "https://signed.example/file.png");
  assert.equal(calls.upload[0].path, "user-1/asset-123/wallpaper.png");
  assert.equal(calls.createSignedUrl[0].path, "user-1/asset-123/wallpaper.png");
});

test("upload failure is normalized as STORAGE_UPLOAD_FAILED (no raw Supabase error leaked)", async () => {
  const { storage } = createMockSupabaseClient({ uploadError: { message: "permission denied", details: "secret-internal-detail" } });
  const uploader = createWallpaperStorageUploader({ supabaseClient: { storage }, idFactory: () => "asset-1" });

  await assert.rejects(
    () =>
      uploader.uploadWallpaperImage({
        userId: "user-1",
        base64: Buffer.from("hello").toString("base64"),
        mimeType: "image/png"
      }),
    (error) => {
      assert.equal(error.failureCode, "STORAGE_UPLOAD_FAILED");
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("createSignedUrl failure is normalized", async () => {
  const { storage } = createMockSupabaseClient({ signedUrlError: { message: "boom" } });
  const uploader = createWallpaperStorageUploader({ supabaseClient: { storage }, idFactory: () => "asset-1" });

  await assert.rejects(
    () =>
      uploader.uploadWallpaperImage({
        userId: "user-1",
        base64: Buffer.from("hello").toString("base64"),
        mimeType: "image/png"
      }),
    (error) => {
      assert.equal(error.failureCode, "STORAGE_UPLOAD_FAILED");
      return true;
    }
  );
});

test("rejects missing userId / base64", async () => {
  const { storage } = createMockSupabaseClient();
  const uploader = createWallpaperStorageUploader({ supabaseClient: { storage } });

  await assert.rejects(() => uploader.uploadWallpaperImage({ base64: "abc" }));
  await assert.rejects(() => uploader.uploadWallpaperImage({ userId: "user-1" }));
});
