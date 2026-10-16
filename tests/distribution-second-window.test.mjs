import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelHolderDistributionSecondWindow, modelHolderDistributionClaims } from '../src/domain.js';

// Holder distribution second claim window model (v1.212): the
// other destination for the unclaimed allocations the claim-window
// model (v1.149) names — a later window, where holders who missed
// the first deadline claim their OWN allocation in full, never a
// share of anyone else's. The claim-window model is composed
// unchanged; final paid + still unclaimed + undistributed (the
// base division's dust) === pool always, and the recovered share
// is derived from the amounts, never from holder counts.
const DEFAULT = { pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: true, claimedSecond: false }, { label: 'Holder B', balance: '300000', claimed: false, claimedSecond: true }, { label: 'Holder C', balance: '100000', claimed: false, claimedSecond: false }] };

test('the preloaded second window: Holder B claims their own 3000 late, Holder C never claims, 1000 stays unclaimed', () => {
  const r = modelHolderDistributionSecondWindow(DEFAULT);
  assert.equal(r.pool, 10000000000n);
  assert.deepEqual(r.holders.map(h => h.allocated), [6000000000n, 3000000000n, 1000000000n]);
  assert.deepEqual(r.holders.map(h => h.paidOut), [6000000000n, 0n, 0n]);
  assert.deepEqual(r.holders.map(h => h.latePaid), [0n, 3000000000n, 0n]);
  assert.deepEqual(r.holders.map(h => h.finalPaid), [6000000000n, 3000000000n, 0n]);
  assert.deepEqual(r.holders.map(h => h.stillUnclaimedAmount), [0n, 0n, 1000000000n]);
  assert.equal(r.firstWindowTotal, 6000000000n);
  assert.equal(r.secondWindowTotal, 3000000000n);
  assert.equal(r.finalPaidTotal, 9000000000n);
  assert.equal(r.unclaimedTotal, 4000000000n);
  assert.equal(r.stillUnclaimedTotal, 1000000000n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.recoveredShareBpsText, '7500.00');
  assert.equal(r.allClaimed, false);
  assert.equal(r.allFinallyClaimed, false);
  assert.equal(r.secondWindowRecovered, true);
  assert.equal(r.nobodyClaimedEitherWindow, false);
  assert.equal(r.claimedCount, 1);
  assert.equal(r.lateClaimedCount, 1);
  assert.equal(r.finalClaimedCount, 2);
  assert.equal(r.stillUnclaimedCount, 1);
});

test('the claim split is the claim-window model composed unchanged', () => {
  const r = modelHolderDistributionSecondWindow(DEFAULT);
  const claims = modelHolderDistributionClaims(DEFAULT);
  assert.deepEqual(r.holders.map(h => h.allocated), claims.holders.map(h => h.allocated));
  assert.deepEqual(r.holders.map(h => h.paidOut), claims.holders.map(h => h.paidOut));
  assert.equal(r.firstWindowTotal, claims.claimedTotal);
  assert.equal(r.unclaimedTotal, claims.unclaimedTotal);
  assert.equal(r.distributed, claims.distributed);
  assert.equal(r.undistributed, claims.undistributed);
});

test('identities at the preload: the three window identities and the per-holder identity all hold exactly', () => {
  const r = modelHolderDistributionSecondWindow(DEFAULT);
  assert.equal(r.finalPaidTotal + r.stillUnclaimedTotal + r.undistributed, r.pool);
  assert.equal(r.firstWindowTotal + r.secondWindowTotal, r.finalPaidTotal);
  assert.equal(r.secondWindowTotal + r.stillUnclaimedTotal, r.unclaimedTotal);
  for (const h of r.holders) {
    assert.equal(h.finalPaid, h.paidOut + h.latePaid);
    assert.equal(h.stillUnclaimedAmount, h.allocated - h.finalPaid);
  }
});

