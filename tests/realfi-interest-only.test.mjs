import test from 'node:test';
import assert from 'node:assert/strict';
import { amortizationSchedule, interestOnlyLoan } from '../src/domain.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const LOAN = { principal: 50000, rate: 8, months: 12 };

test('the amortizing phase is the displayed schedule function applied to the remaining term', () => {
  const rest = amortizationSchedule({ principal: LOAN.principal, rate: LOAN.rate, months: 6 });
  const r = interestOnlyLoan({ ...LOAN, interestOnlyMonths: 6 });
  assert.equal(r.amortizingPayment, rest.monthlyPayment);
  assert.equal(r.schedule.length, 12);
  assert.deepEqual(r.schedule.slice(6).map(row => row.payment), rest.schedule.map(row => row.payment));
  assert.deepEqual(r.schedule.slice(6).map(row => row.balance), rest.schedule.map(row => row.balance));
  assert.deepEqual(r.schedule.slice(6).map(row => row.month), [7, 8, 9, 10, 11, 12]);
});

test('during the interest-only period the balance does not move and every cent of the payment is interest', () => {
  const r = interestOnlyLoan({ ...LOAN, interestOnlyMonths: 6 });
  for (const row of r.schedule.slice(0, 6)) {
    assert.equal(row.principal, 0);
    assert.equal(row.balance, LOAN.principal);
    assert.equal(row.payment, row.interest);
    assert.ok(near(row.payment, 50000 * 0.08 / 12, 1e-9));
  }
  assert.ok(near(r.ioInterest, 2000, 1e-6), `io interest ${r.ioInterest}`);
  assert.ok(r.schedule[6].balance < LOAN.principal, 'repayment starts the month the period ends');
});

test('the default scenario: $333.33 a month, then a step-up to $8,528.85, costing $980.07 more than the plain loan', () => {
  const r = interestOnlyLoan({ ...LOAN, interestOnlyMonths: 6 });
  assert.ok(near(r.ioPayment, 333.33), `io payment ${r.ioPayment}`);
  assert.ok(near(r.amortizingPayment, 8528.85), `amortizing ${r.amortizingPayment}`);
  assert.ok(near(r.paymentIncrease, 8195.52), `increase ${r.paymentIncrease}`);
  assert.ok(near(r.totalInterest, 3173.13), `interest ${r.totalInterest}`);
  assert.ok(near(r.extraInterest, 980.07), `extra ${r.extraInterest}`);
  assert.ok(near(r.plainTotalInterest, 2193.06), `plain ${r.plainTotalInterest}`);
  assert.ok(near(r.totalInterest - r.extraInterest, r.plainTotalInterest, 1e-6));
});

test('principal parts sum exactly to the principal, the schedule ends at zero, and totals are the schedule sums', () => {
  const r = interestOnlyLoan({ ...LOAN, interestOnlyMonths: 6 });
  assert.ok(near(r.schedule.reduce((s, row) => s + row.principal, 0), LOAN.principal, 1e-6));
  assert.equal(r.schedule[11].balance, 0);
  assert.ok(near(r.totalPaid, LOAN.principal + r.totalInterest, 1e-6));
  assert.ok(near(r.totalPaid, r.schedule.reduce((s, row) => s + row.payment, 0), 1e-9));
});

test('an interest-only period of zero is the plain amortizing loan itself', () => {
  const plain = amortizationSchedule(LOAN);
  const r = interestOnlyLoan({ ...LOAN, interestOnlyMonths: 0 });
  assert.deepEqual(r.schedule, plain.schedule);
  assert.equal(r.ioPayment, plain.monthlyPayment);
  assert.equal(r.amortizingPayment, plain.monthlyPayment);
  assert.equal(r.paymentIncrease, 0);
  assert.equal(r.extraInterest, 0);
  assert.equal(r.ioInterest, 0);
  assert.ok(near(r.totalInterest, plain.totalInterest, 1e-9));
});

