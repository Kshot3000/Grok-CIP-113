import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelLendingInterest } from '../src/domain.js';

// Lending interest model (v1.215): the liquidation model prices a
// position already under water and the stress model prices a price
// move, but debt also grows on its own. This model accrues interest
// per period — simple on the starting debt, compound on the growing
// debt, every period floored — and states the first period whose
// closing debt crosses the liquidation threshold.
const DEFAULT = { collateralValue: '10000', debtValue: '7000', interestRateBps: 500, periods: 12, mode: 'compound', liquidationThresholdBps: 8000, decimals: 6 };

test('the preloaded accrual: compound interest grows 7000 of debt to 12570.994278 over 12 periods and crosses at period 3', () => {
  const r = modelLendingInterest(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.collateralValue, 10000000000n);
  assert.equal(r.debtValue, 7000000000n);
  assert.equal(r.firstPeriodInterest, 350000000n);
  assert.equal(r.lastPeriodInterest, 598618775n);
  assert.equal(r.totalInterest, 5570994278n);
  assert.equal(r.debtAfter, 12570994278n);
  assert.equal(r.maxDebt, 8000000000n);
  assert.equal(r.healthBeforeBpsText, '11428.57');
  assert.equal(r.healthAfterBpsText, '6363.85');
  assert.equal(r.totalInterestRateBpsText, '7958.56');
  assert.equal(r.interestShareOfDebtAfterBpsText, '4431.62');
  assert.equal(r.headroomAfter, 0n);
  assert.equal(r.shortfallAfter, 4570994278n);
  assert.equal(r.liquidatableBefore, false);
  assert.equal(r.liquidatableAfter, true);
  assert.equal(r.crossedIntoLiquidation, true);
  assert.equal(r.periodsToLiquidation, 3);
  assert.equal(r.noGrowth, false);
});

test('identities: debt after is the starting debt plus the total interest, the total is the schedule sum, headroom and shortfall are never both positive', () => {
  const r = modelLendingInterest(DEFAULT);
  assert.equal(r.debtAfter, r.debtValue + r.totalInterest);
  assert.equal(r.schedule.reduce((a, b) => a + b, 0n), r.totalInterest);
  assert.equal(r.schedule.length, 12);
  assert.ok(r.headroomAfter === 0n || r.shortfallAfter === 0n);
});

test('simple interest charges the same floored amount every period on the starting debt only', () => {
  const r = modelLendingInterest({ ...DEFAULT, mode: 'simple' });
  assert.ok(r.schedule.every(v => v === 350000000n));
  assert.equal(r.totalInterest, 4200000000n);
  assert.equal(r.debtAfter, 11200000000n);
  assert.equal(r.totalInterestRateBpsText, '6000.00');
  assert.equal(r.interestShareOfDebtAfterBpsText, '3750.00');
  assert.equal(r.healthAfterBpsText, '7142.85');
  assert.equal(r.periodsToLiquidation, 3);
});

test('over one period simple and compound agree exactly — compounding needs a second period to differ', () => {
  const s = modelLendingInterest({ ...DEFAULT, mode: 'simple', periods: 1 });
  const c = modelLendingInterest({ ...DEFAULT, mode: 'compound', periods: 1 });
  assert.equal(s.totalInterest, 350000000n);
  assert.equal(c.totalInterest, s.totalInterest);
  assert.equal(c.debtAfter, s.debtAfter);
  const c2 = modelLendingInterest({ ...DEFAULT, mode: 'compound', periods: 2 });
  const s2 = modelLendingInterest({ ...DEFAULT, mode: 'simple', periods: 2 });
  assert.ok(c2.totalInterest > s2.totalInterest);
});

test('a zero rate grows nothing: the debt, the health, and the status all stand', () => {
  const r = modelLendingInterest({ ...DEFAULT, interestRateBps: 0 });
  assert.equal(r.totalInterest, 0n);
  assert.equal(r.debtAfter, r.debtValue);
  assert.equal(r.noGrowth, true);
  assert.equal(r.healthAfterBpsText, r.healthBeforeBpsText);
  assert.equal(r.periodsToLiquidation, null);
  assert.equal(r.headroomAfter, 1000000000n);
});

test('a position already liquidatable states period 0 — it crossed before any interest accrued', () => {
  const r = modelLendingInterest({ ...DEFAULT, debtValue: '9000' });
  assert.equal(r.liquidatableBefore, true);
  assert.equal(r.periodsToLiquidation, 0);
  assert.equal(r.crossedIntoLiquidation, false);
  assert.equal(r.totalInterest, 7162706931n);
  assert.equal(r.debtAfter, 16162706931n);
  assert.equal(r.shortfallAfter, 8162706931n);
});

