import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelVestingClaim } from '../src/domain.js';

// Vesting claim model (v1.228): vesting is not claiming — a
// recipient claims the vested amount in separate steps, so a
// claim's ceiling is what had vested by the claim period and had
// not yet been claimed, priced on the vesting schedule model
// composed unchanged at the claim period. Locked tokens are
// never claimable and already-claimed tokens are never claimable
// twice; claimedAfter + unclaimedVested + locked is the total.
const DEFAULT = { amount: '1000000', decimals: 6, cliffPeriods: 6, vestingPeriods: 24, claimPeriod: 12, alreadyClaimed: '250000', claimAmount: '250000' };

test('the preloaded claim: at period 12 half had vested, half of that was already claimed, and this claim takes the rest of the vested amount', () => {
  const r = modelVestingClaim(DEFAULT);
  assert.equal(r.total, 1000000000000n);
  assert.equal(r.vested, 500000000000n);
  assert.equal(r.locked, 500000000000n);
  assert.equal(r.alreadyClaimed, 250000000000n);
  assert.equal(r.claimable, 250000000000n);
  assert.equal(r.thisClaim, 250000000000n);
  assert.equal(r.claimedAfter, 500000000000n);
  assert.equal(r.unclaimedVested, 0n);
  assert.equal(r.claimedAfter + r.unclaimedVested + r.locked, r.total);
  assert.equal(r.claimedShareBpsText, '5000.00');
  assert.equal(r.unclaimedShareBpsText, '0.00');
  assert.equal(r.lockedShareBpsText, '5000.00');
  assert.equal(r.fullClaim, true);
  assert.equal(r.fullyClaimedAfter, true);
  assert.equal(r.partialClaim, false);
  assert.equal(r.beforeCliff, false);
});

test('before the cliff nothing had vested, so nothing is claimable and a zero claim is stated as such', () => {
  const r = modelVestingClaim({ ...DEFAULT, claimPeriod: 5, alreadyClaimed: '0', claimAmount: '0' });
  assert.equal(r.vested, 0n);
  assert.equal(r.claimable, 0n);
  assert.equal(r.thisClaim, 0n);
  assert.equal(r.claimedAfter, 0n);
  assert.equal(r.locked, r.total);
  assert.equal(r.beforeCliff, true);
  assert.equal(r.nothingVested, true);
  assert.equal(r.nothingToClaim, true);
  assert.equal(r.zeroClaim, true);
  assert.equal(r.fullClaim, false);
  assert.equal(r.fullyClaimedAfter, false);
  assert.equal(r.lockedShareBpsText, '10000.00');
});

test('at the cliff, the claimable amount is the cliff release minus what was already claimed', () => {
  const r = modelVestingClaim({ ...DEFAULT, claimPeriod: 6, alreadyClaimed: '100000', claimAmount: '150000' });
  assert.equal(r.vested, 250000000000n);
  assert.equal(r.claimable, 150000000000n);
  assert.equal(r.thisClaim, 150000000000n);
  assert.equal(r.claimedAfter, 250000000000n);
  assert.equal(r.unclaimedVested, 0n);
  assert.equal(r.fullClaim, true);
  assert.equal(r.beforeCliff, false);
});

test('a partial claim leaves vested amount still unclaimed, stated apart from the locked amount', () => {
  const r = modelVestingClaim({ ...DEFAULT, alreadyClaimed: '100000', claimAmount: '150000' });
  assert.equal(r.vested, 500000000000n);
  assert.equal(r.claimable, 400000000000n);
  assert.equal(r.claimedAfter, 250000000000n);
  assert.equal(r.unclaimedVested, 250000000000n);
  assert.equal(r.locked, 500000000000n);
  assert.equal(r.partialClaim, true);
  assert.equal(r.fullClaim, false);
  assert.equal(r.fullyClaimedAfter, false);
  assert.equal(r.claimedShareBpsText, '2500.00');
  assert.equal(r.unclaimedShareBpsText, '2500.00');
});

test('a zero claim at a claimable point is stated, never mistaken for a full claim', () => {
  const r = modelVestingClaim({ ...DEFAULT, claimAmount: '0' });
  assert.equal(r.claimable, 250000000000n);
  assert.equal(r.thisClaim, 0n);
  assert.equal(r.zeroClaim, true);
  assert.equal(r.fullClaim, false);
  assert.equal(r.unclaimedVested, 250000000000n);
  assert.equal(r.fullyClaimedAfter, false);
});

