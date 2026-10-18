import test from 'node:test';
import assert from 'node:assert/strict';
import { modelStraightLineDepreciation } from '../src/domain.js';

const DEFAULT = { assetCost: '1000000', salvageValue: '200000', usefulLifePeriods: 8, elapsedPeriods: 3, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, elapsedPeriods: 0 },
  { ...DEFAULT, elapsedPeriods: 8 },
  { ...DEFAULT, salvageValue: '1000000', elapsedPeriods: 8 },
  { assetCost: '100', salvageValue: '0', usefulLifePeriods: 3, elapsedPeriods: 2, decimals: 6 },
  { assetCost: '100', salvageValue: '0', usefulLifePeriods: 3, elapsedPeriods: 3, decimals: 6 },
  { assetCost: '0.001', salvageValue: '0', usefulLifePeriods: 3, elapsedPeriods: 1, decimals: 6 },
  { assetCost: '333333.333333', salvageValue: '33333.333333', usefulLifePeriods: 3, elapsedPeriods: 2, decimals: 6 },
  { assetCost: '2', salvageValue: '1', usefulLifePeriods: 4, elapsedPeriods: 1, decimals: 6 },
  { ...DEFAULT, decimals: 0 },
];

test('preload: a cost of 1000000 with a salvage of 200000 over 8 periods depreciates by 100000000000 per period, with 300000000000 taken and a book value of 700000000000 after 3 periods', () => {
  const r = modelStraightLineDepreciation(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.assetCost, 1000000000000n);
  assert.equal(r.salvageValue, 200000000000n);
  assert.equal(r.depreciableAmount, 800000000000n);
  assert.equal(r.depreciationPerPeriod, 100000000000n);
  assert.equal(r.totalDepreciation, 300000000000n);
  assert.equal(r.bookValue, 700000000000n);
  assert.equal(r.remainingDepreciable, 500000000000n);
});

test('the salvage is never depreciated: the per-period amount is measured on cost less salvage, never on the whole cost', () => {
  const r = modelStraightLineDepreciation(DEFAULT);
  assert.equal(r.salvageNeverDepreciated, true);
  assert.equal(r.depreciationPerPeriod, r.depreciableAmount / 8n);
  assert.notEqual(r.depreciationPerPeriod, r.assetCost / 8n);
  assert.notEqual(r.depreciationPerPeriod, 125000000000n);
});

test('the book value never falls below the salvage and both amounts are conserved on every stated case', () => {
  for (const input of CASES) {
    const r = modelStraightLineDepreciation(input);
    assert.equal(r.bookNeverBelowSalvage, true);
    assert.ok(r.bookValue >= r.salvageValue);
    assert.equal(r.totalDepreciation + r.bookValue, r.assetCost);
    assert.equal(r.totalDepreciation + r.remainingDepreciable, r.depreciableAmount);
    assert.equal(r.depreciableAmount + r.salvageValue, r.assetCost);
  }
});

