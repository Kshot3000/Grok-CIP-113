import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelServiceFee, SERVICE_FEE_BPS_LEVELS } from '../src/domain.js';

const DEFAULT = { amount: '1000', decimals: 6, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 100 };

test('default split: 100 bps of 1,000 units is exactly 10, recipient receives 990', () => {
  const r = modelServiceFee(DEFAULT);
  assert.equal(r.gross, 1000000000n);
  assert.equal(r.bpsFee, 10000000n);
  assert.equal(r.fee, 10000000n);
  assert.equal(r.net, 990000000n);
  assert.equal(r.fee + r.net, r.gross);
  assert.equal(r.effectiveBpsText, '100.00');
  assert.equal(r.capApplied, false);
  assert.equal(r.maxFee, null);
});

test('the fee rounds DOWN to the base unit — a 50% fee on one base unit is zero', () => {
  const r = modelServiceFee({ amount: '0.000001', decimals: 6, feeBps: 5000 });
  assert.equal(r.gross, 1n);
  assert.equal(r.fee, 0n);
  assert.equal(r.net, 1n);
  // The rounding remainder stays with the recipient, never with the fee.
  assert.equal(r.effectiveBpsText, '0.00');
});

test('exactness beyond float range: a 9,007,199,254,740,993-unit transfer at 100 bps', () => {
  const r = modelServiceFee({ amount: '9007199254740993', decimals: 0, feeBps: 100 });
  assert.equal(r.gross, 9007199254740993n);
  assert.equal(r.fee, 90071992547409n);
  assert.equal(r.net, 8917127262193584n);
  assert.equal(r.fee + r.net, r.gross);
});

test('a fixed fee is added after the percentage part', () => {
  const r = modelServiceFee({ ...DEFAULT, fixedFee: '2.5' });
  assert.equal(r.fixedFee, 2500000n);
  assert.equal(r.fee, 12500000n);
  assert.equal(r.net, 987500000n);
  assert.equal(r.effectiveBpsText, '125.00');
});

test('a cap bounds the total and its binding is reported, never hidden', () => {
  const r = modelServiceFee({ ...DEFAULT, maxFee: '5' });
  assert.equal(r.uncappedFee, 10000000n);
  assert.equal(r.fee, 5000000n);
  assert.equal(r.capApplied, true);
  assert.equal(r.maxFee, 5000000n);
  // A cap above the uncapped fee does not bind.
  const loose = modelServiceFee({ ...DEFAULT, maxFee: '50' });
  assert.equal(loose.fee, 10000000n);
  assert.equal(loose.capApplied, false);
});

test('a cap of zero is legal and means the design charges nothing yet', () => {
  const r = modelServiceFee({ ...DEFAULT, maxFee: '0' });
  assert.equal(r.fee, 0n);
  assert.equal(r.net, r.gross);
  assert.equal(r.capApplied, true);
});

test('zero fee: a 0 bps rate with no fixed fee splits nothing', () => {
  const r = modelServiceFee({ ...DEFAULT, feeBps: 0 });
  assert.equal(r.fee, 0n);
  assert.equal(r.net, r.gross);
  assert.equal(r.effectiveBpsText, '0.00');
});

test('a fee that would take the whole transfer is refused, never modeled in part', () => {
  assert.throws(() => modelServiceFee({ ...DEFAULT, feeBps: 10000 }), /whole transfer/);
  assert.throws(() => modelServiceFee({ amount: '10', decimals: 6, feeBps: 0, fixedFee: '10' }), /whole transfer/);
  assert.throws(() => modelServiceFee({ amount: '10', decimals: 6, feeBps: 0, fixedFee: '11' }), /whole transfer/);
});

test('the monthly projection is the single-transfer split at the entered volume', () => {
  const r = modelServiceFee(DEFAULT);
  assert.equal(r.monthly.gross, 100000000000n);
  assert.equal(r.monthly.fee, 1000000000n);
  assert.equal(r.monthly.net, 99000000000n);
  const one = modelServiceFee({ ...DEFAULT, transfersPerMonth: 1 });
  assert.equal(one.monthly.fee, one.fee);
});

test('the rate table re-splits at the standard levels with the same fixed fee and cap', () => {
  const r = modelServiceFee({ ...DEFAULT, fixedFee: '1', maxFee: '30' });
  assert.deepEqual(r.rows.map(x => x.feeBps), [...SERVICE_FEE_BPS_LEVELS]);
  assert.equal(r.rows[0].fee, 1000000n); // 0 bps: the fixed fee alone.
  assert.equal(r.rows[3].fee, 11000000n); // 100 bps + fixed 1.
  assert.equal(r.rows[5].fee, 30000000n); // 500 bps would be 51 — the cap binds.
  assert.equal(r.rows[5].capApplied, true);
  for (const row of r.rows) assert.equal(row.takesAll, false);
});

test('a row whose fee would take the whole transfer is flagged, not hidden', () => {
  const r = modelServiceFee({ amount: '4', decimals: 6, feeBps: 0, fixedFee: '3.9' });
  assert.equal(r.fee, 3900000n); // The main split itself is fine.
  const top = r.rows[r.rows.length - 1];
  assert.equal(top.feeBps, 500);
  assert.equal(top.takesAll, true); // 5% of 4 plus the 3.9 fixed fee passes the whole transfer.
});

test('validation: bad rates, amounts, decimals, and volumes are refused', () => {
  assert.throws(() => modelServiceFee({ ...DEFAULT, feeBps: 10001 }), /basis points/);
  assert.throws(() => modelServiceFee({ ...DEFAULT, feeBps: 1.5 }), /basis points/);
  assert.throws(() => modelServiceFee({ ...DEFAULT, feeBps: -1 }), /basis points/);
  assert.throws(() => modelServiceFee({ ...DEFAULT, amount: '0' }), /greater than zero/);
  assert.throws(() => modelServiceFee({ ...DEFAULT, amount: '-5' }), /positive decimal/);
  assert.throws(() => modelServiceFee({ ...DEFAULT, decimals: 7 }), /Decimals/);
  assert.throws(() => modelServiceFee({ ...DEFAULT, fixedFee: '-1' }), /positive decimal/);
  assert.throws(() => modelServiceFee({ ...DEFAULT, maxFee: 'abc' }), /positive decimal/);
  assert.throws(() => modelServiceFee({ ...DEFAULT, transfersPerMonth: 0 }), /Monthly transfers/);
  assert.throws(() => modelServiceFee({ ...DEFAULT, transfersPerMonth: 2.5 }), /Monthly transfers/);
});

test('defaults: fixed fee and volume default, cap defaults to none', () => {
  const r = modelServiceFee({ amount: '100', decimals: 6, feeBps: 50 });
  assert.equal(r.fixedFee, 0n);
  assert.equal(r.transfersPerMonth, 100);
  assert.equal(r.maxFee, null);
  assert.equal(r.fee, 500000n);
});

test('app wires the service-fee model: panel, outputs, honest boundary, v1.214', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /modelServiceFee/);
  assert.match(app, /Service-fee model — a disclosed cut, priced exactly/);
  assert.match(app, /data-fee="amount"/);
  assert.match(app, /data-fee="feeBps"/);
  assert.match(app, /id="fee-output"/);
  assert.match(app, /PRISM collects nothing, charges nothing, and executes no transfer/);
  assert.match(app, /v1\.214/);
});
