// ESM port of `js/services/logging/correlation-id.js` for the Deno Edge
// Runtime. This directory (`_shared/lib/*.ts`) mirrors the reviewed
// CommonJS modules under `js/services/**` file-for-file, in plain ESM
// syntax, so the Edge Function's dependency graph is 100% statically
// `import`-able (see the header comment in
// `supabase/functions/wallpaper-generate/index.ts` for the full root-cause
// write-up on why this port exists). Logic is unchanged; only the module
// syntax differs (`export` instead of `module.exports`, Web Crypto global
// instead of `node:crypto` — both produce a standard v4 UUID).

export function createCorrelationId(prefix = "corr"): string {
  const normalizedPrefix = String(prefix || "corr").trim() || "corr";
  return `${normalizedPrefix}_${crypto.randomUUID()}`;
}

export function createCorrelationIdFactory({ prefix = "corr" }: { prefix?: string } = {}) {
  return function nextCorrelationId(): string {
    return createCorrelationId(prefix);
  };
}
