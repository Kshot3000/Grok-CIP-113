import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelMinimumHolderDistribution, modelHolderDistribution } from '../src/domain.js';

// Minimum-guarantee holder distribution model (v1.267): the holder
// distribution (v1.145) divides a pool by holdings with no limit,
// and the capped distribution (v1.146) caps what any one holder
// may receive; this model does the opposite — it GUARANTEES each
// eligible holder a minimum first, then divides what remains
// pro-rata by holdings. The guarantees are reserved first, they
// are feasible only if minimum × eligible count fits in the pool,
// and only holders who actually hold are eligible: a zero-balance
// holder receives zero and is guaranteed nothing. Distributed +
// undistributed === pool always, and the undistributed remainder
// is floor dust from the remainder division only.
const DEFAULT = { pool: '10000', minimum: '500', decimals: 6, holders: [{ label: 'Holder A', balance: '600000' }, { label: 'Holder B', balance: '300000' }, { label: 'Holder C', balance: '100000' }] };

test('the preloaded minimum distribution: a 10000 pool with a 500 minimum pays 5600, 3050, and 1350', () => {
  const r = modelMinimumHolderDistribution(DEFAULT);
  assert.equal(r.pool, 10000000000n);
  assert.equal(r.minimum, 500000000n);
  assert.equal(r.totalBalances, 1000000000000n);
  assert.equal(r.eligibleCount, 3);
  assert.equal(r.guaranteeTotal, 1500000000n);
  assert.equal(r.remainderPool, 8500000000n);
  assert.deepEqual(r.holders.map(h => h.guaranteed), [500000000n, 500000000n, 500000000n]);
  assert.deepEqual(r.holders.map(h => h.proRata), [5100000000n, 2550000000n, 850000000n]);
  assert.deepEqual(r.holders.map(h => h.receives), [5600000000n, 3050000000n, 1350000000n]);
  assert.deepEqual(r.holders.map(h => h.eligible), [true, true, true]);
  assert.deepEqual(r.holders.map(h => h.holdingShareBpsText), ['6000.00', '3000.00', '1000.00']);
  assert.equal(r.distributed, 10000000000n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.distributed + r.undistributed, r.pool);
});

test('the guarantee is reserved first: the pro-rata shares are priced on the remainder pool, never on the whole pool', () => {
  const r = modelMinimumHolderDistribution(DEFAULT);
  const plain = modelHolderDistribution({ pool: '10000', decimals: 6, holders: DEFAULT.holders });
  // Holder C's uncapped share of the whole pool is 1000; priced on
  // the 8500 remainder it is 850, and the 500 guarantee on top of
  // it is what lifts the smallest holder to 1350.
  assert.equal(plain.holders[2].receives, 1000000000n);
  assert.equal(r.holders[2].proRata, 850000000n);
  assert.equal(r.holders[2].receives, 1350000000n);
  assert.ok(r.holders[2].receives > plain.holders[2].receives);
});

test('the remainder division leaves floor dust only: a pool of 10 with a minimum of 2 over three equal holdings pays 3 each and leaves 1', () => {
  const r = modelMinimumHolderDistribution({ pool: '10', minimum: '2', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] });
  assert.equal(r.guaranteeTotal, 6n);
  assert.equal(r.remainderPool, 4n);
  assert.deepEqual(r.holders.map(h => h.proRata), [1n, 1n, 1n]);
  assert.deepEqual(r.holders.map(h => h.receives), [3n, 3n, 3n]);
  assert.equal(r.distributed, 9n);
  assert.equal(r.undistributed, 1n); // Dust from flooring the remainder division: less than the eligible count of 3.
  assert.ok(r.undistributed < BigInt(r.eligibleCount));
});

test('a zero-balance holder receives zero and is guaranteed nothing', () => {
  const r = modelMinimumHolderDistribution({ pool: '100', minimum: '10', decimals: 0, holders: [{ label: 'A', balance: '100' }, { label: 'B', balance: '0' }] });
  assert.equal(r.eligibleCount, 1);
  assert.equal(r.guaranteeTotal, 10n);
  assert.equal(r.remainderPool, 90n);
  assert.deepEqual(r.holders.map(h => h.eligible), [true, false]);
  assert.deepEqual(r.holders.map(h => h.guaranteed), [10n, 0n]);
  assert.deepEqual(r.holders.map(h => h.proRata), [90n, 0n]);
  assert.deepEqual(r.holders.map(h => h.receives), [100n, 0n]);
  assert.equal(r.holders[1].holdingShareBpsText, '0.00');
  assert.equal(r.distributed, 100n);
  assert.equal(r.undistributed, 0n);
});

