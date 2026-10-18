import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelStackedDiscounts, modelPriceDiscount } from '../src/domain.js';

// Stacked discounts model (v1.257): the discount axis's
// second moment — two stated cuts in a stated order, the
// second measured against the price the first cut leaves
// (never both against the list price), each cut floored at
// its own stage, and the shares derived from the amounts
// against the list price, floored.
const DEFAULT = { priceAmount: '1000', firstRateBps: 2500, secondRateBps: 2000, decimals: 6 };

test('the preloaded stack: a 1000 list price at a stated 2500 bps first rate and a stated 2000 bps second rate takes 250 off, then 150 off the 750 that leaves, and the amount due is 600, shares 2500.00, 1500.00, 4000.00 and 6000.00', () => {
  const r = modelStackedDiscounts(DEFAULT);
  assert.equal(r.priceAmount, 1000000000n);
  assert.equal(r.firstDiscountAmount, 250000000n);
  assert.equal(r.priceAfterFirst, 750000000n);
  assert.equal(r.secondDiscountAmount, 150000000n);
  assert.equal(r.totalDiscountAmount, 400000000n);
  assert.equal(r.amountDue, 600000000n);
  assert.equal(r.firstShareBpsText, '2500.00');
  assert.equal(r.secondShareBpsText, '1500.00');
  assert.equal(r.totalShareBpsText, '4000.00');
  assert.equal(r.dueShareBpsText, '6000.00');
});

test('the default rates are none stated when none are given: the amount due is the list price whole', () => {
  const r = modelStackedDiscounts({ priceAmount: '1000', decimals: 6 });
  assert.equal(r.firstRateBps, 0);
  assert.equal(r.secondRateBps, 0);
  assert.equal(r.totalDiscountAmount, 0n);
  assert.equal(r.amountDue, r.priceAmount);
  assert.equal(r.noDiscountStated, true);
});

test('identities hold across prices: the two cuts taken plus the amount due is the list price, exactly, at every stage', () => {
  const cases = [
    DEFAULT,
    { priceAmount: '1000', firstRateBps: 0, secondRateBps: 0, decimals: 6 },
    { priceAmount: '1000', firstRateBps: 10000, secondRateBps: 2000, decimals: 6 },
    { priceAmount: '1000', firstRateBps: 2500, secondRateBps: 10000, decimals: 6 },
    { priceAmount: '777', firstRateBps: 2000, secondRateBps: 1000, decimals: 0 },
    { priceAmount: '9007199254740993', firstRateBps: 2500, secondRateBps: 2000, decimals: 0 },
    { priceAmount: '0.000001', firstRateBps: 100, secondRateBps: 100, decimals: 6 },
  ];
  for (const c of cases) {
    const r = modelStackedDiscounts(c);
    assert.equal(r.firstDiscountAmount + r.priceAfterFirst, r.priceAmount);
    assert.equal(r.secondDiscountAmount + r.amountDue, r.priceAfterFirst);
    assert.equal(r.firstDiscountAmount + r.secondDiscountAmount + r.amountDue, r.priceAmount);
    assert.equal(r.totalDiscountAmount, r.firstDiscountAmount + r.secondDiscountAmount);
  }
});

test('the second cut is measured against the price the first cut leaves, never against the list price: on the no-decimals 777 price at 2000 then 1000 bps the second cut is 62, not the 77 the list price states', () => {
  const r = modelStackedDiscounts({ priceAmount: '777', firstRateBps: 2000, secondRateBps: 1000, decimals: 0 });
  assert.equal(r.firstDiscountAmount, 155n);
  assert.equal(r.priceAfterFirst, 622n);
  assert.equal(r.secondDiscountAmount, 62n);
  assert.equal(r.totalDiscountAmount, 217n);
  assert.equal(r.amountDue, 560n);
  assert.notEqual(r.secondDiscountAmount, 777n * 1000n / 10000n);
});

test('measuring both cuts against the list overstates the total by exactly the second rate taken on the first discount: on the preload it states 200 where the stacked second cut is 150', () => {
  const r = modelStackedDiscounts(DEFAULT);
  assert.equal(1000000000n * 2000n / 10000n, 200000000n);
  assert.equal(r.secondDiscountAmount, 150000000n);
  assert.equal(200000000n - r.secondDiscountAmount, 250000000n * 2000n / 10000n);
  assert.equal(r.bothMeasuredOnList, false);
  assert.equal(r.ratesAddedTogether, false);
});

