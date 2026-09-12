"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const container = process.argv[2];
const database = process.argv[3];
assert.ok(container && database, "container and database arguments are required");

async function insertOrder(index) {
  const sql = `INSERT INTO public.orders(user_id,total_amount,total_items) VALUES ('concurrency-${index}',0,0) RETURNING order_no;`;
  const { stdout } = await execFileAsync("docker", [
    "exec", "-e", "PGPASSWORD=localtest", container,
    "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database,
    "-At", "-c", sql
  ]);
  const orderNumber = stdout.split(/\r?\n/).find((line) => /^LUCK-\d{6}-\d{6}$/.test(line.trim()));
  assert.ok(orderNumber, `missing valid order number for insert ${index}`);
  return orderNumber.trim();
}

async function main() {
  const orderNumbers = await Promise.all(
    Array.from({ length: 24 }, (_, index) => insertOrder(index + 1))
  );
  assert.equal(new Set(orderNumbers).size, orderNumbers.length, "duplicate order number generated");
  const sequenceNumbers = orderNumbers.map((value) => Number(value.slice(-6))).sort((a, b) => a - b);
  assert.deepEqual(sequenceNumbers, Array.from({ length: 24 }, (_, index) => index + 1));
  process.stdout.write(`WEB_HOME_01B1C_ORDER_CONCURRENCY_PASS count=${orderNumbers.length}\n`);
}

main().catch((error) => {
  process.stderr.write(`WEB_HOME_01B1C_ORDER_CONCURRENCY_FAIL:${error.message}\n`);
  process.exitCode = 1;
});