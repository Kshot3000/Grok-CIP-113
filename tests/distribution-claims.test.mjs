import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelHolderDistributionClaims, modelHolderDistribution } from '../src/domain.js';

// Holder distribution claim-window model (v1.157): the lifecycle
// after a priced distribution — the allocation is priced by the
// uncapped holder distribution (v1.145) composed unchanged, then
// each holder's allocation splits by claim status: claimed pays
// out in full, unclaimed leaves the whole allocation unclaimed.
// Claimed + unclaimed + undistributed (the base division's dust)
// === pool always, and the claimed share is derived from the
// amounts, never from holder counts.
const DEFAULT = { pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: true }, { label: 'Holder C', balance: '100000', claimed: false }] };

test('the preloaded claim window: a 10000 pool allocated 6000, 3000, and 1000 pays out 9000 and leaves 1000 unclaimed', () => {
  const r = modelHolderDistributionClaims(DEFAULT);
  assert.equal(r.pool, 10000000000n);
  assert.equal(r.totalBalances, 1000000000000n);
  assert.deepEqual(r.holders.map(h => h.allocated), [6000000000n, 3000000000n, 1000000000n]);
  assert.deepEqual(r.holders.map(h => h.claimed), [true, true, false]);
  assert.deepEqual(r.holders.map(h => h.paidOut), [6000000000n, 3000000000n, 0n]);
  assert.deepEqual(r.holders.map(h => h.unclaimedAmount), [0n, 0n, 1000000000n]);
  assert.deepEqual(r.holders.map(h => h.holdingShareBpsText), ['6000.00', '3000.00', '1000.00']);
  assert.equal(r.distributed, 10000000000n);
  assert.equal(r.claimedTotal, 9000000000n);
  assert.equal(r.unclaimedTotal, 1000000000n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.claimedShareBpsText, '9000.00');
  assert.equal(r.allClaimed, false);
  assert.equal(r.noneClaimed, false);
  assert.equal(r.claimedCount, 2);
  assert.equal(r.unclaimedCount, 1);
});

test('the allocation is the base holder distribution composed unchanged', () => {
  const r = modelHolderDistributionClaims(DEFAULT);
  const base = modelHolderDistribution({ pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000' }, { label: 'Holder B', balance: '300000' }, { label: 'Holder C', balance: '100000' }] });
  assert.deepEqual(r.holders.map(h => h.allocated), base.holders.map(h => h.receives));
  assert.equal(r.distributed, base.distributed);
  assert.equal(r.undistributed, base.undistributed);
  assert.equal(r.totalBalances, base.totalBalances);
});

test('identity at the preload: claimed + unclaimed + undistributed is the full pool, and claimed + unclaimed is the distributed amount', () => {
  const r = modelHolderDistributionClaims(DEFAULT);
  assert.equal(r.claimedTotal + r.unclaimedTotal, r.distributed);
  assert.equal(r.claimedTotal + r.unclaimedTotal + r.undistributed, r.pool);
  for (const h of r.holders) assert.equal(h.paidOut + h.unclaimedAmount, h.allocated);
});

test('the dust case keeps the identity: a pool of 10 over three equal holdings allocates 3 each, and the unclaimed third stays unclaimed beside the dust', () => {
  const r = modelHolderDistributionClaims({ pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1', claimed: true }, { label: 'C', balance: '1', claimed: false }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [3n, 3n, 3n]);
  assert.equal(r.distributed, 9n);
  assert.equal(r.claimedTotal, 6n);
  assert.equal(r.unclaimedTotal, 3n);
  assert.equal(r.undistributed, 1n);
  assert.equal(r.claimedTotal + r.unclaimedTotal + r.undistributed, 10n);
  assert.equal(r.claimedShareBpsText, '6666.66');
});

test('when every holder claims, nothing is unclaimed, allClaimed holds, and the claimed share is the whole distributed amount', () => {
  const r = modelHolderDistributionClaims({ pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: true }, { label: 'Holder C', balance: '100000', claimed: true }] });
  assert.equal(r.claimedTotal, 10000000000n);
  assert.equal(r.unclaimedTotal, 0n);
  assert.equal(r.claimedShareBpsText, '10000.00');
  assert.equal(r.allClaimed, true);
  assert.equal(r.noneClaimed, false);
  assert.equal(r.claimedCount, 3);
  assert.equal(r.unclaimedCount, 0);
});

test('when no holder claims, nothing is paid out, the whole distribution is unclaimed, and noneClaimed holds', () => {
  const r = modelHolderDistributionClaims({ pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: false }, { label: 'Holder B', balance: '300000', claimed: false }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.equal(r.claimedTotal, 0n);
  assert.equal(r.unclaimedTotal, 10000000000n);
  assert.equal(r.claimedShareBpsText, '0.00');
  assert.equal(r.allClaimed, false);
  assert.equal(r.noneClaimed, true);
  assert.equal(r.claimedCount, 0);
  assert.equal(r.unclaimedCount, 3);
});

test('a zero-balance holder is allocated nothing, and their claim status changes nothing — allClaimed is judged on holders with an allocation', () => {
  const unclaimed = modelHolderDistributionClaims({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '100', claimed: true }, { label: 'B', balance: '0', claimed: false }] });
  const claimed = modelHolderDistributionClaims({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '100', claimed: true }, { label: 'B', balance: '0', claimed: true }] });
  for (const r of [unclaimed, claimed]) {
    assert.equal(r.holders[1].allocated, 0n);
    assert.equal(r.holders[1].paidOut, 0n);
    assert.equal(r.holders[1].unclaimedAmount, 0n);
    assert.equal(r.claimedTotal, 100n);
    assert.equal(r.unclaimedTotal, 0n);
    assert.equal(r.allClaimed, true); // B had nothing to claim, so B's status cannot break allClaimed.
    assert.equal(r.claimedShareBpsText, '10000.00');
  }
  assert.equal(unclaimed.unclaimedCount, 1); // Counts still count holders by status, even a zero-allocation one.
  assert.equal(claimed.claimedCount, 2);
});