test('with one rate at zero the stack states exactly what the single-discount model states at the other rate', () => {
  const secondOnly = modelStackedDiscounts({ priceAmount: '1000', firstRateBps: 0, secondRateBps: 2000, decimals: 6 });
  const singleSecond = modelPriceDiscount({ priceAmount: '1000', discountRateBps: 2000, decimals: 6 });
  assert.equal(secondOnly.secondDiscountAmount, singleSecond.discountAmount);
  assert.equal(secondOnly.amountDue, singleSecond.amountDue);
  const firstOnly = modelStackedDiscounts({ priceAmount: '1000', firstRateBps: 2500, secondRateBps: 0, decimals: 6 });
  const singleFirst = modelPriceDiscount({ priceAmount: '1000', discountRateBps: 2500, decimals: 6 });
  assert.equal(firstOnly.firstDiscountAmount, singleFirst.discountAmount);
  assert.equal(firstOnly.amountDue, singleFirst.amountDue);
});

test('eligibility is not priced: the model states the cuts the stated rates describe, never whether a buyer may take both or how long either is offered', () => {
  const r = modelStackedDiscounts(DEFAULT);
  assert.equal(r.eligibilityPriced, false);
});

test('both rates at zero state no discount: the amount due is the list price whole, with total share 0.00 and due share 10000.00', () => {
  const r = modelStackedDiscounts({ priceAmount: '1000', firstRateBps: 0, secondRateBps: 0, decimals: 6 });
  assert.equal(r.noDiscountStated, true);
  assert.equal(r.fullyDiscounted, false);
  assert.equal(r.firstDiscountAmount, 0n);
  assert.equal(r.secondDiscountAmount, 0n);
  assert.equal(r.amountDue, 1000000000n);
  assert.equal(r.totalShareBpsText, '0.00');
  assert.equal(r.dueShareBpsText, '10000.00');
});

test('stated rates that floor to zero at their stages take nothing at that size, stated as such: 1 base unit at 100 then 100 bps carries no whole base unit of either cut, and the rates still stand', () => {
  const r = modelStackedDiscounts({ priceAmount: '0.000001', firstRateBps: 100, secondRateBps: 100, decimals: 6 });
  assert.equal(r.noDiscountStated, false);
  assert.equal(r.firstDiscountFloorsToZero, true);
  assert.equal(r.secondDiscountFloorsToZero, true);
  assert.equal(r.firstDiscountAmount, 0n);
  assert.equal(r.secondDiscountAmount, 0n);
  assert.equal(r.amountDue, 1n);
});

test('a first rate of the whole takes the price whole: the second stated rate has nothing left to take and the amount due is zero', () => {
  const r = modelStackedDiscounts({ priceAmount: '1000', firstRateBps: 10000, secondRateBps: 2000, decimals: 0 });
  assert.equal(r.firstTakesWholePrice, true);
  assert.equal(r.secondTakesRemainingPrice, false);
  assert.equal(r.secondDiscountFloorsToZero, false);
  assert.equal(r.fullyDiscounted, true);
  assert.equal(r.firstDiscountAmount, 1000n);
  assert.equal(r.priceAfterFirst, 0n);
  assert.equal(r.secondDiscountAmount, 0n);
  assert.equal(r.amountDue, 0n);
});

test('a second rate of the whole takes everything the first cut left: 1000 at 2500 then 10000 bps takes 250 then the remaining 750, and the amount due is zero', () => {
  const r = modelStackedDiscounts({ priceAmount: '1000', firstRateBps: 2500, secondRateBps: 10000, decimals: 6 });
  assert.equal(r.firstTakesWholePrice, false);
  assert.equal(r.secondTakesRemainingPrice, true);
  assert.equal(r.fullyDiscounted, true);
  assert.equal(r.firstDiscountAmount, 250000000n);
  assert.equal(r.secondDiscountAmount, 750000000n);
  assert.equal(r.totalDiscountAmount, 1000000000n);
  assert.equal(r.amountDue, 0n);
  assert.equal(r.totalShareBpsText, '10000.00');
  assert.equal(r.dueShareBpsText, '0.00');
});

test('the stated order is part of the terms: on a price of 3, rates of 3441 then 5106 bps leave 1 due, while 5106 then 3441 leave 2', () => {
  const forward = modelStackedDiscounts({ priceAmount: '3', firstRateBps: 3441, secondRateBps: 5106, decimals: 0 });
  const swapped = modelStackedDiscounts({ priceAmount: '3', firstRateBps: 5106, secondRateBps: 3441, decimals: 0 });
  assert.equal(forward.totalDiscountAmount, 2n);
  assert.equal(forward.amountDue, 1n);
  assert.equal(swapped.totalDiscountAmount, 1n);
  assert.equal(swapped.amountDue, 2n);
});

