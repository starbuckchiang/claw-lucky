"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPredictionRunner } = require("../predictions/prediction-runner");

function noWait() {
  return Promise.resolve();
}

test("waitUntilTerminal resolves on succeeded status", async () => {
  let calls = 0;
  const runner = createPredictionRunner({
    createPrediction: async () => ({ predictionId: "pred-1", status: "starting" }),
    getPrediction: async () => {
      calls += 1;
      if (calls < 3) return { status: "processing" };
      return { status: "succeeded", output: ["https://example.test/output.png"] };
    },
    wait: noWait,
    maxPollAttempts: 10
  });

  const result = await runner.waitUntilTerminal("pred-1");
  assert.equal(result.terminal, true);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.output, ["https://example.test/output.png"]);
  assert.equal(calls, 3);
});

test("waitUntilTerminal resolves on failed status", async () => {
  const runner = createPredictionRunner({
    createPrediction: async () => ({ predictionId: "pred-2", status: "starting" }),
    getPrediction: async () => ({ status: "failed", error: "model exploded" }),
    wait: noWait,
    maxPollAttempts: 5
  });

  const result = await runner.waitUntilTerminal("pred-2");
  assert.equal(result.terminal, true);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "model exploded");
});

test("waitUntilTerminal returns non-terminal timeout after bounded attempts", async () => {
  let calls = 0;
  const runner = createPredictionRunner({
    createPrediction: async () => ({ predictionId: "pred-3", status: "starting" }),
    getPrediction: async () => {
      calls += 1;
      return { status: "processing" };
    },
    wait: noWait,
    maxPollAttempts: 4
  });

  const result = await runner.waitUntilTerminal("pred-3");
  assert.equal(result.terminal, false);
  assert.equal(result.status, "timeout");
  assert.equal(calls, 4);
});

test("onProgress callback is invoked per poll attempt", async () => {
  const progressCalls = [];
  const runner = createPredictionRunner({
    createPrediction: async () => ({ predictionId: "pred-4", status: "starting" }),
    getPrediction: async () => ({ status: "succeeded", output: "https://example.test/x.png" }),
    wait: noWait,
    maxPollAttempts: 5
  });

  await runner.waitUntilTerminal("pred-4", {
    onProgress: (info) => progressCalls.push(info)
  });

  assert.equal(progressCalls.length, 1);
  assert.equal(progressCalls[0].predictionId, "pred-4");
  assert.equal(progressCalls[0].status, "succeeded");
});