test('the claimed share is derived from the amounts, never from holder counts: Holder A alone claiming reads 6000.00 though they are 1 of 3 holders', () => {
  const r = modelHolderDistributionClaims({ pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: false }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.equal(r.claimedCount, 1);
  assert.equal(r.claimedTotal, 6000000000n);
  assert.equal(r.unclaimedTotal, 4000000000n);
  assert.equal(r.claimedShareBpsText, '6000.00');
});

test('a missing claim status defaults to unclaimed', () => {
  const r = modelHolderDistributionClaims({ pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000' }, { label: 'Holder B', balance: '300000' }, { label: 'Holder C', balance: '100000' }] });
  assert.deepEqual(r.holders.map(h => h.claimed), [false, false, false]);
  assert.equal(r.claimedTotal, 0n);
  assert.equal(r.unclaimedTotal, r.distributed);
  assert.equal(r.noneClaimed, true);
  const mixed = modelHolderDistributionClaims({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1' }] });
  assert.deepEqual(mixed.holders.map(h => h.claimed), [true, false]);
  assert.equal(mixed.claimedTotal, 50n);
  assert.equal(mixed.unclaimedTotal, 50n);
});

test('each holder\u2019s split is all or nothing: a claim pays the whole allocation, no claim pays none of it', () => {
  const r = modelHolderDistributionClaims({ pool: '123.456', decimals: 6, holders: [{ label: 'X', balance: '100', claimed: false }, { label: 'Y', balance: '50', claimed: true }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [82304000n, 41152000n]);
  assert.deepEqual(r.holders.map(h => h.paidOut), [0n, 41152000n]);
  assert.deepEqual(r.holders.map(h => h.unclaimedAmount), [82304000n, 0n]);
  assert.equal(r.claimedTotal, 41152000n);
  assert.equal(r.unclaimedTotal, 82304000n);
  assert.equal(r.claimedShareBpsText, '3333.33');
});

test('when nothing is distributed there is nothing to have claimed: allClaimed and noneClaimed are both false and the claimed share reads 0.00', () => {
  const r = modelHolderDistributionClaims({ pool: '1', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '100', claimed: true }] });
  assert.equal(r.distributed, 0n);
  assert.equal(r.claimedTotal, 0n);
  assert.equal(r.unclaimedTotal, 0n);
  assert.equal(r.undistributed, 1n);
  assert.equal(r.claimedShareBpsText, '0.00');
  assert.equal(r.allClaimed, false);
  assert.equal(r.noneClaimed, false);
  assert.equal(r.claimedTotal + r.unclaimedTotal + r.undistributed, r.pool);
});

test('a sole holder who claims is paid the whole pool; a sole holder who does not claim leaves the whole pool unclaimed', () => {
  const claimed = modelHolderDistributionClaims({ pool: '250', decimals: 0, holders: [{ label: 'Only', balance: '500', claimed: true }] });
  assert.equal(claimed.holders[0].allocated, 250n);
  assert.equal(claimed.claimedTotal, 250n);
  assert.equal(claimed.allClaimed, true);
  assert.equal(claimed.claimedShareBpsText, '10000.00');
  const unclaimed = modelHolderDistributionClaims({ pool: '250', decimals: 0, holders: [{ label: 'Only', balance: '500', claimed: false }] });
  assert.equal(unclaimed.claimedTotal, 0n);
  assert.equal(unclaimed.unclaimedTotal, 250n);
  assert.equal(unclaimed.noneClaimed, true);
});

test('five holders are modeled across the claim window, and labels are trimmed before they are told apart', () => {
  const r = modelHolderDistributionClaims({ pool: '1000', decimals: 0, holders: [{ label: ' A ', balance: '1', claimed: true }, { label: 'B', balance: '1', claimed: false }, { label: 'C', balance: '1', claimed: true }, { label: 'D', balance: '1', claimed: false }, { label: 'E', balance: '1', claimed: true }] });
  assert.equal(r.holders.length, 5);
  assert.equal(r.holders[0].label, 'A');
  assert.deepEqual(r.holders.map(h => h.allocated), [200n, 200n, 200n, 200n, 200n]);
  assert.equal(r.claimedTotal, 600n);
  assert.equal(r.unclaimedTotal, 400n);
  assert.equal(r.claimedShareBpsText, '6000.00');
  assert.equal(r.claimedCount, 3);
  assert.equal(r.unclaimedCount, 2);
});

test('the identities hold across designs, and the claimed share is always the claimed amount over the distributed amount', () => {
  const inputs = [
    DEFAULT,
    { pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1', claimed: true }, { label: 'C', balance: '1', claimed: false }] },
    { pool: '7', decimals: 0, holders: [{ label: 'A', balance: '2', claimed: true }, { label: 'B', balance: '3', claimed: false }, { label: 'C', balance: '2', claimed: true }] },
    { pool: '123.456', decimals: 6, holders: [{ label: 'X', balance: '100', claimed: false }, { label: 'Y', balance: '50', claimed: true }] },
    { pool: '100', decimals: 0, holders: [{ label: 'A', balance: '100', claimed: true }, { label: 'B', balance: '0', claimed: false }] },
    { pool: '1', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '100', claimed: true }] },
    { pool: '1000000', decimals: 6, holders: [{ label: 'A', balance: '1', claimed: false }, { label: 'B', balance: '0', claimed: true }, { label: 'C', balance: '999999', claimed: true }] },
  ];
  for (const input of inputs) {
    const r = modelHolderDistributionClaims(input);
    const at = JSON.stringify(input);
    assert.equal(r.claimedTotal + r.unclaimedTotal, r.distributed, at);
    assert.equal(r.claimedTotal + r.unclaimedTotal + r.undistributed, r.pool, at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.allocated, 0n), r.distributed, at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.paidOut, 0n), r.claimedTotal, at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.unclaimedAmount, 0n), r.unclaimedTotal, at);
    assert.equal(r.claimedCount + r.unclaimedCount, r.holders.length, at);
    for (const h of r.holders) {
      assert.equal(h.paidOut + h.unclaimedAmount, h.allocated, at);
      assert.equal(h.paidOut, h.claimed ? h.allocated : 0n, at);
    }
    if (r.distributed > 0n) {
      const hundredths = r.claimedTotal * 1000000n / r.distributed;
      assert.equal(r.claimedShareBpsText, `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`, at);
    } else {
      assert.equal(r.claimedShareBpsText, '0.00', at);
    }
    assert.equal(r.allClaimed, r.distributed > 0n && r.holders.filter(h => h.allocated > 0n).every(h => h.claimed), at);
    assert.equal(r.noneClaimed, r.claimedTotal === 0n && r.distributed > 0n, at);
  }
});

test('beyond float range: the claim split stays exact where a double would lose a base unit', () => {
  const r = modelHolderDistributionClaims({ pool: '9007199254740993', decimals: 0, holders: [{ label: 'X', balance: '2000000000000000', claimed: true }, { label: 'Y', balance: '1000000000000000', claimed: false }] });
  assert.deepEqual(r.holders.map(h => h.allocated), [6004799503160662n, 3002399751580331n]);
  assert.equal(r.distributed, 9007199254740993n);
  assert.equal(r.claimedTotal, 6004799503160662n);
  assert.equal(r.unclaimedTotal, 3002399751580331n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.claimedTotal + r.unclaimedTotal + r.undistributed, r.pool);
  assert.equal(r.claimedShareBpsText, '6666.66');
});

test('validation: a claim status stated as anything but a boolean is refused with its own message, naming the holder', () => {
  assert.throws(() => modelHolderDistributionClaims({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: 'yes' }] }), /Holder 1's claim status must be stated as claimed or unclaimed\./);
  assert.throws(() => modelHolderDistributionClaims({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }, { label: 'B', balance: '1', claimed: 1 }] }), /Holder 2's claim status must be stated as claimed or unclaimed\./);
  assert.throws(() => modelHolderDistributionClaims({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: null }] }), /Holder 1's claim status must be stated as claimed or unclaimed\./);
});

