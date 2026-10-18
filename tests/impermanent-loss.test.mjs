import test from 'node:test';
import assert from 'node:assert/strict';
import { modelImpermanentLoss } from '../src/domain.js';

const DEFAULT = { amountIn: '1000000', amountOut: '500000', priceMultiplierBps: 20000, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, priceMultiplierBps: 5000 },
  { ...DEFAULT, priceMultiplierBps: 10000 },
  { ...DEFAULT, priceMultiplierBps: 40000 },
  { ...DEFAULT, priceMultiplierBps: 2500 },
  { ...DEFAULT, priceMultiplierBps: 11000 },
  { ...DEFAULT, priceMultiplierBps: 9000 },
  { amountIn: '2500.5', amountOut: '1250.25', priceMultiplierBps: 20000, decimals: 6 },
  { amountIn: '1000000', amountOut: '500000', priceMultiplierBps: 20000, decimals: 0 },
  { ...DEFAULT, priceMultiplierBps: 1000000 },
];

test('preload: a doubled price states a loss of 85786.437628 out against holding, valued in out at the stated new price', () => {
  const r = modelImpermanentLoss(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.amountIn, 1000000000000n);
  assert.equal(r.amountOut, 500000000000n);
  assert.equal(r.priceMultiplierBps, 20000);
  assert.equal(r.kBefore, 500000000000000000000000n);
  assert.equal(r.reserveInAfter, 707106781186n);
  assert.equal(r.reserveOutAfter, 707106781186n);
  assert.equal(r.kAfter, 499999999999225683566596n);
  assert.equal(r.holdValueOut, 1500000000000n);
  assert.equal(r.poolValueOut, 1414213562372n);
  assert.equal(r.lossAmount, 85786437628n);
  assert.equal(r.lossBpsText, '571.90');
  assert.equal(r.priceRose, true);
  assert.equal(r.priceFell, false);
  assert.equal(r.priceUnchanged, false);
  assert.equal(r.lossIsZero, false);
});

test('the loss is the difference between the two stated values on every stated case, never a share without its base', () => {
  for (const input of CASES) {
    const r = modelImpermanentLoss(input);
    assert.equal(r.holdValueOut - r.poolValueOut, r.lossAmount);
    assert.equal(r.valuedInOut, true);
    assert.ok(r.lossAmount >= 0n);
  }
});

test('the loss is measured against holding at the stated new price, never against the entry value, which would mix the price move itself into the loss', () => {
  const r = modelImpermanentLoss(DEFAULT);
  const entryValueOut = r.amountOut + r.amountOut; // The amount in was worth amountOut in out at entry: 1,000,000 out in all.
  assert.equal(entryValueOut, 1000000000000n);
  assert.notEqual(r.lossAmount, entryValueOut - r.poolValueOut);
  assert.ok(r.poolValueOut > entryValueOut); // The position GAINED in out terms when the price doubled — and still lost against holding.
});

test('the rebalancing lies on the position\u2019s own constant product, floored by integer square root: the product after never exceeds the product before', () => {
  for (const input of CASES) {
    const r = modelImpermanentLoss(input);
    assert.equal(r.reserveInAfter * r.reserveOutAfter, r.kAfter);
    assert.ok(r.kAfter <= r.kBefore);
    assert.equal(r.rebalancedAlongProduct, true);
    const sqIn = r.reserveInAfter * r.reserveInAfter;
    assert.ok(sqIn <= r.kBefore * r.amountIn * 10000n / (r.amountOut * BigInt(r.priceMultiplierBps)));
  }
});

test('the loss is symmetric in direction: a doubling and a halving of the price state the same loss share', () => {
  const up = modelImpermanentLoss(DEFAULT);
  const down = modelImpermanentLoss({ ...DEFAULT, priceMultiplierBps: 5000 });
  assert.equal(down.lossBpsText, up.lossBpsText);
  assert.equal(down.lossBpsText, '571.90');
  assert.equal(down.reserveInAfter, 1414213562373n);
  assert.equal(down.reserveOutAfter, 353553390593n);
  assert.equal(down.holdValueOut, 750000000000n);
  assert.equal(down.poolValueOut, 707106781186n);
  assert.equal(down.lossAmount, 42893218814n);
  assert.equal(down.priceFell, true);
});

