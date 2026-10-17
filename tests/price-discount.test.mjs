import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelPriceDiscount } from '../src/domain.js';

// Price discount model (v1.239): a NEW axis — a stated
// discount taken off a stated list price. The discount is
// taken off the list price — floor(list x rate / 10,000) —
// never measured against the amount due, the amount due
// is what remains, and the shares are derived from the
// amounts against the list price, floored.
const DEFAULT = { priceAmount: '1000', discountRateBps: 2500, decimals: 6 };

test('the preloaded discount: a 1000 list price at a stated 2500 bps rate takes 250 off and the amount due is 750, shares 2500.00 and 7500.00', () => {
  const r = modelPriceDiscount(DEFAULT);
  assert.equal(r.priceAmount, 1000000000n);
  assert.equal(r.discountAmount, 250000000n);
  assert.equal(r.amountDue, 750000000n);
  assert.equal(r.discountShareBpsText, '2500.00');
  assert.equal(r.dueShareBpsText, '7500.00');
});

test('the default rate is none stated when none is given: the amount due is the list price whole', () => {
  const r = modelPriceDiscount({ priceAmount: '1000', decimals: 6 });
  assert.equal(r.discountRateBps, 0);
  assert.equal(r.discountAmount, 0n);
  assert.equal(r.amountDue, r.priceAmount);
  assert.equal(r.noDiscountStated, true);
});

test('identities hold across prices: the discount taken off plus the amount due is the list price, exactly', () => {
  const cases = [
    DEFAULT,
    { priceAmount: '1000', discountRateBps: 0, decimals: 6 },
    { priceAmount: '1000', discountRateBps: 10000, decimals: 6 },
    { priceAmount: '777', discountRateBps: 2000, decimals: 0 },
    { priceAmount: '9007199254740993', discountRateBps: 2500, decimals: 0 },
    { priceAmount: '0.000001', discountRateBps: 100, decimals: 6 },
  ];
  for (const c of cases) {
    const r = modelPriceDiscount(c);
    assert.equal(r.discountAmount + r.amountDue, r.priceAmount);
  }
});

test('the discount is taken off the list price, never measured against the amount due: on the no-decimals 777 price at 2000 bps the discount taken is 155, not the 124 the amount-due method states', () => {
  const r = modelPriceDiscount({ priceAmount: '777', discountRateBps: 2000, decimals: 0 });
  assert.equal(r.discountAmount, 155n);
  assert.equal(r.amountDue, 622n);
  assert.notEqual(r.discountAmount, 622n * 2000n / 10000n);
});

test('the amount-due understatement is exactly the discount on the discount: on the preload the amount-due method states 187.5 where the discount taken is 250', () => {
  const r = modelPriceDiscount(DEFAULT);
  assert.equal(750000000n * 2500n / 10000n, 187500000n);
  assert.equal(r.discountAmount, 250000000n);
  assert.equal(r.discountAmount - 187500000n, 250000000n * 2500n / 10000n);
});

test('the discount is never measured against the amount due: discount plus due is the list price and nothing more', () => {
  const r = modelPriceDiscount(DEFAULT);
  assert.equal(r.discountMeasuredOnDue, false);
  assert.equal(r.discountAmount + r.amountDue, r.priceAmount);
});

test('eligibility is not priced: the model states the cut the stated rate describes, never whether a buyer may take it or how long it is offered', () => {
  const r = modelPriceDiscount(DEFAULT);
  assert.equal(r.eligibilityPriced, false);
});

test('a rate of zero states no discount: the amount due is the list price whole, with shares 0.00 and 10000.00', () => {
  const r = modelPriceDiscount({ priceAmount: '1000', discountRateBps: 0, decimals: 6 });
  assert.equal(r.noDiscountStated, true);
  assert.equal(r.discountFloorsToZero, false);
  assert.equal(r.fullyDiscounted, false);
  assert.equal(r.discountAmount, 0n);
  assert.equal(r.amountDue, 1000000000n);
  assert.equal(r.discountShareBpsText, '0.00');
  assert.equal(r.dueShareBpsText, '10000.00');
});

