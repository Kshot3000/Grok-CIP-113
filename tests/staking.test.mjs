import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelStakingRewards, STAKING_HORIZON_PERIODS } from '../src/domain.js';

// Staking rewards dev-fee model (v1.210): a staking lifecycle holds
// two kinds of money — the staker's principal and the rewards it
// earns — and the dev fee is charged ONLY on the rewards. The
// principal returns whole in every outcome.
const DEFAULT = { amount: '10000', decimals: 6, rewardBps: 500, periods: 12, devFeeBps: 1000, mode: 'simple' };

test('simple mode: a constant floored per-period reward on the principal', () => {
  const r = modelStakingRewards(DEFAULT);
  assert.equal(r.principal, 10000000000n);
  assert.equal(r.perPeriodReward, 500000000n); // 500 bps of 10,000
  assert.equal(r.schedule.length, 12);
  assert.ok(r.schedule.every(x => x === 500000000n));
  assert.equal(r.totalRewards, 6000000000n);
});

test('the dev fee is charged on the rewards only — the principal is never its base', () => {
  const r = modelStakingRewards(DEFAULT);
  assert.equal(r.devFee, 600000000n); // 1000 bps of the 6,000 rewards — not of the 16,000 principal-plus-rewards (which would be 1,600)
  assert.notEqual(r.devFee, 1600000000n);
  assert.equal(r.stakerRewardsNet, 5400000000n);
  assert.equal(r.stakerFinal, 15400000000n);
  assert.equal(r.principalReturned, r.principal);
});

test('accounting identity: dev fee + staker final always equals principal + total rewards', () => {
  const inputs = [
    DEFAULT,
    { ...DEFAULT, rewardBps: 33, periods: 7, devFeeBps: 333 },
    { ...DEFAULT, amount: '7', decimals: 0, rewardBps: 999, devFeeBps: 1 },
    { ...DEFAULT, mode: 'compound', rewardBps: 250, periods: 24, devFeeBps: 2500 },
    { ...DEFAULT, amount: '123.456', rewardBps: 77, periods: 3, devFeeBps: 9999 },
  ];
  for (const input of inputs) {
    const r = modelStakingRewards(input);
    assert.equal(r.devFee + r.stakerFinal, r.principal + r.totalRewards, JSON.stringify(input));
    assert.equal(r.devFee + r.stakerRewardsNet, r.totalRewards, JSON.stringify(input));
  }
});

test('compound mode: each period earns on principal plus accrued rewards (expected values computed mechanically, independently of the model)', () => {
  const r = modelStakingRewards({ ...DEFAULT, mode: 'compound' });
  // Independent arithmetic: balance starts 10,000e6; each period adds floor(balance × 500 ÷ 10000).
  assert.equal(r.totalRewards, 7958563256n);
  assert.equal(r.devFee, 795856325n); // floor(7958563256 × 1000 ÷ 10000)
  assert.equal(r.stakerFinal, 17162706931n);
  assert.equal(r.firstPeriodReward, 500000000n); // The first period is identical in both modes.
  assert.equal(r.lastPeriodReward, 855169678n); // Later periods earn on more.
  assert.ok(r.schedule.every((x, i) => i === 0 || x >= r.schedule[i - 1]));
});

test('compound earns more than simple at the same entered rate, and the difference is stated from the amounts', () => {
  const s = modelStakingRewards(DEFAULT);
  const c = modelStakingRewards({ ...DEFAULT, mode: 'compound' });
  assert.ok(c.totalRewards > s.totalRewards);
  assert.equal(c.totalRewards - s.totalRewards, 1958563256n);
});

test('a dev fee that would take all the rewards is refused; at zero rewards nothing is refused and nothing is taken', () => {
  assert.throws(() => modelStakingRewards({ ...DEFAULT, devFeeBps: 10000 }), /take all the rewards/);
  const zero = modelStakingRewards({ ...DEFAULT, rewardBps: 0, devFeeBps: 10000 });
  assert.equal(zero.totalRewards, 0n);
  assert.equal(zero.devFee, 0n);
  assert.equal(zero.stakerFinal, zero.principal);
});

