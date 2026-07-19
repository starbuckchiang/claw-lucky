Root cause
Supabase's Edge Function deploy pipeline packages each function into an artifact by classifying every file it will ship as an "asset" with a supported media type. .ts/.tsx/.js/.jsx/.json/.wasm are recognized; .cjs is not in that whitelist — the previous fix's re-export shims (wallpaper-generate-handler-loader.cjs, etc.) were rejected at deploy time itself (unsupported media type Cjs), before the function ever ran.

That .cjs attempt existed to work around an earlier problem: node-require.ts used node:module's createRequire(...) to obtain a require function value at runtime, then called require("./wallpaper-generate-handler.js") dynamically. That call is invisible to static bundling analysis, so the target file was silently dropped from the deployed artifact (Cannot find module). Renaming the shim to .cjs made it statically importable, but Supabase's own asset manifest doesn't accept that extension at all — a hard rejection, unrelated to Deno's own (broader) Node-compat capabilities.

Why the .cjs fix failed
.cjs fixed the static-analysis problem but tripped a separate, stricter constraint: Supabase's deploy-time asset-type whitelist, which simply doesn't include .cjs as a valid media type to upload — a hard rejection independent of whether the import itself would have been traceable.

The redesign
Since the Edge Runtime requires pure ESM with zero require()/CommonJS/Node-module-loader usage anywhere in the runtime path, and the existing js/services/** business-logic files are dual-purpose (loaded as classic <script> tags in the browser and via Node's require() in unit tests — converting them to ESM would break the frontend), I created line-for-line ESM ports of the exact dependency graph the two Edge Functions need, under a new lib directory, reached via plain, static import statements only.

Modified / new / removed files
Removed (Supabase-incompatible loading mechanism):

supabase/functions/_shared/node-require.ts
supabase/functions/_shared/wallpaper-generate-handler-loader.cjs
supabase/functions/_shared/wallpaper-status-handler-loader.cjs
supabase/functions/_shared/gemini-provider-loader.cjs
New — ESM ports of the reviewed CommonJS modules (identical logic, export/import instead of module.exports/require):

wallpaper-generate-handler.ts
wallpaper-status-handler.ts
supabase/functions/_shared/lib/{correlation-id,generation-tracing,generation-logger,response-dto,progress-response-dto,generation-validator,generation-repository,generation-query-repository,generation-query-service,job-repository,job-service,points-repository,points-service,usage-repository,usage-service,generation-service,generation-orchestrator,fallback-templates,prompt-registry-loader,provider-types,gemini-provider,provider-adapter,wallpaper-provider-adapter,wallpaper-storage-uploader}.ts (24 files)
Modified:

index.ts — imports handleGenerateRequest and GeminiProvider directly (no more node-require.ts indirection)
index.ts — imports handleStatusRequest directly
wallpaper-generate-handler.js / wallpaper-status-handler.js — unchanged logic; doc comments updated to clarify these .js CommonJS files are now Node-only (test source of truth), while Deno uses the .ts twins
verify-local.ps1 — removed the now-deleted .cjs syntax-check lines; added a note that .ts files are validated via deno check/deploy, not node --check