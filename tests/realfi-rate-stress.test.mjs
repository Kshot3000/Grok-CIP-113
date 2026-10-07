import test from 'node:test';
import assert from 'node:assert/strict';
import { amortizationSchedule, rateStressTest, RATE_SHOCKS } from '../src/domain.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const LOAN = { principal: 50000, rate: 8, months: 12 };

test('a zero rise reproduces the displayed amortization schedule exactly', () => {
  const base = amortizationSchedule(LOAN);
  const r = rateStressTest({ ...LOAN, shockPoints: 0 });
  assert.equal(r.shocked.monthlyPayment, base.monthlyPayment);
  assert.equal(r.shocked.totalInterest, base.totalInterest);
  assert.equal(r.shocked.paymentIncrease, 0);
  assert.equal(r.shocked.interestIncrease, 0);
  assert.deepEqual(r.rows[0], { shockPoints: 0, ...r.base });
  assert.equal(r.base.rate, 8);
});

test('the default scenario shocked by 3 points: 11%, $4,419.08 payment, $835.94 more interest', () => {
  const r = rateStressTest(LOAN);
  assert.equal(r.shockPoints, 3);
  assert.equal(r.shocked.rate, 11);
  assert.ok(near(r.shocked.monthlyPayment, 4419.08), `payment ${r.shocked.monthlyPayment}`);
  assert.ok(near(r.shocked.totalInterest, 3029.00), `interest ${r.shocked.totalInterest}`);
  assert.ok(near(r.shocked.paymentIncrease, 69.66), `payment increase ${r.shocked.paymentIncrease}`);
  assert.ok(near(r.shocked.interestIncrease, 835.94), `interest increase ${r.shocked.interestIncrease}`);
  // The shocked figures are the schedule's own figures at the shocked rate.
  const direct = amortizationSchedule({ principal: 50000, rate: 11, months: 12 });
  assert.equal(r.shocked.monthlyPayment, direct.monthlyPayment);
  assert.equal(r.shocked.totalInterest, direct.totalInterest);
});

test('the shock is in percentage points, not percent: 8% + 3 points is 11%, not 8.24%', () => {
  const r = rateStressTest(LOAN);
  assert.equal(r.shocked.rate, 11);
  assert.notEqual(r.shocked.rate, 8 * 1.03);
});

test('the standard-shock table is monotone and matches the schedule at each rate', () => {
  const r = rateStressTest(LOAN);
  assert.deepEqual(r.rows.map(row => row.shockPoints), [...RATE_SHOCKS]);
  for (let i = 1; i < r.rows.length; i++) {
    assert.ok(r.rows[i].monthlyPayment > r.rows[i - 1].monthlyPayment);
    assert.ok(r.rows[i].totalInterest > r.rows[i - 1].totalInterest);
  }
  for (const row of r.rows) {
    const direct = amortizationSchedule({ principal: 50000, rate: row.rate, months: 12 });
    assert.equal(row.monthlyPayment, direct.monthlyPayment);
  }
  const last = r.rows.at(-1);
  assert.equal(last.rate, 18);
  assert.ok(near(last.monthlyPayment, 4584.00), `+10 payment ${last.monthlyPayment}`);
  assert.ok(near(last.interestIncrease, 2814.94), `+10 interest increase ${last.interestIncrease}`);
});

test('shocks that would pass the 100% modeled limit are left out of the table', () => {
  const r = rateStressTest({ principal: 50000, rate: 98, months: 12, shockPoints: 2 });
  assert.equal(r.shocked.rate, 100);
  assert.deepEqual(r.rows.map(row => row.shockPoints), [0, 1, 2]);
});

test('a budget solver result fits, and one hundredth of a point higher does not', () => {
  const r = rateStressTest({ ...LOAN, paymentBudget: 4500 });
  assert.ok(near(r.zeroRatePayment, 4166.67), `zero-rate ${r.zeroRatePayment}`);
  assert.equal(r.maxRateForBudget, 14.45);
  assert.ok(near(r.rateHeadroomPoints, 6.45), `headroom ${r.rateHeadroomPoints}`);
  assert.equal(r.cappedAtMax, false);
  assert.equal(r.overBudget, false);
  const fits = amortizationSchedule({ principal: 50000, rate: r.maxRateForBudget, months: 12 });
  assert.ok(fits.monthlyPayment <= 4500, `at max ${fits.monthlyPayment}`);
  const over = amortizationSchedule({ principal: 50000, rate: r.maxRateForBudget + 0.01, months: 12 });
  assert.ok(over.monthlyPayment > 4500, `above max ${over.monthlyPayment}`);
});

test('a budget equal to the current payment solves back to about the current rate', () => {
  const base = amortizationSchedule(LOAN);
  const r = rateStressTest({ ...LOAN, paymentBudget: base.monthlyPayment });
  assert.ok(Math.abs(r.maxRateForBudget - 8) <= 0.01, `max ${r.maxRateForBudget}`);
  assert.equal(r.overBudget, false);
});

test('a budget below the current payment is over budget, with negative headroom', () => {
  const r = rateStressTest({ ...LOAN, paymentBudget: 4300 });
  assert.equal(r.overBudget, true);
  assert.ok(r.maxRateForBudget < 8, `max ${r.maxRateForBudget}`);
  assert.ok(r.rateHeadroomPoints < 0);
  const fits = amortizationSchedule({ principal: 50000, rate: r.maxRateForBudget, months: 12 });
  assert.ok(fits.monthlyPayment <= 4300);
});

test('a budget below even the 0% payment fits no rate and returns null', () => {
  const r = rateStressTest({ ...LOAN, paymentBudget: 4000 });
  assert.equal(r.maxRateForBudget, null);
  assert.equal(r.rateHeadroomPoints, null);
  assert.equal(r.overBudget, true);
  assert.ok(r.zeroRatePayment > 4000);
});

test('a budget that fits even 100% is reported as capped at the modeled limit', () => {
  const r = rateStressTest({ ...LOAN, paymentBudget: 100000 });
  assert.equal(r.maxRateForBudget, 100);
  assert.equal(r.cappedAtMax, true);
});

test('no budget supplied means no solver fields are invented', () => {
  const r = rateStressTest(LOAN);
  assert.equal(r.paymentBudget, null);
  assert.equal(r.maxRateForBudget, null);
  assert.equal(r.zeroRatePayment, null);
  assert.equal(r.overBudget, false);
});

test('invalid stress inputs are rejected', () => {
  assert.throws(() => rateStressTest({ ...LOAN, shockPoints: -1 }), /rate rise/);
  assert.throws(() => rateStressTest({ ...LOAN, shockPoints: 101 }), /rate rise/);
  assert.throws(() => rateStressTest({ ...LOAN, shockPoints: NaN }), /rate rise/);
  assert.throws(() => rateStressTest({ ...LOAN, shockPoints: 95 }), /100% modeled limit/);
  assert.throws(() => rateStressTest({ ...LOAN, paymentBudget: 0 }), /payment budget/);
  assert.throws(() => rateStressTest({ ...LOAN, paymentBudget: -5 }), /payment budget/);
  assert.throws(() => rateStressTest({ ...LOAN, principal: -5 }), /principal/);
  assert.throws(() => rateStressTest({ ...LOAN, months: 12.5 }), /whole number of months/);
});