test('the dust case: a pool of 10 over three equal holdings pays 3 in each window and leaves 3 still unclaimed beside 1 of dust', () => {
  const r = modelHolderDistributionSecondWindow({ pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1', claimed: false, claimedSecond: true }, { label: 'C', balance: '1', claimed: false }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [3n, 3n, 3n]);
  assert.deepEqual(r.holders.map(h => h.finalPaid), [3n, 3n, 0n]);
  assert.equal(r.firstWindowTotal, 3n);
  assert.equal(r.secondWindowTotal, 3n);
  assert.equal(r.finalPaidTotal, 6n);
  assert.equal(r.stillUnclaimedTotal, 3n);
  assert.equal(r.undistributed, 1n);
  assert.equal(r.finalPaidTotal + r.stillUnclaimedTotal + r.undistributed, 10n);
  assert.equal(r.recoveredShareBpsText, '5000.00');
});

test('a seven-unit case: allocations 2/3/2, the first holder claims 2 late and the third never claims', () => {
  const r = modelHolderDistributionSecondWindow({ pool: '7', decimals: 0, holders: [{ label: 'A', balance: '2', claimed: false, claimedSecond: true }, { label: 'B', balance: '3', claimed: true }, { label: 'C', balance: '2', claimed: false }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [2n, 3n, 2n]);
  assert.deepEqual(r.holders.map(h => h.finalPaid), [2n, 3n, 0n]);
  assert.equal(r.secondWindowTotal, 2n);
  assert.equal(r.finalPaidTotal, 5n);
  assert.equal(r.stillUnclaimedTotal, 2n);
  assert.equal(r.recoveredShareBpsText, '5000.00');
  assert.equal(r.finalPaidTotal + r.stillUnclaimedTotal + r.undistributed, 7n);
});

test('when every holder claims in the first window the second window is moot: nothing recovered, finals are the allocations', () => {
  const r = modelHolderDistributionSecondWindow({ pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: true }, { label: 'Holder C', balance: '100000', claimed: true }] });
  assert.equal(r.unclaimedTotal, 0n);
  assert.equal(r.secondWindowTotal, 0n);
  assert.equal(r.finalPaidTotal, 10000000000n);
  assert.equal(r.stillUnclaimedTotal, 0n);
  assert.equal(r.allClaimed, true);
  assert.equal(r.allFinallyClaimed, true);
  assert.equal(r.secondWindowRecovered, false);
  assert.equal(r.recoveredShareBpsText, '0.00');
});

test('when nobody claims in either window, nothing is paid out and the whole distributed amount stays unclaimed', () => {
  const r = modelHolderDistributionSecondWindow({ pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: false }, { label: 'Holder B', balance: '300000', claimed: false, claimedSecond: false }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.equal(r.finalPaidTotal, 0n);
  assert.equal(r.nobodyClaimedEitherWindow, true);
  assert.equal(r.secondWindowRecovered, false);
  assert.equal(r.stillUnclaimedTotal, r.distributed);
  assert.equal(r.recoveredShareBpsText, '0.00');
  assert.equal(r.finalClaimedCount, 0);
  assert.equal(r.stillUnclaimedCount, 3);
});

test('a late claim pays the holder their own allocation in full — never a share of the other unclaimed allocations', () => {
  const r = modelHolderDistributionSecondWindow({ pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: false }, { label: 'Holder B', balance: '300000', claimed: false, claimedSecond: true }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.equal(r.holders[1].latePaid, 3000000000n);
  assert.equal(r.holders[1].finalPaid, r.holders[1].allocated);
  assert.equal(r.holders[0].stillUnclaimedAmount, 6000000000n);
  assert.equal(r.holders[2].stillUnclaimedAmount, 1000000000n);
  assert.equal(r.secondWindowTotal, 3000000000n);
});

test('the recovered share is derived from the amounts, not holder counts: one of two unclaimed holders claiming late reads 7500.00, not 5000.00', () => {
  const r = modelHolderDistributionSecondWindow(DEFAULT);
  assert.equal(r.lateClaimedCount, 1);
  assert.equal(r.recoveredShareBpsText, '7500.00');
});

test('a zero-allocation holder claiming late is paid nothing, and allFinallyClaimed judges only holders with an allocation', () => {
  const r = modelHolderDistributionSecondWindow({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '100', claimed: true }, { label: 'B', balance: '0', claimed: false, claimedSecond: true }] });
  assert.equal(r.holders[1].allocated, 0n);
  assert.equal(r.holders[1].lateClaimed, true);
  assert.equal(r.holders[1].latePaid, 0n);
  assert.equal(r.allFinallyClaimed, true);
  assert.equal(r.finalPaidTotal, 100n);
});

test('when every unclaimed holder claims late, allFinallyClaimed is true and nothing stays unclaimed', () => {
  const r = modelHolderDistributionSecondWindow({ pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: false, claimedSecond: true }, { label: 'Holder C', balance: '100000', claimed: false, claimedSecond: true }] });
  assert.equal(r.allFinallyClaimed, true);
  assert.equal(r.stillUnclaimedTotal, 0n);
  assert.equal(r.finalPaidTotal, 10000000000n);
  assert.equal(r.finalClaimedCount, 3);
  assert.equal(r.recoveredShareBpsText, '10000.00');
});