test('a minimum of zero reproduces the uncapped division exactly', () => {
  const floored = modelMinimumHolderDistribution({ pool: '10', minimum: '0', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] });
  const plain = modelHolderDistribution({ pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] });
  assert.equal(floored.guaranteeTotal, 0n);
  assert.equal(floored.remainderPool, floored.pool);
  assert.deepEqual(floored.holders.map(h => h.receives), plain.holders.map(h => h.receives));
  assert.equal(floored.undistributed, plain.undistributed);
  const big = modelMinimumHolderDistribution({ pool: '10000', minimum: '0', decimals: 6, holders: DEFAULT.holders });
  assert.deepEqual(big.holders.map(h => h.receives), [6000000000n, 3000000000n, 1000000000n]);
});

test('an infeasible guarantee is refused: a minimum of 4 for three eligible holders cannot fit in a pool of 10', () => {
  assert.throws(() => modelMinimumHolderDistribution({ pool: '10', minimum: '4', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] }), /Per-holder minimum times the eligible holder count exceeds the pool\./);
});

test('a guarantee that exactly fills the pool is feasible: the remainder is zero and each eligible holder receives only the minimum', () => {
  const r = modelMinimumHolderDistribution({ pool: '6', minimum: '2', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] });
  assert.equal(r.guaranteeTotal, 6n);
  assert.equal(r.remainderPool, 0n);
  assert.deepEqual(r.holders.map(h => h.proRata), [0n, 0n, 0n]);
  assert.deepEqual(r.holders.map(h => h.receives), [2n, 2n, 2n]);
  assert.equal(r.distributed, 6n);
  assert.equal(r.undistributed, 0n);
});

test('the holding share is derived from the balances, never from the guaranteed receives', () => {
  const r = modelMinimumHolderDistribution(DEFAULT);
  // Holder C receives 1350 of 10000 (1350.00 by amount received),
  // but holds 100000 of 1000000 — the share the division priced.
  assert.equal(r.holders[2].receives, 1350000000n);
  assert.equal(r.holders[2].holdingShareBpsText, '1000.00');
});

test('every eligible holder receives at least the minimum, and the identity and dust bound hold across designs', () => {
  const inputs = [
    DEFAULT,
    { pool: '10', minimum: '2', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] },
    { pool: '7', minimum: '1', decimals: 0, holders: [{ label: 'A', balance: '2' }, { label: 'B', balance: '3' }, { label: 'C', balance: '5' }, { label: 'D', balance: '11' }] },
    { pool: '123.456', minimum: '10', decimals: 6, holders: [{ label: 'X', balance: '100' }, { label: 'Y', balance: '50' }] },
    { pool: '100', minimum: '10', decimals: 0, holders: [{ label: 'A', balance: '100' }, { label: 'B', balance: '0' }] },
    { pool: '1', minimum: '0', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }] },
    { pool: '1000000', minimum: '999', decimals: 6, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '0' }, { label: 'C', balance: '999999' }] },
  ];
  for (const input of inputs) {
    const r = modelMinimumHolderDistribution(input);
    const at = JSON.stringify(input);
    assert.equal(r.distributed + r.undistributed, r.pool, at);
    assert.equal(r.guaranteeTotal + r.remainderPool, r.pool, at);
    assert.equal(r.guaranteeTotal, r.minimum * BigInt(r.eligibleCount), at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.receives, 0n), r.distributed, at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.balance, 0n), r.totalBalances, at);
    assert.ok(r.undistributed >= 0n && r.undistributed < BigInt(r.eligibleCount), at);
    for (const h of r.holders) {
      assert.equal(h.receives, h.guaranteed + h.proRata, at);
      if (h.eligible) assert.ok(h.receives >= r.minimum, at);
      if (h.balance === 0n) {
        assert.equal(h.eligible, false, at);
        assert.equal(h.guaranteed, 0n, at);
        assert.equal(h.receives, 0n, at);
      }
    }
    assert.equal(r.eligibleCount, r.holders.filter(h => h.eligible).length, at);
  }
});

test('beyond float range: the guaranteed division stays exact where a double would lose a base unit', () => {
  const r = modelMinimumHolderDistribution({ pool: '9007199254740993', minimum: '1', decimals: 0, holders: [{ label: 'X', balance: '2000000000000000' }, { label: 'Y', balance: '1000000000000000' }] });
  assert.equal(r.guaranteeTotal, 2n);
  assert.equal(r.remainderPool, 9007199254740991n);
  assert.deepEqual(r.holders.map(h => h.receives), [6004799503160661n, 3002399751580331n]);
  assert.equal(r.distributed + r.undistributed, r.pool);
  assert.equal(r.undistributed, 1n);
});

