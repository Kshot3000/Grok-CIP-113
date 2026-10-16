import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelCappedHolderDistribution, modelHolderDistribution } from '../src/domain.js';

// Capped pro-rata holder distribution model (v1.212): the holder
// distribution (v1.145) divides a pool by holdings with no limit;
// this model caps what any one holder may receive and divides
// what the cap holds back again among the holders still under
// it, round by round — water-filling. When every holder is at
// the cap, the remainder is cap-blocked, not floor dust, and
// distributed + undistributed === pool always.
const DEFAULT = { pool: '10000', cap: '4000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000' }, { label: 'Holder B', balance: '300000' }, { label: 'Holder C', balance: '100000' }] };

test('the preloaded capped distribution: a 10000 pool capped at 4000 per holder pays 4000, 4000, and 2000 over 3 rounds', () => {
  const r = modelCappedHolderDistribution(DEFAULT);
  assert.equal(r.pool, 10000000000n);
  assert.equal(r.cap, 4000000000n);
  assert.equal(r.totalBalances, 1000000000000n);
  assert.deepEqual(r.holders.map(h => h.receives), [4000000000n, 4000000000n, 2000000000n]);
  assert.deepEqual(r.holders.map(h => h.capped), [true, true, false]);
  assert.deepEqual(r.holders.map(h => h.holdingShareBpsText), ['6000.00', '3000.00', '1000.00']);
  assert.equal(r.distributed, 10000000000n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.distributed + r.undistributed, r.pool);
  assert.equal(r.cappedCount, 2);
  assert.equal(r.allCapped, false);
  assert.equal(r.rounds, 3);
});

test('the redistribution is priced round by round: the largest holder caps first, then the next, and the smallest takes what is left', () => {
  const r = modelCappedHolderDistribution({ pool: '1000', cap: '400', decimals: 0, holders: [{ label: 'A', balance: '600' }, { label: 'B', balance: '300' }, { label: 'C', balance: '100' }] });
  // Uncapped this pool pays 600/300/100. Round 1 caps A at 400;
  // round 2 prices the remaining 200 over B and C at 3:1, so B
  // takes 100 more and reaches the cap while C takes 50; round 3
  // gives C the last 50. Final: 400/400/200.
  assert.deepEqual(r.holders.map(h => h.receives), [400n, 400n, 200n]);
  assert.equal(r.rounds, 3);
  assert.equal(r.cappedCount, 2);
  assert.equal(r.distributed, 1000n);
  assert.equal(r.undistributed, 0n);
});

test('when every holder is at the cap, the remainder is cap-blocked and can be most of the pool — it is not dust', () => {
  const r = modelCappedHolderDistribution({ pool: '1000', cap: '100', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] });
  assert.deepEqual(r.holders.map(h => h.receives), [100n, 100n, 100n]);
  assert.equal(r.distributed, 300n);
  assert.equal(r.undistributed, 700n); // Far past the < holder-count dust bound of the uncapped model.
  assert.equal(r.allCapped, true);
  assert.equal(r.cappedCount, 3);
  assert.equal(r.rounds, 1);
  assert.equal(r.distributed + r.undistributed, r.pool);
});

test('a cap no share reaches changes nothing: the division is the uncapped one, dust included', () => {
  const capped = modelCappedHolderDistribution({ pool: '10', cap: '4', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] });
  const plain = modelHolderDistribution({ pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] });
  assert.deepEqual(capped.holders.map(h => h.receives), plain.holders.map(h => h.receives));
  assert.equal(capped.undistributed, plain.undistributed);
  assert.equal(capped.cappedCount, 0);
  assert.equal(capped.allCapped, false);
  assert.equal(capped.rounds, 1);
});

test('a share that lands exactly on the cap is at the cap, and the pool still divides in full', () => {
  const r = modelCappedHolderDistribution({ pool: '100', cap: '50', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }] });
  assert.deepEqual(r.holders.map(h => h.receives), [50n, 50n]);
  assert.deepEqual(r.holders.map(h => h.capped), [true, true]);
  assert.equal(r.allCapped, true);
  assert.equal(r.undistributed, 0n); // allCapped with nothing left: the cap blocked nothing in the end.
  assert.equal(r.rounds, 1);
});

