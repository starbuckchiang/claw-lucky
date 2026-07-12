"use strict";

function createMockProvider({ shouldFail = false, errorFactory } = {}) {
  return {
    async generateLuckyContext(input) {
      if (shouldFail) {
        throw (errorFactory ? errorFactory("generateLuckyContext", input) : new Error("Provider failed"));
      }

      return {
        providerRequestId: "req-lucky-001",
        model: "mock-model-v1",
        result: {
          luckyTheme: "Sunrise",
          blessing: "Great things are coming."
        }
      };
    },
    async generateWallpaper(input) {
      if (shouldFail) {
        throw (errorFactory ? errorFactory("generateWallpaper", input) : new Error("Provider failed"));
      }

      return {
        providerRequestId: "req-wallpaper-001",
        model: "mock-model-v1",
        result: {
          imageUrl: "mock://wallpaper.png",
          promptEcho: input?.prompt || ""
        }
      };
    }
  };
}

module.exports = {
  createMockProvider
};
