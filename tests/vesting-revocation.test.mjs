import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelVestingRevocation } from '../src/domain.js';

// Vesting revocation model (v1.148): a revocable schedule ends at
// the revocation period — the recipient keeps exactly what had
// vested by then under the vesting schedule model (v1.142),
// composed unchanged, everything not yet vested returns to the
// issuer, and kept + returned is the total at every point.
const DEFAULT = { amount: '1000000', decimals: 6, cliffPeriods: 6, vestingPeriods: 24, revocationPeriod: 9 };

test('the preloaded revocation: at period 9 the recipient keeps 375000 and 625000 returns', () => {
  const r = modelVestingRevocation(DEFAULT);
  assert.equal(r.total, 1000000000000n);
  assert.equal(r.kept, 375000000000n);
  assert.equal(r.returned, 625000000000n);
  assert.equal(r.kept + r.returned, r.total);
  assert.equal(r.keptShareBpsText, '3750.00');
  assert.equal(r.returnedShareBpsText, '6250.00');
  assert.equal(r.beforeCliff, false);
  assert.equal(r.noEffect, false);
});

test('before the cliff, revocation returns everything — nothing had vested yet', () => {
  const r = modelVestingRevocation({ ...DEFAULT, revocationPeriod: 5 });
  assert.equal(r.kept, 0n);
  assert.equal(r.returned, r.total);
  assert.equal(r.beforeCliff, true);
  assert.equal(r.keptShareBpsText, '0.00');
  assert.equal(r.returnedShareBpsText, '10000.00');
});

test('at the cliff, revocation keeps exactly the cliff release', () => {
  const r = modelVestingRevocation({ ...DEFAULT, revocationPeriod: 6 });
  assert.equal(r.kept, 250000000000n);
  assert.equal(r.returned, 750000000000n);
  assert.equal(r.beforeCliff, false);
});

test('revoking at the full duration changes nothing: noEffect, and nothing returns', () => {
  const r = modelVestingRevocation({ ...DEFAULT, revocationPeriod: 24 });
  assert.equal(r.kept, r.total);
  assert.equal(r.returned, 0n);
  assert.equal(r.noEffect, true);
  assert.equal(r.keptShareBpsText, '10000.00');
});

test('accounting identity across designs: kept + returned is the total at every revocation point', () => {
  const inputs = [
    DEFAULT,
    { amount: '7', decimals: 0, cliffPeriods: 2, vestingPeriods: 5, revocationPeriod: 3 },
    { amount: '123.456', decimals: 6, cliffPeriods: 3, vestingPeriods: 10, revocationPeriod: 7 },
    { amount: '1000', decimals: 0, cliffPeriods: 5, vestingPeriods: 5, revocationPeriod: 5 },
    { amount: '42', decimals: 0, cliffPeriods: 0, vestingPeriods: 1, revocationPeriod: 0 },
  ];
  for (const input of inputs) {
    for (let period = 0; period <= input.vestingPeriods; period++) {
      const r = modelVestingRevocation({ ...input, revocationPeriod: period });
      assert.equal(r.kept + r.returned, r.total, JSON.stringify({ ...input, revocationPeriod: period }));
      assert.equal(r.beforeCliff, period < input.cliffPeriods, JSON.stringify({ ...input, revocationPeriod: period }));
      assert.equal(r.noEffect, period >= input.vestingPeriods, JSON.stringify({ ...input, revocationPeriod: period }));
    }
  }
});

test('revocation defaults to the cliff period — the first moment anything has vested', () => {
  const r = modelVestingRevocation({ amount: '1000000', decimals: 6, cliffPeriods: 6, vestingPeriods: 24 });
  assert.equal(r.revocationPeriod, 6);
  assert.equal(r.kept, 250000000000n);
  const noCliff = modelVestingRevocation({ amount: '100', decimals: 0, vestingPeriods: 3 });
  assert.equal(noCliff.revocationPeriod, 0);
  assert.equal(noCliff.kept, 0n);
  assert.equal(noCliff.returned, 100n);
});

