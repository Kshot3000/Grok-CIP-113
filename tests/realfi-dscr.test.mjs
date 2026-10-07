import test from 'node:test';
import assert from 'node:assert/strict';
import { amortizationSchedule, debtServiceCoverage, DSCR_REQUIREMENTS } from '../src/domain.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const LOAN = { principal: 50000, rate: 8, months: 12 };

test('coverage divides the income by the displayed schedule payment itself', () => {
  const base = amortizationSchedule(LOAN);
  const r = debtServiceCoverage(LOAN);
  assert.equal(r.monthlyPayment, base.monthlyPayment);
  assert.ok(near(r.monthlyPayment, 4349.42), `payment ${r.monthlyPayment}`);
  assert.ok(near(r.dscr, r.monthlyIncome / base.monthlyPayment, 1e-9));
  assert.equal(r.monthlyIncome, 6000);
  assert.equal(r.requiredDscr, 1.25);
});

test('the default scenario: 1.38x coverage, $5,436.78 needed at 1.25x, $563.22 cushion', () => {
  const r = debtServiceCoverage(LOAN);
  assert.ok(near(r.dscr, 1.38, 0.005), `dscr ${r.dscr}`);
  assert.ok(near(r.incomeNeeded, 5436.78), `needed ${r.incomeNeeded}`);
  assert.ok(near(r.incomeCushion, 563.22), `cushion ${r.incomeCushion}`);
  assert.equal(r.incomeShortfall, 0);
  assert.equal(r.meetsRequirement, true);
});

test('the income could fall exactly 9.39% before coverage reaches the requirement', () => {
  const r = debtServiceCoverage(LOAN);
  assert.ok(near(r.incomeDropTolerancePercent, 9.39, 0.005), `tolerance ${r.incomeDropTolerancePercent}`);
  const dropped = debtServiceCoverage({ ...LOAN, monthlyIncome: r.monthlyIncome * (1 - r.incomeDropTolerancePercent / 100) });
  assert.ok(near(dropped.dscr, 1.25, 0.001), `dropped dscr ${dropped.dscr}`);
  assert.ok(near(dropped.incomeCushion, 0, 0.5), `dropped cushion ${dropped.incomeCushion}`);
});

test('the max-principal solver result fits, and one cent more of principal does not', () => {
  const r = debtServiceCoverage(LOAN);
  assert.equal(r.maxPaymentForRequirement, 4800);
  assert.equal(r.maxPrincipalForRequirement, 55179.75);
  assert.ok(near(r.principalHeadroom, 5179.75), `headroom ${r.principalHeadroom}`);
  assert.equal(r.cappedAtMax, false);
  const fits = amortizationSchedule({ principal: r.maxPrincipalForRequirement, rate: 8, months: 12 });
  assert.ok(fits.monthlyPayment <= 4800, `at max ${fits.monthlyPayment}`);
  const over = amortizationSchedule({ principal: r.maxPrincipalForRequirement + 0.01, rate: 8, months: 12 });
  assert.ok(over.monthlyPayment > 4800, `above max ${over.monthlyPayment}`);
});

test('income exactly at the requirement meets it, with zero tolerance and the same principal back', () => {
  const needed = debtServiceCoverage(LOAN).incomeNeeded;
  const r = debtServiceCoverage({ ...LOAN, monthlyIncome: needed });
  assert.equal(r.meetsRequirement, true);
  assert.equal(r.incomeCushion, 0);
  assert.equal(r.incomeDropTolerancePercent, 0);
  assert.ok(near(r.dscr, 1.25, 1e-9), `dscr ${r.dscr}`);
  // At exactly the required income the solver returns the scenario's own
  // principal — distinct from starting below the requirement (next test).
  assert.equal(r.maxPrincipalForRequirement, 50000);
  assert.equal(r.principalHeadroom, 0);
});

test('income below the requirement reports a shortfall, zero tolerance, and a smaller carryable principal', () => {
  const r = debtServiceCoverage({ ...LOAN, monthlyIncome: 5000 });
  assert.equal(r.meetsRequirement, false);
  assert.ok(near(r.dscr, 1.15, 0.005), `dscr ${r.dscr}`);
  assert.ok(near(r.incomeShortfall, 436.78), `shortfall ${r.incomeShortfall}`);
  assert.ok(near(r.incomeCushion, -436.78), `cushion ${r.incomeCushion}`);
  assert.equal(r.incomeDropTolerancePercent, 0);
  assert.equal(r.maxPrincipalForRequirement, 45983.12);
  assert.ok(r.principalHeadroom < 0);
});