test('validation: the base distribution\u2019s refusals propagate unchanged', () => {
  assert.throws(() => modelHolderDistributionClaims({ pool: '100', decimals: 0, holders: [] }), /At least one holder is required to model a holder distribution\./);
  const six = [1, 2, 3, 4, 5, 6].map(n => ({ label: `H${n}`, balance: '1', claimed: true }));
  assert.throws(() => modelHolderDistributionClaims({ pool: '100', decimals: 0, holders: six }), /A holder distribution models at most five holders at a time\./);
  assert.throws(() => modelHolderDistributionClaims({ pool: '100', decimals: 0, holders: [{ label: '  ', balance: '1', claimed: true }] }), /Holder 1 needs a label so its share can be told apart from the others\./);
  assert.throws(() => modelHolderDistributionClaims({ pool: '100', decimals: 0, holders: [{ label: 'Holder A', balance: '1', claimed: true }, { label: 'holder a', balance: '2', claimed: false }] }), /Duplicate holder label: holder a\. Each holder in the distribution needs its own label\./);
  assert.throws(() => modelHolderDistributionClaims({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '0', claimed: true }] }), /Total holder balance must be greater than zero\./);
  assert.throws(() => modelHolderDistributionClaims({ pool: '0', decimals: 0, holders: [{ label: 'A', balance: '1', claimed: true }] }), /Distribution pool must be greater than zero\./);
});

test('decimals default to 6 when none are entered', () => {
  const r = modelHolderDistributionClaims({ pool: '10000', holders: [{ label: 'Holder A', balance: '600000', claimed: true }, { label: 'Holder B', balance: '300000', claimed: true }, { label: 'Holder C', balance: '100000', claimed: false }] });
  assert.equal(r.decimals, 6);
  assert.equal(r.claimedTotal, 9000000000n);
  assert.equal(r.unclaimedTotal, 1000000000n);
  assert.equal(r.claimedShareBpsText, '9000.00');
});

test('wiring: app.js imports the model, renders a distribution-claims panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelHolderDistributionClaims/);
  assert.match(app, /data-dclaim/);
  assert.match(app, /distribution-claims-output/);
  assert.match(app, /v1\.157/);
  assert.match(readme, /Holder distribution claim-window model/);
});
