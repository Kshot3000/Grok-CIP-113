import test from 'node:test';
import assert from 'node:assert/strict';
import { modelAverageCostBasis } from '../src/domain.js';

const DEFAULT = { lot1Quantity: 300, lot1Price: '2', lot2Quantity: 100, lot2Price: '6', statedQuantity: 150, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, statedQuantity: 0 },
  { ...DEFAULT, statedQuantity: 400 },
  { lot1Quantity: 3, lot1Price: '1.000001', lot2Quantity: 1, lot2Price: '0', statedQuantity: 2, decimals: 6 },
  { lot1Quantity: 100, lot1Price: '0', lot2Quantity: 100, lot2Price: '4', statedQuantity: 50, decimals: 6 },
  { lot1Quantity: 7, lot1Price: '3', lot2Quantity: 0, lot2Price: '9', statedQuantity: 7, decimals: 6 },
  { lot1Quantity: 11, lot1Price: '0.5', lot2Quantity: 3, lot2Price: '2.25', statedQuantity: 4, decimals: 6 },
  { lot1Quantity: 1, lot1Price: '0.000001', lot2Quantity: 1, lot2Price: '0.000002', statedQuantity: 1, decimals: 6 },
  { lot1Quantity: 999, lot1Price: '7', lot2Quantity: 1, lot2Price: '7', statedQuantity: 500, decimals: 6 },
  { lot1Quantity: 5, lot1Price: '10', lot2Quantity: 5, lot2Price: '10', statedQuantity: 10, decimals: 0 },
];

test('preload: 300 units at 2 plus 100 units at 6 cost 1200000000 in total and carry an average cost of 3000000 per unit', () => {
  const r = modelAverageCostBasis(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.lot1Price, 2000000n);
  assert.equal(r.lot2Price, 6000000n);
  assert.equal(r.totalQuantity, 400);
  assert.equal(r.lot1Cost, 600000000n);
  assert.equal(r.lot2Cost, 600000000n);
  assert.equal(r.totalCost, 1200000000n);
  assert.equal(r.averageCostPerUnit, 3000000n);
  assert.equal(r.averagingRemainder, 0n);
  assert.equal(r.basisOfStatedQuantity, 450000000n);
});

test('the total cost is the two lots costs added exactly, on every stated case', () => {
  for (const input of CASES) {
    const r = modelAverageCostBasis(input);
    assert.equal(r.lot1Cost, BigInt(r.lot1Quantity) * r.lot1Price);
    assert.equal(r.lot2Cost, BigInt(r.lot2Quantity) * r.lot2Price);
    assert.equal(r.lot1Cost + r.lot2Cost, r.totalCost);
    assert.equal(r.totalQuantity, r.lot1Quantity + r.lot2Quantity);
    assert.equal(r.basisOfStatedQuantity, r.averageCostPerUnit * BigInt(r.statedQuantity));
  }
});

test('the average is the exact floor of total cost over total quantity, with a remainder below the total quantity, on every stated case', () => {
  for (const input of CASES) {
    const r = modelAverageCostBasis(input);
    const q = BigInt(r.totalQuantity);
    assert.equal(r.averageCostPerUnit * q + r.averagingRemainder, r.totalCost);
    assert.ok(r.averagingRemainder >= 0n);
    assert.ok(r.averagingRemainder < q);
    assert.equal(r.averageRoundedDown, true);
    assert.equal(r.averageWeightedByQuantity, true);
  }
});

test('the average is weighted by quantity: the preload average is not the plain mean of 4000000, which would state a cost of 1600000000', () => {
  const r = modelAverageCostBasis(DEFAULT);
  assert.equal(r.plainMeanPrice, 4000000n);
  assert.equal(r.costAtPlainMean, 1600000000n);
  assert.notEqual(r.averageCostPerUnit, r.plainMeanPrice);
  assert.notEqual(r.totalCost, r.costAtPlainMean);
  assert.ok(r.costAtPlainMean > r.totalCost);
});

test('the average lies between the two lot prices inclusive, on every stated case', () => {
  for (const input of CASES) {
    const r = modelAverageCostBasis(input);
    const lo = r.lot1Price < r.lot2Price ? r.lot1Price : r.lot2Price;
    const hi = r.lot1Price < r.lot2Price ? r.lot2Price : r.lot1Price;
    assert.ok(r.averageCostPerUnit >= lo);
    assert.ok(r.averageCostPerUnit <= hi);
  }
});

test('the flooring remainder is stated exactly: 3 units at 1.000001 plus 1 unit at 0 average 750000 with a remainder of 3', () => {
  const r = modelAverageCostBasis({ lot1Quantity: 3, lot1Price: '1.000001', lot2Quantity: 1, lot2Price: '0', statedQuantity: 2, decimals: 6 });
  assert.equal(r.totalCost, 3000003n);
  assert.equal(r.averageCostPerUnit, 750000n);
  assert.equal(r.averagingRemainder, 3n);
  assert.equal(r.basisOfStatedQuantity, 1500000n);
});