test('when everything vested was already claimed there is nothing to claim, and the default claim takes nothing', () => {
  const r = modelVestingClaim({ amount: '1000000', decimals: 6, cliffPeriods: 6, vestingPeriods: 24, claimPeriod: 12, alreadyClaimed: '500000' });
  assert.equal(r.claimable, 0n);
  assert.equal(r.thisClaim, 0n);
  assert.equal(r.nothingToClaim, true);
  assert.equal(r.claimedAfter, 500000000000n);
  assert.equal(r.unclaimedVested, 0n);
  assert.equal(r.fullyClaimedAfter, true);
});

test('defaults: the claim period defaults to the cliff and an unstated claim takes the whole claimable amount', () => {
  const r = modelVestingClaim({ amount: '1000000', decimals: 6, cliffPeriods: 6, vestingPeriods: 24 });
  assert.equal(r.claimPeriod, 6);
  assert.equal(r.vested, 250000000000n);
  assert.equal(r.claimable, 250000000000n);
  assert.equal(r.thisClaim, 250000000000n);
  assert.equal(r.claimedAfter, 250000000000n);
  assert.equal(r.fullClaim, true);
  const noCliff = modelVestingClaim({ amount: '100', decimals: 0, vestingPeriods: 3 });
  assert.equal(noCliff.claimPeriod, 0);
  assert.equal(noCliff.vested, 0n);
  assert.equal(noCliff.thisClaim, 0n);
  assert.equal(noCliff.nothingVested, true);
});

test('accounting identity across designs: claimed + unclaimed vested + locked is the total at every claim point', () => {
  const inputs = [
    DEFAULT,
    { amount: '7', decimals: 0, cliffPeriods: 2, vestingPeriods: 5, alreadyClaimed: '1', claimAmount: '2' },
    { amount: '123.456', decimals: 6, cliffPeriods: 3, vestingPeriods: 10, alreadyClaimed: '10', claimAmount: '20' },
    { amount: '1000', decimals: 0, cliffPeriods: 5, vestingPeriods: 5, alreadyClaimed: '0', claimAmount: '1000' },
    { amount: '42', decimals: 0, cliffPeriods: 0, vestingPeriods: 1, alreadyClaimed: '0', claimAmount: '0' },
  ];
  for (const input of inputs) {
    for (let period = 0; period <= input.vestingPeriods; period++) {
      // Claim the whole claimable amount at each point (alreadyClaimed may exceed early vesting: skip those refused points).
      let r;
      try { r = modelVestingClaim({ ...input, claimPeriod: period, claimAmount: undefined }); } catch { continue; }
      const at = JSON.stringify({ ...input, claimPeriod: period });
      assert.equal(r.claimedAfter + r.unclaimedVested + r.locked, r.total, at);
      assert.equal(r.claimedAfter, r.alreadyClaimed + r.thisClaim, at);
      assert.equal(r.claimable, r.vested - r.alreadyClaimed, at);
      assert.equal(r.unclaimedVested, r.vested - r.claimedAfter, at);
      assert.equal(r.beforeCliff, period < input.cliffPeriods, at);
    }
  }
});

test('milestone rows reuse the schedule milestones, each stating vested and claimable against the same already-claimed figure', () => {
  const r = modelVestingClaim(DEFAULT);
  assert.deepEqual(r.rows.map(x => x.periods), [0, 6, 12, 24]);
  assert.deepEqual(r.rows.map(x => x.vested), [0n, 250000000000n, 500000000000n, 1000000000000n]);
  assert.deepEqual(r.rows.map(x => x.claimable), [0n, 0n, 250000000000n, 750000000000n]);
  assert.ok(r.rows.every(x => x.vested + x.locked === r.total));
});

test('the claimed, unclaimed, and locked shares are derived from the amounts, never the period ratio', () => {
  const r = modelVestingClaim({ amount: '7', decimals: 0, cliffPeriods: 2, vestingPeriods: 5, claimPeriod: 3, alreadyClaimed: '1', claimAmount: '2' });
  assert.equal(r.vested, 4n);
  assert.equal(r.claimable, 3n);
  assert.equal(r.claimedAfter, 3n);
  assert.equal(r.unclaimedVested, 1n);
  assert.equal(r.locked, 3n);
  assert.equal(r.claimedShareBpsText, '4285.71'); // 3 of 7 by amount — not the 6000.00 the 3-of-5 period ratio would claim.
  assert.equal(r.unclaimedShareBpsText, '1428.57'); // 1 of 7 by amount.
  assert.equal(r.lockedShareBpsText, '4285.71'); // 3 of 7 by amount.
  assert.equal(r.partialClaim, true);
});

