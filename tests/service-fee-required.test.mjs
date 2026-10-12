import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requiredServiceFee } from '../src/domain.js';

const DEFAULT = { amount: '1000', decimals: 6, fixedFee: '0', maxFee: '', transfersPerMonth: 100, monthlyCost: '750' };

test('default: covering 750 at 100 transfers requires 7.5 per transfer — 75 bps', () => {
  const r = requiredServiceFee(DEFAULT);
  assert.equal(r.requiredFeePerTransfer, 7500000n);
  assert.equal(r.requiredBps, 75);
  assert.equal(r.feeAtRequiredBps, 7500000n);
  assert.equal(r.monthlyFeeIncomeAtRequired, 750000000n);
  assert.equal(r.surplusAtRequired, 0n);
  assert.equal(r.impossible, false);
});

test('one basis point less provably falls short of the requirement', () => {
  const r = requiredServiceFee(DEFAULT);
  assert.equal(r.feeOneBpsLess, 7400000n);
  assert.ok(r.feeOneBpsLess < r.requiredFeePerTransfer);
  assert.ok(r.feeOneBpsLess * 100n < r.monthlyCost);
});

test('the required per-transfer fee rounds UP to the base unit', () => {
  // Cost 755 over 100 transfers is 7.55 exactly in units, but a cost of
  // 755.000001 would need 7.55000001 per transfer — charged as 7.550001.
  const r = requiredServiceFee({ ...DEFAULT, monthlyCost: '755' });
  assert.equal(r.requiredFeePerTransfer, 7550000n);
  assert.equal(r.requiredBps, 76);
  assert.equal(r.feeAtRequiredBps, 7600000n);
  assert.equal(r.feeOneBpsLess, 7500000n);
  assert.ok(r.feeOneBpsLess < r.requiredFeePerTransfer);
  assert.equal(r.surplusAtRequired, 5000000n);
});

test('a fixed fee counts toward the requirement and lowers the solved rate', () => {
  const r = requiredServiceFee({ ...DEFAULT, fixedFee: '2' });
  assert.equal(r.requiredBps, 55);
  assert.equal(r.feeAtRequiredBps, 7500000n);
});

test('a fixed fee that alone covers the cost solves to zero basis points', () => {
  const r = requiredServiceFee({ ...DEFAULT, fixedFee: '10' });
  assert.equal(r.requiredBps, 0);
  assert.equal(r.feeAtRequiredBps, 10000000n);
  assert.equal(r.feeOneBpsLess, null);
  assert.equal(r.monthlyFeeIncomeAtRequired, 1000000000n);
  assert.equal(r.surplusAtRequired, 250000000n);
});

test('a zero cost requires no fee at all', () => {
  const r = requiredServiceFee({ ...DEFAULT, monthlyCost: '0' });
  assert.equal(r.requiredFeePerTransfer, 0n);
  assert.equal(r.requiredBps, 0);
  assert.equal(r.impossible, false);
});

test('an empty cost field is a zero cost', () => {
  const r = requiredServiceFee({ ...DEFAULT, monthlyCost: '' });
  assert.equal(r.monthlyCost, 0n);
  assert.equal(r.requiredBps, 0);
});

test('a cap below the required fee makes coverage impossible at any rate — stated, not modeled around', () => {
  const r = requiredServiceFee({ ...DEFAULT, maxFee: '5' });
  assert.equal(r.impossible, true);
  assert.equal(r.impossibleReason, 'cap');
  assert.equal(r.requiredBps, null);
  assert.equal(r.maxMonthlyFeeIncome, 500000000n);
  assert.ok(r.maxMonthlyFeeIncome < r.monthlyCost);
});

test('a cap at exactly the required fee still covers', () => {
  const r = requiredServiceFee({ ...DEFAULT, maxFee: '7.5' });
  assert.equal(r.impossible, false);
  assert.equal(r.requiredBps, 75);
  assert.equal(r.feeAtRequiredBps, 7500000n);
});

test('a cap of zero makes a positive cost impossible', () => {
  const r = requiredServiceFee({ ...DEFAULT, maxFee: '0' });
  assert.equal(r.impossible, true);
  assert.equal(r.impossibleReason, 'cap');
  assert.equal(r.maxMonthlyFeeIncome, 0n);
});

test('a required fee at or above the whole transfer is impossible — no honest fee takes its transfer', () => {
  const at = requiredServiceFee({ amount: '10', decimals: 6, fixedFee: '0', maxFee: '', transfersPerMonth: 100, monthlyCost: '1000' });
  assert.equal(at.requiredFeePerTransfer, 10000000n);
  assert.equal(at.impossible, true);
  assert.equal(at.impossibleReason, 'takes-all');
  const above = requiredServiceFee({ amount: '10', decimals: 6, fixedFee: '0', maxFee: '', transfersPerMonth: 100, monthlyCost: '2000' });
  assert.equal(above.impossible, true);
  assert.equal(above.impossibleReason, 'takes-all');
});

test('higher volume lowers the required fee', () => {
  const r = requiredServiceFee({ ...DEFAULT, transfersPerMonth: 1000 });
  assert.equal(r.requiredFeePerTransfer, 750000n);
  assert.equal(r.requiredBps, 8);
  assert.equal(r.feeAtRequiredBps, 800000n);
  assert.ok(r.feeOneBpsLess < r.requiredFeePerTransfer);
});

test('exactness beyond float range: the solved rate is minimal by exactly one base unit', () => {
  const r = requiredServiceFee({ amount: '9007199254740993', decimals: 0, fixedFee: '0', maxFee: '', transfersPerMonth: 100, monthlyCost: '9007199254740993' });
  assert.equal(r.requiredFeePerTransfer, 90071992547410n);
  assert.equal(r.requiredBps, 101);
  assert.equal(r.feeOneBpsLess, 90071992547409n);
  assert.equal(r.requiredFeePerTransfer - r.feeOneBpsLess, 1n);
});

test('unreadable inputs are refused', () => {
  assert.throws(() => requiredServiceFee({ ...DEFAULT, monthlyCost: 'abc' }));
  assert.throws(() => requiredServiceFee({ ...DEFAULT, monthlyCost: '-5' }));
  assert.throws(() => requiredServiceFee({ ...DEFAULT, transfersPerMonth: 0 }), /Monthly transfers/);
  assert.throws(() => requiredServiceFee({ ...DEFAULT, amount: '0' }), /greater than zero/);
});

test('panel wiring: the solver renders in app.js', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /requiredServiceFee\(/);
  assert.match(app, /v1\.135/);
});
