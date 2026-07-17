"use strict";

/**
 * Wallpaper Storage Uploader
 *
 * Responsible for:
 * - Converting a base64 image (from the Provider Adapter) into binary
 * - Uploading it to the private `wallpapers` Supabase Storage bucket
 * - Producing a server-controlled storage path ({userId}/{assetId}/wallpaper.png)
 * - Producing a short-lived signed URL for preview
 *
 * MUST NOT:
 * - Accept a client-specified storage path
 * - Persist base64 data anywhere
 *
 * Runtime-neutral: works under Node.js (unit tests, local scripts) and under
 * Deno (Supabase Edge Functions) since it only relies on `atob`/`Buffer`
 * (whichever is available) and the injected `supabaseClient.storage` API.
 */

function base64ToBytes(base64) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64, "base64");
  }

  // Deno / browser fallback (no Buffer global).
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function createWallpaperStorageUploader({
  supabaseClient,
  bucket = "wallpapers",
  signedUrlExpirySeconds = 3600,
  idFactory
} = {}) {
  if (!supabaseClient || !supabaseClient.storage || typeof supabaseClient.storage.from !== "function") {
    throw new Error("createWallpaperStorageUploader requires supabaseClient.storage.from().");
  }

  const normalizedExpiry = Number.isFinite(Number(signedUrlExpirySeconds))
    ? Math.max(60, Number(signedUrlExpirySeconds))
    : 3600;

  const generateId =
    typeof idFactory === "function"
      ? idFactory
      : () => {
          if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
          }
          // Node < 19 fallback without pulling in node:crypto at module scope
          // (keeps this module dependency-free for Deno bundling).
          return `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        };

  async function uploadWallpaperImage({ userId, base64, mimeType, correlationId, assetId }) {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) {
      throw new Error("uploadWallpaperImage requires userId.");
    }

    if (!base64 || typeof base64 !== "string") {
      throw new Error("uploadWallpaperImage requires base64 image data.");
    }

    const resolvedAssetId = String(assetId || generateId()).trim();
    const path = `${normalizedUserId}/${resolvedAssetId}/wallpaper.png`;
    const bytes = base64ToBytes(base64);

    const { error: uploadError } = await supabaseClient.storage
      .from(bucket)
      .upload(path, bytes, {
        contentType: mimeType || "image/png",
        upsert: false
      });

    if (uploadError) {
      const error = new Error(uploadError.message || "Storage upload failed.");
      error.failureCode = "STORAGE_UPLOAD_FAILED";
      error.retryable = true;
      error.cause = uploadError;
      error.correlationId = correlationId || null;
      throw error;
    }

    const signedUrl = await createSignedUrlForPath(path);

    return {
      bucket,
      path,
      assetId: resolvedAssetId,
      mimeType: mimeType || "image/png",
      fileSize: bytes.length,
      signedUrl
    };
  }

  async function createSignedUrlForPath(path, expirySeconds = normalizedExpiry) {
    const { data, error } = await supabaseClient.storage
      .from(bucket)
      .createSignedUrl(path, expirySeconds);

    if (error) {
      const wrapped = new Error(error.message || "Failed to create signed URL.");
      wrapped.failureCode = "STORAGE_UPLOAD_FAILED";
      wrapped.retryable = true;
      wrapped.cause = error;
      throw wrapped;
    }

    return data?.signedUrl || null;
  }

  return {
    bucket,
    uploadWallpaperImage,
    createSignedUrlForPath
  };
}

module.exports = {
  createWallpaperStorageUploader
};
