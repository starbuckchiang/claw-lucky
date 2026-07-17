"use strict";

// Static, explicit-CommonJS re-export shim — same rationale as
// `wallpaper-generate-handler-loader.cjs`. Kept separate from the two
// handler loaders (rather than adding a new export to `gemini-provider.js`
// itself) so the Gemini integration file is not touched at all.
//
// `gemini-provider.js` only `require()`s `./provider-types.js` (also
// dependency-free) at module scope — it never touches `@google/genai`
// directly. The SDK client is always injected by the caller.
module.exports = require("../../../js/services/ai/gemini-provider.js");