test('milestone rows reuse the schedule milestones, each priced as kept and returned at that period', () => {
  const r = modelVestingRevocation(DEFAULT);
  assert.deepEqual(r.rows.map(x => x.periods), [0, 6, 12, 24]);
  assert.deepEqual(r.rows.map(x => x.kept), [0n, 250000000000n, 500000000000n, 1000000000000n]);
  assert.deepEqual(r.rows.map(x => x.returned), [1000000000000n, 750000000000n, 500000000000n, 0n]);
  assert.ok(r.rows.every(x => x.kept + x.returned === r.total));
});

test('the kept and returned shares are derived from the amounts, never the period ratio', () => {
  const r = modelVestingRevocation({ amount: '7', decimals: 0, cliffPeriods: 2, vestingPeriods: 5, revocationPeriod: 3 });
  assert.equal(r.kept, 4n);
  assert.equal(r.returned, 3n);
  assert.equal(r.keptShareBpsText, '5714.28'); // 4 of 7 by amount — not the 6000.00 the 3-of-5 period ratio would claim.
  assert.equal(r.returnedShareBpsText, '4285.71'); // 3 of 7 by amount.
});

test('beyond float range: revocation stays exact where a double would lose base units', () => {
  const r = modelVestingRevocation({ amount: '9007199254.740993', decimals: 6, cliffPeriods: 4, vestingPeriods: 9, revocationPeriod: 5 });
  assert.equal(r.total, 9007199254740993n);
  assert.equal(r.kept, 5003999585967218n);
  assert.equal(r.returned, 4003199668773775n);
  assert.equal(r.kept + r.returned, r.total);
});

test('a fractional allocation revoked mid-schedule keeps and returns exact base units', () => {
  const r = modelVestingRevocation({ amount: '123.456', decimals: 6, cliffPeriods: 3, vestingPeriods: 10, revocationPeriod: 7 });
  assert.equal(r.total, 123456000n);
  assert.equal(r.kept, 86419200n);
  assert.equal(r.returned, 37036800n);
  assert.equal(r.keptShareBpsText, '7000.00');
});

test('revoking at period 0 keeps nothing, and a zero cliff revoked in the first period keeps the first floored release', () => {
  const atZero = modelVestingRevocation({ ...DEFAULT, revocationPeriod: 0 });
  assert.equal(atZero.kept, 0n);
  assert.equal(atZero.returned, atZero.total);
  assert.equal(atZero.beforeCliff, true); // Period 0 is before the cliff at period 6.
  const noCliff = modelVestingRevocation({ amount: '100', decimals: 0, cliffPeriods: 0, vestingPeriods: 3, revocationPeriod: 1 });
  assert.equal(noCliff.kept, 33n);
  assert.equal(noCliff.returned, 67n);
  assert.equal(noCliff.beforeCliff, false);
});

test('validation: a bad revocation period is refused with its own message', () => {
  assert.throws(() => modelVestingRevocation({ ...DEFAULT, revocationPeriod: -1 }), /Revocation period must be a whole number between 0 and the vesting periods\./);
  assert.throws(() => modelVestingRevocation({ ...DEFAULT, revocationPeriod: 25 }), /Revocation period must be a whole number between 0 and the vesting periods\./);
  assert.throws(() => modelVestingRevocation({ ...DEFAULT, revocationPeriod: 2.5 }), /Revocation period must be a whole number between 0 and the vesting periods\./);
});

test('validation: base amount and cliff errors propagate unchanged from the schedule model', () => {
  assert.throws(() => modelVestingRevocation({ ...DEFAULT, amount: '0' }), /greater than zero/);
  assert.throws(() => modelVestingRevocation({ ...DEFAULT, amount: '-5' }), /positive decimal amount/);
  assert.throws(() => modelVestingRevocation({ ...DEFAULT, cliffPeriods: 25 }), /cannot exceed the vesting periods/);
  assert.throws(() => modelVestingRevocation({ ...DEFAULT, cliffPeriods: -1 }), /Cliff periods/);
  assert.throws(() => modelVestingRevocation({ ...DEFAULT, vestingPeriods: 0 }), /Vesting periods/);
});

test('wiring: app.js imports the model, renders a revocation panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelVestingRevocation/);
  assert.match(app, /data-revoke/);
  assert.match(app, /revocation-output/);
  assert.match(app, /v1\.148/);
  assert.match(readme, /Vesting revocation model/);
});
