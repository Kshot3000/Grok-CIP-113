import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { serviceFeeBreakEven } from '../src/domain.js';

const DEFAULT = { amount: '1000', decimals: 6, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 100, monthlyCost: '750' };

test('default: a fee of 10 per transfer covers a 750 cost at exactly 75 transfers', () => {
  const r = serviceFeeBreakEven(DEFAULT);
  assert.equal(r.feePerTransfer, 10000000n);
  assert.equal(r.monthlyCost, 750000000n);
  assert.equal(r.breakEvenTransfers, 75n);
  assert.equal(r.breakEvenGross, 75000000000n);
  assert.equal(r.neverCovers, false);
  assert.equal(r.monthlyFeeIncome, 1000000000n);
  assert.equal(r.monthlyNet, 250000000n);
  assert.equal(r.coversAtEnteredVolume, true);
});

test('the break-even count rounds UP — the one rounding that favours coverage', () => {
  // Fee 10 per transfer, cost 755: 75 transfers collect 750, still short.
  const r = serviceFeeBreakEven({ ...DEFAULT, monthlyCost: '755' });
  assert.equal(r.breakEvenTransfers, 76n);
  // At 76 the fees reach the cost; at 75 they do not.
  assert.ok(75n * r.feePerTransfer < r.monthlyCost);
  assert.ok(76n * r.feePerTransfer >= r.monthlyCost);
});

test('a cost the fee divides exactly needs no rounding', () => {
  const r = serviceFeeBreakEven({ ...DEFAULT, monthlyCost: '1000' });
  assert.equal(r.breakEvenTransfers, 100n);
  assert.equal(r.coversAtEnteredVolume, true);
  assert.equal(r.monthlyNet, 0n);
});

test('below break-even volume the net is a signed shortfall', () => {
  const r = serviceFeeBreakEven({ ...DEFAULT, transfersPerMonth: 50 });
  assert.equal(r.monthlyFeeIncome, 500000000n);
  assert.equal(r.monthlyNet, -250000000n);
  assert.equal(r.coversAtEnteredVolume, false);
});

test('a zero fee never covers a positive cost — stated, never a division by zero', () => {
  const r = serviceFeeBreakEven({ ...DEFAULT, feeBps: 0 });
  assert.equal(r.feePerTransfer, 0n);
  assert.equal(r.neverCovers, true);
  assert.equal(r.breakEvenTransfers, null);
  assert.equal(r.breakEvenGross, null);
  assert.equal(r.coversAtEnteredVolume, false);
});

test('a cap of zero also never covers — it charges nothing', () => {
  const r = serviceFeeBreakEven({ ...DEFAULT, maxFee: '0' });
  assert.equal(r.feePerTransfer, 0n);
  assert.equal(r.capApplied, true);
  assert.equal(r.neverCovers, true);
});

test('a zero cost is covered before the first transfer, even at a zero fee', () => {
  const r = serviceFeeBreakEven({ ...DEFAULT, feeBps: 0, monthlyCost: '0' });
  assert.equal(r.breakEvenTransfers, 0n);
  assert.equal(r.breakEvenGross, 0n);
  assert.equal(r.neverCovers, false);
  assert.equal(r.coversAtEnteredVolume, true);
});

test('an empty cost field is a zero cost', () => {
  const r = serviceFeeBreakEven({ ...DEFAULT, monthlyCost: '' });
  assert.equal(r.monthlyCost, 0n);
  assert.equal(r.breakEvenTransfers, 0n);
});

test('a binding cap lowers the fee the break-even divides by', () => {
  const r = serviceFeeBreakEven({ ...DEFAULT, maxFee: '5' });
  assert.equal(r.feePerTransfer, 5000000n);
  assert.equal(r.capApplied, true);
  assert.equal(r.breakEvenTransfers, 150n);
});

test('a fixed fee counts toward coverage', () => {
  const r = serviceFeeBreakEven({ amount: '100', decimals: 6, feeBps: 0, fixedFee: '2', transfersPerMonth: 10, monthlyCost: '100' });
  assert.equal(r.feePerTransfer, 2000000n);
  assert.equal(r.breakEvenTransfers, 50n);
  assert.equal(r.monthlyFeeIncome, 20000000n);
  assert.equal(r.monthlyNet, -80000000n);
});

test('exactness beyond float range: a huge cost divided by a base-unit fee', () => {
  const r = serviceFeeBreakEven({ amount: '9007199254740993', decimals: 0, feeBps: 100, transfersPerMonth: 1, monthlyCost: '9007199254740993' });
  assert.equal(r.feePerTransfer, 90071992547409n);
  // ceil(9007199254740993 / 90071992547409) = 101 (100 fees collect 9007199254740900, short by 93).
  assert.equal(r.breakEvenTransfers, 101n);
  assert.ok(100n * r.feePerTransfer < r.monthlyCost);
  assert.ok(101n * r.feePerTransfer >= r.monthlyCost);
});

test('the takes-all refusal of the split propagates — never modeled in part', () => {
  assert.throws(() => serviceFeeBreakEven({ ...DEFAULT, feeBps: 10000 }), /whole transfer/);
});

test('an unreadable cost is refused', () => {
  assert.throws(() => serviceFeeBreakEven({ ...DEFAULT, monthlyCost: 'abc' }));
  assert.throws(() => serviceFeeBreakEven({ ...DEFAULT, monthlyCost: '-5' }));
});

test('panel wiring: the cost field and break-even render are in app.js', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-fee="monthlyCost"/);
  assert.match(app, /serviceFeeBreakEven\(/);
  assert.match(app, /v1\.198/);
});
