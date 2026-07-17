// ESM port of `js/services/storage/wallpaper-storage-uploader.js`. Logic
// unchanged: server-controlled `{userId}/{assetId}/wallpaper.png` path,
// private bucket upload, short-lived signed URL.

function base64ToBytes(base64: string): Uint8Array {
  // Deno provides `atob` as a Web API global (no Buffer needed).
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function createWallpaperStorageUploader({
  supabaseClient,
  bucket = "wallpapers",
  signedUrlExpirySeconds = 3600,
  idFactory
}: {
  // deno-lint-ignore no-explicit-any
  supabaseClient: any;
  bucket?: string;
  signedUrlExpirySeconds?: number;
  idFactory?: () => string;
} = {} as never) {
  if (!supabaseClient || !supabaseClient.storage || typeof supabaseClient.storage.from !== "function") {
    throw new Error("createWallpaperStorageUploader requires supabaseClient.storage.from().");
  }

  const normalizedExpiry = Number.isFinite(Number(signedUrlExpirySeconds))
    ? Math.max(60, Number(signedUrlExpirySeconds))
    : 3600;

  const generateId = typeof idFactory === "function" ? idFactory : () => crypto.randomUUID();

  async function uploadWallpaperImage({
    userId,
    base64,
    mimeType,
    correlationId,
    assetId
  }: {
    userId: string;
    base64: string;
    mimeType?: string;
    correlationId?: string;
    assetId?: string;
  }) {
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
      // deno-lint-ignore no-explicit-any
      const error: any = new Error(uploadError.message || "Storage upload failed.");
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

  async function createSignedUrlForPath(path: string, expirySeconds: number = normalizedExpiry) {
    const { data, error } = await supabaseClient.storage
      .from(bucket)
      .createSignedUrl(path, expirySeconds);

    if (error) {
      // deno-lint-ignore no-explicit-any
      const wrapped: any = new Error(error.message || "Failed to create signed URL.");
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