test('beyond float range: a claim stays exact where a double would lose base units', () => {
  const r = modelVestingClaim({ amount: '9007199254.740993', decimals: 6, cliffPeriods: 4, vestingPeriods: 9, claimPeriod: 5, alreadyClaimed: '1000000000', claimAmount: '2000000000' });
  assert.equal(r.total, 9007199254740993n);
  assert.equal(r.vested, 5003999585967218n);
  assert.equal(r.claimable, 4003999585967218n);
  assert.equal(r.claimedAfter, 3000000000000000n);
  assert.equal(r.unclaimedVested, 2003999585967218n);
  assert.equal(r.locked, 4003199668773775n);
  assert.equal(r.claimedAfter + r.unclaimedVested + r.locked, r.total);
  assert.equal(r.claimedShareBpsText, '3330.66');
  assert.equal(r.unclaimedShareBpsText, '2224.88');
  assert.equal(r.lockedShareBpsText, '4444.44');
});

test('a fractional allocation claimed mid-schedule prices exact base units', () => {
  const r = modelVestingClaim({ amount: '123.456', decimals: 6, cliffPeriods: 3, vestingPeriods: 10, claimPeriod: 7, alreadyClaimed: '10', claimAmount: '20' });
  assert.equal(r.total, 123456000n);
  assert.equal(r.vested, 86419200n);
  assert.equal(r.claimable, 76419200n);
  assert.equal(r.claimedAfter, 30000000n);
  assert.equal(r.unclaimedVested, 56419200n);
  assert.equal(r.claimedShareBpsText, '2430.01');
  assert.equal(r.unclaimedShareBpsText, '4569.98');
  assert.equal(r.lockedShareBpsText, '3000.00');
});

test('own refusal: an already-claimed amount larger than what had vested is refused', () => {
  assert.throws(() => modelVestingClaim({ ...DEFAULT, claimPeriod: 6, alreadyClaimed: '250001' }), /Already claimed exceeds what had vested by the claim period/);
  assert.throws(() => modelVestingClaim({ ...DEFAULT, claimPeriod: 5, alreadyClaimed: '1' }), /Already claimed exceeds what had vested by the claim period/);
});

test('own refusal: a claim larger than the claimable amount is refused — locked tokens cannot be claimed', () => {
  assert.throws(() => modelVestingClaim({ ...DEFAULT, claimAmount: '250001' }), /Claim amount exceeds what had vested and not yet been claimed by the claim period/);
  assert.throws(() => modelVestingClaim({ ...DEFAULT, claimPeriod: 5, alreadyClaimed: '0', claimAmount: '1' }), /Claim amount exceeds what had vested and not yet been claimed by the claim period/);
});

test('validation: a bad claim period is refused with its own message', () => {
  assert.throws(() => modelVestingClaim({ ...DEFAULT, claimPeriod: -1 }), /Claim period must be a whole number between 0 and the vesting periods\./);
  assert.throws(() => modelVestingClaim({ ...DEFAULT, claimPeriod: 25 }), /Claim period must be a whole number between 0 and the vesting periods\./);
  assert.throws(() => modelVestingClaim({ ...DEFAULT, claimPeriod: 2.5 }), /Claim period must be a whole number between 0 and the vesting periods\./);
});

test('validation: base schedule errors and bad claim amounts propagate', () => {
  assert.throws(() => modelVestingClaim({ ...DEFAULT, amount: '0' }), /greater than zero/);
  assert.throws(() => modelVestingClaim({ ...DEFAULT, amount: '-5' }), /positive decimal amount/);
  assert.throws(() => modelVestingClaim({ ...DEFAULT, cliffPeriods: 25 }), /cannot exceed the vesting periods/);
  assert.throws(() => modelVestingClaim({ ...DEFAULT, claimAmount: '-5' }), /positive decimal amount/);
  assert.throws(() => modelVestingClaim({ ...DEFAULT, alreadyClaimed: '1,000' }), /positive decimal amount/);
});

test('wiring: app.js imports the model, renders a claim panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelVestingClaim/);
  assert.match(app, /data-vclaim/);
  assert.match(app, /vesting-claim-output/);
  assert.match(app, /v1\.228/);
  assert.match(readme, /Vesting claim model/);
});
