import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelVestingAcceleration } from '../src/domain.js';

// Vesting acceleration model (v1.257): a schedule that accelerates
// on a stated event releases the entered share of the UNVESTED
// remainder at the acceleration period, priced on the vesting
// schedule model (v1.142) composed unchanged — the same schedule
// the revocation model (v1.143) ends early — and recipientFinal +
// stillLocked is the total at every point.
const DEFAULT = { amount: '1000000', decimals: 6, cliffPeriods: 6, vestingPeriods: 24, accelerationPeriod: 9, acceleratedBps: 5000 };

test('the preloaded acceleration: at period 9, half the unvested remainder accelerates — final 687500, locked 312500', () => {
  const r = modelVestingAcceleration(DEFAULT);
  assert.equal(r.total, 1000000000000n);
  assert.equal(r.normallyVested, 375000000000n);
  assert.equal(r.unvestedAtPeriod, 625000000000n);
  assert.equal(r.accelerated, 312500000000n);
  assert.equal(r.recipientFinal, 687500000000n);
  assert.equal(r.stillLocked, 312500000000n);
  assert.equal(r.recipientFinal + r.stillLocked, r.total);
  assert.equal(r.recipientShareBpsText, '6875.00');
  assert.equal(r.lockedShareBpsText, '3125.00');
  assert.equal(r.beforeCliff, false);
  assert.equal(r.noEffect, false);
  assert.equal(r.fullAcceleration, false);
  assert.equal(r.zeroAcceleration, false);
});

test('before the cliff, acceleration applies to the whole allocation — nothing had vested normally yet', () => {
  const r = modelVestingAcceleration({ ...DEFAULT, accelerationPeriod: 5 });
  assert.equal(r.normallyVested, 0n);
  assert.equal(r.unvestedAtPeriod, r.total);
  assert.equal(r.accelerated, 500000000000n); // floor(total × 5000 ÷ 10000): the share of the whole, as entered.
  assert.equal(r.recipientFinal, 500000000000n);
  assert.equal(r.stillLocked, 500000000000n);
  assert.equal(r.beforeCliff, true);
  assert.equal(r.recipientShareBpsText, '5000.00');
  assert.equal(r.lockedShareBpsText, '5000.00');
});

test('at the cliff, acceleration prices the cliff release as vested and half of the rest on top', () => {
  const r = modelVestingAcceleration({ ...DEFAULT, accelerationPeriod: 6 });
  assert.equal(r.normallyVested, 250000000000n);
  assert.equal(r.accelerated, 375000000000n);
  assert.equal(r.recipientFinal, 625000000000n);
  assert.equal(r.stillLocked, 375000000000n);
  assert.equal(r.beforeCliff, false);
});

test('full acceleration: at 10000 bps the whole unvested remainder releases and nothing stays locked', () => {
  const r = modelVestingAcceleration({ ...DEFAULT, acceleratedBps: 10000 });
  assert.equal(r.accelerated, 625000000000n);
  assert.equal(r.recipientFinal, r.total);
  assert.equal(r.stillLocked, 0n);
  assert.equal(r.fullAcceleration, true);
  assert.equal(r.recipientShareBpsText, '10000.00');
  assert.equal(r.lockedShareBpsText, '0.00');
});

test('zero accelerated share: the recipient final is exactly what had vested normally', () => {
  const r = modelVestingAcceleration({ ...DEFAULT, acceleratedBps: 0 });
  assert.equal(r.accelerated, 0n);
  assert.equal(r.recipientFinal, r.normallyVested);
  assert.equal(r.recipientFinal, 375000000000n);
  assert.equal(r.stillLocked, 625000000000n);
  assert.equal(r.zeroAcceleration, true);
  assert.equal(r.fullAcceleration, false);
});

test('accelerating at the full duration changes nothing: noEffect, and nothing remains to accelerate', () => {
  const r = modelVestingAcceleration({ ...DEFAULT, accelerationPeriod: 24 });
  assert.equal(r.normallyVested, r.total);
  assert.equal(r.unvestedAtPeriod, 0n);
  assert.equal(r.accelerated, 0n);
  assert.equal(r.recipientFinal, r.total);
  assert.equal(r.stillLocked, 0n);
  assert.equal(r.noEffect, true);
});

