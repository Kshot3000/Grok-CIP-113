import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { serviceFeeRevenueSplit } from '../src/domain.js';

const BASE = { amount: '1000', decimals: 6, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 100 };
const DEFAULT_SHARES = [
  { label: 'Operator', shareBps: 7000 },
  { label: 'Treasury', shareBps: 2000 },
  { label: 'Community fund', shareBps: 1000 },
];

test('defaults: the fee of 10 splits 7 / 2 / 1 with nothing left over', () => {
  const r = serviceFeeRevenueSplit({ ...BASE, shares: DEFAULT_SHARES });
  assert.equal(r.fee, 10000000n);
  assert.equal(r.monthlyFee, 1000000000n);
  assert.deepEqual(r.recipients.map(x => x.label), ['Operator', 'Treasury', 'Community fund']);
  assert.deepEqual(r.recipients.map(x => x.amount), [7000000n, 2000000n, 1000000n]);
  assert.deepEqual(r.recipients.map(x => x.monthlyAmount), [700000000n, 200000000n, 100000000n]);
  assert.equal(r.allocated, 10000000n);
  assert.equal(r.remainder, 0n);
  assert.equal(r.unallocatedAmount, 0n);
  assert.equal(r.roundingRemainder, 0n);
  assert.equal(r.totalShareBps, 10000);
  assert.equal(r.unallocatedBps, 0);
  assert.equal(r.fullyShared, true);
});

test('thirds on a fee of 10: each share floors to 3 and the dust is named as rounding remainder', () => {
  const r = serviceFeeRevenueSplit({ amount: '1000', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 100, shares: [
    { label: 'A', shareBps: 3333 }, { label: 'B', shareBps: 3333 }, { label: 'C', shareBps: 3334 },
  ] });
  assert.equal(r.fee, 10n);
  assert.deepEqual(r.recipients.map(x => x.amount), [3n, 3n, 3n]);
  assert.equal(r.allocated, 9n);
  assert.equal(r.remainder, 1n);
  assert.equal(r.unallocatedAmount, 0n);
  assert.equal(r.roundingRemainder, 1n);
  assert.equal(r.fullyShared, true);
});

test('shares below the whole fee: the unallocated part is named separately from the dust', () => {
  const r = serviceFeeRevenueSplit({ amount: '1000', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 100, shares: [
    { label: 'A', shareBps: 5000 }, { label: 'B', shareBps: 2500 },
  ] });
  assert.deepEqual(r.recipients.map(x => x.amount), [5n, 2n]);
  assert.equal(r.allocated, 7n);
  assert.equal(r.totalShareBps, 7500);
  assert.equal(r.unallocatedBps, 2500);
  assert.equal(r.unallocatedAmount, 2n); // floor(10 × 2500 / 10,000)
  assert.equal(r.roundingRemainder, 1n); // the floor of B's 2.5
  assert.equal(r.remainder, 3n);
  assert.equal(r.remainder, r.unallocatedAmount + r.roundingRemainder);
  assert.equal(r.fullyShared, false);
});

test('the monthly split is computed from the monthly total, not multiplied from the per-transfer split', () => {
  const r = serviceFeeRevenueSplit({ amount: '1000', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 3, shares: [
    { label: 'A', shareBps: 3333 }, { label: 'B', shareBps: 3333 }, { label: 'C', shareBps: 3334 },
  ] });
  assert.equal(r.fee, 10n);
  assert.equal(r.monthlyFee, 30n);
  // Per transfer 3 / 3 / 3 would multiply to 9 / 9 / 9; the monthly total splits 9 / 9 / 10.
  assert.deepEqual(r.recipients.map(x => x.monthlyAmount), [9n, 9n, 10n]);
  assert.equal(r.monthlyAllocated, 28n);
  assert.equal(r.monthlyRemainder, 2n);
  assert.equal(r.monthlyUnallocatedAmount, 0n);
  assert.equal(r.monthlyRoundingRemainder, 2n);
});

test('a zero share is listed and paid nothing; a single recipient can take the whole fee', () => {
  const r = serviceFeeRevenueSplit({ ...BASE, shares: [{ label: 'All', shareBps: 10000 }, { label: 'None', shareBps: 0 }] });
  assert.deepEqual(r.recipients.map(x => x.amount), [10000000n, 0n]);
  assert.equal(r.remainder, 0n);
  assert.equal(r.fullyShared, true);
});