test('an unchanged price states no loss at all: the reserves after are the deposited amounts exactly and the loss is zero', () => {
  const r = modelImpermanentLoss({ ...DEFAULT, priceMultiplierBps: 10000 });
  assert.equal(r.priceUnchanged, true);
  assert.equal(r.reserveInAfter, r.amountIn);
  assert.equal(r.reserveOutAfter, r.amountOut);
  assert.equal(r.kAfter, r.kBefore);
  assert.equal(r.holdValueOut, r.poolValueOut);
  assert.equal(r.lossAmount, 0n);
  assert.equal(r.lossBpsText, '0.00');
  assert.equal(r.lossIsZero, true);
});

test('the pool holds less of the asset that rose and more of the asset that fell: the rebalanced reserves move against the depositor in both directions', () => {
  const up = modelImpermanentLoss(DEFAULT);
  assert.ok(up.reserveInAfter < up.amountIn); // The in asset's price rose (out per in doubled): the pool holds less of it than was deposited.
  assert.ok(up.reserveOutAfter > up.amountOut);
  const down = modelImpermanentLoss({ ...DEFAULT, priceMultiplierBps: 5000 });
  assert.ok(down.reserveInAfter > down.amountIn);
  assert.ok(down.reserveOutAfter < down.amountOut);
});

test('the loss grows with the size of the move in either direction: a 4x move loses a larger share than a 2x move, and a small move a smaller one', () => {
  const two = modelImpermanentLoss(DEFAULT);
  const four = modelImpermanentLoss({ ...DEFAULT, priceMultiplierBps: 40000 });
  const small = modelImpermanentLoss({ ...DEFAULT, priceMultiplierBps: 11000 });
  assert.ok(BigInt(four.lossBpsText.replace('.', '')) > BigInt(two.lossBpsText.replace('.', '')));
  assert.ok(BigInt(small.lossBpsText.replace('.', '')) < BigInt(two.lossBpsText.replace('.', '')));
  assert.ok(four.lossAmount > two.lossAmount);
});

test('the loss is not a fee and fees earned are never netted against it', () => {
  const r = modelImpermanentLoss(DEFAULT);
  assert.equal(r.lossIsFee, false);
  assert.equal(r.feesEarnedPriced, false);
  assert.equal(r.swapFeesPriced, false);
});

test('the new price is stated as a multiplier, never observed: no oracle, path, or later price enters the model', () => {
  const r = modelImpermanentLoss(DEFAULT);
  assert.equal(r.oraclePricePriced, false);
  assert.equal(r.pricePathPriced, false);
  assert.equal(r.laterPricePriced, false);
  assert.equal(r.concentratedRangePriced, false);
});

test('a zero or negative deposited amount is refused on either side', () => {
  assert.throws(() => modelImpermanentLoss({ ...DEFAULT, amountIn: '0' }), /Position amount in must be greater than zero\./);
  assert.throws(() => modelImpermanentLoss({ ...DEFAULT, amountOut: '0' }), /Position amount out must be greater than zero\./);
});

test('a price multiplier of zero, fractional, or above the stated bound is refused: a price cannot be stated as nothing', () => {
  assert.throws(() => modelImpermanentLoss({ ...DEFAULT, priceMultiplierBps: 0 }), /Price multiplier must be a whole number of basis points between 1 and 1,000,000\./);
  assert.throws(() => modelImpermanentLoss({ ...DEFAULT, priceMultiplierBps: 1.5 }), /Price multiplier must be a whole number of basis points/);
  assert.throws(() => modelImpermanentLoss({ ...DEFAULT, priceMultiplierBps: 1000001 }), /Price multiplier must be a whole number of basis points/);
});

test('an extreme stated move still states a loss below the whole holding value: the pool side is never worth nothing while the price is stated above zero', () => {
  const r = modelImpermanentLoss({ ...DEFAULT, priceMultiplierBps: 1000000 });
  assert.ok(r.poolValueOut > 0n);
  assert.ok(r.lossAmount < r.holdValueOut);
  assert.ok(r.reserveOutAfter > 0n);
});
