import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { serviceFeeSizeProfile, SERVICE_FEE_SIZE_LADDER } from '../src/domain.js';

const FIXED10 = { feeBps: 100, fixedFee: '10', maxFee: '', decimals: 6 };

test('the ladder is the six standard sizes, frozen, and the inputs are echoed back', () => {
  assert.deepEqual([...SERVICE_FEE_SIZE_LADDER], ['1', '10', '100', '1000', '10000', '100000']);
  assert.equal(Object.isFrozen(SERVICE_FEE_SIZE_LADDER), true);
  const r = serviceFeeSizeProfile({});
  assert.equal(r.feeBps, 100);
  assert.equal(r.fixedFee, 0n);
  assert.equal(r.maxFee, null);
  assert.equal(r.decimals, 6);
  assert.equal(r.maxEffectiveBps, 500);
  assert.equal(r.rows.length, 6);
  assert.deepEqual(r.rows.map(row => row.amount), [...SERVICE_FEE_SIZE_LADDER]);
});

test('defaults: a pure 100 bps schedule charges the same effective rate at every size', () => {
  const r = serviceFeeSizeProfile({});
  assert.deepEqual(r.rows.map(row => row.fee), [10000n, 100000n, 1000000n, 10000000n, 100000000n, 1000000000n]);
  assert.deepEqual(r.rows.map(row => row.effectiveBpsText), ['100.00', '100.00', '100.00', '100.00', '100.00', '100.00']);
  assert.ok(r.rows.every(row => !row.takesAll && !row.capApplied && row.withinBound));
  assert.equal(r.firstSizeWithinBound, '1');
  assert.equal(r.withinBoundFromThatSizeOn, true);
});

test('a fixed fee of 10 makes small sizes pay far more: exact fees and effective rates per rung', () => {
  const r = serviceFeeSizeProfile(FIXED10);
  assert.deepEqual(r.rows.map(row => row.fee), [10010000n, 10100000n, 11000000n, 20000000n, 110000000n, 1010000000n]);
  assert.equal(r.rows[2].effectiveBpsText, '1100.00'); // 11 on a transfer of 100
  assert.equal(r.rows[4].effectiveBpsText, '110.00'); // 110 on a transfer of 10,000
  assert.equal(r.rows[3].fee, 20000000n);
  assert.equal(r.rows[3].net, 980000000n);
});

test('a takes-all rung is flagged, not refused, and its rate is still stated exactly', () => {
  const r = serviceFeeSizeProfile(FIXED10);
  // Fixed 10 at a size of 1: percentage part floors to 0, fee is 10 on a gross of 1.
  assert.equal(r.rows[0].takesAll, true);
  assert.equal(r.rows[0].fee, 10010000n);
  assert.equal(r.rows[0].net, -9010000n);
  assert.equal(r.rows[0].effectiveBpsText, '100100.00');
  assert.equal(r.rows[0].withinBound, false);
  // At a size of 10 the fee is 10.1 — still the whole transfer, still flagged.
  assert.equal(r.rows[1].takesAll, true);
  assert.equal(r.rows[2].takesAll, false);
});

test('a cap binds at the large sizes only, and the binding is reported per rung', () => {
  const r = serviceFeeSizeProfile({ ...FIXED10, maxFee: '50' });
  assert.deepEqual(r.rows.map(row => row.capApplied), [false, false, false, false, true, true]);
  assert.equal(r.rows[4].fee, 50000000n);
  assert.equal(r.rows[4].effectiveBpsText, '50.00');
  assert.equal(r.rows[5].fee, 50000000n);
  assert.equal(r.rows[5].effectiveBpsText, '5.00');
  assert.equal(r.rows[3].fee, 20000000n);
});

test('firstSizeWithinBound is exact and the within flags are per rung', () => {
  const r = serviceFeeSizeProfile(FIXED10); // bound defaults to 500 bps
  assert.deepEqual(r.rows.map(row => row.withinBound), [false, false, false, true, true, true]);
  assert.equal(r.firstSizeWithinBound, '1000'); // effective 200 bps; at 100 it is 1,100 bps
  assert.equal(r.withinBoundFromThatSizeOn, true);
});

test('when no ladder size stays within the bound, the first size is null', () => {
  const r = serviceFeeSizeProfile({ ...FIXED10, maxEffectiveBps: 100 });
  // The gentlest rung (100,000) still pays 101 bps effective.
  assert.equal(r.firstSizeWithinBound, null);
  assert.equal(r.withinBoundFromThatSizeOn, false);
  assert.ok(r.rows.every(row => !row.withinBound));
});