test('a zero-balance holder receives zero and is never capped, while the holders with balances cap out', () => {
  const r = modelCappedHolderDistribution({ pool: '100', cap: '40', decimals: 0, holders: [{ label: 'A', balance: '3' }, { label: 'B', balance: '1' }, { label: 'Empty', balance: '0' }] });
  assert.deepEqual(r.holders.map(h => h.receives), [40n, 40n, 0n]);
  assert.deepEqual(r.holders.map(h => h.capped), [true, true, false]);
  assert.equal(r.holders[2].holdingShareBpsText, '0.00');
  assert.equal(r.allCapped, true); // Every holder WITH a balance is at the cap; the zero-balance holder holds nothing to cap.
  assert.equal(r.undistributed, 20n);
  assert.equal(r.rounds, 2);
});

test('the holding share is derived from the balances, never from the capped receives', () => {
  const r = modelCappedHolderDistribution(DEFAULT);
  // Holder A receives 4000 of 10000 (4000.00 by amount received),
  // but holds 600000 of 1000000 — the share the division priced.
  assert.equal(r.holders[0].receives, 4000000000n);
  assert.equal(r.holders[0].holdingShareBpsText, '6000.00');
});

test('no holder ever receives more than the cap, and the identity holds across designs', () => {
  const inputs = [
    DEFAULT,
    { pool: '1000', cap: '400', decimals: 0, holders: [{ label: 'A', balance: '600' }, { label: 'B', balance: '300' }, { label: 'C', balance: '100' }] },
    { pool: '1000', cap: '100', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] },
    { pool: '7', cap: '2', decimals: 0, holders: [{ label: 'A', balance: '2' }, { label: 'B', balance: '3' }, { label: 'C', balance: '5' }, { label: 'D', balance: '11' }] },
    { pool: '123.456', cap: '50', decimals: 6, holders: [{ label: 'X', balance: '100' }, { label: 'Y', balance: '50' }] },
    { pool: '1', cap: '1', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }] },
    { pool: '1000000', cap: '999999', decimals: 6, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '0' }, { label: 'C', balance: '999999' }] },
  ];
  for (const input of inputs) {
    const r = modelCappedHolderDistribution(input);
    const at = JSON.stringify(input);
    assert.equal(r.distributed + r.undistributed, r.pool, at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.receives, 0n), r.distributed, at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.balance, 0n), r.totalBalances, at);
    for (const h of r.holders) {
      assert.ok(h.receives <= r.cap, at);
      assert.equal(h.capped, h.receives === r.cap, at);
      if (h.balance === 0n) assert.equal(h.receives, 0n, at);
    }
    assert.equal(r.cappedCount, r.holders.filter(h => h.capped).length, at);
    assert.ok(r.rounds >= 1 && r.rounds <= input.holders.length, at);
  }
});

test('beyond float range: the capped division stays exact where a double would lose a base unit', () => {
  const r = modelCappedHolderDistribution({ pool: '9007199254740993', cap: '5000000000000000', decimals: 0, holders: [{ label: 'X', balance: '2000000000000000' }, { label: 'Y', balance: '1000000000000000' }] });
  assert.equal(r.holders[0].receives, 5000000000000000n); // Capped exactly.
  assert.equal(r.holders[1].receives, 4007199254740993n); // The whole remainder, base-unit exact past 2^53.
  assert.equal(r.distributed + r.undistributed, r.pool);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.rounds, 2);
});

test('a fractional pool under a fractional cap prices exact base units, and both holders cap out', () => {
  const r = modelCappedHolderDistribution({ pool: '123.456', cap: '50', decimals: 6, holders: [{ label: 'X', balance: '100' }, { label: 'Y', balance: '50' }] });
  assert.equal(r.pool, 123456000n);
  assert.equal(r.cap, 50000000n);
  assert.deepEqual(r.holders.map(h => h.receives), [50000000n, 50000000n]);
  assert.equal(r.undistributed, 23456000n);
  assert.equal(r.allCapped, true);
  assert.equal(r.rounds, 2);
});

