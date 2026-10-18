import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelHolderDistributionBurn, modelHolderDistributionSecondWindow } from '../src/domain.js';

// Holder distribution burn model (v1.262): the other final
// disposition the second-window model (v1.151) names for the
// allocations still unclaimed after both claim windows — the
// design burns them, so they leave the total supply. The
// second-window model is composed unchanged; final paid +
// burned + undistributed (the base division's dust) === pool
// always, supply after === supply before - burned always, a
// burn larger than the stated supply is refused, and both
// shares are derived from the amounts, never from holder counts.
const DEFAULT = { pool: '10000', decimals: 6, supplyBefore: '100000', holders: [{ label: 'Holder A', balance: '600000', claimed: true, claimedSecond: false }, { label: 'Holder B', balance: '300000', claimed: false, claimedSecond: true }, { label: 'Holder C', balance: '100000', claimed: false, claimedSecond: false }] };

test('the preloaded burn: Holder C never claims in either window, their 1000 is burned and the supply falls from 100000 to 99000', () => {
  const r = modelHolderDistributionBurn(DEFAULT);
  assert.equal(r.pool, 10000000000n);
  assert.deepEqual(r.holders.map(h => h.allocated), [6000000000n, 3000000000n, 1000000000n]);
  assert.deepEqual(r.holders.map(h => h.finalPaid), [6000000000n, 3000000000n, 0n]);
  assert.deepEqual(r.holders.map(h => h.burnedAmount), [0n, 0n, 1000000000n]);
  assert.equal(r.firstWindowTotal, 6000000000n);
  assert.equal(r.secondWindowTotal, 3000000000n);
  assert.equal(r.finalPaidTotal, 9000000000n);
  assert.equal(r.stillUnclaimedTotal, 1000000000n);
  assert.equal(r.burnedTotal, 1000000000n);
  assert.equal(r.supplyBefore, 100000000000n);
  assert.equal(r.supplyAfter, 99000000000n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.burnedShareBpsText, '1000.00');
  assert.equal(r.supplyBurnShareBpsText, '100.00');
  assert.equal(r.burnHappened, true);
  assert.equal(r.nothingToBurn, false);
  assert.equal(r.allBurned, false);
  assert.equal(r.allFinallyClaimed, false);
  assert.equal(r.burnedCount, 1);
});

test('the two-window split is the second-window model composed unchanged', () => {
  const r = modelHolderDistributionBurn(DEFAULT);
  const second = modelHolderDistributionSecondWindow(DEFAULT);
  assert.deepEqual(r.holders.map(h => h.allocated), second.holders.map(h => h.allocated));
  assert.deepEqual(r.holders.map(h => h.finalPaid), second.holders.map(h => h.finalPaid));
  assert.equal(r.finalPaidTotal, second.finalPaidTotal);
  assert.equal(r.stillUnclaimedTotal, second.stillUnclaimedTotal);
  assert.equal(r.burnedTotal, second.stillUnclaimedTotal);
  assert.equal(r.undistributed, second.undistributed);
});

test('identities at the preload: final paid + burned + dust is the pool, and supply after is supply before - burned', () => {
  const r = modelHolderDistributionBurn(DEFAULT);
  assert.equal(r.finalPaidTotal + r.burnedTotal + r.undistributed, r.pool);
  assert.equal(r.supplyAfter, r.supplyBefore - r.burnedTotal);
  for (const h of r.holders) assert.equal(h.burnedAmount, h.allocated - h.finalPaid);
});

