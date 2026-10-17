import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tieredServiceFee } from '../src/domain.js';

const DEFAULT = { amount: '1000', decimals: 6, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 100, tierThreshold: 50, tierBps: 50 };

test('default schedule: first 50 at 100 bps, rest at 50 bps', () => {
  const r = tieredServiceFee(DEFAULT);
  assert.equal(r.baseCount, 50);
  assert.equal(r.tierCount, 50);
  assert.equal(r.baseFeePerTransfer, 10000000n);
  assert.equal(r.tierFeePerTransfer, 5000000n);
  assert.equal(r.monthlyTieredFee, 750000000n);
  assert.equal(r.monthlyFlatFee, 1000000000n);
  assert.equal(r.differenceVsFlat, 250000000n);
  assert.equal(r.monthlyNetTiered, 100000000000n - 750000000n);
  assert.equal(r.blendedBpsText, '75.00');
});

test('threshold at or above volume: no transfer reaches the tier, tiered equals flat', () => {
  for (const th of [100, 500]) {
    const r = tieredServiceFee({ ...DEFAULT, tierThreshold: th });
    assert.equal(r.tierCount, 0);
    assert.equal(r.monthlyTieredFee, r.monthlyFlatFee);
    assert.equal(r.differenceVsFlat, 0n);
  }
});

test('threshold zero: every transfer pays the tier rate', () => {
  const r = tieredServiceFee({ ...DEFAULT, tierThreshold: 0 });
  assert.equal(r.baseCount, 0);
  assert.equal(r.tierCount, 100);
  assert.equal(r.monthlyTieredFee, 500000000n);
  assert.equal(r.blendedBpsText, '50.00');
});

test('a tier rate above the base rate is a premium: the difference is negative, stated signed', () => {
  const r = tieredServiceFee({ ...DEFAULT, tierBps: 250 });
  assert.equal(r.tierFeePerTransfer, 25000000n);
  assert.ok(r.differenceVsFlat < 0n);
  assert.equal(r.differenceVsFlat, -750000000n);
  assert.equal(r.monthlyTieredFee, 1750000000n);
});

test('equal tier and base rates collect exactly the flat month', () => {
  const r = tieredServiceFee({ ...DEFAULT, tierBps: 100 });
  assert.equal(r.differenceVsFlat, 0n);
  assert.equal(r.monthlyTieredFee, r.monthlyFlatFee);
  assert.equal(r.blendedBpsText, '100.00');
});

test('the fixed fee applies in both tiers', () => {
  const r = tieredServiceFee({ ...DEFAULT, fixedFee: '1' });
  assert.equal(r.baseFeePerTransfer, 11000000n);
  assert.equal(r.tierFeePerTransfer, 6000000n);
  assert.equal(r.monthlyTieredFee, 850000000n);
});

test('the cap bounds each tier and its binding is reported per tier', () => {
  const r = tieredServiceFee({ ...DEFAULT, maxFee: '7' });
  assert.equal(r.baseFeePerTransfer, 7000000n);
  assert.equal(r.baseCapApplied, true);
  assert.equal(r.tierFeePerTransfer, 5000000n);
  assert.equal(r.tierCapApplied, false);
  assert.equal(r.monthlyTieredFee, 600000000n);
});

test('a cap of zero charges nothing in either tier', () => {
  const r = tieredServiceFee({ ...DEFAULT, maxFee: '0' });
  assert.equal(r.monthlyTieredFee, 0n);
  assert.equal(r.blendedBpsText, '0.00');
});

test('a takes-all tier rate is refused when the tier carries transfers', () => {
  assert.throws(() => tieredServiceFee({ amount: '10', decimals: 6, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 100, tierThreshold: 50, tierBps: 10000 }), /tier fee would take the whole transfer/i);
});

test('a takes-all tier rate is not refused when no transfer reaches the tier', () => {
  const r = tieredServiceFee({ amount: '10', decimals: 6, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 100, tierThreshold: 100, tierBps: 10000 });
  assert.equal(r.tierCount, 0);
  assert.equal(r.monthlyTieredFee, r.monthlyFlatFee);
});

test('the base takes-all refusal from the split propagates', () => {
  assert.throws(() => tieredServiceFee({ ...DEFAULT, feeBps: 10000 }), /whole transfer/);
});

test('blended rate is derived from the totals, not averaged from the printed rates', () => {
  // 3 transfers: 1 at 100 bps (fee 10), 2 at 33 bps (fee floor(1000*33/10000)=3.3 -> 3 in token units at decimals 0? use decimals 0 amount 1000)
  const r = tieredServiceFee({ amount: '1000', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 3, tierThreshold: 1, tierBps: 33 });
  assert.equal(r.baseFeePerTransfer, 10n);
  assert.equal(r.tierFeePerTransfer, 3n);
  assert.equal(r.monthlyTieredFee, 16n);
  // blended = 16 / 3000 = 53.33 bps (hundredths truncated)
  assert.equal(r.blendedBpsText, '53.33');
});

test('exactness beyond float range', () => {
  const r = tieredServiceFee({ amount: '9007199254740993', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 2, tierThreshold: 1, tierBps: 50 });
  assert.equal(r.baseFeePerTransfer, 90071992547409n);
  assert.equal(r.tierFeePerTransfer, 45035996273704n);
  assert.equal(r.monthlyTieredFee, 90071992547409n + 45035996273704n);
});

test('unreadable tier inputs are refused', () => {
  assert.throws(() => tieredServiceFee({ ...DEFAULT, tierThreshold: -1 }), /Tier threshold/);
  assert.throws(() => tieredServiceFee({ ...DEFAULT, tierThreshold: 1.5 }), /Tier threshold/);
  assert.throws(() => tieredServiceFee({ ...DEFAULT, tierBps: 10001 }), /Tier fee/);
  assert.throws(() => tieredServiceFee({ ...DEFAULT, tierBps: -5 }), /Tier fee/);
});

test('panel wiring: the tiered model renders in app.js', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /tieredServiceFee\(/);
  assert.match(app, /v1\.233/);
});