test('withinBoundFromThatSizeOn is computed, not assumed: floor rounding can leave the bound again', () => {
  const r = serviceFeeSizeProfile({ feeBps: 333, fixedFee: '0', maxFee: '', decimals: 0, maxEffectiveBps: 331 });
  assert.equal(r.rows[3].effectiveBpsText, '330.00'); // floor(1000 × 333 / 10,000) = 33 on 1,000
  assert.equal(r.rows[4].effectiveBpsText, '333.00'); // at 10,000 the floor stops biting
  assert.equal(r.firstSizeWithinBound, '1');
  assert.equal(r.withinBoundFromThatSizeOn, false);
  assert.deepEqual(r.rows.map(row => row.withinBound), [true, true, true, true, false, false]);
});

test('fixedDominatesUntil is the last rung where the fixed fee outweighs the percentage part', () => {
  const r = serviceFeeSizeProfile(FIXED10);
  // Fixed 10 vs percentage parts 0.01 / 0.1 / 1 / 10 / 100 / 1000: larger up to size 100, equal at 1,000.
  assert.equal(r.fixedDominatesUntil, '100');
  const noFixed = serviceFeeSizeProfile({ feeBps: 100, fixedFee: '0', maxFee: '', decimals: 6 });
  assert.equal(noFixed.fixedDominatesUntil, null);
});

test('at 0 bps the fee is the fixed fee at every size, and the fixed fee dominates to the last rung', () => {
  const r = serviceFeeSizeProfile({ feeBps: 0, fixedFee: '2', maxFee: '', decimals: 6 });
  assert.ok(r.rows.every(row => row.fee === 2000000n));
  assert.equal(r.rows[0].takesAll, true); // 2 on a transfer of 1
  assert.equal(r.rows[1].takesAll, false);
  assert.equal(r.fixedDominatesUntil, '100000');
  assert.equal(r.firstSizeWithinBound, '100'); // effective 200 bps there; 2,000 bps at a size of 10
});

test('a zero fee has no fixed share: the share text is null, never an invented number', () => {
  const r = serviceFeeSizeProfile({ feeBps: 0, fixedFee: '0', maxFee: '', decimals: 6 });
  assert.ok(r.rows.every(row => row.fee === 0n && row.fixedShareBpsText === null && row.effectiveBpsText === '0.00' && !row.takesAll));
  assert.equal(r.firstSizeWithinBound, '1');
  assert.equal(r.fixedDominatesUntil, null);
});

test('the fixed share of the fee is exact text, in basis points of the fee', () => {
  const r = serviceFeeSizeProfile(FIXED10);
  assert.equal(r.rows[2].fixedShareBpsText, '9090.90'); // 10 of the 11 charged at size 100
  assert.equal(r.rows[3].fixedShareBpsText, '5000.00'); // 10 of 20 at size 1,000 — exactly half
  assert.equal(r.rows[5].fixedShareBpsText, '99.00'); // 10 of 1,010 at size 100,000
  const pureFixed = serviceFeeSizeProfile({ feeBps: 0, fixedFee: '2', maxFee: '', decimals: 6 });
  assert.equal(pureFixed.rows[2].fixedShareBpsText, '10000.00'); // the whole fee is the fixed fee
});

test('the fairness bound is refused at 0, above 10,000, and when fractional', () => {
  assert.throws(() => serviceFeeSizeProfile({ maxEffectiveBps: 0 }), /Fairness bound must be a whole number/);
  assert.throws(() => serviceFeeSizeProfile({ maxEffectiveBps: 10001 }), /Fairness bound must be a whole number/);
  assert.throws(() => serviceFeeSizeProfile({ maxEffectiveBps: 1.5 }), /Fairness bound must be a whole number/);
});

test('the fee family validations propagate exactly as modelServiceFee states them', () => {
  assert.throws(() => serviceFeeSizeProfile({ feeBps: 10001 }), /Fee must be a whole number of basis points/);
  assert.throws(() => serviceFeeSizeProfile({ feeBps: 1.5 }), /Fee must be a whole number of basis points/);
  assert.throws(() => serviceFeeSizeProfile({ decimals: 7 }), /Decimals must be between 0 and 6/);
  assert.throws(() => serviceFeeSizeProfile({ fixedFee: '-1' }), /Enter a positive decimal amount/);
});

test('exactness beyond float range: a fixed fee past 2^53 splits and states exactly at the top rung', () => {
  const r = serviceFeeSizeProfile({ feeBps: 100, fixedFee: '9007199254740993', maxFee: '', decimals: 0 });
  const top = r.rows[5];
  assert.equal(top.gross, 100000n);
  assert.equal(top.bpsFee, 1000n);
  assert.equal(top.fee, 9007199254741993n);
  assert.equal(top.takesAll, true);
  assert.equal(top.effectiveBpsText, '900719925474199.30');
  assert.equal(top.fixedShareBpsText, '9999.99');
});

test('panel wiring: the size profile renders in app.js with its fairness-bound field', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /serviceFeeSizeProfile\(/);
  assert.match(app, /data-fee="maxEffectiveBps"/);
  assert.match(app, /first standard size within your/);
  assert.match(app, /v1\.197/);
});