test('a zero fee splits to zero everywhere, with no remainder invented', () => {
  const r = serviceFeeRevenueSplit({ ...BASE, feeBps: 0, shares: DEFAULT_SHARES });
  assert.equal(r.fee, 0n);
  assert.ok(r.recipients.every(x => x.amount === 0n && x.monthlyAmount === 0n));
  assert.equal(r.remainder, 0n);
  assert.equal(r.roundingRemainder, 0n);
  assert.equal(r.monthlyRemainder, 0n);
});

test('labels are trimmed and the entered shares are echoed back', () => {
  const r = serviceFeeRevenueSplit({ ...BASE, shares: [{ label: '  Operator  ', shareBps: 10000 }] });
  assert.equal(r.recipients[0].label, 'Operator');
  assert.equal(r.recipients[0].shareBps, 10000);
  assert.equal(r.decimals, 6);
  assert.equal(r.gross, 1000000000n);
  assert.equal(r.transfersPerMonth, 100);
});

test('an empty or non-array share list is refused', () => {
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, shares: [] }), /At least one fee recipient/);
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE }), /At least one fee recipient/);
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, shares: 'Operator' }), /At least one fee recipient/);
});

test('more than five recipients are refused', () => {
  const six = [1, 2, 3, 4, 5, 6].map(i => ({ label: `R${i}`, shareBps: 1000 }));
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, shares: six }), /at most five recipients/);
});

test('a missing label and a label-less entry are refused, naming the position', () => {
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, shares: [{ label: 'A', shareBps: 5000 }, { shareBps: 5000 }] }), /Recipient 2 needs a label/);
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, shares: [{ label: '  ', shareBps: 5000 }] }), /Recipient 1 needs a label/);
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, shares: [null] }), /Recipient 1 needs its own label and share/);
});

test('duplicate labels are refused case-insensitively', () => {
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, shares: [{ label: 'Treasury', shareBps: 5000 }, { label: ' treasury ', shareBps: 5000 }] }), /Duplicate recipient label/);
});

test('a share above the whole fee or fractional is refused, naming the recipient', () => {
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, shares: [{ label: 'A', shareBps: 10001 }] }), /A: share must be a whole number/);
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, shares: [{ label: 'A', shareBps: 1.5 }] }), /A: share must be a whole number/);
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, shares: [{ label: 'A', shareBps: -1 }] }), /A: share must be a whole number/);
});

test('shares summing past the whole fee are refused, naming the sum', () => {
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, shares: [{ label: 'A', shareBps: 6000 }, { label: 'B', shareBps: 4001 }] }), /shares total 10001 basis points/);
});

test('the fee family validations propagate: a takes-all fee is refused before any split', () => {
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, fixedFee: '1000', shares: DEFAULT_SHARES }), /would take the whole transfer/);
  assert.throws(() => serviceFeeRevenueSplit({ ...BASE, feeBps: 10001, shares: DEFAULT_SHARES }), /Fee must be a whole number of basis points/);
});

test('exactness beyond float range: a fee past 2^53 splits exactly', () => {
  const r = serviceFeeRevenueSplit({ amount: '9007199254740993', decimals: 0, feeBps: 5000, fixedFee: '0', maxFee: '', transfersPerMonth: 1, shares: [{ label: 'A', shareBps: 3333 }, { label: 'B', shareBps: 6667 }] });
  assert.equal(r.fee, 4503599627370496n);
  assert.equal(r.recipients[0].amount, 1501049755802586n); // floor(4503599627370496 × 3333 / 10,000)
  assert.equal(r.allocated + r.remainder, r.fee);
  assert.equal(r.remainder, r.unallocatedAmount + r.roundingRemainder);
  assert.equal(r.unallocatedAmount, 0n);
});

test('panel wiring: the revenue split renders in app.js with its recipient fields', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /serviceFeeRevenueSplit\(/);
  assert.match(app, /data-split-a="label"/);
  assert.match(app, /data-split-b="shareBps"/);
  assert.match(app, /data-split-c="shareBps"/);
  assert.match(app, /v1\.224/);
});
