"use strict";

// Static, explicit-CommonJS re-export shim.
//
// Root cause this file fixes: `node-require.ts` previously loaded
// `wallpaper-generate-handler.js` through a *dynamic* `createRequire(...)`
// call. That call target is invisible to static module-graph analysis
// (esbuild/eszip, used by Supabase's Edge Function deploy bundler), so the
// file was silently dropped from the deployed artifact — while still
// working locally under `supabase functions serve`, which reads directly
// from disk instead of a pre-built bundle. See node-require.ts for details.
//
// The `.cjs` extension makes this file's module kind (CommonJS)
// unambiguous to Deno regardless of any package.json `"type"` field, and
// `node-require.ts` now reaches it via a literal, static `import` — which
// IS traceable by the deploy bundler. `wallpaper-generate-handler.js`
// itself is untouched (same file, same name, same exports).
module.exports = require("./wallpaper-generate-handler.js");