test('a stated rate that floors to zero takes nothing at that size, stated as such: 1 base unit at 100 bps carries no whole base unit of discount, and the rate still stands', () => {
  const r = modelPriceDiscount({ priceAmount: '0.000001', discountRateBps: 100, decimals: 6 });
  assert.equal(r.noDiscountStated, false);
  assert.equal(r.discountFloorsToZero, true);
  assert.equal(r.fullyDiscounted, false);
  assert.equal(r.discountAmount, 0n);
  assert.equal(r.amountDue, 1n);
  assert.equal(r.discountShareBpsText, '0.00');
  assert.equal(r.dueShareBpsText, '10000.00');
});

test('a 10000 bps rate discounts the price whole: 1000 at the full rate takes 1000 off and the amount due is zero, a fully discounted outcome', () => {
  const r = modelPriceDiscount({ priceAmount: '1000', discountRateBps: 10000, decimals: 0 });
  assert.equal(r.fullyDiscounted, true);
  assert.equal(r.noDiscountStated, false);
  assert.equal(r.discountFloorsToZero, false);
  assert.equal(r.discountAmount, 1000n);
  assert.equal(r.amountDue, 0n);
  assert.equal(r.discountShareBpsText, '10000.00');
  assert.equal(r.dueShareBpsText, '0.00');
});

test('shares are derived from the amounts against the list price: on the no-decimals 777 price, 155 off a 777 price states shares 1994.85 and 8005.14', () => {
  const r = modelPriceDiscount({ priceAmount: '777', discountRateBps: 2000, decimals: 0 });
  assert.equal(r.discountShareBpsText, '1994.85');
  assert.equal(r.dueShareBpsText, '8005.14');
});

test('the discount share is floored, never rounded up: 1 off a price of 3 states 3333.33, not the 3333.34 rounding would state', () => {
  const r = modelPriceDiscount({ priceAmount: '3', discountRateBps: 5000, decimals: 0 });
  assert.equal(r.discountAmount, 1n);
  assert.equal(r.amountDue, 2n);
  assert.equal(r.discountShareBpsText, '3333.33');
  assert.equal(r.dueShareBpsText, '6666.66');
});

test('amounts beyond float precision stay exact: a 2^53+1 price at 2500 bps takes 2251799813685248 off and the amount due is 6755399441055745', () => {
  const r = modelPriceDiscount({ priceAmount: '9007199254740993', discountRateBps: 2500, decimals: 0 });
  assert.equal(r.discountAmount, 2251799813685248n);
  assert.equal(r.amountDue, 6755399441055745n);
  assert.equal(r.discountShareBpsText, '2499.99');
  assert.equal(r.dueShareBpsText, '7500.00');
});

test('the cut floors on an odd price: 999 at 3333 bps takes 332 off, never 333 taken by rounding up', () => {
  const r = modelPriceDiscount({ priceAmount: '999', discountRateBps: 3333, decimals: 0 });
  assert.equal(r.discountAmount, 332n);
  assert.equal(r.amountDue, 667n);
  assert.equal(r.discountAmount + r.amountDue, r.priceAmount);
});

test('a zero list price is refused: a price of nothing carries no discount', () => {
  assert.throws(() => modelPriceDiscount({ priceAmount: '0', discountRateBps: 2500, decimals: 6 }), /List price must be greater than zero/);
  assert.throws(() => modelPriceDiscount({ discountRateBps: 2500, decimals: 6 }), /List price must be greater than zero/);
});

test('a rate beyond the whole or fractional is refused: the stated rate is a whole share of the list price', () => {
  assert.throws(() => modelPriceDiscount({ priceAmount: '1000', discountRateBps: 10001, decimals: 6 }), /Discount rate must be a whole number of basis points/);
  assert.throws(() => modelPriceDiscount({ priceAmount: '1000', discountRateBps: 12.5, decimals: 6 }), /Discount rate must be a whole number of basis points/);
  assert.throws(() => modelPriceDiscount({ priceAmount: '1000', discountRateBps: -1, decimals: 6 }), /Discount rate must be a whole number of basis points/);
});

test('a negative price is refused at parsing, before the model ever sees it', () => {
  assert.throws(() => modelPriceDiscount({ priceAmount: '-1', discountRateBps: 2500, decimals: 6 }), /Enter a positive decimal amount/);
});
