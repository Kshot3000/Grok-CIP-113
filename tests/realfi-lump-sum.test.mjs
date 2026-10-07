import test from 'node:test';
import assert from 'node:assert/strict';
import { amortizationSchedule, lumpSumPayoff } from '../src/domain.js';

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const LOAN = { principal: 50000, rate: 8, months: 12 };

test('the months before the lump are the displayed schedule’s own rows, and the lump lands on its balance', () => {
  const plain = amortizationSchedule(LOAN);
  const r = lumpSumPayoff({ ...LOAN, lumpMonth: 6, lumpAmount: 10000 });
  assert.deepEqual(r.schedule.slice(0, 5), plain.schedule.slice(0, 5));
  assert.equal(r.schedule[5].payment, plain.schedule[5].payment);
  assert.equal(r.schedule[5].interest, plain.schedule[5].interest);
  assert.equal(r.schedule[5].lump, 10000);
  assert.ok(near(r.schedule[5].balance, plain.schedule[5].balance - 10000, 1e-9));
  assert.ok(near(r.balanceAfterLump, 15498.27), `balance after lump ${r.balanceAfterLump}`);
});

test('the default scenario: a $10,000 lump in month 6 pays off in month 10 and saves $355.57', () => {
  const r = lumpSumPayoff({ ...LOAN, lumpMonth: 6, lumpAmount: 10000 });
  assert.equal(r.lumpApplied, 10000);
  assert.equal(r.payoffMonths, 10);
  assert.equal(r.monthsSaved, 2);
  assert.ok(near(r.totalInterest, 1837.49), `interest ${r.totalInterest}`);
  assert.ok(near(r.interestSaved, 355.57), `saved ${r.interestSaved}`);
  assert.ok(near(r.plainTotalInterest, 2193.06), `plain ${r.plainTotalInterest}`);
  assert.ok(near(r.totalInterest + r.interestSaved, r.plainTotalInterest, 1e-6));
});

test('the scheduled payment never changes — the term shortens instead of the payment being recast', () => {
  const plain = amortizationSchedule(LOAN);
  const r = lumpSumPayoff({ ...LOAN, lumpMonth: 6, lumpAmount: 10000 });
  assert.equal(r.monthlyPayment, plain.monthlyPayment);
  for (const row of r.schedule.slice(0, -1)) assert.equal(row.payment, plain.monthlyPayment);
  const last = r.schedule[r.schedule.length - 1];
  assert.ok(last.payment < plain.monthlyPayment, 'only the final payment is smaller');
  assert.equal(last.balance, 0);
});

test('principal parts plus the lump sum exactly to the principal, and total paid is principal plus interest charged', () => {
  const r = lumpSumPayoff({ ...LOAN, lumpMonth: 6, lumpAmount: 10000 });
  const principalParts = r.schedule.reduce((s, row) => s + row.principal, 0);
  assert.ok(near(principalParts + r.lumpApplied, LOAN.principal, 1e-6));
  assert.ok(near(r.totalPaid, LOAN.principal + r.totalInterest, 1e-6));
  assert.ok(near(r.totalPaid, r.schedule.reduce((s, row) => s + row.payment, 0) + r.lumpApplied, 1e-9));
});

test('a lump of zero is the plain amortizing loan itself', () => {
  const plain = amortizationSchedule(LOAN);
  const r = lumpSumPayoff({ ...LOAN, lumpMonth: 6, lumpAmount: 0 });
  assert.deepEqual(r.schedule, plain.schedule);
  assert.equal(r.lumpApplied, 0);
  assert.equal(r.payoffMonths, LOAN.months);
  assert.equal(r.monthsSaved, 0);
  assert.equal(r.interestSaved, 0);
  assert.ok(near(r.totalInterest, plain.totalInterest, 1e-9));
  assert.ok(near(r.balanceAfterLump, plain.schedule[5].balance, 1e-9));
});

