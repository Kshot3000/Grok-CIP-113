import test from 'node:test';
import assert from 'node:assert/strict';
import { amortizationSchedule, adjustableRateLoan } from '../src/domain.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const LOAN = { principal: 50000, rate: 8, months: 12 };

test('the months before the reset are the displayed schedule’s own rows, and the reset lands on its balance', () => {
  const plain = amortizationSchedule(LOAN);
  const r = adjustableRateLoan({ ...LOAN, resetMonth: 6, newRate: 10 });
  assert.deepEqual(r.schedule.slice(0, 5), plain.schedule.slice(0, 5));
  assert.ok(near(r.balanceAtReset, plain.schedule[4].balance, 1e-9));
  assert.ok(near(r.balanceAtReset, 29650.03), `balance at reset ${r.balanceAtReset}`);
  // The post-reset rows are the schedule function applied to that balance
  // over the months remaining, months offset.
  const rest = amortizationSchedule({ principal: r.balanceAtReset, rate: 10, months: 7 });
  for (let i = 0; i < rest.schedule.length; i++) {
    const got = r.schedule[5 + i], want = rest.schedule[i];
    assert.equal(got.month, want.month + 5);
    assert.ok(near(got.payment, want.payment, 1e-9), `month ${got.month} payment`);
    assert.ok(near(got.balance, want.balance, 1e-9), `month ${got.month} balance`);
  }
});

test('the default scenario: a reset from 8% to 10% in month 6 steps the payment up and costs $200.61 more', () => {
  const r = adjustableRateLoan({ ...LOAN, resetMonth: 6, newRate: 10 });
  assert.ok(near(r.initialPayment, 4349.42), `initial ${r.initialPayment}`);
  assert.ok(near(r.resetPayment, 4378.08), `reset ${r.resetPayment}`);
  assert.ok(near(r.paymentChange, 28.66), `change ${r.paymentChange}`);
  assert.ok(near(r.paymentChangePercent, 0.66), `change % ${r.paymentChangePercent}`);
  assert.ok(near(r.totalInterest, 2393.67), `interest ${r.totalInterest}`);
  assert.ok(near(r.interestDifference, 200.61), `difference ${r.interestDifference}`);
  assert.equal(r.schedule.length, 12, 'the term never changes');
  assert.equal(r.schedule[11].balance, 0);
});

test('principal parts sum exactly to the principal, and total paid is principal plus interest charged', () => {
  for (const args of [
    { ...LOAN, resetMonth: 6, newRate: 10 },
    { ...LOAN, resetMonth: 3, newRate: 4 },
    { ...LOAN, resetMonth: 12, newRate: 0 },
    { principal: 1200, rate: 0, months: 12, resetMonth: 7, newRate: 12 },
  ]) {
    const r = adjustableRateLoan(args);
    assert.ok(near(r.schedule.reduce((s, row) => s + row.principal, 0), args.principal, 1e-6));
    assert.ok(near(r.totalPaid, args.principal + r.totalInterest, 1e-6));
    assert.equal(r.schedule[r.schedule.length - 1].balance, 0);
  }
});

test('an unchanged rate at the reset IS the plain loan — schedule deep-equal', () => {
  const plain = amortizationSchedule(LOAN);
  const r = adjustableRateLoan({ ...LOAN, resetMonth: 6, newRate: 8 });
  assert.deepEqual(r.schedule, plain.schedule);
  assert.equal(r.resetPayment, r.initialPayment);
  assert.equal(r.paymentChange, 0);
  assert.equal(r.totalInterest, plain.totalInterest);
  assert.equal(r.interestDifference, 0);
});

test('a reset in month 1 IS a plain loan at the new rate — schedule deep-equal', () => {
  const atNew = amortizationSchedule({ principal: 50000, rate: 10, months: 12 });
  const r = adjustableRateLoan({ ...LOAN, resetMonth: 1, newRate: 10 });
  assert.deepEqual(r.schedule, atNew.schedule);
  assert.equal(r.balanceAtReset, 50000);
  assert.ok(near(r.resetPayment, 4395.79), `reset ${r.resetPayment}`);
  assert.ok(near(r.interestDifference, atNew.totalInterest - amortizationSchedule(LOAN).totalInterest, 1e-9));
});

test('a reset down saves: 8% to 4% in month 6 lowers the payment and the interest', () => {
  const r = adjustableRateLoan({ ...LOAN, resetMonth: 6, newRate: 4 });
  assert.ok(near(r.resetPayment, 4292.38), `reset ${r.resetPayment}`);
  assert.ok(r.paymentChange < 0);
  assert.ok(near(r.totalInterest, 1793.79), `interest ${r.totalInterest}`);
  assert.ok(near(r.interestDifference, -399.27), `difference ${r.interestDifference}`);
});

