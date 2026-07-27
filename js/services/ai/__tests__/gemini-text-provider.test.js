"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { GeminiTextProvider } = require("../gemini-text-provider");
const { NormalizedProviderError } = require("../provider-types");

function silentLogger() {
  return { info() {}, error() {} };
}

function createClient({ text = "{}", throwError = null } = {}) {
  return {
    models: {
      async generateContent() {
        if (throwError) {
          throw throwError;
        }
        return { text };
      }
    }
  };
}

test("returns { text, durationMs } on success, requesting JSON structured output", async () => {
  let capturedRequest = null;
  const client = {
    models: {
      async generateContent(request) {
        capturedRequest = request;
        return { text: '{"luckyTheme":"Golden Day"}' };
      }
    }
  };

  const provider = new GeminiTextProvider({ config: { model: "gemini-2.5-flash" }, client, logger: silentLogger() });

  const result = await provider.generateContext({ promptText: "hello", correlationId: "corr-1" });

  assert.equal(result.text, '{"luckyTheme":"Golden Day"}');
  assert.equal(typeof result.durationMs, "number");
  assert.equal(capturedRequest.model, "gemini-2.5-flash");
  assert.equal(capturedRequest.contents, "hello");
  assert.equal(capturedRequest.config.responseMimeType, "application/json");
});

test("empty text response -> throws PROVIDER_INVALID_RESPONSE", async () => {
  const provider = new GeminiTextProvider({
    config: { model: "gemini-2.5-flash" },
    client: createClient({ text: "" }),
    logger: silentLogger()
  });

  await assert.rejects(
    provider.generateContext({ promptText: "hello", correlationId: "corr-1" }),
    (error) => {
      assert.ok(error instanceof NormalizedProviderError);
      assert.equal(error.code, "PROVIDER_INVALID_RESPONSE");
      return true;
    }
  );
});

test("timeout-shaped error -> normalized PROVIDER_TIMEOUT (retryable)", async () => {
  const timeoutError = new Error("Request timeout");
  timeoutError.name = "AbortError";

  const provider = new GeminiTextProvider({
    config: { model: "gemini-2.5-flash" },
    client: createClient({ throwError: timeoutError }),
    logger: silentLogger()
  });

  await assert.rejects(
    provider.generateContext({ promptText: "hello", correlationId: "corr-1" }),
    (error) => {
      assert.ok(error instanceof NormalizedProviderError);
      assert.equal(error.code, "PROVIDER_TIMEOUT");
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("5xx-shaped error -> normalized PROVIDER_UNAVAILABLE (retryable)", async () => {
  const providerError = new Error("Service unavailable");
  providerError.status = 503;

  const provider = new GeminiTextProvider({
    config: { model: "gemini-2.5-flash" },
    client: createClient({ throwError: providerError }),
    logger: silentLogger()
  });

  await assert.rejects(
    provider.generateContext({ promptText: "hello", correlationId: "corr-1" }),
    (error) => {
      assert.ok(error instanceof NormalizedProviderError);
      assert.equal(error.code, "PROVIDER_UNAVAILABLE");
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("constructor requires a valid client with models.generateContent", () => {
  assert.throws(() => new GeminiTextProvider({ config: {}, client: {}, logger: silentLogger() }), TypeError);
});
