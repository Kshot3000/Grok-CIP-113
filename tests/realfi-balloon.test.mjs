import test from 'node:test';
import assert from 'node:assert/strict';
import { amortizationSchedule, balloonLoan } from '../src/domain.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const LOAN = { principal: 50000, rate: 8, amortizationMonths: 12 };

test('the balloon is read off the displayed schedule itself, not re-derived', () => {
  const full = amortizationSchedule({ principal: LOAN.principal, rate: LOAN.rate, months: 12 });
  const r = balloonLoan({ ...LOAN, balloonMonths: 6 });
  assert.equal(r.monthlyPayment, full.monthlyPayment);
  assert.equal(r.balloonAmount, full.schedule[5].balance);
  assert.equal(r.schedule.length, 6);
  assert.equal(r.schedule[5].balance, r.balloonAmount);
  assert.equal(r.finalPayment, full.schedule[5].payment + r.balloonAmount);
});

test('the default scenario: due month 6 leaves $25,498.27 — 51.00% of the principal — as the balloon', () => {
  const r = balloonLoan({ ...LOAN, balloonMonths: 6 });
  assert.ok(near(r.monthlyPayment, 4349.42), `payment ${r.monthlyPayment}`);
  assert.ok(near(r.balloonAmount, 25498.27), `balloon ${r.balloonAmount}`);
  assert.ok(near(r.finalPayment, 29847.70), `final ${r.finalPayment}`);
  assert.ok(near(r.principalSharePercent, 51.00, 0.005), `share ${r.principalSharePercent}`);
  assert.equal(r.monthsEarly, 6);
});

test('paying the balloon in full totals exactly principal plus the interest actually charged', () => {
  const r = balloonLoan({ ...LOAN, balloonMonths: 6 });
  assert.ok(near(r.totalPaid, LOAN.principal + r.totalInterest, 1e-6), `total ${r.totalPaid}`);
  assert.ok(near(r.totalInterest, 1594.80), `interest ${r.totalInterest}`);
  assert.ok(near(r.interestNotCharged, 598.25), `not charged ${r.interestNotCharged}`);
  assert.ok(near(r.totalInterest + r.interestNotCharged, r.fullTermInterest, 1e-6));
});

test('a due month at the end of the amortization period is the plain amortizing loan', () => {
  const full = amortizationSchedule({ principal: LOAN.principal, rate: LOAN.rate, months: 12 });
  const r = balloonLoan({ ...LOAN, balloonMonths: 12 });
  assert.equal(r.balloonAmount, 0);
  assert.equal(r.principalSharePercent, 0);
  assert.equal(r.monthsEarly, 0);
  assert.equal(r.interestNotCharged, 0);
  assert.ok(near(r.totalInterest, full.totalInterest, 1e-9));
  assert.ok(near(r.totalPaid, full.total, 1e-9));
  assert.equal(r.finalPayment, full.schedule[11].payment);
});

test('due in month 1: one month of interest, and 91.97% of the principal rides on the final payment', () => {
  const r = balloonLoan({ ...LOAN, balloonMonths: 1 });
  assert.ok(near(r.totalInterest, 50000 * 0.08 / 12, 1e-6), `interest ${r.totalInterest}`);
  assert.ok(near(r.balloonAmount, 45983.91), `balloon ${r.balloonAmount}`);
  assert.ok(near(r.principalSharePercent, 91.97, 0.005), `share ${r.principalSharePercent}`);
});

test('a 0% loan divides exactly: half the principal is the balloon at the halfway month', () => {
  const r = balloonLoan({ principal: 1200, rate: 0, amortizationMonths: 12, balloonMonths: 6 });
  assert.equal(r.monthlyPayment, 100);
  assert.equal(r.balloonAmount, 600);
  assert.equal(r.finalPayment, 700);
  assert.equal(r.principalSharePercent, 50);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.interestNotCharged, 0);
  assert.equal(r.totalPaid, 1200);
});

test('the classic long structure: 30-year amortization due in 5 years keeps 93.05% of the principal in the balloon', () => {
  const r = balloonLoan({ principal: 100000, rate: 6, amortizationMonths: 360, balloonMonths: 60 });
  assert.ok(near(r.monthlyPayment, 599.55), `payment ${r.monthlyPayment}`);
  assert.ok(near(r.balloonAmount, 93054.36), `balloon ${r.balloonAmount}`);
  assert.ok(near(r.principalSharePercent, 93.05, 0.005), `share ${r.principalSharePercent}`);
  assert.equal(r.monthsEarly, 300);
  assert.equal(r.schedule.length, 60);
});

test('the due-month table walks the quarter points of the amortization period and ends at zero', () => {
  const full = amortizationSchedule({ principal: LOAN.principal, rate: LOAN.rate, months: 12 });
  const r = balloonLoan({ ...LOAN, balloonMonths: 6 });
  assert.deepEqual(r.rows.map(row => row.dueMonths), [3, 6, 9, 12]);
  for (const row of r.rows) {
    assert.equal(row.balloonAmount, full.schedule[row.dueMonths - 1].balance);
    assert.equal(row.finalPayment, full.schedule[row.dueMonths - 1].payment + row.balloonAmount);
  }
  const balloons = r.rows.map(row => row.balloonAmount);
  assert.ok(balloons.every((v, i) => i === 0 || v < balloons[i - 1]), 'balloon shrinks as the due month moves later');
  assert.equal(r.rows[3].balloonAmount, 0);
  assert.equal(r.rows[3].principalSharePercent, 0);
  const long = balloonLoan({ principal: 100000, rate: 6, amortizationMonths: 360, balloonMonths: 60 });
  assert.deepEqual(long.rows.map(row => row.dueMonths), [90, 180, 270, 360]);
});

test('defaults: a 12-month amortization period, due halfway through it', () => {
  const r = balloonLoan({ principal: 50000, rate: 8 });
  assert.equal(r.amortizationMonths, 12);
  assert.equal(r.balloonMonths, 6);
  const odd = balloonLoan({ principal: 50000, rate: 8, amortizationMonths: 7 });
  assert.equal(odd.balloonMonths, 3);
});

test('an earlier due month never charges more interest and never shrinks the balloon share', () => {
  const early = balloonLoan({ ...LOAN, balloonMonths: 3 });
  const late = balloonLoan({ ...LOAN, balloonMonths: 9 });
  assert.ok(early.totalInterest < late.totalInterest);
  assert.ok(early.principalSharePercent > late.principalSharePercent);
  assert.ok(early.interestNotCharged > late.interestNotCharged);
});

test('invalid balloon inputs are rejected', () => {
  assert.throws(() => balloonLoan({ ...LOAN, balloonMonths: 0 }), /balloon due month/);
  assert.throws(() => balloonLoan({ ...LOAN, balloonMonths: 13 }), /balloon due month/);
  assert.throws(() => balloonLoan({ ...LOAN, balloonMonths: 6.5 }), /balloon due month/);
  assert.throws(() => balloonLoan({ ...LOAN, balloonMonths: NaN }), /balloon due month/);
  assert.throws(() => balloonLoan({ ...LOAN, amortizationMonths: 0 }), /whole number of months/);
  assert.throws(() => balloonLoan({ ...LOAN, amortizationMonths: 361 }), /whole number of months/);
  assert.throws(() => balloonLoan({ ...LOAN, amortizationMonths: 12.5 }), /whole number of months/);
  assert.throws(() => balloonLoan({ ...LOAN, principal: -5 }), /principal/);
  assert.throws(() => balloonLoan({ ...LOAN, rate: 101 }), /interest rate/);
});