test('a reset in the final month reprices only that payment', () => {
  const plain = amortizationSchedule(LOAN);
  const r = adjustableRateLoan({ ...LOAN, resetMonth: 12, newRate: 10 });
  assert.deepEqual(r.schedule.slice(0, 11), plain.schedule.slice(0, 11));
  const last = r.schedule[11];
  assert.ok(near(last.payment, 4356.62), `final payment ${last.payment}`);
  assert.ok(near(last.interest, 36.01), `final interest ${last.interest}`);
  assert.ok(near(last.principal, plain.schedule[10].balance, 1e-9), 'the final principal part is the balance standing');
  assert.ok(near(r.interestDifference, 7.20), `difference ${r.interestDifference}`);
});

test('the later a rising reset lands, the less extra interest it charges — and the term never changes', () => {
  let previous = Infinity;
  for (const resetMonth of [2, 4, 6, 9, 12]) {
    const r = adjustableRateLoan({ ...LOAN, resetMonth, newRate: 10 });
    assert.equal(r.schedule.length, 12);
    assert.ok(r.interestDifference > 0, `reset ${resetMonth} costs more`);
    assert.ok(r.interestDifference < previous, `reset ${resetMonth} costs less than the earlier reset`);
    previous = r.interestDifference;
  }
});

test('a 0% loan reset upward: the balance at the reset is exact division, and interest starts only from the reset', () => {
  const r = adjustableRateLoan({ principal: 1200, rate: 0, months: 12, resetMonth: 7, newRate: 12 });
  assert.equal(r.balanceAtReset, 600);
  assert.ok(near(r.resetPayment, 103.53), `reset ${r.resetPayment}`);
  assert.ok(near(r.totalInterest, 21.17), `interest ${r.totalInterest}`);
  assert.ok(r.schedule.slice(0, 6).every(row => row.interest === 0 && row.payment === 100));
  const flat = adjustableRateLoan({ principal: 1200, rate: 0, months: 12, resetMonth: 7, newRate: 0 });
  assert.equal(flat.totalInterest, 0);
  assert.equal(flat.resetPayment, 100);
});

test('the standard reset-rate table is clamped, deduped, starts below and rises monotonically through the unchanged row', () => {
  const r = adjustableRateLoan({ ...LOAN, resetMonth: 6, newRate: 10 });
  assert.deepEqual(r.rows.map(row => row.newRate), [6, 8, 10, 12]);
  assert.deepEqual(r.rows.map(row => row.rateDelta), [-2, 0, 2, 4]);
  assert.equal(r.rows[1].interestDifference, 0);
  assert.equal(r.rows[1].resetPayment, r.initialPayment);
  for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i].totalInterest > r.rows[i - 1].totalInterest, `row ${i}`);
  // Clamped at the modeled bounds: a 99% loan's +2/+4 rows collapse onto 100%.
  const high = adjustableRateLoan({ principal: 50000, rate: 99, months: 12, resetMonth: 6, newRate: 100 });
  assert.deepEqual(high.rows.map(row => row.newRate), [97, 99, 100]);
  const low = adjustableRateLoan({ principal: 50000, rate: 1, months: 12, resetMonth: 6, newRate: 0 });
  assert.deepEqual(low.rows.map(row => row.newRate), [0, 1, 3, 5]);
});

test('defaults and validation: reset defaults to mid-term, new rate to initial + 2, malformed inputs throw', () => {
  const r = adjustableRateLoan(LOAN);
  assert.equal(r.resetMonth, 6);
  assert.equal(r.newRate, 10);
  assert.equal(adjustableRateLoan({ principal: 1200, rate: 0, months: 1 }).resetMonth, 1);
  assert.equal(adjustableRateLoan({ principal: 1200, rate: 99.5, months: 12 }).newRate, 100);
  assert.throws(() => adjustableRateLoan({ ...LOAN, resetMonth: 0 }), /between 1 and the 12-month term/);
  assert.throws(() => adjustableRateLoan({ ...LOAN, resetMonth: 13 }), /between 1 and the 12-month term/);
  assert.throws(() => adjustableRateLoan({ ...LOAN, resetMonth: 2.5 }), /between 1 and the 12-month term/);
  assert.throws(() => adjustableRateLoan({ ...LOAN, newRate: -1 }), /between 0 and 100%/);
  assert.throws(() => adjustableRateLoan({ ...LOAN, newRate: 101 }), /between 0 and 100%/);
  assert.throws(() => adjustableRateLoan({ ...LOAN, newRate: NaN }), /between 0 and 100%/);
});
