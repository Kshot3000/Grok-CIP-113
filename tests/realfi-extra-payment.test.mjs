import test from 'node:test';
import assert from 'node:assert/strict';
import { amortizationSchedule } from '../src/domain.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

test('no extra payment is the baseline schedule, unchanged', () => {
  const plain = amortizationSchedule({ principal: 50000, rate: 8, months: 12 });
  const explicit = amortizationSchedule({ principal: 50000, rate: 8, months: 12, extraMonthly: 0 });
  assert.equal(plain.extraMonthly, 0);
  assert.equal(plain.payoffMonths, 12);
  assert.equal(plain.monthsSaved, 0);
  assert.equal(plain.interestSaved, 0);
  assert.equal(plain.scheduledPayment, plain.monthlyPayment);
  assert.deepEqual(explicit.schedule, plain.schedule);
  assert.equal(explicit.totalInterest, plain.totalInterest);
});

test('an extra payment pays the default scenario off two months early and saves interest', () => {
  // $50,000 at 8% over 12 months: scheduled $4,349.42, plus $1,000 extra.
  const r = amortizationSchedule({ principal: 50000, rate: 8, months: 12, extraMonthly: 1000 });
  assert.ok(near(r.monthlyPayment, 4349.42), `level payment ${r.monthlyPayment}`);
  assert.ok(near(r.scheduledPayment, 5349.42), `scheduled ${r.scheduledPayment}`);
  assert.equal(r.payoffMonths, 10);
  assert.equal(r.monthsSaved, 2);
  assert.ok(near(r.totalInterest, 1801.44, 0.5), `interest ${r.totalInterest}`);
  assert.ok(near(r.interestSaved, 391.62, 0.5), `saved ${r.interestSaved}`);
  // Every month but the last pays the full scheduled amount; the final
  // payment is only the remaining balance plus its interest.
  assert.ok(r.schedule.slice(0, -1).every(row => near(row.payment, 5349.42)));
  assert.ok(near(r.schedule.at(-1).payment, 3656.65), `final ${r.schedule.at(-1).payment}`);
  assert.equal(r.schedule.at(-1).balance, 0);
});

test('the schedule still repays exactly with an extra payment', () => {
  const r = amortizationSchedule({ principal: 20000, rate: 9, months: 24, extraMonthly: 250 });
  const principalSum = r.schedule.reduce((s, row) => s + row.principal, 0);
  assert.ok(near(principalSum, 20000, 0.001), `principal sum ${principalSum}`);
  const paymentSum = r.schedule.reduce((s, row) => s + row.payment, 0);
  assert.ok(near(paymentSum, r.total, 0.001));
  assert.ok(near(r.total - 20000, r.totalInterest, 0.001));
  assert.ok(r.schedule.length < 24, 'extra payment shortens the schedule');
  assert.equal(r.payoffMonths, r.schedule.length);
  assert.equal(r.monthsSaved, 24 - r.schedule.length);
});

test('interest saved is exactly the baseline interest minus the actual interest', () => {
  const input = { principal: 10000, rate: 12, months: 12 };
  const base = amortizationSchedule(input);
  const extra = amortizationSchedule({ ...input, extraMonthly: 100 });
  assert.equal(extra.payoffMonths, 11);
  assert.equal(extra.monthsSaved, 1);
  assert.ok(near(extra.interestSaved, base.totalInterest - extra.totalInterest, 1e-9));
  assert.ok(near(extra.interestSaved, 65.48, 0.5), `saved ${extra.interestSaved}`);
  assert.ok(extra.totalInterest < base.totalInterest);
});

test('at a zero rate an extra payment shortens the term and saves nothing', () => {
  const r = amortizationSchedule({ principal: 1200, rate: 0, months: 12, extraMonthly: 100 });
  assert.equal(r.payoffMonths, 6);
  assert.equal(r.monthsSaved, 6);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.interestSaved, 0);
  assert.equal(r.total, 1200);
  assert.ok(r.schedule.every(row => row.payment === 200));
});

test('an extra payment larger than the loan pays it off in month one', () => {
  const r = amortizationSchedule({ principal: 10000, rate: 12, months: 12, extraMonthly: 100000 });
  assert.equal(r.payoffMonths, 1);
  assert.equal(r.monthsSaved, 11);
  // One month of interest on the full principal, and nothing after it.
  assert.ok(near(r.totalInterest, 100));
  assert.ok(near(r.schedule[0].payment, 10100));
  assert.equal(r.schedule[0].balance, 0);
  assert.ok(near(r.interestSaved, 561.85, 0.5), `saved ${r.interestSaved}`);
});

test('a larger extra never pays off later or costs more interest', () => {
  const input = { principal: 30000, rate: 10, months: 36 };
  let prev = amortizationSchedule(input);
  for (const extraMonthly of [50, 200, 500, 2000]) {
    const r = amortizationSchedule({ ...input, extraMonthly });
    assert.ok(r.payoffMonths <= prev.payoffMonths, `payoff at ${extraMonthly}`);
    assert.ok(r.totalInterest <= prev.totalInterest, `interest at ${extraMonthly}`);
    prev = r;
  }
});

test('the extra payment applies from month one, not at the end', () => {
  // If the extra were applied late, the first month's principal part would
  // be the level principal part; it is exactly $100 higher here.
  const base = amortizationSchedule({ principal: 10000, rate: 12, months: 12 });
  const extra = amortizationSchedule({ principal: 10000, rate: 12, months: 12, extraMonthly: 100 });
  assert.ok(near(extra.schedule[0].interest, base.schedule[0].interest));
  assert.ok(near(extra.schedule[0].principal - base.schedule[0].principal, 100));
  assert.ok(extra.schedule[0].balance < base.schedule[0].balance);
});

test('invalid extra payments are rejected instead of producing a schedule', () => {
  const ok = { principal: 10000, rate: 5, months: 12 };
  assert.throws(() => amortizationSchedule({ ...ok, extraMonthly: -1 }), /extra monthly payment/);
  assert.throws(() => amortizationSchedule({ ...ok, extraMonthly: NaN }), /extra monthly payment/);
  assert.throws(() => amortizationSchedule({ ...ok, extraMonthly: 1e12 + 1 }), /extra monthly payment/);
  assert.throws(() => amortizationSchedule({ ...ok, extraMonthly: Infinity }), /extra monthly payment/);
});
