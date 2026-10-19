import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPerpetuityValue } from '../src/domain.js';

const DEFAULT = { paymentPerPeriod: '50000', discountRateBps: 500, periodsStated: 10, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, discountRateBps: 0 },
  { ...DEFAULT, paymentPerPeriod: '0' },
  { paymentPerPeriod: '333', discountRateBps: 700, periodsStated: 7, decimals: 6 },
  { paymentPerPeriod: '0.000001', discountRateBps: 100000, periodsStated: 5, decimals: 6 },
  { paymentPerPeriod: '123456.789', discountRateBps: 333, periodsStated: 25, decimals: 6 },
  { ...DEFAULT, periodsStated: 0 },
  { paymentPerPeriod: '1', discountRateBps: 10000, periodsStated: 3, decimals: 0 },
  { paymentPerPeriod: '999', discountRateBps: 1, periodsStated: 2, decimals: 6 },
  { paymentPerPeriod: '7', discountRateBps: 30000, periodsStated: 100, decimals: 6 },
];

test('preload: a payment of 50000 per period at 500 bps is worth 1000000000000, pays 500000000000 over 10 periods, and takes 20 periods to collect', () => {
  const r = modelPerpetuityValue(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.paymentPerPeriod, 50000000000n);
  assert.equal(r.discountRateBps, 500);
  assert.equal(r.periodsStated, 10);
  assert.equal(r.hasFiniteValue, true);
  assert.equal(r.perpetuityValue, 1000000000000n);
  assert.equal(r.totalPaidOverStatedPeriods, 500000000000n);
  assert.equal(r.periodsToCollectValue, 20n);
});

test('the payments never deplete the value: the value after the stated periods is the value before, on every stated case', () => {
  for (const input of CASES) {
    const r = modelPerpetuityValue(input);
    assert.equal(r.paymentsNeverDepleteValue, true);
    assert.equal(r.valueAfterStatedPeriods, r.perpetuityValue);
    assert.equal(r.totalPaidOverStatedPeriods, r.paymentPerPeriod * BigInt(r.periodsStated));
  }
});

test('the value is the exact floor of payment times 10000 over the rate, on every stated case with a positive rate', () => {
  for (const input of CASES) {
    const r = modelPerpetuityValue(input);
    if (!r.hasFiniteValue) continue;
    const rate = BigInt(r.discountRateBps);
    assert.ok(r.perpetuityValue * rate <= r.paymentPerPeriod * 10000n);
    assert.ok(r.paymentPerPeriod * 10000n < (r.perpetuityValue + 1n) * rate);
    assert.equal(r.valueRoundedDown, true);
    assert.equal(r.valueMeasuredOnStatedRate, true);
  }
});

test('at a discount rate of zero there is no finite value, stated not refused, and collecting it states no count', () => {
  const r = modelPerpetuityValue({ ...DEFAULT, discountRateBps: 0 });
  assert.equal(r.hasFiniteValue, false);
  assert.equal(r.perpetuityValue, null);
  assert.equal(r.valueAfterStatedPeriods, null);
  assert.equal(r.periodsToCollectValue, null);
  assert.equal(r.noFiniteValueAtZeroRate, true);
  assert.equal(r.totalPaidOverStatedPeriods, 500000000000n);
});

test('a payment of zero is stated, not refused: an endless stream of nothing is worth nothing', () => {
  const r = modelPerpetuityValue({ ...DEFAULT, paymentPerPeriod: '0' });
  assert.equal(r.hasFiniteValue, true);
  assert.equal(r.perpetuityValue, 0n);
  assert.equal(r.totalPaidOverStatedPeriods, 0n);
  assert.equal(r.periodsToCollectValue, null);
});

test('the value is not a finite count of payments: the preload value of 1000000000000 is not the 500000000000 paid over 10 periods', () => {
  const r = modelPerpetuityValue(DEFAULT);
  assert.notEqual(r.perpetuityValue, r.totalPaidOverStatedPeriods);
  assert.equal(r.finiteTermPriced, false);
});

