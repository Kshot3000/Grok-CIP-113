import test from 'node:test';
import assert from 'node:assert/strict';
import { amortizationSchedule } from '../src/domain.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

test('textbook case: $10,000 at 12% APR for 12 months', () => {
  const r = amortizationSchedule({ principal: 10000, rate: 12, months: 12 });
  assert.ok(near(r.monthlyPayment, 888.49), `payment ${r.monthlyPayment}`);
  assert.ok(near(r.totalInterest, 661.85, 0.5), `interest ${r.totalInterest}`);
  assert.ok(near(r.total, 10661.85, 0.5), `total ${r.total}`);
  assert.equal(r.schedule.length, 12);
});

test('schedule repays exactly: principal parts sum to the principal and the final balance is zero', () => {
  const r = amortizationSchedule({ principal: 50000, rate: 8, months: 12 });
  const principalSum = r.schedule.reduce((s, row) => s + row.principal, 0);
  assert.ok(near(principalSum, 50000, 0.001), `principal sum ${principalSum}`);
  assert.equal(r.schedule.at(-1).balance, 0);
  const paymentSum = r.schedule.reduce((s, row) => s + row.payment, 0);
  assert.ok(near(paymentSum, r.total, 0.001));
  assert.ok(near(r.total - 50000, r.totalInterest, 0.001));
});

test('zero rate splits the principal evenly with no interest', () => {
  const r = amortizationSchedule({ principal: 1200, rate: 0, months: 12 });
  assert.equal(r.monthlyPayment, 100);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.total, 1200);
  assert.ok(r.schedule.every(row => row.interest === 0 && row.payment === 100));
  assert.equal(r.schedule[5].balance, 600);
  assert.equal(r.schedule.at(-1).balance, 0);
});

test('a single month repays principal plus one month of interest', () => {
  const r = amortizationSchedule({ principal: 5000, rate: 10, months: 1 });
  assert.equal(r.schedule.length, 1);
  assert.ok(near(r.schedule[0].interest, 5000 * 0.10 / 12));
  assert.ok(near(r.total, 5000 + 5000 * 0.10 / 12));
  assert.equal(r.schedule[0].balance, 0);
});

test('balance and interest portion decline monotonically at a positive rate', () => {
  const r = amortizationSchedule({ principal: 20000, rate: 9, months: 24 });
  for (let i = 1; i < r.schedule.length; i++) {
    assert.ok(r.schedule[i].balance < r.schedule[i - 1].balance, `balance month ${i + 1}`);
    assert.ok(r.schedule[i].interest < r.schedule[i - 1].interest, `interest month ${i + 1}`);
    assert.ok(r.schedule[i].principal > r.schedule[i - 1].principal, `principal month ${i + 1}`);
  }
});

test('long terms amortize fully: 30 years on $100,000 at 6%', () => {
  const r = amortizationSchedule({ principal: 100000, rate: 6, months: 360 });
  assert.equal(r.schedule.length, 360);
  assert.ok(near(r.monthlyPayment, 599.55), `payment ${r.monthlyPayment}`);
  assert.ok(near(r.totalInterest, 115838.19, 1), `interest ${r.totalInterest}`);
  assert.equal(r.schedule.at(-1).balance, 0);
});

test('amortizing interest is below simple interest on the full principal for the same terms', () => {
  // Simple interest (the lab's other model) charges on the whole principal
  // for the whole term; amortization charges on a declining balance.
  const { principal, rate, months } = { principal: 50000, rate: 8, months: 12 };
  const simple = principal * (rate / 100) * (months / 12);
  const r = amortizationSchedule({ principal, rate, months });
  assert.ok(r.totalInterest < simple, `${r.totalInterest} < ${simple}`);
});

test('invalid inputs are rejected instead of producing a schedule', () => {
  const ok = { principal: 10000, rate: 5, months: 12 };
  assert.throws(() => amortizationSchedule({ ...ok, principal: 0 }));
  assert.throws(() => amortizationSchedule({ ...ok, principal: -5 }));
  assert.throws(() => amortizationSchedule({ ...ok, principal: 1e12 + 1 }));
  assert.throws(() => amortizationSchedule({ ...ok, principal: NaN }));
  assert.throws(() => amortizationSchedule({ ...ok, rate: -0.1 }));
  assert.throws(() => amortizationSchedule({ ...ok, rate: 100.1 }));
  assert.throws(() => amortizationSchedule({ ...ok, months: 0 }));
  assert.throws(() => amortizationSchedule({ ...ok, months: 361 }));
  assert.throws(() => amortizationSchedule({ ...ok, months: 12.5 }), /whole number of months/);
  assert.throws(() => amortizationSchedule({}));
  assert.throws(() => amortizationSchedule());
});
