import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelLendingHealthStress } from '../src/domain.js';

// Lending health stress model (v1.243): the liquidation model
// prices a position already under water; this model reprices a
// position after a stated move in its collateral's price and
// states whether the move crossed the liquidation threshold,
// recovered the position, or wiped the collateral out — plus the
// share of the collateral that could be lost before liquidation,
// derived from the amounts.
const DEFAULT = { collateralValue: '10000', debtValue: '7000', liquidationThresholdBps: 8000, priceMoveBps: -2500, decimals: 6 };

test('the preloaded stress: a 25% fall takes a healthy position across its threshold', () => {
  const r = modelLendingHealthStress(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.collateralValue, 10000000000n);
  assert.equal(r.debtValue, 7000000000n);
  assert.equal(r.collateralAfter, 7500000000n);
  assert.equal(r.collateralChange, -2500000000n);
  assert.equal(r.maxDebtBefore, 8000000000n);
  assert.equal(r.maxDebtAfter, 6000000000n);
  assert.equal(r.minSafeCollateral, 8750000000n);
  assert.equal(r.healthBeforeBpsText, '11428.57');
  assert.equal(r.healthAfterBpsText, '8571.42');
  assert.equal(r.safeFallShareBpsText, '1250.00');
  assert.equal(r.headroomAfter, 0n);
  assert.equal(r.shortfallAfter, 1000000000n);
  assert.equal(r.liquidatableBefore, false);
  assert.equal(r.liquidatableAfter, true);
  assert.equal(r.crossedIntoLiquidation, true);
  assert.equal(r.recoveredFromLiquidation, false);
  assert.equal(r.collateralWipedOut, false);
  assert.equal(r.priceFall, true);
});

test('identities: the change is after minus before, max debt after is the floored threshold share of the collateral after, headroom and shortfall are never both positive', () => {
  const r = modelLendingHealthStress(DEFAULT);
  assert.equal(r.collateralAfter - r.collateralValue, r.collateralChange);
  assert.equal(r.maxDebtAfter, r.collateralAfter * 8000n / 10000n);
  assert.ok(r.headroomAfter === 0n || r.shortfallAfter === 0n);
});

test('a price rise can recover an underwater position, and that is stated separately from crossing', () => {
  const r = modelLendingHealthStress({ collateralValue: '10000', debtValue: '9000', liquidationThresholdBps: 8000, priceMoveBps: 2500, decimals: 6 });
  assert.equal(r.collateralAfter, 12500000000n);
  assert.equal(r.collateralChange, 2500000000n);
  assert.equal(r.liquidatableBefore, true);
  assert.equal(r.liquidatableAfter, false);
  assert.equal(r.recoveredFromLiquidation, true);
  assert.equal(r.crossedIntoLiquidation, false);
  assert.equal(r.healthAfterBpsText, '11111.11');
  assert.equal(r.headroomAfter, 1000000000n);
  assert.equal(r.safeFallShareBpsText, '0.00');
});

test('a total fall wipes the collateral out and the whole debt is the shortfall', () => {
  const r = modelLendingHealthStress({ ...DEFAULT, priceMoveBps: -10000 });
  assert.equal(r.collateralAfter, 0n);
  assert.equal(r.collateralWipedOut, true);
  assert.equal(r.maxDebtAfter, 0n);
  assert.equal(r.shortfallAfter, 7000000000n);
  assert.equal(r.healthAfterBpsText, '0.00');
  assert.equal(r.crossedIntoLiquidation, true);
});

test('no move changes nothing: health, max debt, and status all stand', () => {
  const r = modelLendingHealthStress({ ...DEFAULT, priceMoveBps: 0 });
  assert.equal(r.collateralAfter, r.collateralValue);
  assert.equal(r.collateralChange, 0n);
  assert.equal(r.noChange, true);
  assert.equal(r.healthAfterBpsText, r.healthBeforeBpsText);
  assert.equal(r.liquidatableAfter, r.liquidatableBefore);
});

test('a position exactly at its minimum safe collateral is not liquidatable but has no fall left', () => {
  const r = modelLendingHealthStress({ collateralValue: '8750', debtValue: '7000', liquidationThresholdBps: 8000, priceMoveBps: 0, decimals: 6 });
  assert.equal(r.minSafeCollateral, 8750000000n);
  assert.equal(r.maxDebtBefore, 7000000000n);
  assert.equal(r.liquidatableBefore, false);
  assert.equal(r.safeFallShareBpsText, '0.00');
  assert.equal(r.healthBeforeBpsText, '10000.00');
  assert.equal(r.headroomAfter, 0n);
  assert.equal(r.shortfallAfter, 0n);
});

