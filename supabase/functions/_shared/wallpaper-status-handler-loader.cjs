"use strict";

// Static, explicit-CommonJS re-export shim — same rationale as
// `wallpaper-generate-handler-loader.cjs`. `wallpaper-status-handler.js`
// itself is untouched.
module.exports = require("./wallpaper-status-handler.js");
