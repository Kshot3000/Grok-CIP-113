import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelHolderDistributionTreasurySweep, modelHolderDistributionSecondWindow } from '../src/domain.js';

// Holder distribution treasury sweep model (v1.228): the final
// disposition the second-window model (v1.151) names for the
// allocations still unclaimed after both claim windows — the
// design sweeps them to its treasury. The second-window model is
// composed unchanged; final paid + swept + undistributed (the
// base division's dust) === pool always, treasury after ===
// treasury before + swept always, and both shares are derived
// from the amounts, never from holder counts.
const DEFAULT = { pool: '10000', decimals: 6, treasuryBefore: '5000', holders: [{ label: 'Holder A', balance: '600000', claimed: true, claimedSecond: false }, { label: 'Holder B', balance: '300000', claimed: false, claimedSecond: true }, { label: 'Holder C', balance: '100000', claimed: false, claimedSecond: false }] };

test('the preloaded sweep: Holder C never claims in either window, their 1000 is swept onto a 5000 treasury, which ends at 6000', () => {
  const r = modelHolderDistributionTreasurySweep(DEFAULT);
  assert.equal(r.pool, 10000000000n);
  assert.deepEqual(r.holders.map(h => h.allocated), [6000000000n, 3000000000n, 1000000000n]);
  assert.deepEqual(r.holders.map(h => h.finalPaid), [6000000000n, 3000000000n, 0n]);
  assert.deepEqual(r.holders.map(h => h.sweptAmount), [0n, 0n, 1000000000n]);
  assert.equal(r.firstWindowTotal, 6000000000n);
  assert.equal(r.secondWindowTotal, 3000000000n);
  assert.equal(r.finalPaidTotal, 9000000000n);
  assert.equal(r.stillUnclaimedTotal, 1000000000n);
  assert.equal(r.sweptTotal, 1000000000n);
  assert.equal(r.treasuryBefore, 5000000000n);
  assert.equal(r.treasuryAfter, 6000000000n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.sweptShareBpsText, '1000.00');
  assert.equal(r.treasurySweepShareBpsText, '1666.66');
  assert.equal(r.sweepHappened, true);
  assert.equal(r.nothingToSweep, false);
  assert.equal(r.allSweptToTreasury, false);
  assert.equal(r.allFinallyClaimed, false);
  assert.equal(r.sweptCount, 1);
});

test('the two-window split is the second-window model composed unchanged', () => {
  const r = modelHolderDistributionTreasurySweep(DEFAULT);
  const second = modelHolderDistributionSecondWindow(DEFAULT);
  assert.deepEqual(r.holders.map(h => h.allocated), second.holders.map(h => h.allocated));
  assert.deepEqual(r.holders.map(h => h.finalPaid), second.holders.map(h => h.finalPaid));
  assert.equal(r.finalPaidTotal, second.finalPaidTotal);
  assert.equal(r.stillUnclaimedTotal, second.stillUnclaimedTotal);
  assert.equal(r.sweptTotal, second.stillUnclaimedTotal);
  assert.equal(r.undistributed, second.undistributed);
});

test('identities at the preload: final paid + swept + dust is the pool, and treasury after is treasury before + swept', () => {
  const r = modelHolderDistributionTreasurySweep(DEFAULT);
  assert.equal(r.finalPaidTotal + r.sweptTotal + r.undistributed, r.pool);
  assert.equal(r.treasuryAfter, r.treasuryBefore + r.sweptTotal);
  for (const h of r.holders) assert.equal(h.sweptAmount, h.allocated - h.finalPaid);
});