test('a sole holder under a cap receives the cap and the rest stays undistributed', () => {
  const r = modelCappedHolderDistribution({ pool: '250', cap: '100', decimals: 0, holders: [{ label: 'Only', balance: '500' }] });
  assert.equal(r.holders[0].receives, 100n);
  assert.equal(r.holders[0].capped, true);
  assert.equal(r.holders[0].holdingShareBpsText, '10000.00');
  assert.equal(r.distributed, 100n);
  assert.equal(r.undistributed, 150n);
  assert.equal(r.allCapped, true);
  assert.equal(r.rounds, 1);
});

test('a cap at or above the pool never binds a sole holder: the whole pool is received', () => {
  const r = modelCappedHolderDistribution({ pool: '250', cap: '250', decimals: 0, holders: [{ label: 'Only', balance: '500' }] });
  assert.equal(r.holders[0].receives, 250n);
  assert.equal(r.undistributed, 0n);
});

test('five holders are modeled under a cap, and labels are trimmed before they are told apart', () => {
  const r = modelCappedHolderDistribution({ pool: '1000', cap: '150', decimals: 0, holders: [{ label: ' A ', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }, { label: 'D', balance: '1' }, { label: 'E', balance: '1' }] });
  assert.equal(r.holders.length, 5);
  assert.equal(r.holders[0].label, 'A');
  assert.deepEqual(r.holders.map(h => h.receives), [150n, 150n, 150n, 150n, 150n]);
  assert.equal(r.undistributed, 250n);
  assert.equal(r.allCapped, true);
});

test('decimals default to 6 when none are entered', () => {
  const r = modelCappedHolderDistribution({ pool: '10000', cap: '4000', holders: DEFAULT.holders });
  assert.equal(r.decimals, 6);
  assert.deepEqual(r.holders.map(h => h.receives), [4000000000n, 4000000000n, 2000000000n]);
});

test('validation: a zero cap is refused with its own message, and a negative cap is refused by the amount layer', () => {
  assert.throws(() => modelCappedHolderDistribution({ pool: '10', cap: '0', decimals: 0, holders: [{ label: 'A', balance: '1' }] }), /Per-holder cap must be greater than zero\./);
  assert.throws(() => modelCappedHolderDistribution({ pool: '10', cap: '-5', decimals: 0, holders: [{ label: 'A', balance: '1' }] }), /positive decimal amount/);
  assert.throws(() => modelCappedHolderDistribution({ pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1' }] }), /Per-holder cap must be greater than zero\./);
});

test('validation: the holder rules of the uncapped model carry over unchanged', () => {
  assert.throws(() => modelCappedHolderDistribution({ pool: '10', cap: '5', decimals: 0, holders: [] }), /At least one holder is required to model a holder distribution\./);
  const six = [1, 2, 3, 4, 5, 6].map(n => ({ label: `H${n}`, balance: '1' }));
  assert.throws(() => modelCappedHolderDistribution({ pool: '10', cap: '5', decimals: 0, holders: six }), /A holder distribution models at most five holders at a time\./);
  assert.throws(() => modelCappedHolderDistribution({ pool: '10', cap: '5', decimals: 0, holders: [{ label: '  ', balance: '1' }] }), /Holder 1 needs a label so its share can be told apart from the others\./);
  assert.throws(() => modelCappedHolderDistribution({ pool: '10', cap: '5', decimals: 0, holders: [{ label: 'Holder A', balance: '1' }, { label: 'holder a', balance: '2' }] }), /Duplicate holder label: holder a\. Each holder in the distribution needs its own label\./);
  assert.throws(() => modelCappedHolderDistribution({ pool: '10', cap: '5', decimals: 0, holders: [{ label: 'A', balance: '0' }] }), /Total holder balance must be greater than zero\./);
  assert.throws(() => modelCappedHolderDistribution({ pool: '0', cap: '5', decimals: 0, holders: [{ label: 'A', balance: '1' }] }), /Distribution pool must be greater than zero\./);
});

test('wiring: app.js imports the model, renders a capped distribution panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelCappedHolderDistribution/);
  assert.match(app, /data-capdist/);
  assert.match(app, /capped-distribution-output/);
  assert.match(app, /v1\.212/);
  assert.match(readme, /Capped holder distribution model/);
});
