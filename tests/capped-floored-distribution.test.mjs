import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelCappedFlooredHolderDistribution, modelCappedHolderDistribution, modelMinimumHolderDistribution } from '../src/domain.js';

// Capped-and-floored holder distribution model (v1.233): both bounds
// of the distribution family at once — the minimum guarantee of the
// floored model (v1.147) reserved first, the remainder water-filled
// under each holder's cap room (cap − minimum) as in the capped
// model (v1.146). The interaction is the model: a cap below the
// minimum is contradictory and refused, every eligible holder
// receives at least the minimum and at most the cap, and the
// remainder is cap-blocked (not dust) when every eligible holder
// is at the cap. Distributed + undistributed === pool always.
const DEFAULT = { pool: '10000', minimum: '500', cap: '5000', decimals: 6, holders: [{ label: 'Holder A', balance: '600000' }, { label: 'Holder B', balance: '300000' }, { label: 'Holder C', balance: '100000' }] };
const HOLDERS = DEFAULT.holders;

test('the preloaded capped-and-floored distribution: a 10000 pool with a 500 minimum and a 5000 cap pays 5000, 3500, and 1500', () => {
  const r = modelCappedFlooredHolderDistribution(DEFAULT);
  assert.equal(r.pool, 10000000000n);
  assert.equal(r.minimum, 500000000n);
  assert.equal(r.cap, 5000000000n);
  assert.equal(r.totalBalances, 1000000000000n);
  assert.equal(r.eligibleCount, 3);
  assert.equal(r.guaranteeTotal, 1500000000n);
  assert.equal(r.remainderPool, 8500000000n);
  assert.deepEqual(r.holders.map(h => h.guaranteed), [500000000n, 500000000n, 500000000n]);
  assert.deepEqual(r.holders.map(h => h.proRata), [4500000000n, 3000000000n, 1000000000n]);
  assert.deepEqual(r.holders.map(h => h.receives), [5000000000n, 3500000000n, 1500000000n]);
  assert.deepEqual(r.holders.map(h => h.capped), [true, false, false]);
  assert.equal(r.cappedCount, 1);
  assert.equal(r.allCapped, false);
  assert.equal(r.rounds, 2);
  assert.deepEqual(r.holders.map(h => h.holdingShareBpsText), ['6000.00', '3000.00', '1000.00']);
  assert.equal(r.distributed, 10000000000n);
  assert.equal(r.undistributed, 0n);
  assert.equal(r.distributed + r.undistributed, r.pool);
});

test('the remainder is priced on the cap room, never the whole cap: the largest holder receives the minimum plus the room, exactly the cap', () => {
  const r = modelCappedFlooredHolderDistribution(DEFAULT);
  // Holder A's uncapped remainder share is 5100; priced against the
  // whole cap it would receive 500 + 5000 = 5500, past the cap.
  // Priced against the 4500 room it receives exactly 5000.
  assert.equal(r.holders[0].proRata, 4500000000n);
  assert.equal(r.holders[0].receives, r.cap);
  assert.ok(r.holders.every(h => h.receives <= r.cap));
});

test('the floor lifts the smallest holder against the capped model alone, at the middle holder\u2019s expense', () => {
  const both = modelCappedFlooredHolderDistribution(DEFAULT);
  const cappedOnly = modelCappedHolderDistribution({ pool: '10000', cap: '5000', decimals: 6, holders: HOLDERS });
  assert.deepEqual(cappedOnly.holders.map(h => h.receives), [5000000000n, 3750000000n, 1250000000n]);
  assert.deepEqual(both.holders.map(h => h.receives), [5000000000n, 3500000000n, 1500000000n]);
  assert.ok(both.holders[2].receives > cappedOnly.holders[2].receives);
});

test('a minimum of zero reproduces the capped model exactly', () => {
  const both = modelCappedFlooredHolderDistribution({ pool: '10000', minimum: '0', cap: '4000', decimals: 6, holders: HOLDERS });
  const cappedOnly = modelCappedHolderDistribution({ pool: '10000', cap: '4000', decimals: 6, holders: HOLDERS });
  assert.equal(both.guaranteeTotal, 0n);
  assert.equal(both.remainderPool, both.pool);
  assert.deepEqual(both.holders.map(h => h.receives), cappedOnly.holders.map(h => h.receives));
  assert.deepEqual(both.holders.map(h => h.receives), [4000000000n, 4000000000n, 2000000000n]);
  assert.equal(both.rounds, cappedOnly.rounds);
  assert.equal(both.rounds, 3);
  assert.equal(both.undistributed, cappedOnly.undistributed);
});

