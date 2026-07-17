"use strict";

const { randomUUID } = require("node:crypto");

function createCorrelationId(prefix = "corr") {
  const normalizedPrefix = String(prefix || "corr").trim() || "corr";
  return `${normalizedPrefix}_${randomUUID()}`;
}

function createCorrelationIdFactory({ prefix = "corr" } = {}) {
  return function nextCorrelationId() {
    return createCorrelationId(prefix);
  };
}

module.exports = {
  createCorrelationId,
  createCorrelationIdFactory
};
