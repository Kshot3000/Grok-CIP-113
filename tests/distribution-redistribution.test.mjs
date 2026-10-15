import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelHolderDistributionRedistribution, modelHolderDistributionClaims } from '../src/domain.js';

// Holder distribution redistribution model (v1.190): one
// destination for the unclaimed allocations the claim-window model
// (v1.149) states — the claimants share them. The claim-window
// model is composed unchanged; its unclaimed total becomes a
// second pool divided among the claimants pro-rata by their
// ALLOCATIONS in BigInt, leaving its own floor dust unclaimed.
// Final paid + remaining unclaimed + undistributed (the first
// division's dust) === pool always, and the redistributed share
// is derived from the amounts, never from holder counts.
const DEFAULT = { pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: true }, { label: 'Holder C', balance: '100000', claimed: false }] };

test('the preloaded redistribution: the 1000 unclaimed is divided 666.666666 and 333.333333 among the claimants, leaving one base unit of second-division dust', () => {
  const r = modelHolderDistributionRedistribution(DEFAULT);
  assert.equal(r.pool, 10000000000n);
  assert.deepEqual(r.holders.map(h => h.allocated), [6000000000n, 3000000000n, 1000000000n]);
  assert.deepEqual(r.holders.map(h => h.paidOut), [6000000000n, 3000000000n, 0n]);
  assert.deepEqual(r.holders.map(h => h.redistribution), [666666666n, 333333333n, 0n]);
  assert.deepEqual(r.holders.map(h => h.finalPaid), [6666666666n, 3333333333n, 0n]);
  assert.equal(r.claimedTotal, 9000000000n);
  assert.equal(r.unclaimedTotal, 1000000000n);
  assert.equal(r.redistributedTotal, 999999999n);
  assert.equal(r.remainingUnclaimed, 1n);
  assert.equal(r.finalPaidTotal, 9999999999n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.redistributedShareBpsText, '9999.99');
  assert.equal(r.redistributionHappened, true);
  assert.equal(r.noClaimants, false);
  assert.equal(r.allClaimed, false);
});

test('the claim split is the claim-window model composed unchanged', () => {
  const r = modelHolderDistributionRedistribution(DEFAULT);
  const claims = modelHolderDistributionClaims(DEFAULT);
  assert.deepEqual(r.holders.map(h => h.allocated), claims.holders.map(h => h.allocated));
  assert.deepEqual(r.holders.map(h => h.paidOut), claims.holders.map(h => h.paidOut));
  assert.deepEqual(r.holders.map(h => h.unclaimedAmount), claims.holders.map(h => h.unclaimedAmount));
  assert.equal(r.claimedTotal, claims.claimedTotal);
  assert.equal(r.unclaimedTotal, claims.unclaimedTotal);
  assert.equal(r.distributed, claims.distributed);
  assert.equal(r.undistributed, claims.undistributed);
});

test('identities at the preload: redistributed + remaining is the unclaimed total, and final paid + remaining + undistributed is the full pool', () => {
  const r = modelHolderDistributionRedistribution(DEFAULT);
  assert.equal(r.redistributedTotal + r.remainingUnclaimed, r.unclaimedTotal);
  assert.equal(r.finalPaidTotal + r.remainingUnclaimed + r.undistributed, r.pool);
  for (const h of r.holders) assert.equal(h.finalPaid, h.paidOut + h.redistribution);
});