test('the dust case: a pool of 10 over three equal holdings burns 3, and the 1 of floor dust is NOT burned — it was never allocated', () => {
  const r = modelHolderDistributionBurn({ pool: '10', decimals: 0, supplyBefore: '100', holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1', claimed: false, claimedSecond: true }, { label: 'C', balance: '1', claimed: false }] });
  assert.equal(r.finalPaidTotal, 6n);
  assert.equal(r.burnedTotal, 3n);
  assert.equal(r.undistributed, 1n);
  assert.equal(r.supplyAfter, 97n);
  assert.equal(r.burnedShareBpsText, '3333.33');
  assert.equal(r.supplyBurnShareBpsText, '300.00');
  assert.equal(r.finalPaidTotal + r.burnedTotal + r.undistributed, 10n);
});

test('a seven-unit case: allocations 2/3/2, the third holder never claims and their 2 is burned off a supply of 70', () => {
  const r = modelHolderDistributionBurn({ pool: '7', decimals: 0, supplyBefore: '70', holders: [{ label: 'A', balance: '2', claimed: false, claimedSecond: true }, { label: 'B', balance: '3', claimed: true }, { label: 'C', balance: '2', claimed: false }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [2n, 3n, 2n]);
  assert.equal(r.finalPaidTotal, 5n);
  assert.equal(r.burnedTotal, 2n);
  assert.equal(r.supplyAfter, 68n);
  assert.equal(r.burnedShareBpsText, '2857.14');
  assert.equal(r.supplyBurnShareBpsText, '285.71');
});

test('when every holder claims in one of the windows there is nothing to burn and the supply is untouched', () => {
  const r = modelHolderDistributionBurn({ pool: '10000', decimals: 6, supplyBefore: '100000', holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: false, claimedSecond: true }, { label: 'Holder C', balance: '100000', claimed: false, claimedSecond: true }] });
  assert.equal(r.burnedTotal, 0n);
  assert.equal(r.supplyAfter, 100000000000n);
  assert.equal(r.burnHappened, false);
  assert.equal(r.nothingToBurn, true);
  assert.equal(r.allFinallyClaimed, true);
  assert.equal(r.burnedShareBpsText, '0.00');
  assert.equal(r.supplyBurnShareBpsText, '0.00');
});

test('when nobody claims in either window, the whole distributed amount is burned and the final paid is zero', () => {
  const r = modelHolderDistributionBurn({ pool: '10000', decimals: 6, supplyBefore: '10000', holders: [{ label: 'Holder A', balance: '600000', claimed: false }, { label: 'Holder B', balance: '300000', claimed: false }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.equal(r.finalPaidTotal, 0n);
  assert.equal(r.burnedTotal, 10000000000n);
  assert.equal(r.supplyAfter, 0n);
  assert.equal(r.allBurned, true);
  assert.equal(r.burnedShareBpsText, '10000.00');
  assert.equal(r.supplyBurnShareBpsText, '10000.00');
  assert.equal(r.burnedCount, 3);
});

test('the burned share is derived from the amounts, not holder counts: one of three holders never claiming reads 1000.00 of the distributed pool, not a third', () => {
  const r = modelHolderDistributionBurn(DEFAULT);
  assert.equal(r.burnedCount, 1);
  assert.equal(r.burnedShareBpsText, '1000.00');
});

test('a holder who claimed in either window has nothing burned — only the never-claimed allocation is destroyed', () => {
  const r = modelHolderDistributionBurn(DEFAULT);
  assert.equal(r.holders[0].burnedAmount, 0n);
  assert.equal(r.holders[1].burnedAmount, 0n);
  assert.equal(r.holders[2].burnedAmount, r.holders[2].allocated);
});

test('a zero-allocation holder burns nothing', () => {
  const r = modelHolderDistributionBurn({ pool: '100', decimals: 0, supplyBefore: '1000', holders: [{ label: 'A', balance: '100', claimed: true }, { label: 'B', balance: '0', claimed: false }] });
  assert.equal(r.holders[1].allocated, 0n);
  assert.equal(r.holders[1].burnedAmount, 0n);
  assert.equal(r.supplyAfter, 1000n);
  assert.equal(r.nothingToBurn, true);
});

test('a sole holder who never claims has the whole pool burned exactly, with no dust, down to a supply of zero', () => {
  const r = modelHolderDistributionBurn({ pool: '12345', decimals: 0, supplyBefore: '12345', holders: [{ label: 'Only', balance: '7', claimed: false }] });
  assert.equal(r.burnedTotal, 12345n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.supplyAfter, 0n);
  assert.equal(r.allBurned, true);
});

test('validation: a burn larger than the stated total supply is refused — a burn cannot destroy more than was issued', () => {
  assert.throws(() => modelHolderDistributionBurn({ pool: '10000', decimals: 6, supplyBefore: '500', holders: [{ label: 'A', balance: '600000', claimed: false }, { label: 'B', balance: '400000', claimed: true }] }), /The amount left unclaimed to burn is larger than the stated total supply before the burn — a burn cannot destroy more than was issued\./);
  assert.throws(() => modelHolderDistributionBurn({ pool: '100', decimals: 0, supplyBefore: '0', holders: [{ label: 'A', balance: '1', claimed: false }] }), /a burn cannot destroy more than was issued\./);
});

test('validation: the stated supply is an amount like any other — a malformed one is refused by the amount layer', () => {
  assert.throws(() => modelHolderDistributionBurn({ ...DEFAULT, supplyBefore: 'abc' }), /Enter a positive decimal amount, without commas or exponents\./);
  assert.throws(() => modelHolderDistributionBurn({ ...DEFAULT, supplyBefore: '-5' }), /Enter a positive decimal amount, without commas or exponents\./);
  assert.throws(() => modelHolderDistributionBurn({ ...DEFAULT, supplyBefore: '1.1234567' }), /Use at most 6 decimal places\./);
});

test('validation: the second-window model’s refusals propagate unchanged, including the both-windows refusal', () => {
  assert.throws(() => modelHolderDistributionBurn({ pool: '100', decimals: 0, supplyBefore: '1000', holders: [{ label: 'A', balance: '1', claimed: true, claimedSecond: true }] }), /Holder 1 already claimed in the first window and has nothing left to claim in the second window\./);
  assert.throws(() => modelHolderDistributionBurn({ pool: '100', decimals: 0, supplyBefore: '1000', holders: [{ label: 'A', balance: '1', claimed: false, claimedSecond: 'yes' }] }), /Holder 1's second-window claim status must be stated as claimed or unclaimed\./);
  assert.throws(() => modelHolderDistributionBurn({ pool: '0', decimals: 0, supplyBefore: '1000', holders: [{ label: 'A', balance: '1', claimed: true }] }), /Distribution pool must be greater than zero\./);
});

test('beyond-float exactness: a pool of 2^53+1 burns its unclaimed half exactly off a supply of ten times the pool', () => {
  const r = modelHolderDistributionBurn({ pool: '9007199254740993', decimals: 0, supplyBefore: '90071992547409930', holders: [{ label: 'A', balance: '1', claimed: false }, { label: 'B', balance: '1', claimed: true }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [4503599627370496n, 4503599627370496n]);
  assert.equal(r.burnedTotal, 4503599627370496n);
  assert.equal(r.supplyAfter, 85568392920039434n);
  assert.equal(r.undistributed, 1n);
  assert.equal(r.burnedShareBpsText, '5000.00');
  assert.equal(r.supplyBurnShareBpsText, '499.99');
  assert.equal(r.finalPaidTotal + r.burnedTotal + r.undistributed, 9007199254740993n);
  assert.equal(r.supplyAfter + r.burnedTotal, r.supplyBefore);
});

test('decimals default to 6 when none are entered', () => {
  const r = modelHolderDistributionBurn({ pool: '10000', supplyBefore: '100000', holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: false, claimedSecond: true }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.equal(r.decimals, 6);
  assert.equal(r.burnedTotal, 1000000000n);
  assert.equal(r.supplyAfter, 99000000000n);
});

test('wiring: app.js imports the model, renders a distribution-burn panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelHolderDistributionBurn/);
  assert.match(app, /data-dburn/);
  assert.match(app, /distribution-burn-output/);
  assert.match(app, /v1\.262/);
  assert.match(readme, /Holder distribution burn model/);
});