test('depreciation is not a payment and not a fee, and other methods, impairment, revaluation, disposal, and taxes are not priced', () => {
  const r = modelStraightLineDepreciation(DEFAULT);
  assert.equal(r.depreciationIsPayment, false);
  assert.equal(r.depreciationIsFee, false);
  assert.equal(r.otherMethodsPriced, false);
  assert.equal(r.impairmentPriced, false);
  assert.equal(r.revaluationPriced, false);
  assert.equal(r.disposalPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('zero elapsed periods state no depreciation taken and a book value of the whole cost', () => {
  const r = modelStraightLineDepreciation({ ...DEFAULT, elapsedPeriods: 0 });
  assert.equal(r.totalDepreciation, 0n);
  assert.equal(r.bookValue, 1000000000000n);
  assert.equal(r.remainingDepreciable, 800000000000n);
});

test('at the end of the life the book value is the salvage exactly and nothing remains to take', () => {
  const r = modelStraightLineDepreciation({ ...DEFAULT, elapsedPeriods: 8 });
  assert.equal(r.totalDepreciation, 800000000000n);
  assert.equal(r.bookValue, 200000000000n);
  assert.equal(r.remainingDepreciable, 0n);
});

test('the final period absorbs the flooring remainder: over a life of 3 on 100 the total taken is the whole depreciable amount, not 3 times the floored period amount', () => {
  const r = modelStraightLineDepreciation({ assetCost: '100', salvageValue: '0', usefulLifePeriods: 3, elapsedPeriods: 3, decimals: 6 });
  assert.equal(r.finalPeriodAbsorbsRemainder, true);
  assert.equal(r.depreciationPerPeriod, 33333333n);
  assert.equal(r.totalDepreciation, 100000000n);
  assert.notEqual(r.totalDepreciation, 99999999n);
  assert.equal(r.bookValue, 0n);
});

test('flooring is exact before the final period: on 100 over 3 periods, 2 elapsed periods take 66666666 and the book value is 33333334', () => {
  const r = modelStraightLineDepreciation({ assetCost: '100', salvageValue: '0', usefulLifePeriods: 3, elapsedPeriods: 2, decimals: 6 });
  assert.equal(r.totalDepreciation, 66666666n);
  assert.equal(r.bookValue, 33333334n);
  assert.equal(r.remainingDepreciable, 33333334n);
});

test('on a tiny cost of 0.001 over 3 periods, 1 elapsed period takes 333 base units and the book value is 667', () => {
  const r = modelStraightLineDepreciation({ assetCost: '0.001', salvageValue: '0', usefulLifePeriods: 3, elapsedPeriods: 1, decimals: 6 });
  assert.equal(r.depreciationPerPeriod, 333n);
  assert.equal(r.totalDepreciation, 333n);
  assert.equal(r.bookValue, 667n);
});

test('fractional amounts are exact: a cost of 333333.333333 less a salvage of 33333.333333 depreciates by 100000000000 per period over 3 periods', () => {
  const r = modelStraightLineDepreciation({ assetCost: '333333.333333', salvageValue: '33333.333333', usefulLifePeriods: 3, elapsedPeriods: 2, decimals: 6 });
  assert.equal(r.depreciableAmount, 300000000000n);
  assert.equal(r.depreciationPerPeriod, 100000000000n);
  assert.equal(r.totalDepreciation, 200000000000n);
  assert.equal(r.bookValue, 133333333333n);
});

test('a salvage equal to the whole cost is stated, not refused: nothing is depreciated and the book value is the cost throughout', () => {
  const r = modelStraightLineDepreciation({ ...DEFAULT, salvageValue: '1000000', elapsedPeriods: 8 });
  assert.equal(r.depreciableAmount, 0n);
  assert.equal(r.depreciationPerPeriod, 0n);
  assert.equal(r.totalDepreciation, 0n);
  assert.equal(r.bookValue, 1000000000000n);
});

test('more elapsed periods always take at least as much depreciation and never raise the book value', () => {
  const early = modelStraightLineDepreciation({ ...DEFAULT, elapsedPeriods: 1 });
  const late = modelStraightLineDepreciation({ ...DEFAULT, elapsedPeriods: 7 });
  assert.ok(late.totalDepreciation > early.totalDepreciation);
  assert.ok(late.bookValue < early.bookValue);
});

test('an asset cost of zero is refused', () => {
  assert.throws(() => modelStraightLineDepreciation({ ...DEFAULT, assetCost: '0' }), /Asset cost must be greater than zero/);
});

test('a salvage above the asset cost is refused', () => {
  assert.throws(() => modelStraightLineDepreciation({ ...DEFAULT, salvageValue: '1000001' }), /Salvage value must not exceed the asset cost/);
});

test('a useful life of zero or a non-whole life, and elapsed periods beyond the life or not whole, are refused', () => {
  assert.throws(() => modelStraightLineDepreciation({ ...DEFAULT, usefulLifePeriods: 0 }), /Useful life must be a whole number of periods/);
  assert.throws(() => modelStraightLineDepreciation({ ...DEFAULT, usefulLifePeriods: 2.5 }), /Useful life must be a whole number of periods/);
  assert.throws(() => modelStraightLineDepreciation({ ...DEFAULT, elapsedPeriods: 9 }), /Elapsed periods must be a whole number/);
  assert.throws(() => modelStraightLineDepreciation({ ...DEFAULT, elapsedPeriods: -1 }), /Elapsed periods must be a whole number/);
});
