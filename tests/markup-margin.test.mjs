import test from 'node:test';
import assert from 'node:assert/strict';
import { modelMarkupMargin } from '../src/domain.js';

const DEFAULT = { unitCost: '1000000', markupRateBps: 2500, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, markupRateBps: 0 },
  { ...DEFAULT, markupRateBps: 10000 },
  { unitCost: '100', markupRateBps: 1000, decimals: 6 },
  { unitCost: '0.001', markupRateBps: 3333, decimals: 6 },
  { unitCost: '333333.333333', markupRateBps: 1500, decimals: 6 },
  { unitCost: '2', markupRateBps: 1, decimals: 6 },
  { unitCost: '7', markupRateBps: 99999, decimals: 6 },
  { ...DEFAULT, decimals: 0 },
  { unitCost: '0.5', markupRateBps: 5000, decimals: 6 },
];

test('preload: a cost of 1000000 at a markup of 2500 bps sells at 1250000000000, with a profit of 250000000000 and a margin of 2000 bps', () => {
  const r = modelMarkupMargin(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.unitCost, 1000000000000n);
  assert.equal(r.markupRateBps, 2500);
  assert.equal(r.markupAmount, 250000000000n);
  assert.equal(r.sellingPrice, 1250000000000n);
  assert.equal(r.grossProfit, 250000000000n);
  assert.equal(r.impliedMarginBps, 2000);
  assert.equal(r.profitIfMarkupStatedAsMargin, 312500000000n);
});

test('the markup rate is not the margin: stating 2500 bps as the margin would state a profit of 312500, more than the 250000 the price carries', () => {
  const r = modelMarkupMargin(DEFAULT);
  assert.equal(r.markupIsMargin, false);
  assert.equal(r.markupMeasuredOnCost, true);
  assert.equal(r.marginMeasuredOnPrice, true);
  assert.notEqual(r.impliedMarginBps, r.markupRateBps);
  assert.ok(r.profitIfMarkupStatedAsMargin > r.grossProfit);
  assert.notEqual(r.profitIfMarkupStatedAsMargin, r.grossProfit);
});

test('cost plus profit is the price exactly, and the margin never exceeds the markup rate, on every stated case', () => {
  for (const input of CASES) {
    const r = modelMarkupMargin(input);
    assert.equal(r.costPlusProfitIsPrice, true);
    assert.equal(r.unitCost + r.grossProfit, r.sellingPrice);
    assert.equal(r.grossProfit, r.markupAmount);
    assert.equal(r.sellingPrice, r.unitCost + r.markupAmount);
    assert.ok(r.impliedMarginBps <= r.markupRateBps);
    assert.ok(r.profitIfMarkupStatedAsMargin >= r.grossProfit);
    if (r.markupRateBps > 0) assert.ok(r.impliedMarginBps < r.markupRateBps);
  }
});

test('the profit is not a fee, and other costs, discounts, quantities, and taxes are not priced', () => {
  const r = modelMarkupMargin(DEFAULT);
  assert.equal(r.profitIsFee, false);
  assert.equal(r.otherCostsPriced, false);
  assert.equal(r.discountsPriced, false);
  assert.equal(r.quantitiesPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a markup of zero is stated: the price is the cost, the profit is zero, and the margin is zero', () => {
  const r = modelMarkupMargin({ ...DEFAULT, markupRateBps: 0 });
  assert.equal(r.markupAmount, 0n);
  assert.equal(r.sellingPrice, 1000000000000n);
  assert.equal(r.grossProfit, 0n);
  assert.equal(r.impliedMarginBps, 0);
  assert.equal(r.profitIfMarkupStatedAsMargin, 0n);
});

test('a markup of 10000 bps doubles the price: the profit equals the cost and the margin is 5000 bps, half the markup rate', () => {
  const r = modelMarkupMargin({ ...DEFAULT, markupRateBps: 10000 });
  assert.equal(r.markupAmount, 1000000000000n);
  assert.equal(r.sellingPrice, 2000000000000n);
  assert.equal(r.grossProfit, 1000000000000n);
  assert.equal(r.impliedMarginBps, 5000);
});

test('on a cost of 100 at 1000 bps, the price is 110000000, the profit is 10000000, and the margin floors to 909 bps', () => {
  const r = modelMarkupMargin({ unitCost: '100', markupRateBps: 1000, decimals: 6 });
  assert.equal(r.markupAmount, 10000000n);
  assert.equal(r.sellingPrice, 110000000n);
  assert.equal(r.impliedMarginBps, 909);
  assert.equal(r.profitIfMarkupStatedAsMargin, 11000000n);
});

test('on a tiny cost of 0.001 at 3333 bps, the markup floors to 333, the price is 1333, and the margin is 2498 bps', () => {
  const r = modelMarkupMargin({ unitCost: '0.001', markupRateBps: 3333, decimals: 6 });
  assert.equal(r.markupAmount, 333n);
  assert.equal(r.sellingPrice, 1333n);
  assert.equal(r.grossProfit, 333n);
  assert.equal(r.impliedMarginBps, 2498);
  assert.equal(r.profitIfMarkupStatedAsMargin, 444n);
});

test('fractional amounts are exact: 333333.333333 at 1500 bps marks up by 49999999999 to 383333333332, a margin of 1304 bps', () => {
  const r = modelMarkupMargin({ unitCost: '333333.333333', markupRateBps: 1500, decimals: 6 });
  assert.equal(r.markupAmount, 49999999999n);
  assert.equal(r.sellingPrice, 383333333332n);
  assert.equal(r.impliedMarginBps, 1304);
  assert.equal(r.profitIfMarkupStatedAsMargin, 57499999999n);
});

test('a larger markup always states a larger price and a larger profit on the same cost', () => {
  const low = modelMarkupMargin({ ...DEFAULT, markupRateBps: 1000 });
  const high = modelMarkupMargin({ ...DEFAULT, markupRateBps: 4000 });
  assert.ok(high.sellingPrice > low.sellingPrice);
  assert.ok(high.grossProfit > low.grossProfit);
  assert.ok(high.impliedMarginBps > low.impliedMarginBps);
});

test('the margin rises with the markup but never reaches it: at 99999 bps on a cost of 7 the margin stays below 99999 bps', () => {
  const r = modelMarkupMargin({ unitCost: '7', markupRateBps: 99999, decimals: 6 });
  assert.ok(r.impliedMarginBps < 99999);
  assert.ok(r.impliedMarginBps < 10000);
});

test('a unit cost of zero is refused', () => {
  assert.throws(() => modelMarkupMargin({ ...DEFAULT, unitCost: '0' }), /Unit cost must be greater than zero/);
});

test('a markup rate beyond 100000 bps is refused', () => {
  assert.throws(() => modelMarkupMargin({ ...DEFAULT, markupRateBps: 100001 }), /Markup rate must be a whole number of basis points/);
});

test('a negative markup rate is refused', () => {
  assert.throws(() => modelMarkupMargin({ ...DEFAULT, markupRateBps: -1 }), /Markup rate must be a whole number of basis points/);
});

test('a fractional markup rate is refused', () => {
  assert.throws(() => modelMarkupMargin({ ...DEFAULT, markupRateBps: 2.5 }), /Markup rate must be a whole number of basis points/);
});