test('a required ratio of 1 needs exactly the payment itself as income', () => {
  const r = debtServiceCoverage({ ...LOAN, requiredDscr: 1 });
  assert.equal(r.incomeNeeded, r.monthlyPayment);
  assert.equal(r.maxPaymentForRequirement, r.monthlyIncome);
  assert.ok(r.meetsRequirement);
});

test('the standard-requirement table is monotone and flips where the income sits', () => {
  const r = debtServiceCoverage(LOAN);
  assert.deepEqual(r.rows.map(row => row.requiredDscr), [...DSCR_REQUIREMENTS]);
  for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i].incomeNeeded > r.rows[i - 1].incomeNeeded);
  for (const row of r.rows) assert.equal(row.incomeNeeded, row.requiredDscr * r.monthlyPayment);
  // $6,000 covers the 1.25x row but not the 1.5x row.
  assert.deepEqual(r.rows.map(row => row.meetsRequirement), [true, true, true, false, false]);
  assert.ok(near(r.rows[2].cushion, 563.22), `1.25 row cushion ${r.rows[2].cushion}`);
  assert.ok(near(r.rows[3].cushion, -524.13), `1.5 row cushion ${r.rows[3].cushion}`);
});

test('a 0% loan solves by exact division', () => {
  const r = debtServiceCoverage({ principal: 12000, rate: 0, months: 12, monthlyIncome: 1250, requiredDscr: 1.25 });
  assert.equal(r.monthlyPayment, 1000);
  assert.equal(r.dscr, 1.25);
  assert.equal(r.incomeNeeded, 1250);
  assert.equal(r.maxPaymentForRequirement, 1000);
  assert.equal(r.maxPrincipalForRequirement, 12000);
  assert.equal(r.meetsRequirement, true);
});

test('raising the required ratio shrinks the carryable principal and raising income grows it', () => {
  const base = debtServiceCoverage(LOAN);
  const stricter = debtServiceCoverage({ ...LOAN, requiredDscr: 2 });
  assert.ok(stricter.maxPrincipalForRequirement < base.maxPrincipalForRequirement);
  assert.ok(near(stricter.maxPaymentForRequirement, 3000));
  const richer = debtServiceCoverage({ ...LOAN, monthlyIncome: 12000 });
  assert.ok(richer.maxPrincipalForRequirement > base.maxPrincipalForRequirement);
  assert.ok(near(richer.dscr, base.dscr * 2, 0.001));
});

test('an income that fits even the modeled principal limit is reported as capped', () => {
  const r = debtServiceCoverage({ ...LOAN, monthlyIncome: 1e12, requiredDscr: 0.01 });
  assert.equal(r.cappedAtMax, true);
  assert.equal(r.maxPrincipalForRequirement, 1e12);
});

test('invalid coverage inputs are rejected', () => {
  assert.throws(() => debtServiceCoverage({ ...LOAN, monthlyIncome: 0 }), /monthly income/);
  assert.throws(() => debtServiceCoverage({ ...LOAN, monthlyIncome: -100 }), /monthly income/);
  assert.throws(() => debtServiceCoverage({ ...LOAN, monthlyIncome: NaN }), /monthly income/);
  assert.throws(() => debtServiceCoverage({ ...LOAN, requiredDscr: 0 }), /coverage ratio/);
  assert.throws(() => debtServiceCoverage({ ...LOAN, requiredDscr: 0.001 }), /coverage ratio/);
  assert.throws(() => debtServiceCoverage({ ...LOAN, requiredDscr: 11 }), /coverage ratio/);
  assert.throws(() => debtServiceCoverage({ ...LOAN, requiredDscr: NaN }), /coverage ratio/);
  assert.throws(() => debtServiceCoverage({ ...LOAN, principal: -5 }), /principal/);
  assert.throws(() => debtServiceCoverage({ ...LOAN, months: 12.5 }), /whole number of months/);
});
