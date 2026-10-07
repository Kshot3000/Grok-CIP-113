import test from 'node:test';
import assert from 'node:assert/strict';
import { amortizationSchedule, extraForTargetPayoff } from '../src/domain.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const LOAN = { principal: 50000, rate: 8, months: 12 };

test('a target equal to the term needs no extra payment', () => {
  const r = extraForTargetPayoff({ ...LOAN, targetMonths: 12 });
  const base = amortizationSchedule(LOAN);
  assert.equal(r.extraMonthly, 0);
  assert.equal(r.payoffMonths, 12);
  assert.equal(r.monthsSaved, 0);
  assert.equal(r.interestSaved, 0);
  assert.equal(r.scheduledPayment, r.monthlyPayment);
  assert.deepEqual(r.schedule, base.schedule);
});

test('the solved extra pays the default scenario off by the target month', () => {
  // Solving for 10 months must need no more than the $1,000 extra that
  // v1.22 showed pays off in 10 — and strictly less proves minimality bites.
  const r = extraForTargetPayoff({ ...LOAN, targetMonths: 10 });
  assert.ok(near(r.extraMonthly, 835.74), `extra ${r.extraMonthly}`);
  assert.equal(r.payoffMonths, 10);
  assert.equal(r.monthsSaved, 2);
  assert.ok(r.extraMonthly < 1000);
  assert.ok(near(r.interestSaved, 341.45, 0.5), `saved ${r.interestSaved}`);
  assert.equal(r.schedule.at(-1).balance, 0);
});

test('the solved extra is minimal to the cent', () => {
  for (const targetMonths of [1, 3, 6, 9, 11]) {
    const r = extraForTargetPayoff({ ...LOAN, targetMonths });
    const atSolved = amortizationSchedule({ ...LOAN, extraMonthly: r.extraMonthly });
    assert.ok(atSolved.payoffMonths <= targetMonths, `target ${targetMonths} at solved extra`);
    const oneCentLess = amortizationSchedule({ ...LOAN, extraMonthly: (Math.round(r.extraMonthly * 100) - 1) / 100 });
    assert.ok(oneCentLess.payoffMonths > targetMonths, `target ${targetMonths} one cent less`);
  }
});

test('feeding the solved extra back reproduces the solver result exactly', () => {
  const r = extraForTargetPayoff({ ...LOAN, targetMonths: 6 });
  const chk = amortizationSchedule({ ...LOAN, extraMonthly: r.extraMonthly });
  assert.equal(chk.payoffMonths, r.payoffMonths);
  assert.equal(chk.totalInterest, r.totalInterest);
  assert.equal(chk.total, r.total);
  assert.deepEqual(chk.schedule, r.schedule);
});

test('an earlier target never needs a smaller extra or saves less interest', () => {
  let prev = extraForTargetPayoff({ ...LOAN, targetMonths: 12 });
  for (const targetMonths of [10, 8, 6, 4, 2]) {
    const r = extraForTargetPayoff({ ...LOAN, targetMonths });
    assert.ok(r.extraMonthly >= prev.extraMonthly, `extra at ${targetMonths}`);
    assert.ok(r.interestSaved >= prev.interestSaved, `saved at ${targetMonths}`);
    assert.ok(r.payoffMonths <= targetMonths);
    prev = r;
  }
});

test('at a zero rate the solver is exact division', () => {
  // $1,200 over 12 months at 0%: $100/mo scheduled. Paying off in 6 needs
  // $200/mo total — exactly $100 extra, no search fuzz.
  const r = extraForTargetPayoff({ principal: 1200, rate: 0, months: 12, targetMonths: 6 });
  assert.equal(r.extraMonthly, 100);
  assert.equal(r.payoffMonths, 6);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.interestSaved, 0);
  assert.equal(r.total, 1200);
});

test('a one-month target pays off with a single month of interest', () => {
  const r = extraForTargetPayoff({ principal: 10000, rate: 12, months: 12, targetMonths: 1 });
  assert.equal(r.payoffMonths, 1);
  assert.equal(r.monthsSaved, 11);
  assert.ok(near(r.totalInterest, 100), `interest ${r.totalInterest}`);
  assert.ok(near(r.schedule[0].payment, 10100), `payment ${r.schedule[0].payment}`);
});

test('the solved schedule still repays exactly the principal', () => {
  const r = extraForTargetPayoff({ principal: 20000, rate: 9, months: 24, targetMonths: 18 });
  const principalSum = r.schedule.reduce((s, row) => s + row.principal, 0);
  assert.ok(near(principalSum, 20000, 0.001), `principal sum ${principalSum}`);
  assert.equal(r.schedule.length, r.payoffMonths);
  assert.ok(r.payoffMonths <= 18);
});

test('invalid targets and invalid loans are rejected', () => {
  assert.throws(() => extraForTargetPayoff({ ...LOAN, targetMonths: 0 }), /target payoff/);
  assert.throws(() => extraForTargetPayoff({ ...LOAN, targetMonths: 13 }), /target payoff/);
  assert.throws(() => extraForTargetPayoff({ ...LOAN, targetMonths: 6.5 }), /target payoff/);
  assert.throws(() => extraForTargetPayoff({ ...LOAN, targetMonths: NaN }), /target payoff/);
  assert.throws(() => extraForTargetPayoff({ principal: -5, rate: 8, months: 12, targetMonths: 6 }), /principal/);
  assert.throws(() => extraForTargetPayoff({ principal: 50000, rate: 8, months: 12.5, targetMonths: 6 }), /whole number of months/);
});