test('the dust case keeps both dusts apart: a pool of 10 over three equal holdings redistributes 2 of the 3 unclaimed and leaves 1 of second dust beside 1 of first dust', () => {
  const r = modelHolderDistributionRedistribution({ pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1', claimed: true }, { label: 'C', balance: '1', claimed: false }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [3n, 3n, 3n]);
  assert.deepEqual(r.holders.map(h => h.redistribution), [1n, 1n, 0n]);
  assert.deepEqual(r.holders.map(h => h.finalPaid), [4n, 4n, 0n]);
  assert.equal(r.redistributedTotal, 2n);
  assert.equal(r.remainingUnclaimed, 1n);
  assert.equal(r.undistributed, 1n);
  assert.equal(r.finalPaidTotal, 8n);
  assert.equal(r.finalPaidTotal + r.remainingUnclaimed + r.undistributed, 10n);
  assert.equal(r.redistributedShareBpsText, '6666.66');
});

test('a seven-unit case: the second division floors independently of the first', () => {
  const r = modelHolderDistributionRedistribution({ pool: '7', decimals: 0, holders: [{ label: 'A', balance: '2', claimed: true }, { label: 'B', balance: '3', claimed: false }, { label: 'C', balance: '2', claimed: true }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [2n, 3n, 2n]);
  assert.deepEqual(r.holders.map(h => h.redistribution), [1n, 0n, 1n]);
  assert.deepEqual(r.holders.map(h => h.finalPaid), [3n, 0n, 3n]);
  assert.equal(r.redistributedTotal, 2n);
  assert.equal(r.remainingUnclaimed, 1n);
  assert.equal(r.finalPaidTotal + r.remainingUnclaimed + r.undistributed, 7n);
});

test('when every holder claims there is nothing to redistribute: finals are the allocations and no redistribution happens', () => {
  const r = modelHolderDistributionRedistribution({ pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: true }, { label: 'Holder C', balance: '100000', claimed: true }] });
  assert.equal(r.unclaimedTotal, 0n);
  assert.equal(r.redistributedTotal, 0n);
  assert.equal(r.remainingUnclaimed, 0n);
  assert.deepEqual(r.holders.map(h => h.finalPaid), r.holders.map(h => h.allocated));
  assert.equal(r.finalPaidTotal, 10000000000n);
  assert.equal(r.redistributedShareBpsText, '0.00');
  assert.equal(r.redistributionHappened, false);
  assert.equal(r.noClaimants, false);
  assert.equal(r.allClaimed, true);
});

test('when no holder claims there is no one to redistribute to: nothing is paid out and the whole distribution stays unclaimed', () => {
  const r = modelHolderDistributionRedistribution({ pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: false }, { label: 'Holder B', balance: '300000', claimed: false }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.equal(r.claimedTotal, 0n);
  assert.equal(r.redistributedTotal, 0n);
  assert.equal(r.remainingUnclaimed, 10000000000n);
  assert.equal(r.remainingUnclaimed, r.unclaimedTotal);
  assert.equal(r.finalPaidTotal, 0n);
  assert.equal(r.noClaimants, true);
  assert.equal(r.redistributionHappened, false);
  assert.equal(r.noneClaimed, true);
});

test('a sole claimant takes the whole unclaimed total exactly, with no second dust', () => {
  const r = modelHolderDistributionRedistribution({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1', claimed: false }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [50n, 50n]);
  assert.equal(r.holders[0].redistribution, 50n);
  assert.equal(r.holders[0].finalPaid, 100n);
  assert.equal(r.holders[1].finalPaid, 0n);
  assert.equal(r.remainingUnclaimed, 0n);
  assert.equal(r.redistributedShareBpsText, '10000.00');
});

test('a claimant allocated nothing has no base and receives no redistribution, even while other claimants share', () => {
  const r = modelHolderDistributionRedistribution({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '100', claimed: true }, { label: 'B', balance: '0', claimed: true }, { label: 'C', balance: '100', claimed: false }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [50n, 0n, 50n]);
  assert.deepEqual(r.holders.map(h => h.redistribution), [50n, 0n, 0n]);
  assert.deepEqual(r.holders.map(h => h.finalPaid), [100n, 0n, 0n]);
  assert.equal(r.remainingUnclaimed, 0n);
});

test('the redistributed share is derived from the amounts, never from holder counts: one claimant of three taking half the unclaimed pool by amount reads its amount share', () => {
  const r = modelHolderDistributionRedistribution({ pool: '123.456', decimals: 6, holders: [{ label: 'X', balance: '100', claimed: false }, { label: 'Y', balance: '50', claimed: true }] });
  assert.equal(r.claimedCount, 1);
  assert.equal(r.holders[1].redistribution, 82304000n);
  assert.equal(r.holders[1].finalPaid, 123456000n);
  assert.equal(r.holders[0].finalPaid, 0n);
  assert.equal(r.redistributedShareBpsText, '10000.00');
});

test('a missing claim status defaults to unclaimed, so that holder neither is paid nor shares', () => {
  const r = modelHolderDistributionRedistribution({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1' }] });
  assert.deepEqual(r.holders.map(h => h.claimed), [true, false]);
  assert.equal(r.holders[0].finalPaid, 100n);
  assert.equal(r.holders[1].finalPaid, 0n);
});

test('when nothing is distributed there is nothing to redistribute: noClaimants is false and every total is zero beside the dust', () => {
  const r = modelHolderDistributionRedistribution({ pool: '1', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '100', claimed: true }] });
  assert.equal(r.distributed, 0n);
  assert.equal(r.redistributedTotal, 0n);
  assert.equal(r.remainingUnclaimed, 0n);
  assert.equal(r.finalPaidTotal, 0n);
  assert.equal(r.undistributed, 1n);
  assert.equal(r.noClaimants, false);
  assert.equal(r.redistributionHappened, false);
  assert.equal(r.redistributedShareBpsText, '0.00');
  assert.equal(r.finalPaidTotal + r.remainingUnclaimed + r.undistributed, r.pool);
});

test('five holders: three claimants share the two unclaimed allocations by amount and the second dust is stated', () => {
  const r = modelHolderDistributionRedistribution({ pool: '1000', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1', claimed: false }, { label: 'C', balance: '1', claimed: true }, { label: 'D', balance: '1', claimed: false }, { label: 'E', balance: '1', claimed: true }] });
  assert.deepEqual(r.holders.map(h => h.redistribution), [133n, 0n, 133n, 0n, 133n]);
  assert.deepEqual(r.holders.map(h => h.finalPaid), [333n, 0n, 333n, 0n, 333n]);
  assert.equal(r.redistributedTotal, 399n);
  assert.equal(r.remainingUnclaimed, 1n);
  assert.equal(r.finalPaidTotal, 999n);
  assert.equal(r.finalPaidTotal + r.remainingUnclaimed + r.undistributed, 1000n);
});

test('the identities hold across designs, and the redistributed share is always the redistributed amount over the unclaimed amount', () => {
  const inputs = [
    DEFAULT,
    { pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1', claimed: true }, { label: 'C', balance: '1', claimed: false }] },
    { pool: '7', decimals: 0, holders: [{ label: 'A', balance: '2', claimed: true }, { label: 'B', balance: '3', claimed: false }, { label: 'C', balance: '2', claimed: true }] },
    { pool: '123.456', decimals: 6, holders: [{ label: 'X', balance: '100', claimed: false }, { label: 'Y', balance: '50', claimed: true }] },
    { pool: '100', decimals: 0, holders: [{ label: 'A', balance: '100', claimed: true }, { label: 'B', balance: '0', claimed: true }, { label: 'C', balance: '100', claimed: false }] },
    { pool: '1', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '100', claimed: true }] },
    { pool: '1000000', decimals: 6, holders: [{ label: 'A', balance: '1', claimed: false }, { label: 'B', balance: '0', claimed: true }, { label: 'C', balance: '999999', claimed: true }] },
  ];
  for (const input of inputs) {
    const r = modelHolderDistributionRedistribution(input);
    const at = JSON.stringify(input);
    assert.equal(r.redistributedTotal + r.remainingUnclaimed, r.unclaimedTotal, at);
    assert.equal(r.finalPaidTotal + r.remainingUnclaimed + r.undistributed, r.pool, at);
    assert.equal(r.claimedTotal + r.unclaimedTotal + r.undistributed, r.pool, at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.redistribution, 0n), r.redistributedTotal, at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.finalPaid, 0n), r.finalPaidTotal, at);
    for (const h of r.holders) {
      assert.equal(h.finalPaid, h.paidOut + h.redistribution, at);
      if (!h.claimed) assert.equal(h.redistribution, 0n, at);
      if (!h.claimed) assert.equal(h.finalPaid, 0n, at);
    }
    if (r.unclaimedTotal > 0n) {
      const hundredths = r.redistributedTotal * 1000000n / r.unclaimedTotal;
      assert.equal(r.redistributedShareBpsText, `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`, at);
    } else {
      assert.equal(r.redistributedShareBpsText, '0.00', at);
    }
    assert.equal(r.noClaimants, r.claimedTotal === 0n && r.unclaimedTotal > 0n, at);
    assert.equal(r.redistributionHappened, r.redistributedTotal > 0n, at);
  }
});

test('beyond float range: the sole claimant\u2019s redistribution stays exact where a double would lose a base unit', () => {
  const r = modelHolderDistributionRedistribution({ pool: '9007199254740993', decimals: 0, holders: [{ label: 'X', balance: '2000000000000000', claimed: true }, { label: 'Y', balance: '1000000000000000', claimed: false }] });
  assert.equal(r.holders[0].allocated, 6004799503160662n);
  assert.equal(r.holders[0].redistribution, 3002399751580331n);
  assert.equal(r.holders[0].finalPaid, 9007199254740993n);
  assert.equal(r.holders[0].finalPaid, r.pool);
  assert.equal(r.remainingUnclaimed, 0n);
  assert.equal(r.redistributedShareBpsText, '10000.00');
});

test('validation: the claim-window model\u2019s refusals propagate unchanged, including a non-boolean claim status naming the holder', () => {
  assert.throws(() => modelHolderDistributionRedistribution({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: 'yes' }] }), /Holder 1's claim status must be stated as claimed or unclaimed\./);
  assert.throws(() => modelHolderDistributionRedistribution({ pool: '100', decimals: 0, holders: [] }), /At least one holder is required to model a holder distribution\./);
  assert.throws(() => modelHolderDistributionRedistribution({ pool: '100', decimals: 0, holders: [{ label: 'Holder A', balance: '1', claimed: true }, { label: 'holder a', balance: '2', claimed: false }] }), /Duplicate holder label: holder a\. Each holder in the distribution needs its own label\./);
  assert.throws(() => modelHolderDistributionRedistribution({ pool: '0', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }] }), /Distribution pool must be greater than zero\./);
});

test('decimals default to 6 when none are entered', () => {
  const r = modelHolderDistributionRedistribution({ pool: '10000', holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: true }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.equal(r.decimals, 6);
  assert.equal(r.redistributedTotal, 999999999n);
  assert.equal(r.finalPaidTotal, 9999999999n);
});

test('wiring: app.js imports the model, renders a distribution-redistribution panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelHolderDistributionRedistribution/);
  assert.match(app, /data-dredis/);
  assert.match(app, /distribution-redistribution-output/);
  assert.match(app, /v1\.190/);
  assert.match(readme, /Holder distribution redistribution model/);
});