test('accounting identity across designs: final + locked is the total at every acceleration point and share', () => {
  const inputs = [
    DEFAULT,
    { amount: '7', decimals: 0, cliffPeriods: 2, vestingPeriods: 5, accelerationPeriod: 3, acceleratedBps: 5000 },
    { amount: '123.456', decimals: 6, cliffPeriods: 3, vestingPeriods: 10, accelerationPeriod: 7, acceleratedBps: 2500 },
    { amount: '1000', decimals: 0, cliffPeriods: 5, vestingPeriods: 5, accelerationPeriod: 5, acceleratedBps: 10000 },
    { amount: '42', decimals: 0, cliffPeriods: 0, vestingPeriods: 1, accelerationPeriod: 0, acceleratedBps: 3333 },
  ];
  for (const input of inputs) {
    for (let period = 0; period <= input.vestingPeriods; period++) {
      for (const bps of [0, 2500, 5000, 10000]) {
        const r = modelVestingAcceleration({ ...input, accelerationPeriod: period, acceleratedBps: bps });
        const at = JSON.stringify({ ...input, accelerationPeriod: period, acceleratedBps: bps });
        assert.equal(r.recipientFinal + r.stillLocked, r.total, at);
        assert.equal(r.normallyVested + r.unvestedAtPeriod, r.total, at);
        assert.equal(r.recipientFinal, r.normallyVested + r.accelerated, at);
        assert.equal(r.beforeCliff, period < input.cliffPeriods, at);
        assert.equal(r.noEffect, period >= input.vestingPeriods, at);
        assert.equal(r.fullAcceleration, bps === 10000, at);
        assert.equal(r.zeroAcceleration, bps === 0, at);
      }
    }
  }
});

test('acceleration defaults to the cliff period and a 5000 bps share — the first moment anything has vested, half of the rest on top', () => {
  const r = modelVestingAcceleration({ amount: '1000000', decimals: 6, cliffPeriods: 6, vestingPeriods: 24 });
  assert.equal(r.accelerationPeriod, 6);
  assert.equal(r.acceleratedBps, 5000);
  assert.equal(r.normallyVested, 250000000000n);
  assert.equal(r.recipientFinal, 625000000000n);
  const noCliff = modelVestingAcceleration({ amount: '100', decimals: 0, vestingPeriods: 3 });
  assert.equal(noCliff.accelerationPeriod, 0);
  assert.equal(noCliff.normallyVested, 0n);
  assert.equal(noCliff.accelerated, 50n);
  assert.equal(noCliff.recipientFinal, 50n);
  assert.equal(noCliff.stillLocked, 50n);
});

test('milestone rows reuse the schedule milestones, each priced as final and locked at that period with the same share', () => {
  const r = modelVestingAcceleration(DEFAULT);
  assert.deepEqual(r.rows.map(x => x.periods), [0, 6, 12, 24]);
  assert.deepEqual(r.rows.map(x => x.recipientFinal), [500000000000n, 625000000000n, 750000000000n, 1000000000000n]);
  assert.deepEqual(r.rows.map(x => x.stillLocked), [500000000000n, 375000000000n, 250000000000n, 0n]);
  assert.ok(r.rows.every(x => x.recipientFinal + x.stillLocked === r.total));
});

test('the recipient and locked shares are derived from the amounts, never the period ratio', () => {
  const r = modelVestingAcceleration({ amount: '7', decimals: 0, cliffPeriods: 2, vestingPeriods: 5, accelerationPeriod: 3, acceleratedBps: 5000 });
  assert.equal(r.normallyVested, 4n);
  assert.equal(r.accelerated, 1n); // floor(3 × 5000 ÷ 10000): half of the 3 unvested, floored.
  assert.equal(r.recipientFinal, 5n);
  assert.equal(r.stillLocked, 2n);
  assert.equal(r.recipientShareBpsText, '7142.85'); // 5 of 7 by amount — not the 6000.00 the 3-of-5 period ratio would claim.
  assert.equal(r.lockedShareBpsText, '2857.14'); // 2 of 7 by amount.
});

