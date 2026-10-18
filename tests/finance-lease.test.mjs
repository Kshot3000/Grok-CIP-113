import test from 'node:test';
import assert from 'node:assert/strict';
import { modelFinanceLease } from '../src/domain.js';

const DEFAULT = { assetCost: '1000000', residualValue: '200000', financeChargeBps: 1000, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, financeChargeBps: 0 },
  { ...DEFAULT, residualValue: '0' },
  { ...DEFAULT, residualValue: '1000000' },
  { ...DEFAULT, residualValue: '100000', financeChargeBps: 500 },
  { assetCost: '1000000', residualValue: '333333.333333', financeChargeBps: 111, decimals: 6 },
  { assetCost: '1', residualValue: '0.999', financeChargeBps: 1, decimals: 6 },
  { ...DEFAULT, decimals: 0 },
  { assetCost: '2', residualValue: '1', financeChargeBps: 10000, decimals: 6 },
  { ...DEFAULT, financeChargeBps: 9999 },
];

test('preload: an asset costing 1000000 retaining 200000 at a 1000 bps charge for the term states a depreciable amount of 800000, a charge of 80000, and total rentals of 880000', () => {
  const r = modelFinanceLease(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.assetCost, 1000000000000n);
  assert.equal(r.residualValue, 200000000000n);
  assert.equal(r.financeChargeBps, 1000);
  assert.equal(r.depreciableAmount, 800000000000n);
  assert.equal(r.financeChargeAmount, 80000000000n);
  assert.equal(r.totalRentalsAmount, 880000000000n);
});

test('the finance charge is measured on the depreciable amount actually stated, never on the whole asset cost', () => {
  const r = modelFinanceLease(DEFAULT);
  assert.equal(r.chargeOnDepreciable, true);
  assert.notEqual(r.financeChargeAmount, 100000000000n);
  assert.equal(r.financeChargeAmount, r.depreciableAmount * 1000n / 10000n);
});

test('the depreciable amount plus the residual is the asset cost exactly, on every stated case', () => {
  for (const input of CASES) {
    const r = modelFinanceLease(input);
    assert.equal(r.depreciableAmount + r.residualValue, r.assetCost);
    assert.equal(r.depreciablePlusResidualConserved, true);
  }
});

test('the depreciable amount plus the finance charge is the total rentals exactly, on every stated case', () => {
  for (const input of CASES) {
    const r = modelFinanceLease(input);
    assert.equal(r.depreciableAmount + r.financeChargeAmount, r.totalRentalsAmount);
    assert.equal(r.rentalsConserved, true);
  }
});

test('the residual is not a rental: it is counted in no rental total and the asset is leased, not sold', () => {
  const r = modelFinanceLease(DEFAULT);
  assert.equal(r.residualNotRental, true);
  assert.equal(r.assetLeasedNotSold, true);
  assert.notEqual(r.totalRentalsAmount, r.assetCost + r.financeChargeAmount);
});

test('the finance charge is not a fee, and purchase, schedule, term, maintenance, early termination, and default are not priced', () => {
  const r = modelFinanceLease(DEFAULT);
  assert.equal(r.chargeIsFee, false);
  assert.equal(r.purchasePriced, false);
  assert.equal(r.rentalSchedulePriced, false);
  assert.equal(r.termPriced, false);
  assert.equal(r.maintenancePriced, false);
  assert.equal(r.earlyTerminationPriced, false);
  assert.equal(r.defaultPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a residual equal to the whole cost is stated, not refused: the term consumes no value, so the depreciable amount, the charge, and the rentals are all zero', () => {
  const r = modelFinanceLease({ ...DEFAULT, residualValue: '1000000' });
  assert.equal(r.depreciableAmount, 0n);
  assert.equal(r.financeChargeAmount, 0n);
  assert.equal(r.totalRentalsAmount, 0n);
});

test('a residual of zero is stated, not refused: the whole cost is depreciable and the rentals cover it plus the charge', () => {
  const r = modelFinanceLease({ ...DEFAULT, residualValue: '0' });
  assert.equal(r.depreciableAmount, 1000000000000n);
  assert.equal(r.financeChargeAmount, 100000000000n);
  assert.equal(r.totalRentalsAmount, 1100000000000n);
});

test('a finance charge of zero is stated, not refused: the rentals are the depreciable amount alone', () => {
  const r = modelFinanceLease({ ...DEFAULT, financeChargeBps: 0 });
  assert.equal(r.financeChargeAmount, 0n);
  assert.equal(r.totalRentalsAmount, 800000000000n);
});

test('flooring is exact on a fractional residual: the charge floors and both conservations stay exact', () => {
  const r = modelFinanceLease({ assetCost: '1000000', residualValue: '333333.333333', financeChargeBps: 111, decimals: 6 });
  assert.equal(r.depreciableAmount, 666666666667n);
  assert.equal(r.financeChargeAmount, 7400000000n);
  assert.equal(r.totalRentalsAmount, 674066666667n);
});

test('on a tiny depreciable amount a stated charge rate can floor the charge to zero, and that is stated, not hidden', () => {
  const r = modelFinanceLease({ assetCost: '1', residualValue: '0.999', financeChargeBps: 1, decimals: 6 });
  assert.equal(r.depreciableAmount, 1000n);
  assert.equal(r.financeChargeAmount, 0n);
  assert.equal(r.totalRentalsAmount, 1000n);
});

test('a finance charge of 10000 basis points is stated: the charge equals the depreciable amount and the rentals are twice it', () => {
  const r = modelFinanceLease({ assetCost: '2', residualValue: '1', financeChargeBps: 10000, decimals: 6 });
  assert.equal(r.depreciableAmount, 1000000n);
  assert.equal(r.financeChargeAmount, 1000000n);
  assert.equal(r.totalRentalsAmount, 2000000n);
});

test('an asset cost of zero is refused', () => {
  assert.throws(() => modelFinanceLease({ ...DEFAULT, assetCost: '0' }), /Asset cost must be greater than zero/);
});

test('a residual above the asset cost is refused: the asset cannot retain more than it cost', () => {
  assert.throws(() => modelFinanceLease({ ...DEFAULT, residualValue: '1000001' }), /Residual value must not exceed the asset cost/);
});

test('a finance charge above 10000 basis points or not a whole number is refused', () => {
  assert.throws(() => modelFinanceLease({ ...DEFAULT, financeChargeBps: 10001 }), /Finance charge must be a whole number of basis points/);
  assert.throws(() => modelFinanceLease({ ...DEFAULT, financeChargeBps: 100.5 }), /Finance charge must be a whole number of basis points/);
});