test('collecting the value takes a ceiling count: a payment of 333 at 700 bps is worth 4757142857 and takes 15 periods to collect', () => {
  const r = modelPerpetuityValue({ paymentPerPeriod: '333', discountRateBps: 700, periodsStated: 7, decimals: 6 });
  assert.equal(r.perpetuityValue, 4757142857n);
  assert.equal(r.periodsToCollectValue, 15n);
  assert.ok(14n * r.paymentPerPeriod < r.perpetuityValue);
  assert.ok(r.perpetuityValue <= 15n * r.paymentPerPeriod);
  assert.equal(r.totalPaidOverStatedPeriods, 2331000000n);
});

test('a tiny payment at the highest stated rate floors to a value of zero, and collecting it takes zero periods', () => {
  const r = modelPerpetuityValue({ paymentPerPeriod: '0.000001', discountRateBps: 100000, periodsStated: 5, decimals: 6 });
  assert.equal(r.paymentPerPeriod, 1n);
  assert.equal(r.perpetuityValue, 0n);
  assert.equal(r.periodsToCollectValue, 0n);
  assert.equal(r.totalPaidOverStatedPeriods, 5n);
});

test('fractional amounts are exact: a payment of 123456.789 at 333 bps is worth 3707411081081 and takes 31 periods to collect', () => {
  const r = modelPerpetuityValue({ paymentPerPeriod: '123456.789', discountRateBps: 333, periodsStated: 25, decimals: 6 });
  assert.equal(r.perpetuityValue, 3707411081081n);
  assert.equal(r.totalPaidOverStatedPeriods, 3086419725000n);
  assert.equal(r.periodsToCollectValue, 31n);
});

test('zero stated periods pay nothing in total and leave the value untouched', () => {
  const r = modelPerpetuityValue({ ...DEFAULT, periodsStated: 0 });
  assert.equal(r.totalPaidOverStatedPeriods, 0n);
  assert.equal(r.perpetuityValue, 1000000000000n);
  assert.equal(r.valueAfterStatedPeriods, 1000000000000n);
});

test('a rate of 10000 bps values the stream at exactly one period payment times one: a payment of 1 at 10000 bps is worth 1', () => {
  const r = modelPerpetuityValue({ paymentPerPeriod: '1', discountRateBps: 10000, periodsStated: 3, decimals: 0 });
  assert.equal(r.perpetuityValue, 1n);
  assert.equal(r.periodsToCollectValue, 1n);
  assert.equal(r.totalPaidOverStatedPeriods, 3n);
});

test('a rate of 1 bp values a payment of 999 at 9990000000000, collecting it over exactly 10000 periods', () => {
  const r = modelPerpetuityValue({ paymentPerPeriod: '999', discountRateBps: 1, periodsStated: 2, decimals: 6 });
  assert.equal(r.perpetuityValue, 9990000000000n);
  assert.equal(r.periodsToCollectValue, 10000n);
  assert.equal(r.totalPaidOverStatedPeriods, 1998000000n);
});

test('the payment is not a fee, and no principal repayment, finite term, payment growth, rate change, issuer default, or tax is priced', () => {
  const r = modelPerpetuityValue(DEFAULT);
  assert.equal(r.paymentIsFee, false);
  assert.equal(r.principalRepaidPriced, false);
  assert.equal(r.finiteTermPriced, false);
  assert.equal(r.paymentGrowthPriced, false);
  assert.equal(r.rateChangesPriced, false);
  assert.equal(r.issuerDefaultPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a discount rate above 100000 bps, negative, or fractional is refused', () => {
  assert.throws(() => modelPerpetuityValue({ ...DEFAULT, discountRateBps: 100001 }), /Discount rate must be a whole number of basis points/);
  assert.throws(() => modelPerpetuityValue({ ...DEFAULT, discountRateBps: -1 }), /Discount rate must be a whole number of basis points/);
  assert.throws(() => modelPerpetuityValue({ ...DEFAULT, discountRateBps: 2.5 }), /Discount rate must be a whole number of basis points/);
});

test('stated periods above 100000, negative, or fractional are refused', () => {
  assert.throws(() => modelPerpetuityValue({ ...DEFAULT, periodsStated: 100001 }), /Stated periods must be a whole number/);
  assert.throws(() => modelPerpetuityValue({ ...DEFAULT, periodsStated: -1 }), /Stated periods must be a whole number/);
  assert.throws(() => modelPerpetuityValue({ ...DEFAULT, periodsStated: 1.5 }), /Stated periods must be a whole number/);
});
