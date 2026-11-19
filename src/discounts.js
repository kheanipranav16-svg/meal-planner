// Discount rules. Deliberately plain code (no AI): prices must be predictable,
// testable and explainable to a customer.

import { daysUntil } from './dates.js';

export const RULES = {
  lastDayMaxDays: 1, // expires today or tomorrow...
  lastDayRate: 0.5, // ...50% off
  soonMaxDays: 3, // expires within 3 days...
  soonRate: 0.3, // ...30% off
  overstockMinQuantity: 100, // more than 100 units on the shelf...
  overstockRate: 0.15, // ...15% off
};

function expiryReason(daysLeft) {
  if (daysLeft <= 0) return 'Expires today';
  if (daysLeft === 1) return 'Expires tomorrow';
  return `Expires in ${daysLeft} days`;
}

/**
 * Decide the discount for one stock row.
 * Returns { rate, reason, daysLeft }. The biggest applicable rate wins.
 */
export function discountFor(item, today = new Date()) {
  const daysLeft = daysUntil(item.expiryDate, today);
  if (daysLeft < 0) return { rate: 0, reason: 'Expired', daysLeft };

  let expiryRate = 0;
  if (daysLeft <= RULES.lastDayMaxDays) expiryRate = RULES.lastDayRate;
  else if (daysLeft <= RULES.soonMaxDays) expiryRate = RULES.soonRate;

  const overstockRate = item.quantity > RULES.overstockMinQuantity ? RULES.overstockRate : 0;

  if (expiryRate === 0 && overstockRate === 0) return { rate: 0, reason: null, daysLeft };
  if (expiryRate >= overstockRate) return { rate: expiryRate, reason: expiryReason(daysLeft), daysLeft };
  return { rate: overstockRate, reason: 'Overstock', daysLeft };
}

/**
 * Take raw stock rows and return only what can be sold today, each with its
 * discount and sale price (in cents) attached.
 *
 * Stock row shape: { productId, name, category, unit, priceCents, quantity, expiryDate }
 */
export function applyDiscounts(stockRows, today = new Date()) {
  return stockRows
    .filter((row) => row.quantity > 0 && daysUntil(row.expiryDate, today) >= 0)
    .map((row) => {
      const { rate, reason, daysLeft } = discountFor(row, today);
      return {
        ...row,
        daysLeft,
        discountRate: rate,
        discountReason: reason,
        salePriceCents: Math.round(row.priceCents * (1 - rate)),
      };
    });
}