test('beyond float range: acceleration stays exact where a double would lose base units', () => {
  const r = modelVestingAcceleration({ amount: '9007199254.740993', decimals: 6, cliffPeriods: 4, vestingPeriods: 9, accelerationPeriod: 5, acceleratedBps: 5000 });
  assert.equal(r.total, 9007199254740993n);
  assert.equal(r.normallyVested, 5003999585967218n);
  assert.equal(r.unvestedAtPeriod, 4003199668773775n);
  assert.equal(r.accelerated, 2001599834386887n);
  assert.equal(r.recipientFinal, 7005599420354105n);
  assert.equal(r.stillLocked, 2001599834386888n);
  assert.equal(r.recipientFinal + r.stillLocked, r.total);
  assert.equal(r.recipientShareBpsText, '7777.77');
  assert.equal(r.lockedShareBpsText, '2222.22');
});

test('a fractional allocation accelerated mid-schedule prices exact base units', () => {
  const r = modelVestingAcceleration({ amount: '123.456', decimals: 6, cliffPeriods: 3, vestingPeriods: 10, accelerationPeriod: 7, acceleratedBps: 2500 });
  assert.equal(r.total, 123456000n);
  assert.equal(r.normallyVested, 86419200n);
  assert.equal(r.accelerated, 9259200n);
  assert.equal(r.recipientFinal, 95678400n);
  assert.equal(r.stillLocked, 27777600n);
  assert.equal(r.recipientShareBpsText, '7750.00');
});

test('validation: a bad acceleration period is refused with its own message', () => {
  assert.throws(() => modelVestingAcceleration({ ...DEFAULT, accelerationPeriod: -1 }), /Acceleration period must be a whole number between 0 and the vesting periods\./);
  assert.throws(() => modelVestingAcceleration({ ...DEFAULT, accelerationPeriod: 25 }), /Acceleration period must be a whole number between 0 and the vesting periods\./);
  assert.throws(() => modelVestingAcceleration({ ...DEFAULT, accelerationPeriod: 2.5 }), /Acceleration period must be a whole number between 0 and the vesting periods\./);
});

test('validation: a bad accelerated share is refused with its own message', () => {
  assert.throws(() => modelVestingAcceleration({ ...DEFAULT, acceleratedBps: -1 }), /Accelerated share must be a whole number of basis points between 0 and 10000\./);
  assert.throws(() => modelVestingAcceleration({ ...DEFAULT, acceleratedBps: 10001 }), /Accelerated share must be a whole number of basis points between 0 and 10000\./);
  assert.throws(() => modelVestingAcceleration({ ...DEFAULT, acceleratedBps: 2.5 }), /Accelerated share must be a whole number of basis points between 0 and 10000\./);
});

test('validation: base amount and cliff errors propagate unchanged from the schedule model', () => {
  assert.throws(() => modelVestingAcceleration({ ...DEFAULT, amount: '0' }), /greater than zero/);
  assert.throws(() => modelVestingAcceleration({ ...DEFAULT, amount: '-5' }), /positive decimal amount/);
  assert.throws(() => modelVestingAcceleration({ ...DEFAULT, cliffPeriods: 25 }), /cannot exceed the vesting periods/);
  assert.throws(() => modelVestingAcceleration({ ...DEFAULT, cliffPeriods: -1 }), /Cliff periods/);
  assert.throws(() => modelVestingAcceleration({ ...DEFAULT, vestingPeriods: 0 }), /Vesting periods/);
});

test('wiring: app.js imports the model, renders an acceleration panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelVestingAcceleration/);
  assert.match(app, /data-accel/);
  assert.match(app, /acceleration-output/);
  assert.match(app, /v1\.257/);
  assert.match(readme, /Vesting acceleration model/);
});