test('a missing second-window status means the holder did not claim late', () => {
  const r = modelHolderDistributionSecondWindow({ pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: false }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.deepEqual(r.holders.map(h => h.claimedSecond), [false, false, false]);
  assert.equal(r.secondWindowTotal, 0n);
  assert.equal(r.stillUnclaimedTotal, 4000000000n);
});

test('validation: a non-boolean second-window status is refused with its own message naming the holder', () => {
  assert.throws(() => modelHolderDistributionSecondWindow({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1', claimed: false, claimedSecond: 'yes' }] }), /Holder 2's second-window claim status must be stated as claimed or unclaimed\./);
});

test('validation: a first-window claimant marked as claiming in the second window too is refused — they have nothing left to claim', () => {
  assert.throws(() => modelHolderDistributionSecondWindow({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true, claimedSecond: true }] }), /Holder 1 already claimed in the first window and has nothing left to claim in the second window\./);
});

test('validation: the claim-window model’s refusals propagate unchanged, including a non-boolean first-window status', () => {
  assert.throws(() => modelHolderDistributionSecondWindow({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: 'yes' }] }), /Holder 1's claim status must be stated as claimed or unclaimed\./);
  assert.throws(() => modelHolderDistributionSecondWindow({ pool: '100', decimals: 0, holders: [{ label: 'Holder A', balance: '1', claimed: true }, { label: 'holder a', balance: '2', claimed: false }] }), /Duplicate holder label: holder a\. Each holder in the distribution needs its own label\./);
  assert.throws(() => modelHolderDistributionSecondWindow({ pool: '0', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }] }), /Distribution pool must be greater than zero\./);
});

test('beyond-float exactness: a pool of 2^53+1 splits exactly and the late claim recovers the whole unclaimed half', () => {
  const r = modelHolderDistributionSecondWindow({ pool: '9007199254740993', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: false, claimedSecond: true }, { label: 'B', balance: '1', claimed: true }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [4503599627370496n, 4503599627370496n]);
  assert.equal(r.secondWindowTotal, 4503599627370496n);
  assert.equal(r.finalPaidTotal, 9007199254740992n);
  assert.equal(r.stillUnclaimedTotal, 0n);
  assert.equal(r.undistributed, 1n);
  assert.equal(r.recoveredShareBpsText, '10000.00');
  assert.equal(r.finalPaidTotal + r.stillUnclaimedTotal + r.undistributed, 9007199254740993n);
});

test('decimals default to 6 when none are entered', () => {
  const r = modelHolderDistributionSecondWindow({ pool: '10000', holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: false, claimedSecond: true }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.equal(r.decimals, 6);
  assert.equal(r.finalPaidTotal, 9000000000n);
});

test('wiring: app.js imports the model, renders a distribution-second-window panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelHolderDistributionSecondWindow/);
  assert.match(app, /data-dwin/);
  assert.match(app, /distribution-second-window-output/);
  assert.match(app, /v1\.212/);
  assert.match(readme, /Holder distribution second claim window model/);
});