test('the dust case: a pool of 10 over three equal holdings sweeps 3, and the 1 of floor dust is NOT swept — it was never allocated', () => {
  const r = modelHolderDistributionTreasurySweep({ pool: '10', decimals: 0, treasuryBefore: '5', holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1', claimed: false, claimedSecond: true }, { label: 'C', balance: '1', claimed: false }] });
  assert.equal(r.finalPaidTotal, 6n);
  assert.equal(r.sweptTotal, 3n);
  assert.equal(r.undistributed, 1n);
  assert.equal(r.treasuryAfter, 8n);
  assert.equal(r.sweptShareBpsText, '3333.33');
  assert.equal(r.treasurySweepShareBpsText, '3750.00');
  assert.equal(r.finalPaidTotal + r.sweptTotal + r.undistributed, 10n);
});

test('a seven-unit case: allocations 2/3/2, the third holder never claims and their 2 is swept onto an empty treasury', () => {
  const r = modelHolderDistributionTreasurySweep({ pool: '7', decimals: 0, treasuryBefore: '0', holders: [{ label: 'A', balance: '2', claimed: false, claimedSecond: true }, { label: 'B', balance: '3', claimed: true }, { label: 'C', balance: '2', claimed: false }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [2n, 3n, 2n]);
  assert.equal(r.finalPaidTotal, 5n);
  assert.equal(r.sweptTotal, 2n);
  assert.equal(r.treasuryAfter, 2n);
  assert.equal(r.sweptShareBpsText, '2857.14');
  assert.equal(r.treasurySweepShareBpsText, '10000.00');
});

test('when every holder claims in one of the windows there is nothing to sweep and the treasury is untouched', () => {
  const r = modelHolderDistributionTreasurySweep({ pool: '10000', decimals: 6, treasuryBefore: '5000', holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: false, claimedSecond: true }, { label: 'Holder C', balance: '100000', claimed: false, claimedSecond: true }] });
  assert.equal(r.sweptTotal, 0n);
  assert.equal(r.treasuryAfter, 5000000000n);
  assert.equal(r.sweepHappened, false);
  assert.equal(r.nothingToSweep, true);
  assert.equal(r.allFinallyClaimed, true);
  assert.equal(r.sweptShareBpsText, '0.00');
  assert.equal(r.treasurySweepShareBpsText, '0.00');
});

test('when nobody claims in either window, the whole distributed amount is swept and the final paid is zero', () => {
  const r = modelHolderDistributionTreasurySweep({ pool: '10000', decimals: 6, treasuryBefore: '0', holders: [{ label: 'Holder A', balance: '600000', claimed: false }, { label: 'Holder B', balance: '300000', claimed: false }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.equal(r.finalPaidTotal, 0n);
  assert.equal(r.sweptTotal, 10000000000n);
  assert.equal(r.treasuryAfter, 10000000000n);
  assert.equal(r.allSweptToTreasury, true);
  assert.equal(r.sweptShareBpsText, '10000.00');
  assert.equal(r.treasurySweepShareBpsText, '10000.00');
  assert.equal(r.sweptCount, 3);
});

test('the swept share is derived from the amounts, not holder counts: one of three holders never claiming reads 1000.00 of the distributed pool, not a third', () => {
  const r = modelHolderDistributionTreasurySweep(DEFAULT);
  assert.equal(r.sweptCount, 1);
  assert.equal(r.sweptShareBpsText, '1000.00');
});

test('a holder who claimed in either window has nothing swept — only the never-claimed allocation moves', () => {
  const r = modelHolderDistributionTreasurySweep(DEFAULT);
  assert.equal(r.holders[0].sweptAmount, 0n);
  assert.equal(r.holders[1].sweptAmount, 0n);
  assert.equal(r.holders[2].sweptAmount, r.holders[2].allocated);
});

test('a zero-allocation holder sweeps nothing, and a missing treasury balance means an empty treasury', () => {
  const r = modelHolderDistributionTreasurySweep({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '100', claimed: true }, { label: 'B', balance: '0', claimed: false }] });
  assert.equal(r.holders[1].allocated, 0n);
  assert.equal(r.holders[1].sweptAmount, 0n);
  assert.equal(r.treasuryBefore, 0n);
  assert.equal(r.treasuryAfter, 0n);
  assert.equal(r.nothingToSweep, true);
});

test('a sole holder who never claims has the whole pool swept exactly, with no dust', () => {
  const r = modelHolderDistributionTreasurySweep({ pool: '12345', decimals: 0, treasuryBefore: '1', holders: [{ label: 'Only', balance: '7', claimed: false }] });
  assert.equal(r.sweptTotal, 12345n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.treasuryAfter, 12346n);
  assert.equal(r.allSweptToTreasury, true);
});

test('validation: the treasury balance is an amount like any other — a malformed one is refused by the amount layer', () => {
  assert.throws(() => modelHolderDistributionTreasurySweep({ ...DEFAULT, treasuryBefore: 'abc' }), /Enter a positive decimal amount, without commas or exponents\./);
  assert.throws(() => modelHolderDistributionTreasurySweep({ ...DEFAULT, treasuryBefore: '-5' }), /Enter a positive decimal amount, without commas or exponents\./);
  assert.throws(() => modelHolderDistributionTreasurySweep({ ...DEFAULT, treasuryBefore: '1.1234567' }), /Use at most 6 decimal places\./);
});

test('validation: the second-window model’s refusals propagate unchanged, including the both-windows refusal', () => {
  assert.throws(() => modelHolderDistributionTreasurySweep({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true, claimedSecond: true }] }), /Holder 1 already claimed in the first window and has nothing left to claim in the second window\./);
  assert.throws(() => modelHolderDistributionTreasurySweep({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: false, claimedSecond: 'yes' }] }), /Holder 1's second-window claim status must be stated as claimed or unclaimed\./);
  assert.throws(() => modelHolderDistributionTreasurySweep({ pool: '0', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }] }), /Distribution pool must be greater than zero\./);
});

test('beyond-float exactness: a pool of 2^53+1 sweeps its unclaimed half exactly onto a treasury of 2^53+1', () => {
  const r = modelHolderDistributionTreasurySweep({ pool: '9007199254740993', decimals: 0, treasuryBefore: '9007199254740993', holders: [{ label: 'A', balance: '1', claimed: false }, { label: 'B', balance: '1', claimed: true }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [4503599627370496n, 4503599627370496n]);
  assert.equal(r.sweptTotal, 4503599627370496n);
  assert.equal(r.treasuryAfter, 13510798882111489n);
  assert.equal(r.undistributed, 1n);
  assert.equal(r.sweptShareBpsText, '5000.00');
  assert.equal(r.treasurySweepShareBpsText, '3333.33');
  assert.equal(r.finalPaidTotal + r.sweptTotal + r.undistributed, 9007199254740993n);
});

test('decimals default to 6 when none are entered', () => {
  const r = modelHolderDistributionTreasurySweep({ pool: '10000', treasuryBefore: '5000', holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: false, claimedSecond: true }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.equal(r.decimals, 6);
  assert.equal(r.sweptTotal, 1000000000n);
  assert.equal(r.treasuryAfter, 6000000000n);
});

test('wiring: app.js imports the model, renders a distribution-treasury-sweep panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelHolderDistributionTreasurySweep/);
  assert.match(app, /data-dsweep/);
  assert.match(app, /distribution-treasury-sweep-output/);
  assert.match(app, /v1\.228/);
  assert.match(readme, /Holder distribution treasury sweep model/);
});
