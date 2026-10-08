import test from 'node:test';
import assert from 'node:assert/strict';
import { amortizationSchedule, paymentFrequency, PAYMENT_FREQUENCIES } from '../src/domain.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const LOAN = { principal: 50000, rate: 8, months: 12 };

test('the biweekly payment is exactly half the monthly payment, and a year of it is thirteen monthly payments', () => {
  const r = paymentFrequency(LOAN);
  assert.ok(near(r.biweeklyPayment, r.monthlyPayment / 2, 1e-9));
  const bi = r.rows.find(x => x.id === 'biweekly');
  assert.ok(near(bi.annualOutlay, r.monthlyPayment * 13, 1e-9), `annual outlay ${bi.annualOutlay}`);
  // The weekly plan is a quarter of the monthly payment and pays the
  // same thirteen-a-year — the mechanism is the extra payment, and the
  // rows must show it rather than hide it in a lower outlay.
  const wk = r.rows.find(x => x.id === 'weekly');
  assert.ok(near(wk.payment, r.monthlyPayment / 4, 1e-9));
  assert.ok(near(wk.annualOutlay, bi.annualOutlay, 1e-9));
  const mo = r.rows.find(x => x.id === 'monthly');
  assert.ok(near(mo.annualOutlay, r.monthlyPayment * 12, 1e-9));
});

test('the default scenario: 24 biweekly payments, paid off in about 11.1 months, $256.29 saved', () => {
  const r = paymentFrequency(LOAN);
  assert.equal(r.biweeklyPeriods, 24);
  assert.ok(near(r.biweeklyCalendarMonths, 11.08, 0.01), `months ${r.biweeklyCalendarMonths}`);
  assert.ok(near(r.monthsSaved, 0.92, 0.01), `months saved ${r.monthsSaved}`);
  assert.ok(near(r.totalInterest, 1936.77), `interest ${r.totalInterest}`);
  assert.ok(near(r.interestSaved, 256.29), `saved ${r.interestSaved}`);
});

test('the monthly row IS the plain loan: same periods, same interest to the last digit', () => {
  const plain = amortizationSchedule(LOAN);
  const mo = paymentFrequency(LOAN).rows.find(x => x.id === 'monthly');
  assert.equal(mo.periods, plain.payoffMonths);
  assert.equal(mo.totalInterest, plain.totalInterest);
  assert.equal(mo.interestSaved, 0);
  assert.equal(mo.monthsSaved, 0);
});

test('total paid always equals principal plus the interest actually charged, and the schedule ends at exactly zero', () => {
  const r = paymentFrequency(LOAN);
  assert.ok(near(r.totalPaid, r.principal + r.totalInterest, 1e-9));
  assert.equal(r.schedule.at(-1).balance, 0);
  assert.ok(near(r.schedule.reduce((a, s) => a + s.principal, 0), r.principal, 1e-6));
  assert.equal(r.schedule.length, r.biweeklyPeriods);
});

test('weekly pays off no later than biweekly, and both finish before the monthly term at a positive rate', () => {
  const r = paymentFrequency(LOAN);
  const wk = r.rows.find(x => x.id === 'weekly');
  assert.ok(wk.calendarMonths <= r.biweeklyCalendarMonths + 1e-9);
  assert.ok(r.biweeklyCalendarMonths < LOAN.months);
  assert.ok(wk.interestSaved >= r.interestSaved);
});

test('a 0% loan saves no interest at any frequency — it only finishes sooner', () => {
  const r = paymentFrequency({ principal: 1200, rate: 0, months: 12 });
  assert.equal(r.totalInterest, 0);
  assert.equal(r.interestSaved, 0);
  assert.equal(r.biweeklyPeriods, 24);
  assert.ok(r.monthsSaved > 0.9 && r.monthsSaved < 0.95, `months saved ${r.monthsSaved}`);
  for (const row of r.rows) assert.equal(row.totalInterest, 0);
});

test('over a long term the extra payment a year compounds: a 30-year loan finishes about 65 months early', () => {
  const r = paymentFrequency({ principal: 200000, rate: 6, months: 360 });
  assert.equal(r.biweeklyPeriods, 638);
  assert.ok(near(r.monthsSaved, 65.54, 0.01), `months saved ${r.monthsSaved}`);
  assert.ok(near(r.interestSaved, 49624.01, 0.5), `saved ${r.interestSaved}`);
});

test('interest saved rises with the rate: the same plan on a dearer loan saves more', () => {
  const cheap = paymentFrequency({ principal: 50000, rate: 2, months: 12 });
  const dear = paymentFrequency(LOAN);
  assert.ok(dear.interestSaved > cheap.interestSaved);
  assert.ok(cheap.interestSaved > 0);
});

test('the frequency table is complete and ordered monthly, biweekly, weekly', () => {
  assert.deepEqual(PAYMENT_FREQUENCIES.map(f => f.id), ['monthly', 'biweekly', 'weekly']);
  const r = paymentFrequency(LOAN);
  assert.deepEqual(r.rows.map(x => x.id), ['monthly', 'biweekly', 'weekly']);
  assert.deepEqual(r.rows.map(x => x.periodsPerYear), [12, 26, 52]);
});

test('the final biweekly payment is smaller than the regular one — it is only what remains plus interest', () => {
  const r = paymentFrequency(LOAN);
  const last = r.schedule.at(-1);
  assert.ok(last.payment < r.biweeklyPayment, `final ${last.payment}`);
  assert.ok(near(last.payment, last.principal + last.interest, 1e-9));
  for (const row of r.schedule.slice(0, -1)) assert.ok(near(row.payment, r.biweeklyPayment, 1e-9));
});

test('invalid scenario inputs are rejected by the shared schedule validation', () => {
  assert.throws(() => paymentFrequency({ principal: 0, rate: 8, months: 12 }), /positive principal/);
  assert.throws(() => paymentFrequency({ principal: 50000, rate: 101, months: 12 }), /between 0 and 100/);
  assert.throws(() => paymentFrequency({ principal: 50000, rate: 8, months: 361 }), /1 and 360/);
});
