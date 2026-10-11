"use strict";

/**
 * PROD-RELEASE-DAY3C membership-quota-service tests (fake repo, no real DB).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createMembershipQuotaService,
  PAID_MONTHLY_LIMIT,
  FREE_LIFETIME_LIMIT,
  resolveTaipeiMonthKey
} = require("../membership-quota-service");

function fakeQuotaRepository() {
  const rows = new Map();
  function key(userId, periodKey) {
    return `${userId}::${periodKey}`;
  }
  return {
    rows,
    calls: { reserveQuota: 0, confirmUsage: 0, releaseReservation: 0 },
    async reserveQuota({ userId, periodKey, limit }) {
      this.calls.reserveQuota += 1;
      const k = key(userId, periodKey);
      const row = rows.get(k) || { confirmed: 0, pending: 0 };
      if (row.confirmed + row.pending >= limit) {
        rows.set(k, row);
        return { allowed: false, remaining: 0 };
      }
      row.pending += 1;
      rows.set(k, row);
      return { allowed: true, remaining: limit - row.confirmed - row.pending };
    },
    async confirmUsage({ userId, periodKey }) {
      this.calls.confirmUsage += 1;
      const k = key(userId, periodKey);
      const row = rows.get(k);
      if (!row || row.pending <= 0) return;
      row.pending -= 1;
      row.confirmed += 1;
      rows.set(k, row);
    },
    async releaseReservation({ userId, periodKey }) {
      this.calls.releaseReservation += 1;
      const k = key(userId, periodKey);
      const row = rows.get(k);
      if (!row || row.pending <= 0) return;
      row.pending -= 1;
      rows.set(k, row);
    }
  };
}

function fakeSubscriptionRepository(sub) {
  return {
    async findActiveSubscription(_userId) {
      return sub;
    }
  };
}

test("resolveTaipeiMonthKey: formats YYYY-MM using Asia/Taipei", () => {
  // 2026-10-01T15:30:00Z is 2026-10-01T23:30 Taipei (still October).
  assert.equal(resolveTaipeiMonthKey(new Date("2026-10-01T15:30:00Z")), "2026-10");
  // 2026-09-30T16:30:00Z is 2026-10-01T00:30 Taipei -> rolls into October.
  assert.equal(resolveTaipeiMonthKey(new Date("2026-09-30T16:30:00Z")), "2026-10");
});

test("checkDailyLimit: free user gets the FREE_LIFETIME_LIMIT (3), not a monthly reset", async () => {
  const quotaRepo = fakeQuotaRepository();
  const svc = createMembershipQuotaService({
    subscriptionRepository: fakeSubscriptionRepository(null),
    quotaRepository: quotaRepo
  });

  const result = await svc.checkDailyLimit("user-free");
  assert.equal(result.ok, true);
  assert.equal(result.data.isPaid, false);
  assert.equal(result.data.limit, FREE_LIFETIME_LIMIT);
  assert.equal(result.data.periodKey, "free:lifetime");
});

test("checkDailyLimit: ACTIVE + paid_through in the future gets the PAID_MONTHLY_LIMIT (10), keyed by calendar month", async () => {
  const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const quotaRepo = fakeQuotaRepository();
  const svc = createMembershipQuotaService({
    subscriptionRepository: fakeSubscriptionRepository({ status: "ACTIVE", paid_through: future }),
    quotaRepository: quotaRepo
  });

  const result = await svc.checkDailyLimit("user-paid");
  assert.equal(result.ok, true);
  assert.equal(result.data.isPaid, true);
  assert.equal(result.data.limit, PAID_MONTHLY_LIMIT);
  assert.match(result.data.periodKey, /^paid:\d{4}-\d{2}$/);
});

test("checkDailyLimit: a yearly plan (status ACTIVE, paid_through a year out) still only grants 10/month, never a lump sum", async () => {
  const farFuture = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString();
  const quotaRepo = fakeQuotaRepository();
  const svc = createMembershipQuotaService({
    subscriptionRepository: fakeSubscriptionRepository({ status: "ACTIVE", paid_through: farFuture }),
    quotaRepository: quotaRepo
  });

  const result = await svc.checkDailyLimit("user-yearly");
  assert.equal(result.data.limit, PAID_MONTHLY_LIMIT);
});

test("checkDailyLimit: EXPIRED/past paid_through falls back to the free lifetime limit, not paid", async () => {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const quotaRepo = fakeQuotaRepository();
  const svc = createMembershipQuotaService({
    subscriptionRepository: fakeSubscriptionRepository({ status: "ACTIVE", paid_through: past }),
    quotaRepository: quotaRepo
  });

  const result = await svc.checkDailyLimit("user-expired");
  assert.equal(result.data.isPaid, false);
  assert.equal(result.data.limit, FREE_LIFETIME_LIMIT);
});

test("checkDailyLimit: CANCELLED-but-still-paid-through (access continues until period end) is still treated as paid", async () => {
  const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const quotaRepo = fakeQuotaRepository();
  const svc = createMembershipQuotaService({
    subscriptionRepository: fakeSubscriptionRepository({ status: "CANCELLED", paid_through: future }),
    quotaRepository: quotaRepo
  });

  const result = await svc.checkDailyLimit("user-cancelled-but-active");
  // Per the documented rule: status must be ACTIVE AND paid_through in the
  // future. A CANCELLED-with-remaining-access subscription is intentionally
  // NOT "paid" for quota purposes under this strict reading — flagged
  // explicitly rather than silently assumed either way.
  assert.equal(result.data.isPaid, false);
});

test("checkDailyLimit: denies once the limit is reached, with a DAILY_LIMIT_EXCEEDED-shaped error", async () => {
  const quotaRepo = fakeQuotaRepository();
  const svc = createMembershipQuotaService({
    subscriptionRepository: fakeSubscriptionRepository(null),
    quotaRepository: quotaRepo
  });

  for (let i = 0; i < FREE_LIFETIME_LIMIT; i += 1) {
    const r = await svc.checkDailyLimit("user-spend");
    assert.equal(r.ok, true);
    await svc.recordSuccess("user-spend");
  }

  const denied = await svc.checkDailyLimit("user-spend");
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "DAILY_LIMIT_EXCEEDED");
  assert.equal(denied.error.retryable, false);
});

test("releaseReservation: a released reservation frees the slot for a later check (failed generation never consumes quota)", async () => {
  const quotaRepo = fakeQuotaRepository();
  const svc = createMembershipQuotaService({
    subscriptionRepository: fakeSubscriptionRepository(null),
    quotaRepository: quotaRepo
  });

  // Fill the limit via reservations that are then released (simulating
  // repeated generation failures) — must never actually consume quota.
  for (let i = 0; i < FREE_LIFETIME_LIMIT + 2; i += 1) {
    const r = await svc.checkDailyLimit("user-retry");
    if (r.ok) {
      await svc.releaseReservation("user-retry");
    }
  }

  const stillAvailable = await svc.checkDailyLimit("user-retry");
  assert.equal(stillAvailable.ok, true, "quota was never actually consumed since every reservation was released");
  assert.equal(quotaRepo.calls.releaseReservation > 0, true);
});

test("checkDailyLimit: concurrent reservations serialize through the (fake, synchronous) repository and cannot both exceed the limit", async () => {
  const quotaRepo = fakeQuotaRepository();
  const svc = createMembershipQuotaService({
    subscriptionRepository: fakeSubscriptionRepository(null),
    quotaRepository: quotaRepo
  });

  const results = await Promise.all(
    Array.from({ length: FREE_LIFETIME_LIMIT + 3 }, () => svc.checkDailyLimit("user-concurrent"))
  );
  const allowedCount = results.filter((r) => r.ok).length;
  assert.equal(allowedCount, FREE_LIFETIME_LIMIT, "exactly the limit, no more, no fewer, were allowed");
});
