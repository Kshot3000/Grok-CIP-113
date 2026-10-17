import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelHolderDistribution } from '../src/domain.js';

// Pro-rata holder distribution model (v1.238): a pool divided by
// HOLDINGS — shares derived from balances, never entered, unlike
// the revenue split (v1.133), which divides by entered percentage
// shares — with per-holder flooring that leaves dust belonging to
// no holder, and distributed + undistributed === pool always.
const DEFAULT = { pool: '10000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000' }, { label: 'Holder B', balance: '300000' }, { label: 'Holder C', balance: '100000' }] };

test('the preloaded distribution: a 10000 pool divided 60/30/10 by holdings pays 6000, 3000, and 1000 with no dust', () => {
  const r = modelHolderDistribution(DEFAULT);
  assert.equal(r.pool, 10000000000n);
  assert.equal(r.totalBalances, 1000000000000n);
  assert.deepEqual(r.holders.map(h => h.label), ['Holder A', 'Holder B', 'Holder C']);
  assert.deepEqual(r.holders.map(h => h.receives), [6000000000n, 3000000000n, 1000000000n]);
  assert.deepEqual(r.holders.map(h => h.holdingShareBpsText), ['6000.00', '3000.00', '1000.00']);
  assert.equal(r.distributed, 10000000000n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.distributed + r.undistributed, r.pool);
  assert.equal(r.soleHolder, false);
  assert.equal(r.hasDust, false);
});

test('equal holdings split a pool of 10 three ways by flooring: each receives 3, one base unit is left as dust', () => {
  const r = modelHolderDistribution({ pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] });
  assert.deepEqual(r.holders.map(h => h.receives), [3n, 3n, 3n]);
  assert.equal(r.distributed, 9n);
  assert.equal(r.undistributed, 1n);
  assert.equal(r.distributed + r.undistributed, r.pool);
  assert.equal(r.hasDust, true);
  assert.equal(r.soleHolder, false);
});

test('the holding share is derived from the balances, never from the receives', () => {
  const r = modelHolderDistribution({ pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] });
  // Each receive is 3 of 10 (3000.00 by amount received), but each
  // holding is 1 of 3 — the share the distribution is priced on.
  assert.deepEqual(r.holders.map(h => h.holdingShareBpsText), ['3333.33', '3333.33', '3333.33']);
});

test('a zero-balance holder receives zero and holds a zero share, and the others divide the whole pool', () => {
  const r = modelHolderDistribution({ pool: '100', decimals: 0, holders: [{ label: 'A', balance: '3' }, { label: 'B', balance: '1' }, { label: 'Empty', balance: '0' }] });
  assert.deepEqual(r.holders.map(h => h.receives), [75n, 25n, 0n]);
  assert.equal(r.holders[2].holdingShareBpsText, '0.00');
  assert.equal(r.distributed, 100n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.soleHolder, false);
});

test('a sole holder receives the whole pool exactly, with no dust', () => {
  const r = modelHolderDistribution({ pool: '250', decimals: 0, holders: [{ label: 'Only', balance: '500' }] });
  assert.equal(r.holders[0].receives, 250n);
  assert.equal(r.holders[0].holdingShareBpsText, '10000.00');
  assert.equal(r.distributed, 250n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.soleHolder, true);
  assert.equal(r.hasDust, false);
});

test('sole holder among zero balances: one holder holding the whole total receives the whole pool', () => {
  const r = modelHolderDistribution({ pool: '99', decimals: 0, holders: [{ label: 'A', balance: '0' }, { label: 'B', balance: '7' }, { label: 'C', balance: '0' }] });
  assert.deepEqual(r.holders.map(h => h.receives), [0n, 99n, 0n]);
  assert.equal(r.soleHolder, true);
  assert.equal(r.undistributed, 0n);
});

test('accounting identity across designs: distributed + undistributed is the pool, and the dust is always less than the holder count', () => {
  const inputs = [
    DEFAULT,
    { pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] },
    { pool: '123.456', decimals: 6, holders: [{ label: 'X', balance: '100' }, { label: 'Y', balance: '50' }] },
    { pool: '7', decimals: 0, holders: [{ label: 'A', balance: '2' }, { label: 'B', balance: '3' }, { label: 'C', balance: '5' }, { label: 'D', balance: '11' }] },
    { pool: '1000000', decimals: 6, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '0' }, { label: 'C', balance: '999999' }] },
    { pool: '1', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }] },
  ];
  for (const input of inputs) {
    const r = modelHolderDistribution(input);
    const at = JSON.stringify(input);
    assert.equal(r.distributed + r.undistributed, r.pool, at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.receives, 0n), r.distributed, at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.balance, 0n), r.totalBalances, at);
    assert.ok(r.undistributed >= 0n && r.undistributed < BigInt(input.holders.length), at);
    assert.equal(r.hasDust, r.undistributed > 0n, at);
    for (const h of r.holders) assert.equal(h.receives, r.pool * h.balance / r.totalBalances, at);
  }
});