test('a lot priced at zero is stated, not refused: 100 units at 0 plus 100 units at 4 average exactly 2000000', () => {
  const r = modelAverageCostBasis({ lot1Quantity: 100, lot1Price: '0', lot2Quantity: 100, lot2Price: '4', statedQuantity: 50, decimals: 6 });
  assert.equal(r.lot1Cost, 0n);
  assert.equal(r.totalCost, 400000000n);
  assert.equal(r.averageCostPerUnit, 2000000n);
  assert.equal(r.basisOfStatedQuantity, 100000000n);
});

test('a lot of zero quantity is stated, not refused: it contributes nothing whatever its price says', () => {
  const r = modelAverageCostBasis({ lot1Quantity: 7, lot1Price: '3', lot2Quantity: 0, lot2Price: '9', statedQuantity: 7, decimals: 6 });
  assert.equal(r.lot2Cost, 0n);
  assert.equal(r.totalQuantity, 7);
  assert.equal(r.averageCostPerUnit, 3000000n);
  assert.equal(r.basisOfStatedQuantity, 21000000n);
});

test('when both lots carry the same price the average is that price exactly, at any weighting', () => {
  const r = modelAverageCostBasis({ lot1Quantity: 999, lot1Price: '7', lot2Quantity: 1, lot2Price: '7', statedQuantity: 500, decimals: 6 });
  assert.equal(r.averageCostPerUnit, 7000000n);
  assert.equal(r.plainMeanPrice, 7000000n);
  assert.equal(r.totalCost, r.costAtPlainMean);
});

test('fractional prices are exact: 11 units at 0.5 plus 3 units at 2.25 average 875000 on a total cost of 12250000', () => {
  const r = modelAverageCostBasis({ lot1Quantity: 11, lot1Price: '0.5', lot2Quantity: 3, lot2Price: '2.25', statedQuantity: 4, decimals: 6 });
  assert.equal(r.totalCost, 12250000n);
  assert.equal(r.averageCostPerUnit, 875000n);
  assert.equal(r.basisOfStatedQuantity, 3500000n);
});

test('base-unit prices are exact: 1 unit at 0.000001 plus 1 unit at 0.000002 average 1 with a remainder of 1', () => {
  const r = modelAverageCostBasis({ lot1Quantity: 1, lot1Price: '0.000001', lot2Quantity: 1, lot2Price: '0.000002', statedQuantity: 1, decimals: 6 });
  assert.equal(r.totalCost, 3n);
  assert.equal(r.averageCostPerUnit, 1n);
  assert.equal(r.averagingRemainder, 1n);
});

test('a stated quantity of zero carries a basis of zero, and the whole position carries the total cost exactly', () => {
  const zero = modelAverageCostBasis({ ...DEFAULT, statedQuantity: 0 });
  assert.equal(zero.basisOfStatedQuantity, 0n);
  const whole = modelAverageCostBasis({ ...DEFAULT, statedQuantity: 400 });
  assert.equal(whole.basisOfStatedQuantity + whole.averagingRemainder, whole.totalCost);
  assert.equal(whole.basisOfStatedQuantity, 1200000000n);
});

test('a position that cost nothing averages zero: two lots priced at zero state a total cost and an average of zero', () => {
  const r = modelAverageCostBasis({ lot1Quantity: 10, lot1Price: '0', lot2Quantity: 5, lot2Price: '0', statedQuantity: 3, decimals: 6 });
  assert.equal(r.totalCost, 0n);
  assert.equal(r.averageCostPerUnit, 0n);
  assert.equal(r.basisOfStatedQuantity, 0n);
});

test('the average is not a value and not a fee, and no current price, gain or loss, acquisition fee, or tax is priced', () => {
  const r = modelAverageCostBasis(DEFAULT);
  assert.equal(r.averageIsValue, false);
  assert.equal(r.averageIsFee, false);
  assert.equal(r.currentPricePriced, false);
  assert.equal(r.gainLossPriced, false);
  assert.equal(r.acquisitionFeesPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a total quantity of zero is refused, and out-of-range quantities or a stated quantity above the position are refused', () => {
  assert.throws(() => modelAverageCostBasis({ ...DEFAULT, lot1Quantity: 0, lot2Quantity: 0 }), /Total quantity must be greater than zero/);
  assert.throws(() => modelAverageCostBasis({ ...DEFAULT, lot1Quantity: -1 }), /Lot 1 quantity must be a whole number/);
  assert.throws(() => modelAverageCostBasis({ ...DEFAULT, lot2Quantity: 1.5 }), /Lot 2 quantity must be a whole number/);
  assert.throws(() => modelAverageCostBasis({ ...DEFAULT, statedQuantity: 401 }), /Stated quantity must be a whole number/);
  assert.throws(() => modelAverageCostBasis({ ...DEFAULT, statedQuantity: -1 }), /Stated quantity must be a whole number/);
});