test('a 0% loan: the interest-only payment is $0, interest stays $0, and the step-up percentage is null, not a guess', () => {
  const r = interestOnlyLoan({ principal: 1200, rate: 0, months: 12, interestOnlyMonths: 6 });
  assert.equal(r.ioPayment, 0);
  assert.equal(r.amortizingPayment, 200);
  assert.equal(r.paymentIncrease, 200);
  assert.equal(r.paymentIncreasePercent, null);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.extraInterest, 0);
  assert.equal(r.totalPaid, 1200);
  assert.deepEqual(r.schedule.map(row => row.balance), [1200, 1200, 1200, 1200, 1200, 1200, 1000, 800, 600, 400, 200, 0]);
});

test('the longest period: 11 interest-only months charge interest on the full principal for the whole year', () => {
  const r = interestOnlyLoan({ ...LOAN, interestOnlyMonths: 11 });
  assert.equal(r.amortizingMonths, 1);
  assert.ok(near(r.amortizingPayment, 50333.33), `final ${r.amortizingPayment}`);
  assert.ok(near(r.totalInterest, 4000, 1e-6), `interest ${r.totalInterest}`);
  assert.ok(near(r.totalInterest, 12 * 50000 * 0.08 / 12, 1e-6));
});

test('a longer interest-only period never costs less and always steps up further', () => {
  const short = interestOnlyLoan({ ...LOAN, interestOnlyMonths: 3 });
  const long = interestOnlyLoan({ ...LOAN, interestOnlyMonths: 9 });
  assert.ok(long.totalInterest > short.totalInterest);
  assert.ok(long.amortizingPayment > short.amortizingPayment);
  assert.equal(short.ioPayment, long.ioPayment);
});

test('the period table walks 0 and the quarter points of the term, starting at the plain loan', () => {
  const r = interestOnlyLoan({ ...LOAN, interestOnlyMonths: 6 });
  assert.deepEqual(r.rows.map(row => row.interestOnlyMonths), [0, 3, 6, 9]);
  assert.equal(r.rows[0].extraInterest, 0);
  assert.ok(near(r.rows[0].totalInterest, r.plainTotalInterest, 1e-9));
  const totals = r.rows.map(row => row.totalInterest);
  assert.ok(totals.every((v, i) => i === 0 || v > totals[i - 1]), 'interest rises with the period');
  const long = interestOnlyLoan({ principal: 100000, rate: 6, months: 360, interestOnlyMonths: 60 });
  assert.deepEqual(long.rows.map(row => row.interestOnlyMonths), [0, 90, 180, 270]);
});

test('defaults: the interest-only period is half the term, rounded down', () => {
  const r = interestOnlyLoan(LOAN);
  assert.equal(r.interestOnlyMonths, 6);
  const odd = interestOnlyLoan({ principal: 50000, rate: 8, months: 7 });
  assert.equal(odd.interestOnlyMonths, 3);
  assert.equal(odd.amortizingMonths, 4);
});

test('invalid interest-only inputs are rejected', () => {
  assert.throws(() => interestOnlyLoan({ ...LOAN, interestOnlyMonths: 12 }), /interest-only period/);
  assert.throws(() => interestOnlyLoan({ ...LOAN, interestOnlyMonths: 13 }), /interest-only period/);
  assert.throws(() => interestOnlyLoan({ ...LOAN, interestOnlyMonths: -1 }), /interest-only period/);
  assert.throws(() => interestOnlyLoan({ ...LOAN, interestOnlyMonths: 2.5 }), /interest-only period/);
  assert.throws(() => interestOnlyLoan({ ...LOAN, interestOnlyMonths: NaN }), /interest-only period/);
  assert.throws(() => interestOnlyLoan({ principal: 50000, rate: 8, months: 1, interestOnlyMonths: 1 }), /interest-only period/);
  assert.throws(() => interestOnlyLoan({ ...LOAN, principal: -5 }), /principal/);
  assert.throws(() => interestOnlyLoan({ ...LOAN, rate: 101 }), /interest rate/);
  assert.throws(() => interestOnlyLoan({ ...LOAN, months: 0 }), /whole number of months/);
});