test('a cap no remainder share can reach reproduces the minimum-guarantee model exactly', () => {
  const both = modelCappedFlooredHolderDistribution({ pool: '10000', minimum: '500', cap: '999999', decimals: 6, holders: HOLDERS });
  const flooredOnly = modelMinimumHolderDistribution({ pool: '10000', minimum: '500', decimals: 6, holders: HOLDERS });
  assert.deepEqual(both.holders.map(h => h.receives), flooredOnly.holders.map(h => h.receives));
  assert.deepEqual(both.holders.map(h => h.receives), [5600000000n, 3050000000n, 1350000000n]);
  assert.equal(both.cappedCount, 0);
  assert.equal(both.rounds, 1);
});

test('when every eligible holder is at the cap the remainder is cap-blocked, not dust', () => {
  const r = modelCappedFlooredHolderDistribution({ pool: '1000', minimum: '100', cap: '200', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] });
  assert.equal(r.guaranteeTotal, 300n);
  assert.equal(r.remainderPool, 700n);
  assert.deepEqual(r.holders.map(h => h.proRata), [100n, 100n, 100n]);
  assert.deepEqual(r.holders.map(h => h.receives), [200n, 200n, 200n]);
  assert.equal(r.allCapped, true);
  assert.equal(r.cappedCount, 3);
  assert.equal(r.distributed, 600n);
  assert.equal(r.undistributed, 400n); // Cap-blocked: far past the holder-count dust bound.
  assert.ok(r.undistributed >= BigInt(r.eligibleCount));
});

test('a cap equal to the minimum pays each eligible holder exactly the minimum and leaves the whole remainder cap-blocked', () => {
  const r = modelCappedFlooredHolderDistribution({ pool: '100', minimum: '10', cap: '10', decimals: 0, holders: [{ label: 'A', balance: '100' }, { label: 'B', balance: '0' }] });
  assert.equal(r.eligibleCount, 1);
  assert.equal(r.guaranteeTotal, 10n);
  assert.equal(r.remainderPool, 90n);
  assert.deepEqual(r.holders.map(h => h.proRata), [0n, 0n]);
  assert.deepEqual(r.holders.map(h => h.receives), [10n, 0n]);
  assert.deepEqual(r.holders.map(h => h.capped), [true, false]);
  assert.equal(r.allCapped, true);
  assert.equal(r.distributed, 10n);
  assert.equal(r.undistributed, 90n);
});

test('a zero-balance holder receives zero, is guaranteed nothing, and does not consume cap room', () => {
  const r = modelCappedFlooredHolderDistribution({ pool: '100', minimum: '10', cap: '50', decimals: 0, holders: [{ label: 'A', balance: '100' }, { label: 'B', balance: '0' }] });
  assert.equal(r.eligibleCount, 1);
  assert.deepEqual(r.holders.map(h => h.eligible), [true, false]);
  assert.deepEqual(r.holders.map(h => h.guaranteed), [10n, 0n]);
  assert.deepEqual(r.holders.map(h => h.proRata), [40n, 0n]);
  assert.deepEqual(r.holders.map(h => h.receives), [50n, 0n]);
  assert.equal(r.holders[1].holdingShareBpsText, '0.00');
  assert.equal(r.distributed, 50n);
  assert.equal(r.undistributed, 50n);
});

test('the remainder division can still leave floor dust under both bounds', () => {
  const r = modelCappedFlooredHolderDistribution({ pool: '10', minimum: '2', cap: '4', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] });
  assert.equal(r.guaranteeTotal, 6n);
  assert.equal(r.remainderPool, 4n);
  assert.deepEqual(r.holders.map(h => h.receives), [3n, 3n, 3n]);
  assert.equal(r.allCapped, false);
  assert.equal(r.distributed, 9n);
  assert.equal(r.undistributed, 1n);
  assert.ok(r.undistributed < BigInt(r.eligibleCount));
});

test('a sole holder receives the whole pool when the cap allows it: the minimum plus the whole remainder', () => {
  const r = modelCappedFlooredHolderDistribution({ pool: '250', minimum: '25', cap: '1000', decimals: 0, holders: [{ label: 'Only', balance: '500' }] });
  assert.equal(r.holders[0].guaranteed, 25n);
  assert.equal(r.holders[0].proRata, 225n);
  assert.equal(r.holders[0].receives, 250n);
  assert.equal(r.holders[0].holdingShareBpsText, '10000.00');
  assert.equal(r.distributed, 250n);
  assert.equal(r.undistributed, 0n);
});

