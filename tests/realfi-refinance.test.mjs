import test from 'node:test';
import assert from 'node:assert/strict';
import { amortizationSchedule, refinanceComparison } from '../src/domain.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const LOAN = { principal: 50000, rate: 8, months: 12 };
const DEFAULT_REFI = { ...LOAN, paymentsMade: 0, newRate: 4, newMonths: 12, closingCosts: 500 };

test('the default comparison: half the rate, $500 costs, break-even month 6', () => {
  const r = refinanceComparison(DEFAULT_REFI);
  assert.equal(r.paymentsMade, 0);
  assert.equal(r.balanceRemaining, 50000);
  assert.equal(r.current.remainingMonths, 12);
  assert.ok(near(r.current.monthlyPayment, 4349.42), `current ${r.current.monthlyPayment}`);
  assert.ok(near(r.current.remainingInterest, 2193.06), `remaining interest ${r.current.remainingInterest}`);
  assert.ok(near(r.refinance.monthlyPayment, 4257.50), `new ${r.refinance.monthlyPayment}`);
  assert.ok(near(r.monthlySavings, 91.93), `monthly savings ${r.monthlySavings}`);
  assert.ok(near(r.interestSaved, 1103.11), `interest saved ${r.interestSaved}`);
  assert.ok(near(r.netBenefit, 603.11), `net ${r.netBenefit}`);
  assert.equal(r.breakEvenMonths, 6);
});

test('net benefit is exactly the total-cost difference, closing costs included', () => {
  const r = refinanceComparison(DEFAULT_REFI);
  const totalCostDiff = r.current.remainingTotal - (r.refinance.total + r.closingCosts);
  assert.ok(near(r.netBenefit, totalCostDiff, 1e-9), `net ${r.netBenefit} vs ${totalCostDiff}`);
  assert.ok(near(r.netBenefit, r.interestSaved - r.closingCosts, 1e-9));
});

test('closing costs are paid up front, never financed into the new loan', () => {
  const r = refinanceComparison(DEFAULT_REFI);
  const principalSum = r.refinance.schedule.reduce((s, row) => s + row.principal, 0);
  assert.ok(near(principalSum, r.balanceRemaining, 0.001), `principal sum ${principalSum}`);
  const noCosts = refinanceComparison({ ...DEFAULT_REFI, closingCosts: 0 });
  assert.deepEqual(noCosts.refinance.schedule, r.refinance.schedule);
  assert.ok(near(noCosts.netBenefit - r.netBenefit, 500, 1e-9));
});

test('the remaining balance and schedule come from the displayed schedule itself', () => {
  const base = amortizationSchedule(LOAN);
  const r = refinanceComparison({ ...LOAN, paymentsMade: 6, newRate: 4, newMonths: 6, closingCosts: 100 });
  assert.ok(near(r.balanceRemaining, 25498.27), `balance ${r.balanceRemaining}`);
  assert.equal(r.balanceRemaining, base.schedule[5].balance);
  assert.equal(r.current.remainingMonths, 6);
  assert.deepEqual(r.current.schedule, base.schedule.slice(6));
  assert.ok(near(r.current.remainingInterest, 598.25), `remaining interest ${r.current.remainingInterest}`);
  assert.ok(near(r.netBenefit, 199.95), `net ${r.netBenefit}`);
  assert.equal(r.breakEvenMonths, 3);
});

test('an evaporating break-even is not a break-even', () => {
  // Six payments in, refinancing the balance over a FRESH 12 months drops
  // the payment by $2,178.25 — the first month's cash difference alone
  // covers the $500 costs. But once the old loan would have ended, the new
  // loan keeps charging, the cumulative saving falls back, and the deal
  // ends $457.58 behind. Reporting month 1 as the break-even would lie.
  const r = refinanceComparison({ ...LOAN, paymentsMade: 6, newRate: 4, newMonths: 12, closingCosts: 500 });
  assert.ok(r.monthlySavings > 2000);
  assert.equal(r.breakEvenMonths, null);
  assert.ok(near(r.netBenefit, -457.58), `net ${r.netBenefit}`);
});

test('a lower payment from stretching the term alone can cost more overall', () => {
  const r = refinanceComparison({ ...LOAN, paymentsMade: 0, newRate: 8, newMonths: 24, closingCosts: 0 });
  assert.ok(r.monthlySavings > 0, 'payment drops when the term stretches');
  assert.ok(r.interestSaved < 0, 'but total interest rises at the same rate');
  assert.ok(r.netBenefit < 0);
  assert.equal(r.breakEvenMonths, 0, 'no costs to recover');
});

test('a higher new rate never breaks even and loses overall', () => {
  const r = refinanceComparison({ ...LOAN, paymentsMade: 0, newRate: 10, newMonths: 12, closingCosts: 500 });
  assert.ok(r.monthlySavings < 0);
  assert.ok(near(r.netBenefit, -1056.47), `net ${r.netBenefit}`);
  assert.equal(r.breakEvenMonths, null);
});

test('identical terms at zero cost are an exact wash', () => {
  const r = refinanceComparison({ principal: 1200, rate: 0, months: 12, paymentsMade: 0, newRate: 0, newMonths: 12, closingCosts: 0 });
  assert.equal(r.monthlySavings, 0);
  assert.equal(r.interestSaved, 0);
  assert.equal(r.netBenefit, 0);
  assert.equal(r.breakEvenMonths, 0);
});

test('the last payment made still leaves exactly one refinanciable payment', () => {
  const base = amortizationSchedule(LOAN);
  const r = refinanceComparison({ ...LOAN, paymentsMade: 11, newRate: 4, newMonths: 12, closingCosts: 0 });
  assert.equal(r.current.remainingMonths, 1);
  assert.equal(r.balanceRemaining, base.schedule[10].balance);
});

test('invalid refinance inputs are rejected', () => {
  assert.throws(() => refinanceComparison({ ...DEFAULT_REFI, paymentsMade: 12 }), /nothing left to refinance/);
  assert.throws(() => refinanceComparison({ ...DEFAULT_REFI, paymentsMade: -1 }), /payments already made/);
  assert.throws(() => refinanceComparison({ ...DEFAULT_REFI, paymentsMade: 2.5 }), /payments already made/);
  assert.throws(() => refinanceComparison({ ...DEFAULT_REFI, paymentsMade: NaN }), /payments already made/);
  assert.throws(() => refinanceComparison({ ...DEFAULT_REFI, closingCosts: -1 }), /closing costs/);
  assert.throws(() => refinanceComparison({ ...DEFAULT_REFI, closingCosts: NaN }), /closing costs/);
  assert.throws(() => refinanceComparison({ ...DEFAULT_REFI, newRate: 101 }), /annual interest rate/);
  assert.throws(() => refinanceComparison({ ...DEFAULT_REFI, newMonths: 0 }), /whole number of months/);
  assert.throws(() => refinanceComparison({ ...DEFAULT_REFI, newMonths: 361 }), /whole number of months/);
  assert.throws(() => refinanceComparison({ ...DEFAULT_REFI, principal: -5 }), /principal/);
});