test('a fractional pool under a fractional minimum prices exact base units', () => {
  const r = modelMinimumHolderDistribution({ pool: '123.456', minimum: '10', decimals: 6, holders: [{ label: 'X', balance: '100' }, { label: 'Y', balance: '50' }] });
  assert.equal(r.pool, 123456000n);
  assert.equal(r.minimum, 10000000n);
  assert.equal(r.guaranteeTotal, 20000000n);
  assert.equal(r.remainderPool, 103456000n);
  assert.deepEqual(r.holders.map(h => h.receives), [78970666n, 44485333n]);
  assert.equal(r.undistributed, 1n);
});

test('a sole holder receives the whole pool: the minimum plus the whole remainder', () => {
  const r = modelMinimumHolderDistribution({ pool: '250', minimum: '25', decimals: 0, holders: [{ label: 'Only', balance: '500' }] });
  assert.equal(r.eligibleCount, 1);
  assert.equal(r.holders[0].guaranteed, 25n);
  assert.equal(r.holders[0].proRata, 225n);
  assert.equal(r.holders[0].receives, 250n);
  assert.equal(r.holders[0].holdingShareBpsText, '10000.00');
  assert.equal(r.distributed, 250n);
  assert.equal(r.undistributed, 0n);
});

test('five holders are modeled under a guarantee, and labels are trimmed before they are told apart', () => {
  const r = modelMinimumHolderDistribution({ pool: '1000', minimum: '100', decimals: 0, holders: [{ label: ' A ', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }, { label: 'D', balance: '1' }, { label: 'E', balance: '1' }] });
  assert.equal(r.holders.length, 5);
  assert.equal(r.holders[0].label, 'A');
  assert.equal(r.guaranteeTotal, 500n);
  assert.deepEqual(r.holders.map(h => h.receives), [200n, 200n, 200n, 200n, 200n]);
  assert.equal(r.undistributed, 0n);
});

test('decimals default to 6 when none are entered, and an entered minimum defaults to zero', () => {
  const r = modelMinimumHolderDistribution({ pool: '10000', minimum: '500', holders: DEFAULT.holders });
  assert.equal(r.decimals, 6);
  assert.deepEqual(r.holders.map(h => h.receives), [5600000000n, 3050000000n, 1350000000n]);
  const noMinimum = modelMinimumHolderDistribution({ pool: '10', decimals: 0, holders: [{ label: 'A', balance: '1' }] });
  assert.equal(noMinimum.minimum, 0n);
  assert.equal(noMinimum.holders[0].receives, 10n);
});

test('validation: a negative minimum is refused with its own message', () => {
  assert.throws(() => modelMinimumHolderDistribution({ pool: '10', minimum: '-5', decimals: 0, holders: [{ label: 'A', balance: '1' }] }), /Per-holder minimum cannot be negative\./);
  assert.throws(() => modelMinimumHolderDistribution({ pool: '10', minimum: '-0.5', decimals: 6, holders: [{ label: 'A', balance: '1' }] }), /Per-holder minimum cannot be negative\./);
});

test('validation: the holder rules of the uncapped model carry over unchanged', () => {
  assert.throws(() => modelMinimumHolderDistribution({ pool: '10', minimum: '1', decimals: 0, holders: [] }), /At least one holder is required to model a holder distribution\./);
  const six = [1, 2, 3, 4, 5, 6].map(n => ({ label: `H${n}`, balance: '1' }));
  assert.throws(() => modelMinimumHolderDistribution({ pool: '10', minimum: '1', decimals: 0, holders: six }), /A holder distribution models at most five holders at a time\./);
  assert.throws(() => modelMinimumHolderDistribution({ pool: '10', minimum: '1', decimals: 0, holders: [{ label: '  ', balance: '1' }] }), /Holder 1 needs a label so its share can be told apart from the others\./);
  assert.throws(() => modelMinimumHolderDistribution({ pool: '10', minimum: '1', decimals: 0, holders: [{ label: 'Holder A', balance: '1' }, { label: 'holder a', balance: '2' }] }), /Duplicate holder label: holder a\. Each holder in the distribution needs its own label\./);
  assert.throws(() => modelMinimumHolderDistribution({ pool: '10', minimum: '1', decimals: 0, holders: [{ label: 'A', balance: '0' }] }), /Total holder balance must be greater than zero\./);
  assert.throws(() => modelMinimumHolderDistribution({ pool: '0', minimum: '1', decimals: 0, holders: [{ label: 'A', balance: '1' }] }), /Distribution pool must be greater than zero\./);
});

test('wiring: app.js imports the model, renders a minimum distribution panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelMinimumHolderDistribution/);
  assert.match(app, /data-mindist/);
  assert.match(app, /minimum-distribution-output/);
  assert.match(app, /v1\.267/);
  assert.match(readme, /Minimum-guarantee holder distribution model/);
});
