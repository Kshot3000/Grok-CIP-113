import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelVestingSchedule, vestingMilestonePeriods } from '../src/domain.js';

// Token vesting schedule model (v1.193): an allocation unlocks over
// time behind a cliff, priced by the cumulative-floor method — the
// cumulative vested at period n is floor(total × n ÷ duration) once
// the cliff is reached, 0 before it, and exactly the total at the
// final period, so the per-period releases sum to the total with no
// dust left behind.
const DEFAULT = { amount: '1000000', decimals: 6, cliffPeriods: 6, vestingPeriods: 24, elapsedPeriods: 12 };

test('the preloaded schedule: half the allocation is vested at period 12 of 24', () => {
  const r = modelVestingSchedule(DEFAULT);
  assert.equal(r.total, 1000000000000n);
  assert.equal(r.vested, 500000000000n);
  assert.equal(r.locked, 500000000000n);
  assert.equal(r.vested + r.locked, r.total);
  assert.equal(r.vestedShareBpsText, '5000.00');
  assert.equal(r.schedule.length, 24);
});

test('cliff semantics: nothing vests before the cliff, and the whole accrued share releases at the cliff period', () => {
  const before = modelVestingSchedule({ ...DEFAULT, elapsedPeriods: 5 });
  assert.equal(before.vested, 0n);
  assert.equal(before.locked, before.total);
  const at = modelVestingSchedule({ ...DEFAULT, elapsedPeriods: 6 });
  assert.equal(at.vested, 250000000000n);
  assert.equal(at.cliffRelease, 250000000000n);
  assert.ok(at.schedule.slice(0, 5).every(x => x.released === 0n && x.cumulative === 0n));
  assert.equal(at.schedule[5].released, 250000000000n); // Period 6 releases the accrued six periods at once.
  assert.equal(at.schedule[5].cumulative, 250000000000n);
});

test('at the full duration the cumulative is exactly the total and the releases sum to it with no dust', () => {
  const r = modelVestingSchedule({ ...DEFAULT, elapsedPeriods: 24 });
  assert.equal(r.vested, r.total);
  assert.equal(r.locked, 0n);
  assert.equal(r.vestedShareBpsText, '10000.00');
  assert.equal(r.schedule.reduce((a, x) => a + x.released, 0n), r.total);
  assert.equal(r.schedule[23].cumulative, r.total);
  assert.equal(r.schedule[6].released, 41666666666n); // floor(1e12 × 7 ÷ 24) − 250,000,000,000
  assert.equal(r.schedule[23].released, 41666666667n); // The final period takes the remainder the floors left.
});

test('odd total: 100 units over 3 periods with no cliff releases 33, 33, 34 — the final period takes the remainder', () => {
  const r = modelVestingSchedule({ amount: '100', decimals: 0, cliffPeriods: 0, vestingPeriods: 3, elapsedPeriods: 3 });
  assert.deepEqual(r.schedule.map(x => x.released), [33n, 33n, 34n]);
  assert.deepEqual(r.schedule.map(x => x.cumulative), [33n, 66n, 100n]);
  assert.equal(r.schedule.reduce((a, x) => a + x.released, 0n), 100n);
});

test('accounting identity across designs: vested + locked is the total, and the schedule sums to it exactly', () => {
  const inputs = [
    DEFAULT,
    { amount: '7', decimals: 0, cliffPeriods: 2, vestingPeriods: 5, elapsedPeriods: 3 },
    { amount: '123.456', decimals: 6, cliffPeriods: 3, vestingPeriods: 10, elapsedPeriods: 7 },
    { amount: '1000', decimals: 0, cliffPeriods: 5, vestingPeriods: 5, elapsedPeriods: 5 },
    { amount: '42', decimals: 0, cliffPeriods: 0, vestingPeriods: 1, elapsedPeriods: 0 },
  ];
  for (const input of inputs) {
    const r = modelVestingSchedule(input);
    assert.equal(r.vested + r.locked, r.total, JSON.stringify(input));
    assert.equal(r.schedule.reduce((a, x) => a + x.released, 0n), r.total, JSON.stringify(input));
    assert.equal(r.schedule[r.schedule.length - 1].cumulative, r.total, JSON.stringify(input));
    assert.ok(r.schedule.every((x, i) => i === 0 || x.cumulative >= r.schedule[i - 1].cumulative), JSON.stringify(input));
  }
});

test('elapsed defaults to the cliff period — the moment the accrued share releases', () => {
  const r = modelVestingSchedule({ amount: '1000000', decimals: 6, cliffPeriods: 6, vestingPeriods: 24 });
  assert.equal(r.elapsedPeriods, 6);
  assert.equal(r.vested, 250000000000n);
  const noCliff = modelVestingSchedule({ amount: '100', decimals: 0, cliffPeriods: 0, vestingPeriods: 3 });
  assert.equal(noCliff.elapsedPeriods, 0);
  assert.equal(noCliff.vested, 0n);
});

test('a fractional allocation floors every period and still lands exactly on the total', () => {
  const r = modelVestingSchedule({ amount: '123.456', decimals: 6, cliffPeriods: 3, vestingPeriods: 10, elapsedPeriods: 7 });
  assert.equal(r.total, 123456000n);
  assert.equal(r.vested, 86419200n);
  assert.equal(r.locked, 37036800n);
  assert.deepEqual(r.schedule.map(x => x.released), [0n, 0n, 37036800n, 12345600n, 12345600n, 12345600n, 12345600n, 12345600n, 12345600n, 12345600n]);
  assert.deepEqual(r.rows.map(x => x.periods), [0, 3, 5, 10]);
  assert.deepEqual(r.rows.map(x => x.vested), [0n, 37036800n, 61728000n, 123456000n]);
});