test('a short horizon can stay healthy: two compound periods leave headroom and no crossing period', () => {
  const r = modelLendingInterest({ ...DEFAULT, periods: 2 });
  assert.equal(r.totalInterest, 717500000n);
  assert.equal(r.debtAfter, 7717500000n);
  assert.equal(r.liquidatableAfter, false);
  assert.equal(r.periodsToLiquidation, null);
  assert.equal(r.headroomAfter, 282500000n);
  assert.equal(r.healthAfterBpsText, '10366.05');
});

test('a debt exactly at its maximum is not liquidatable and, at a zero rate, stays exactly there', () => {
  const r = modelLendingInterest({ collateralValue: '10000', debtValue: '8000', interestRateBps: 0, periods: 12, mode: 'simple', liquidationThresholdBps: 8000, decimals: 6 });
  assert.equal(r.maxDebt, 8000000000n);
  assert.equal(r.liquidatableBefore, false);
  assert.equal(r.liquidatableAfter, false);
  assert.equal(r.headroomAfter, 0n);
  assert.equal(r.shortfallAfter, 0n);
  assert.equal(r.healthBeforeBpsText, '10000.00');
});

test('the interest share is derived from the amounts, beyond float precision', () => {
  const r = modelLendingInterest({ collateralValue: '10000.000001', debtValue: '7000.000001', interestRateBps: 333, periods: 7, mode: 'compound', liquidationThresholdBps: 8000, decimals: 6 });
  assert.equal(r.firstPeriodInterest, 233100000n);
  assert.equal(r.lastPeriodInterest, 283727120n);
  assert.equal(r.totalInterest, 1804061055n);
  assert.equal(r.debtAfter, 8804061056n);
  assert.equal(r.totalInterestRateBpsText, '2577.23');
  assert.equal(r.interestShareOfDebtAfterBpsText, '2049.12');
  assert.equal(r.periodsToLiquidation, 5);
});

test('the accrual floors: at zero decimals a one-basis-point rate on 10 units accrues nothing at all', () => {
  const r = modelLendingInterest({ collateralValue: '100', debtValue: '10', interestRateBps: 1, periods: 12, mode: 'compound', liquidationThresholdBps: 8000, decimals: 0 });
  assert.equal(r.totalInterest, 0n);
  assert.equal(r.noGrowth, true);
  assert.equal(r.debtAfter, 10n);
  assert.equal(r.headroomAfter, 70n);
});

test('refusals: zero collateral and zero debt', () => {
  assert.throws(() => modelLendingInterest({ ...DEFAULT, collateralValue: '0' }), /Collateral value must be greater than zero/);
  assert.throws(() => modelLendingInterest({ ...DEFAULT, debtValue: '0' }), /Debt value must be greater than zero/);
});

test('refusals: out-of-range or fractional interest rate', () => {
  assert.throws(() => modelLendingInterest({ ...DEFAULT, interestRateBps: -1 }), /Interest rate/);
  assert.throws(() => modelLendingInterest({ ...DEFAULT, interestRateBps: 10001 }), /Interest rate/);
  assert.throws(() => modelLendingInterest({ ...DEFAULT, interestRateBps: 500.5 }), /Interest rate/);
});

test('refusals: periods out of range or fractional', () => {
  assert.throws(() => modelLendingInterest({ ...DEFAULT, periods: 0 }), /Periods must be a whole number/);
  assert.throws(() => modelLendingInterest({ ...DEFAULT, periods: 121 }), /Periods must be a whole number/);
  assert.throws(() => modelLendingInterest({ ...DEFAULT, periods: 12.5 }), /Periods must be a whole number/);
});

test('refusals: an unknown interest mode', () => {
  assert.throws(() => modelLendingInterest({ ...DEFAULT, mode: 'daily' }), /Interest mode must be simple or compound/);
});

test('refusals: out-of-range or fractional liquidation threshold', () => {
  assert.throws(() => modelLendingInterest({ ...DEFAULT, liquidationThresholdBps: 0 }), /Liquidation threshold/);
  assert.throws(() => modelLendingInterest({ ...DEFAULT, liquidationThresholdBps: 10001 }), /Liquidation threshold/);
  assert.throws(() => modelLendingInterest({ ...DEFAULT, liquidationThresholdBps: 8000.5 }), /Liquidation threshold/);
});

test('the shipped site carries the lending interest panel and its honesty boundary', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /lending-interest-output/);
  assert.match(app, /PRISM lends nothing, holds no collateral, charges no interest, and liquidates nothing/);
  assert.match(app, /v1\.215/);
});
