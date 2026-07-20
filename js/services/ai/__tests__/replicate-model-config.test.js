"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseReplicateModelSlug,
  buildReplicatePredictionsPath,
  buildReplicatePredictionRequestBody
} = require("../providers/replicate-model-config");

test("parseReplicateModelSlug parses a valid owner/model slug", () => {
  const result = parseReplicateModelSlug("black-forest-labs/flux-2-dev");
  assert.deepEqual(result, { owner: "black-forest-labs", name: "flux-2-dev" });
});

test("parseReplicateModelSlug throws for missing slash", () => {
  assert.throws(() => parseReplicateModelSlug("flux-2-dev"), /owner\/model/);
});

test("parseReplicateModelSlug throws for empty string", () => {
  assert.throws(() => parseReplicateModelSlug(""), /owner\/model/);
});

test("parseReplicateModelSlug throws for extra path segments", () => {
  assert.throws(() => parseReplicateModelSlug("owner/model/extra"), /owner\/model/);
});

test("parseReplicateModelSlug throws for empty owner or model part", () => {
  assert.throws(() => parseReplicateModelSlug("/flux-2-dev"), /owner\/model/);
  assert.throws(() => parseReplicateModelSlug("black-forest-labs/"), /owner\/model/);
});

test("buildReplicatePredictionsPath builds the official model endpoint", () => {
  const path = buildReplicatePredictionsPath("black-forest-labs/flux-2-dev");
  assert.equal(path, "/models/black-forest-labs/flux-2-dev/predictions");
});

test("buildReplicatePredictionsPath throws for an invalid slug", () => {
  assert.throws(() => buildReplicatePredictionsPath("not-a-slug"), /owner\/model/);
});

test("buildReplicatePredictionRequestBody wraps input with no version field", () => {
  const body = buildReplicatePredictionRequestBody({ prompt: "a lucky bear", aspect_ratio: "9:16" });
  assert.deepEqual(Object.keys(body), ["input"]);
  assert.equal("version" in body, false);
  assert.deepEqual(body.input, { prompt: "a lucky bear", aspect_ratio: "9:16" });
});