test('milestone rows are the distinct sorted periods 0, cliff, midpoint, and duration — duplicates collapse', () => {
  const r = modelVestingSchedule(DEFAULT);
  assert.deepEqual(r.rows.map(x => x.periods), [0, 6, 12, 24]);
  assert.deepEqual(r.rows.map(x => x.vested), [0n, 250000000000n, 500000000000n, 1000000000000n]);
  assert.deepEqual(r.rows.map(x => x.locked), [1000000000000n, 750000000000n, 500000000000n, 0n]);
  assert.deepEqual(vestingMilestonePeriods(5, 5), [0, 3, 5]); // Cliff = duration appears once; the midpoint is ceil(5 ÷ 2).
  assert.deepEqual(vestingMilestonePeriods(0, 3), [0, 2, 3]); // Cliff 0 is period 0, listed once.
  const cliffAtEnd = modelVestingSchedule({ amount: '1000', decimals: 0, cliffPeriods: 5, vestingPeriods: 5, elapsedPeriods: 5 });
  assert.deepEqual(cliffAtEnd.rows.map(x => x.periods), [0, 3, 5]);
  assert.deepEqual(cliffAtEnd.rows.map(x => x.vested), [0n, 0n, 1000n]);
});

test('the vested share is derived from the amounts, never the period ratio', () => {
  const r = modelVestingSchedule({ amount: '7', decimals: 0, cliffPeriods: 2, vestingPeriods: 5, elapsedPeriods: 3 });
  assert.deepEqual(r.schedule.map(x => x.released), [0n, 2n, 2n, 1n, 2n]);
  assert.equal(r.vested, 4n);
  assert.equal(r.vestedShareBpsText, '5714.28'); // 4 of 7 by amount — not the 6000.00 the 3-of-5 period ratio would claim.
  const atCliff = modelVestingSchedule({ amount: '7', decimals: 0, cliffPeriods: 2, vestingPeriods: 5, elapsedPeriods: 2 });
  assert.equal(atCliff.vestedShareBpsText, '2857.14'); // 2 of 7.
});

test('a cliff equal to the duration releases everything in the final period and nothing before it', () => {
  const r = modelVestingSchedule({ amount: '1000', decimals: 0, cliffPeriods: 5, vestingPeriods: 5, elapsedPeriods: 4 });
  assert.equal(r.vested, 0n);
  assert.ok(r.schedule.slice(0, 4).every(x => x.released === 0n));
  assert.equal(r.schedule[4].released, 1000n);
  assert.equal(r.cliffRelease, 1000n);
});

test('a zero cliff starts vesting in the first period and has no cliff release', () => {
  const r = modelVestingSchedule({ amount: '100', decimals: 0, cliffPeriods: 0, vestingPeriods: 3, elapsedPeriods: 1 });
  assert.equal(r.cliffRelease, 0n);
  assert.equal(r.vested, 33n);
  assert.equal(r.vestedShareBpsText, '3300.00');
});

test('beyond float range: the schedule stays exact where a double would lose base units', () => {
  const r = modelVestingSchedule({ amount: '9007199254.740993', decimals: 6, cliffPeriods: 4, vestingPeriods: 9, elapsedPeriods: 5 });
  assert.equal(r.total, 9007199254740993n);
  assert.equal(r.vested, 5003999585967218n);
  assert.equal(r.cliffRelease, 4003199668773774n);
  assert.equal(r.schedule.reduce((a, x) => a + x.released, 0n), r.total);
  const done = modelVestingSchedule({ amount: '9007199254.740993', decimals: 6, cliffPeriods: 4, vestingPeriods: 9, elapsedPeriods: 9 });
  assert.equal(done.vested, done.total);
});

test('validation: bad amount, cliff, duration, and elapsed are refused with their own messages', () => {
  assert.throws(() => modelVestingSchedule({ ...DEFAULT, amount: '0' }), /greater than zero/);
  assert.throws(() => modelVestingSchedule({ ...DEFAULT, amount: '-5' }), /positive decimal amount/);
  assert.throws(() => modelVestingSchedule({ ...DEFAULT, cliffPeriods: 25 }), /cannot exceed the vesting periods/);
  assert.throws(() => modelVestingSchedule({ ...DEFAULT, cliffPeriods: -1 }), /Cliff periods/);
  assert.throws(() => modelVestingSchedule({ ...DEFAULT, cliffPeriods: 121 }), /Cliff periods/);
  assert.throws(() => modelVestingSchedule({ ...DEFAULT, cliffPeriods: 2.5 }), /Cliff periods/);
  assert.throws(() => modelVestingSchedule({ ...DEFAULT, vestingPeriods: 0 }), /Vesting periods/);
  assert.throws(() => modelVestingSchedule({ ...DEFAULT, vestingPeriods: 121 }), /Vesting periods/);
  assert.throws(() => modelVestingSchedule({ ...DEFAULT, vestingPeriods: 1.5 }), /Vesting periods/);
  assert.throws(() => modelVestingSchedule({ ...DEFAULT, elapsedPeriods: -1 }), /Elapsed periods/);
  assert.throws(() => modelVestingSchedule({ ...DEFAULT, elapsedPeriods: 25 }), /Elapsed periods/);
  assert.throws(() => modelVestingSchedule({ ...DEFAULT, elapsedPeriods: 0.5 }), /Elapsed periods/);
});

test('wiring: app.js imports the model, renders a vesting panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelVestingSchedule/);
  assert.match(app, /data-vest/);
  assert.match(app, /vesting-output/);
  assert.match(app, /v1\.193/);
  assert.match(readme, /Vesting schedule model/);
});