test('the holding share is derived from the balances, never from the bounded receives', () => {
  const r = modelCappedFlooredHolderDistribution(DEFAULT);
  // Holder C receives 1500 of 10000 (1500.00 by amount received),
  // but holds 100000 of 1000000 — the share the division priced.
  assert.equal(r.holders[2].receives, 1500000000n);
  assert.equal(r.holders[2].holdingShareBpsText, '1000.00');
  assert.equal(r.holders[0].holdingShareBpsText, '6000.00');
});

test('every eligible holder lands between the minimum and the cap, and the identities hold across designs', () => {
  const inputs = [
    DEFAULT,
    { pool: '10', minimum: '2', cap: '4', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] },
    { pool: '1000', minimum: '100', cap: '200', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] },
    { pool: '7', minimum: '1', cap: '3', decimals: 0, holders: [{ label: 'A', balance: '2' }, { label: 'B', balance: '3' }, { label: 'C', balance: '2' }] },
    { pool: '123.456', minimum: '10', cap: '100', decimals: 6, holders: [{ label: 'X', balance: '100' }, { label: 'Y', balance: '50' }] },
    { pool: '100', minimum: '10', cap: '10', decimals: 0, holders: [{ label: 'A', balance: '100' }, { label: 'B', balance: '0' }] },
    { pool: '1000000', minimum: '999', cap: '500000', decimals: 6, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '0' }, { label: 'C', balance: '999999' }] },
  ];
  for (const input of inputs) {
    const r = modelCappedFlooredHolderDistribution(input);
    const at = JSON.stringify(input);
    assert.equal(r.distributed + r.undistributed, r.pool, at);
    assert.equal(r.guaranteeTotal + r.remainderPool, r.pool, at);
    assert.equal(r.guaranteeTotal, r.minimum * BigInt(r.eligibleCount), at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.receives, 0n), r.distributed, at);
    assert.equal(r.holders.reduce((sum, h) => sum + h.balance, 0n), r.totalBalances, at);
    assert.ok(r.undistributed >= 0n, at);
    if (!r.allCapped) assert.ok(r.undistributed < BigInt(r.eligibleCount), at);
    for (const h of r.holders) {
      assert.equal(h.receives, h.guaranteed + h.proRata, at);
      if (h.eligible) {
        assert.ok(h.receives >= r.minimum, at);
        assert.ok(h.receives <= r.cap, at);
        assert.ok(h.proRata <= r.cap - r.minimum, at);
      }
      if (h.balance === 0n) {
        assert.equal(h.eligible, false, at);
        assert.equal(h.guaranteed, 0n, at);
        assert.equal(h.receives, 0n, at);
      }
    }
    assert.equal(r.eligibleCount, r.holders.filter(h => h.eligible).length, at);
    assert.equal(r.cappedCount, r.holders.filter(h => h.capped).length, at);
  }
});

test('beyond float range: the bounded division stays exact where a double would lose a base unit', () => {
  const r = modelCappedFlooredHolderDistribution({ pool: '9007199254740993', minimum: '1', cap: '7000000000000000', decimals: 0, holders: [{ label: 'X', balance: '2000000000000000' }, { label: 'Y', balance: '1000000000000000' }] });
  assert.equal(r.guaranteeTotal, 2n);
  assert.equal(r.remainderPool, 9007199254740991n);
  assert.deepEqual(r.holders.map(h => h.proRata), [6004799503160660n, 3002399751580330n]);
  assert.deepEqual(r.holders.map(h => h.receives), [6004799503160661n, 3002399751580331n]);
  assert.deepEqual(r.holders.map(h => h.capped), [false, false]);
  assert.equal(r.rounds, 1);
  assert.equal(r.distributed + r.undistributed, r.pool);
  assert.equal(r.undistributed, 1n);
});

test('validation: a cap below the minimum is contradictory and refused with its own message', () => {
  assert.throws(() => modelCappedFlooredHolderDistribution({ pool: '10000', minimum: '500', cap: '499', decimals: 6, holders: HOLDERS }), /Per-holder cap cannot be less than the per-holder minimum\./);
  assert.throws(() => modelCappedFlooredHolderDistribution({ pool: '100', minimum: '10', cap: '9', decimals: 0, holders: [{ label: 'A', balance: '1' }] }), /Per-holder cap cannot be less than the per-holder minimum\./);
});