test('beyond float range: the division stays exact where a double would lose a base unit', () => {
  const r = modelHolderDistribution({ pool: '9007199254740993', decimals: 0, holders: [{ label: 'X', balance: '2000000000000000' }, { label: 'Y', balance: '1000000000000000' }] });
  assert.equal(r.pool, 9007199254740993n);
  assert.equal(r.holders[0].receives, 6004799503160662n); // A double rounds the pool to ...992 first and floors this to ...661.
  assert.equal(r.holders[1].receives, 3002399751580331n);
  assert.deepEqual(r.holders.map(h => h.holdingShareBpsText), ['6666.66', '3333.33']);
  assert.equal(r.distributed + r.undistributed, r.pool);
  assert.equal(r.undistributed, 0n);
});

test('a fractional pool divided by fractional holdings prices exact base units', () => {
  const r = modelHolderDistribution({ pool: '123.456', decimals: 6, holders: [{ label: 'X', balance: '100' }, { label: 'Y', balance: '50' }] });
  assert.equal(r.pool, 123456000n);
  assert.deepEqual(r.holders.map(h => h.receives), [82304000n, 41152000n]);
  assert.equal(r.undistributed, 0n);
});

test('five holders are modeled, and labels are trimmed before they are told apart', () => {
  const r = modelHolderDistribution({ pool: '1000', decimals: 0, holders: [{ label: ' A ', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }, { label: 'D', balance: '1' }, { label: 'E', balance: '1' }] });
  assert.equal(r.holders.length, 5);
  assert.equal(r.holders[0].label, 'A');
  assert.deepEqual(r.holders.map(h => h.receives), [200n, 200n, 200n, 200n, 200n]);
});

test('decimals default to 6 when none are entered', () => {
  const r = modelHolderDistribution({ pool: '10000', holders: DEFAULT.holders });
  assert.equal(r.decimals, 6);
  assert.deepEqual(r.holders.map(h => h.receives), [6000000000n, 3000000000n, 1000000000n]);
});

test('validation: an empty or missing holder list is refused', () => {
  assert.throws(() => modelHolderDistribution({ pool: '10', decimals: 0, holders: [] }), /At least one holder is required to model a holder distribution\./);
  assert.throws(() => modelHolderDistribution({ pool: '10', decimals: 0 }), /At least one holder is required to model a holder distribution\./);
});

test('validation: more than five holders are refused', () => {
  const six = [1, 2, 3, 4, 5, 6].map(n => ({ label: `H${n}`, balance: '1' }));
  assert.throws(() => modelHolderDistribution({ pool: '10', decimals: 0, holders: six }), /A holder distribution models at most five holders at a time\./);
});

test('validation: a blank label and a missing entry are refused with their own messages', () => {
  assert.throws(() => modelHolderDistribution({ pool: '10', decimals: 0, holders: [{ label: '  ', balance: '1' }] }), /Holder 1 needs a label so its share can be told apart from the others\./);
  assert.throws(() => modelHolderDistribution({ pool: '10', decimals: 0, holders: [null] }), /Holder 1 needs its own label and balance\./);
});

test('validation: duplicate labels are refused case-insensitively', () => {
  assert.throws(() => modelHolderDistribution({ pool: '10', decimals: 0, holders: [{ label: 'Holder A', balance: '1' }, { label: 'holder a', balance: '2' }] }), /Duplicate holder label: holder a\. Each holder in the distribution needs its own label\./);
});

test('validation: all-zero balances and a zero pool are refused with their own messages, and a negative pool is refused by the amount layer', () => {
  assert.throws(() => modelHolderDistribution({ pool: '10', decimals: 0, holders: [{ label: 'A', balance: '0' }, { label: 'B', balance: '0' }] }), /Total holder balance must be greater than zero\./);
  assert.throws(() => modelHolderDistribution({ pool: '0', decimals: 0, holders: [{ label: 'A', balance: '1' }] }), /Distribution pool must be greater than zero\./);
  assert.throws(() => modelHolderDistribution({ pool: '-5', decimals: 0, holders: [{ label: 'A', balance: '1' }] }), /positive decimal amount/);
  assert.throws(() => modelHolderDistribution({ pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1.5' }] }), /decimal places/);
});

test('wiring: app.js imports the model, renders a distribution panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelHolderDistribution/);
  assert.match(app, /data-dist/);
  assert.match(app, /distribution-output/);
  assert.match(app, /v1\.238/);
  assert.match(readme, /Holder distribution model/);
});