test('shares are derived from the amounts against the list price: on the no-decimals 777 price, cuts of 155 and 62 state shares 1994.85 and 797.94, a total of 2792.79 and a due share of 7207.20', () => {
  const r = modelStackedDiscounts({ priceAmount: '777', firstRateBps: 2000, secondRateBps: 1000, decimals: 0 });
  assert.equal(r.firstShareBpsText, '1994.85');
  assert.equal(r.secondShareBpsText, '797.94');
  assert.equal(r.totalShareBpsText, '2792.79');
  assert.equal(r.dueShareBpsText, '7207.20');
});

test('the total share is floored, never rounded up: a total cut of 1 off a price of 3 states 3333.33, not the 3333.34 rounding would state', () => {
  const r = modelStackedDiscounts({ priceAmount: '3', firstRateBps: 5000, secondRateBps: 0, decimals: 0 });
  assert.equal(r.totalDiscountAmount, 1n);
  assert.equal(r.amountDue, 2n);
  assert.equal(r.totalShareBpsText, '3333.33');
  assert.equal(r.dueShareBpsText, '6666.66');
});

test('amounts beyond float precision stay exact: a 2^53+1 price at 2500 then 2000 bps takes 2251799813685248 then 1351079888211149, and the amount due is 5404319552844596', () => {
  const r = modelStackedDiscounts({ priceAmount: '9007199254740993', firstRateBps: 2500, secondRateBps: 2000, decimals: 0 });
  assert.equal(r.firstDiscountAmount, 2251799813685248n);
  assert.equal(r.priceAfterFirst, 6755399441055745n);
  assert.equal(r.secondDiscountAmount, 1351079888211149n);
  assert.equal(r.totalDiscountAmount, 3602879701896397n);
  assert.equal(r.amountDue, 5404319552844596n);
  assert.equal(r.firstShareBpsText, '2499.99');
  assert.equal(r.secondShareBpsText, '1500.00');
  assert.equal(r.totalShareBpsText, '3999.99');
});

test('each cut floors at its own stage on an odd price: 999 at 3333 then 3333 bps takes 332 then 222, never more taken by rounding either stage up', () => {
  const r = modelStackedDiscounts({ priceAmount: '999', firstRateBps: 3333, secondRateBps: 3333, decimals: 0 });
  assert.equal(r.firstDiscountAmount, 332n);
  assert.equal(r.priceAfterFirst, 667n);
  assert.equal(r.secondDiscountAmount, 222n);
  assert.equal(r.totalDiscountAmount, 554n);
  assert.equal(r.amountDue, 445n);
});

test('a zero list price is refused: a price of nothing carries no stack', () => {
  assert.throws(() => modelStackedDiscounts({ priceAmount: '0', firstRateBps: 2500, secondRateBps: 2000, decimals: 6 }), /List price must be greater than zero/);
  assert.throws(() => modelStackedDiscounts({ firstRateBps: 2500, secondRateBps: 2000, decimals: 6 }), /List price must be greater than zero/);
});

test('a rate beyond the whole or fractional is refused at either stage: each stated rate is a whole share of its own stage price', () => {
  assert.throws(() => modelStackedDiscounts({ priceAmount: '1000', firstRateBps: 10001, secondRateBps: 2000, decimals: 6 }), /First discount rate must be a whole number of basis points/);
  assert.throws(() => modelStackedDiscounts({ priceAmount: '1000', firstRateBps: 12.5, secondRateBps: 2000, decimals: 6 }), /First discount rate must be a whole number of basis points/);
  assert.throws(() => modelStackedDiscounts({ priceAmount: '1000', firstRateBps: 2500, secondRateBps: 10001, decimals: 6 }), /Second discount rate must be a whole number of basis points/);
  assert.throws(() => modelStackedDiscounts({ priceAmount: '1000', firstRateBps: 2500, secondRateBps: -1, decimals: 6 }), /Second discount rate must be a whole number of basis points/);
});

test('a negative price is refused at parsing, before the model ever sees it', () => {
  assert.throws(() => modelStackedDiscounts({ priceAmount: '-1', firstRateBps: 2500, secondRateBps: 2000, decimals: 6 }), /Enter a positive decimal amount/);
});