test('validation: the bounds\u2019 own refusals carry over — negative minimum, zero cap, infeasible guarantee', () => {
  assert.throws(() => modelCappedFlooredHolderDistribution({ pool: '10', minimum: '-5', cap: '10', decimals: 0, holders: [{ label: 'A', balance: '1' }] }), /Per-holder minimum cannot be negative\./);
  assert.throws(() => modelCappedFlooredHolderDistribution({ pool: '10', minimum: '1', cap: '0', decimals: 0, holders: [{ label: 'A', balance: '1' }] }), /Per-holder cap must be greater than zero\./);
  assert.throws(() => modelCappedFlooredHolderDistribution({ pool: '10', minimum: '4', cap: '10', decimals: 0, holders: [{ label: 'A', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }] }), /Per-holder minimum times the eligible holder count exceeds the pool\./);
});

test('validation: the holder rules of the uncapped model carry over unchanged', () => {
  assert.throws(() => modelCappedFlooredHolderDistribution({ pool: '10', minimum: '1', cap: '5', decimals: 0, holders: [] }), /At least one holder is required to model a holder distribution\./);
  const six = [1, 2, 3, 4, 5, 6].map(n => ({ label: `H${n}`, balance: '1' }));
  assert.throws(() => modelCappedFlooredHolderDistribution({ pool: '10', minimum: '1', cap: '5', decimals: 0, holders: six }), /A holder distribution models at most five holders at a time\./);
  assert.throws(() => modelCappedFlooredHolderDistribution({ pool: '10', minimum: '1', cap: '5', decimals: 0, holders: [{ label: '  ', balance: '1' }] }), /Holder 1 needs a label so its share can be told apart from the others\./);
  assert.throws(() => modelCappedFlooredHolderDistribution({ pool: '10', minimum: '1', cap: '5', decimals: 0, holders: [{ label: 'Holder A', balance: '1' }, { label: 'holder a', balance: '2' }] }), /Duplicate holder label: holder a\. Each holder in the distribution needs its own label\./);
  assert.throws(() => modelCappedFlooredHolderDistribution({ pool: '10', minimum: '1', cap: '5', decimals: 0, holders: [{ label: 'A', balance: '0' }] }), /Total holder balance must be greater than zero\./);
  assert.throws(() => modelCappedFlooredHolderDistribution({ pool: '0', minimum: '1', cap: '5', decimals: 0, holders: [{ label: 'A', balance: '1' }] }), /Distribution pool must be greater than zero\./);
});

test('five holders are modeled under both bounds, and labels are trimmed before they are told apart', () => {
  const r = modelCappedFlooredHolderDistribution({ pool: '1000', minimum: '100', cap: '300', decimals: 0, holders: [{ label: ' A ', balance: '1' }, { label: 'B', balance: '1' }, { label: 'C', balance: '1' }, { label: 'D', balance: '1' }, { label: 'E', balance: '1' }] });
  assert.equal(r.holders.length, 5);
  assert.equal(r.holders[0].label, 'A');
  assert.equal(r.guaranteeTotal, 500n);
  assert.deepEqual(r.holders.map(h => h.receives), [200n, 200n, 200n, 200n, 200n]);
  assert.equal(r.undistributed, 0n);
});

test('decimals default to 6 when none are entered, and an entered minimum defaults to zero', () => {
  const r = modelCappedFlooredHolderDistribution({ pool: '10000', minimum: '500', cap: '5000', holders: HOLDERS });
  assert.equal(r.decimals, 6);
  assert.deepEqual(r.holders.map(h => h.receives), [5000000000n, 3500000000n, 1500000000n]);
  const noMinimum = modelCappedFlooredHolderDistribution({ pool: '10', cap: '100', decimals: 0, holders: [{ label: 'A', balance: '1' }] });
  assert.equal(noMinimum.minimum, 0n);
  assert.equal(noMinimum.holders[0].receives, 10n);
});

test('wiring: app.js imports the model, renders a capped-and-floored distribution panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelCappedFlooredHolderDistribution/);
  assert.match(app, /data-cfd/);
  assert.match(app, /capped-floored-distribution-output/);
  assert.match(app, /v1\.233/);
  assert.match(readme, /Capped-and-floored holder distribution model/);
});