test('one base unit below the minimum safe collateral is already liquidatable', () => {
  const r = modelLendingHealthStress({ collateralValue: '8749.999999', debtValue: '7000', liquidationThresholdBps: 8000, priceMoveBps: 0, decimals: 6 });
  assert.equal(r.liquidatableBefore, true);
});

test('the safe fall is derived from the amounts, beyond float precision', () => {
  const r = modelLendingHealthStress({ collateralValue: '10000.000001', debtValue: '7000.000001', liquidationThresholdBps: 8000, priceMoveBps: -3333, decimals: 6 });
  assert.equal(r.collateralAfter, 6667000000n);
  assert.equal(r.minSafeCollateral, 8750000002n);
  assert.equal(r.safeFallShareBpsText, '1249.99');
  assert.equal(r.healthAfterBpsText, '7619.42');
  assert.equal(r.shortfallAfter, 1666400001n);
});

test('the repricing floors: at zero decimals a one-basis-point fall on 10 units states a whole unit lost', () => {
  const r = modelLendingHealthStress({ collateralValue: '10', debtValue: '7', liquidationThresholdBps: 8000, priceMoveBps: -1, decimals: 0 });
  assert.equal(r.collateralAfter, 9n);
  assert.equal(r.collateralChange, -1n);
  assert.equal(r.maxDebtAfter, 7n);
  assert.equal(r.liquidatableAfter, false);
  assert.equal(r.safeFallShareBpsText, '1000.00');
});

test('a rise that does not recover the position leaves it liquidatable and says neither crossed nor recovered', () => {
  const r = modelLendingHealthStress({ collateralValue: '10000', debtValue: '9000', liquidationThresholdBps: 8000, priceMoveBps: 1000, decimals: 6 });
  assert.equal(r.collateralAfter, 11000000000n);
  assert.equal(r.liquidatableBefore, true);
  assert.equal(r.liquidatableAfter, true);
  assert.equal(r.crossedIntoLiquidation, false);
  assert.equal(r.recoveredFromLiquidation, false);
  assert.equal(r.shortfallAfter, 200000000n);
});

test('a fall that stays inside the threshold keeps headroom and crosses nothing', () => {
  const r = modelLendingHealthStress({ ...DEFAULT, priceMoveBps: -1000 });
  assert.equal(r.collateralAfter, 9000000000n);
  assert.equal(r.liquidatableAfter, false);
  assert.equal(r.crossedIntoLiquidation, false);
  assert.equal(r.headroomAfter, 200000000n);
});

test('refusals: zero collateral and zero debt', () => {
  assert.throws(() => modelLendingHealthStress({ ...DEFAULT, collateralValue: '0' }), /Collateral value must be greater than zero/);
  assert.throws(() => modelLendingHealthStress({ ...DEFAULT, debtValue: '0' }), /Debt value must be greater than zero/);
});

test('refusals: out-of-range or fractional threshold', () => {
  assert.throws(() => modelLendingHealthStress({ ...DEFAULT, liquidationThresholdBps: 0 }), /Liquidation threshold/);
  assert.throws(() => modelLendingHealthStress({ ...DEFAULT, liquidationThresholdBps: 10001 }), /Liquidation threshold/);
  assert.throws(() => modelLendingHealthStress({ ...DEFAULT, liquidationThresholdBps: 8000.5 }), /Liquidation threshold/);
});

test('refusals: a price move beyond a total fall, beyond doubling, or fractional', () => {
  assert.throws(() => modelLendingHealthStress({ ...DEFAULT, priceMoveBps: -10001 }), /Price move/);
  assert.throws(() => modelLendingHealthStress({ ...DEFAULT, priceMoveBps: 10001 }), /Price move/);
  assert.throws(() => modelLendingHealthStress({ ...DEFAULT, priceMoveBps: -2500.5 }), /Price move/);
});

test('the shipped site carries the lending health stress panel and its honesty boundary', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /lending-health-stress-output/);
  assert.match(app, /PRISM lends nothing, holds no collateral, observes no price, and liquidates nothing/);
  assert.match(app, /v1\.243/);
});