test('zero dev fee and zero reward rate are both legal designs', () => {
  const noFee = modelStakingRewards({ ...DEFAULT, devFeeBps: 0 });
  assert.equal(noFee.devFee, 0n);
  assert.equal(noFee.stakerFinal, noFee.principal + noFee.totalRewards);
  const noReward = modelStakingRewards({ ...DEFAULT, rewardBps: 0 });
  assert.equal(noReward.totalRewards, 0n);
  assert.equal(noReward.stakerFinal, noReward.principal);
});

test('derived rates come from the amounts, never the entered rates', () => {
  const r = modelStakingRewards(DEFAULT);
  assert.equal(r.devFeeShareBpsText, '1000.00'); // The fee's exact share of the rewards.
  assert.equal(r.totalRewardRateBpsText, '6000.00'); // 6,000 of rewards over a 10,000 principal.
  const floored = modelStakingRewards({ ...DEFAULT, amount: '3', decimals: 0, rewardBps: 333, periods: 1, devFeeBps: 333 });
  assert.equal(floored.perPeriodReward, 0n); // floor(3 × 333 ÷ 10000) = 0 — flooring can zero a tiny stake's reward, stated not hidden.
  assert.equal(floored.totalRewards, 0n);
});

test('horizon rows price the same design at 1, 6, 12, 24, and 36 periods', () => {
  const r = modelStakingRewards(DEFAULT);
  assert.deepEqual(r.rows.map(x => x.periods), [...STAKING_HORIZON_PERIODS]);
  assert.equal(r.rows[0].totalRewards, 500000000n);
  assert.equal(r.rows[2].totalRewards, 6000000000n); // The 12-period row equals the main outcome at the default horizon.
  assert.equal(r.rows[2].stakerFinal, r.stakerFinal);
  assert.equal(r.rows[4].totalRewards, 18000000000n);
  for (const row of r.rows) assert.equal(row.devFee + row.stakerFinal, r.principal + row.totalRewards);
});

test('beyond float range: the split stays exact where a double would lose base units', () => {
  const r = modelStakingRewards({ amount: '9007199254.740993', decimals: 6, rewardBps: 500, periods: 2, devFeeBps: 1000, mode: 'simple' });
  assert.equal(r.principal, 9007199254740993n);
  const perPeriod = 9007199254740993n * 500n / 10000n;
  assert.equal(r.perPeriodReward, perPeriod);
  assert.equal(r.totalRewards, perPeriod * 2n);
  assert.equal(r.devFee, (perPeriod * 2n) * 1000n / 10000n);
  assert.equal(r.devFee + r.stakerFinal, r.principal + r.totalRewards);
});

test('validation: bad principal, rates, periods, and mode are refused with their own messages', () => {
  assert.throws(() => modelStakingRewards({ ...DEFAULT, amount: '0' }), /greater than zero/);
  assert.throws(() => modelStakingRewards({ ...DEFAULT, amount: '-5' }), /positive decimal amount/);
  assert.throws(() => modelStakingRewards({ ...DEFAULT, rewardBps: 10001 }), /Reward rate/);
  assert.throws(() => modelStakingRewards({ ...DEFAULT, rewardBps: 2.5 }), /Reward rate/);
  assert.throws(() => modelStakingRewards({ ...DEFAULT, periods: 0 }), /Periods/);
  assert.throws(() => modelStakingRewards({ ...DEFAULT, periods: 121 }), /Periods/);
  assert.throws(() => modelStakingRewards({ ...DEFAULT, devFeeBps: -1 }), /Dev fee/);
  assert.throws(() => modelStakingRewards({ ...DEFAULT, mode: 'weekly' }), /simple or compound/);
});

test('wiring: app.js imports the model, renders a staking panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelStakingRewards/);
  assert.match(app, /data-stake/);
  assert.match(app, /staking-output/);
  assert.match(app, /v1\.210/);
  assert.match(readme, /Staking rewards dev-fee model/);
});
