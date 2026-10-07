import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amortizationSchedule, effectiveRate, APR_FEE_PERCENTS } from '../src/domain.js';

const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;
const DEFAULT = { principal: 50000, rate: 8, months: 12, upfrontFees: 500 };

test('no fees: the effective rate is the nominal rate exactly', () => {
  const r = effectiveRate({ ...DEFAULT, upfrontFees: 0 });
  assert.equal(r.aprPercent, 8);
  assert.equal(r.premiumPoints, 0);
  assert.equal(r.exceedsLimit, false);
  assert.equal(r.netProceeds, 50000);
  // With nothing taken up front, the finance charge is the schedule's interest alone.
  assert.ok(near(r.financeCharge, r.totalInterest));
});

test('default scenario: $500 of fees on $50,000 at 8% over 12 months is a 9.90% effective rate', () => {
  const r = effectiveRate(DEFAULT);
  assert.equal(r.aprPercent, 9.9);
  assert.ok(near(r.premiumPoints, 1.9, 1e-9));
  assert.equal(r.netProceeds, 49500);
  // The payment is the displayed schedule's own payment, unchanged by the fees.
  assert.equal(r.monthlyPayment, amortizationSchedule(DEFAULT).monthlyPayment);
});

test('the finance charge is exactly the interest plus the fees', () => {
  const r = effectiveRate(DEFAULT);
  assert.ok(near(r.financeCharge, 2693.06, 0.005));
  assert.ok(near(r.financeCharge, r.totalInterest + r.upfrontFees));
  assert.ok(near(r.financeCharge, r.totalPaid - r.netProceeds));
});

test('solver property: at the reported rate the net proceeds carry the payment, one hundredth lower they do not', () => {
  const r = effectiveRate(DEFAULT);
  const at = rate => amortizationSchedule({ principal: r.netProceeds, rate, months: r.months }).monthlyPayment;
  assert.ok(at(r.aprPercent) >= r.monthlyPayment);
  assert.ok(at(r.aprPercent - 0.01) < r.monthlyPayment);
});

test('a 0% nominal loan with fees still has a positive effective rate', () => {
  const r = effectiveRate({ principal: 1200, rate: 0, months: 12, upfrontFees: 12 });
  assert.equal(r.monthlyPayment, 100);
  assert.equal(r.aprPercent, 1.86);
  assert.ok(r.premiumPoints > 0);
});

test('the fee table is the scenario re-solved at standard fee shares, starting at the nominal rate', () => {
  const r = effectiveRate(DEFAULT);
  assert.deepEqual(r.rows.map(x => x.feePercent), [...APR_FEE_PERCENTS]);
  assert.equal(r.rows[0].aprPercent, 8);
  assert.equal(r.rows[1].feeAmount, 500);
  assert.equal(r.rows[1].aprPercent, r.aprPercent); // The default $500 IS the 1% row.
  for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i].aprPercent > r.rows[i - 1].aprPercent, 'effective rate rises with fees');
});

test('the same fees cost less, in rate terms, spread over a longer term', () => {
  const short = effectiveRate(DEFAULT);
  const long = effectiveRate({ ...DEFAULT, months: 360 });
  assert.equal(long.aprPercent, 8.11);
  assert.ok(long.premiumPoints < short.premiumPoints);
});

test('larger fees always mean a higher effective rate on the same loan', () => {
  const a = effectiveRate({ ...DEFAULT, upfrontFees: 100 });
  const b = effectiveRate({ ...DEFAULT, upfrontFees: 1000 });
  const c = effectiveRate({ ...DEFAULT, upfrontFees: 5000 });
  assert.ok(a.aprPercent < b.aprPercent && b.aprPercent < c.aprPercent);
});

test('fees that swamp the proceeds report above the modeled limit instead of a guessed rate', () => {
  const r = effectiveRate({ principal: 50000, rate: 8, months: 1, upfrontFees: 49000 });
  assert.equal(r.aprPercent, null);
  assert.equal(r.premiumPoints, null);
  assert.equal(r.exceedsLimit, true);
  assert.equal(r.netProceeds, 1000);
});

test('fees at or above the principal are rejected', () => {
  assert.throws(() => effectiveRate({ ...DEFAULT, upfrontFees: 50000 }), /less than the principal/);
  assert.throws(() => effectiveRate({ ...DEFAULT, upfrontFees: 60000 }), /less than the principal/);
});

test('invalid fees and scenario inputs are rejected', () => {
  assert.throws(() => effectiveRate({ ...DEFAULT, upfrontFees: -1 }), /upfront fees/);
  assert.throws(() => effectiveRate({ ...DEFAULT, upfrontFees: NaN }), /upfront fees/);
  assert.throws(() => effectiveRate({ ...DEFAULT, rate: 101 }), /interest rate/);
  assert.throws(() => effectiveRate({ ...DEFAULT, months: 0 }), /months/);
});