test('a lump at or above the remaining balance applies only what is owed and ends the loan that month', () => {
  const plain = amortizationSchedule(LOAN);
  const r = lumpSumPayoff({ ...LOAN, lumpMonth: 6, lumpAmount: 50000 });
  assert.ok(near(r.lumpApplied, plain.schedule[5].balance, 1e-9), `applied ${r.lumpApplied}`);
  assert.ok(near(r.lumpApplied, 25498.27), `applied ${r.lumpApplied}`);
  assert.equal(r.payoffMonths, 6);
  assert.equal(r.monthsSaved, 6);
  assert.equal(r.schedule[5].balance, 0);
  assert.ok(near(r.totalInterest, 1594.80), `interest ${r.totalInterest}`);
  assert.ok(near(r.totalPaid, LOAN.principal + r.totalInterest, 1e-6));
});

test('a lump chosen for the final month applies nothing — the final scheduled payment already ended the loan', () => {
  const plain = amortizationSchedule(LOAN);
  const r = lumpSumPayoff({ ...LOAN, lumpMonth: 12, lumpAmount: 10000 });
  assert.equal(r.lumpApplied, 0);
  assert.equal(r.payoffMonths, 12);
  assert.equal(r.interestSaved, 0);
  assert.ok(near(r.totalInterest, plain.totalInterest, 1e-9));
});

test('the same lump saves more the earlier it is paid', () => {
  const early = lumpSumPayoff({ ...LOAN, lumpMonth: 1, lumpAmount: 10000 });
  const late = lumpSumPayoff({ ...LOAN, lumpMonth: 6, lumpAmount: 10000 });
  assert.equal(early.payoffMonths, 10);
  assert.ok(near(early.totalInterest, 1490.58), `early interest ${early.totalInterest}`);
  assert.ok(near(early.interestSaved, 702.47), `early saved ${early.interestSaved}`);
  assert.ok(early.interestSaved > late.interestSaved);
});

test('a 0% loan: the lump shortens the term and saves nothing, because there is no interest to save', () => {
  const r = lumpSumPayoff({ principal: 1200, rate: 0, months: 12, lumpMonth: 6, lumpAmount: 600 });
  assert.equal(r.lumpApplied, 600);
  assert.equal(r.balanceAfterLump, 0);
  assert.equal(r.payoffMonths, 6);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.interestSaved, 0);
  assert.ok(near(r.totalPaid, 1200, 1e-9));
});

test('the standard lump table starts at the plain loan and saves monotonically more as the lump grows', () => {
  const r = lumpSumPayoff({ ...LOAN, lumpMonth: 6, lumpAmount: 10000 });
  assert.deepEqual(r.rows.map(row => row.lumpPercent), [0, 10, 25, 50, 100]);
  assert.equal(r.rows[0].lumpApplied, 0);
  assert.equal(r.rows[0].payoffMonths, LOAN.months);
  assert.equal(r.rows[0].interestSaved, 0);
  for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i].interestSaved >= r.rows[i - 1].interestSaved, `row ${i}`);
  assert.ok(near(r.rows[1].interestSaved, 197.71), `10% saved ${r.rows[1].interestSaved}`);
  assert.equal(r.rows[2].payoffMonths, 10);
  assert.equal(r.rows[3].payoffMonths, 7);
  assert.equal(r.rows[4].payoffMonths, 6);
  assert.ok(r.rows[4].lumpApplied < r.rows[4].lumpAmount, 'the 100% row is capped at the balance still owed');
});

test('defaults and validation: month defaults to mid-term, amount to $10,000, malformed inputs throw', () => {
  const r = lumpSumPayoff(LOAN);
  assert.equal(r.lumpMonth, 6);
  assert.equal(r.lumpAmount, 10000);
  assert.equal(lumpSumPayoff({ principal: 1200, rate: 0, months: 1 }).lumpMonth, 1);
  assert.throws(() => lumpSumPayoff({ ...LOAN, lumpMonth: 0 }), /between 1 and the 12-month term/);
  assert.throws(() => lumpSumPayoff({ ...LOAN, lumpMonth: 13 }), /between 1 and the 12-month term/);
  assert.throws(() => lumpSumPayoff({ ...LOAN, lumpMonth: 2.5 }), /between 1 and the 12-month term/);
  assert.throws(() => lumpSumPayoff({ ...LOAN, lumpAmount: -1 }), /lump sum of 0 or more/);
  assert.throws(() => lumpSumPayoff({ ...LOAN, lumpAmount: NaN }), /lump sum of 0 or more/);
});
