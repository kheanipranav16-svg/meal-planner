import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscounts, discountFor } from '../src/discounts.js';
import { addDays, daysUntil } from '../src/dates.js';

const TODAY = new Date(2026, 10, 16); // 16 Nov 2026 (local time)
const item = (daysLeft, quantity = 10, priceCents = 1000) => ({
  productId: 1,
  name: 'Test',
  priceCents,
  quantity,
  expiryDate: addDays(TODAY, daysLeft),
});

test('daysUntil counts whole calendar days', () => {
  assert.equal(daysUntil('2026-11-16', TODAY), 0);
  assert.equal(daysUntil('2026-11-17', TODAY), 1);
  assert.equal(daysUntil('2026-11-15', TODAY), -1);
});

test('dates reject impossible values', () => {
  assert.throws(() => daysUntil('2026-02-31', TODAY));
  assert.throws(() => daysUntil('16-11-2026', TODAY));
});

test('expires today or tomorrow: 50% off', () => {
  assert.equal(discountFor(item(0), TODAY).rate, 0.5);
  assert.equal(discountFor(item(1), TODAY).rate, 0.5);
});

test('expires in 2-3 days: 30% off', () => {
  assert.equal(discountFor(item(2), TODAY).rate, 0.3);
  assert.equal(discountFor(item(3), TODAY).rate, 0.3);
});

test('expires in 4+ days with normal stock: no discount', () => {
  const result = discountFor(item(4), TODAY);
  assert.equal(result.rate, 0);
  assert.equal(result.reason, null);
});

test('overstock: 15% off, but only above 100 units', () => {
  assert.equal(discountFor(item(30, 101), TODAY).rate, 0.15);
  assert.equal(discountFor(item(30, 100), TODAY).rate, 0);
});

test('the biggest applicable discount wins (they do not stack)', () => {
  assert.equal(discountFor(item(1, 500), TODAY).rate, 0.5);
});

test('applyDiscounts drops expired and sold-out items and rounds prices to cents', () => {
  const rows = [item(-1), item(5, 0), item(1, 10, 199)];
  const result = applyDiscounts(rows, TODAY);
  assert.equal(result.length, 1);
  assert.equal(result[0].salePriceCents, 100); // 199 * 0.5 = 99.5 -> 100
  assert.equal(result[0].discountReason, 'Expires tomorrow');
});
