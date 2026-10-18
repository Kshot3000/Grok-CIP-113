import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelStakingExit, modelStakingRewards } from '../src/domain.js';

// Staking early-exit model (v1.250): the staking rewards model prices
// a position held to term. This model prices leaving early: rewards
// not yet accrued are never earned, a penalty is charged only on the
// rewards accrued by the exit, the dev fee likewise, and the two
// together may not take all the accrued rewards.
const DEFAULT = { amount: '10000', rewardBps: 500, periods: 12, devFeeBps: 1000, mode: 'simple', exitPeriod: 6, exitPenaltyBps: 2500, decimals: 6 };

test('the preloaded exit: leaving at period 6 of 12 forfeits 750 of the 3000 accrued and 3000 more is never earned', () => {
  const r = modelStakingExit(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.principal, 10000000000n);
  assert.equal(r.accruedRewards, 3000000000n);
  assert.equal(r.termRewards, 6000000000n);
  assert.equal(r.unaccruedRewards, 3000000000n);
  assert.equal(r.devFee, 300000000n);
  assert.equal(r.penalty, 750000000n);
  assert.equal(r.forfeitedPenalty, 750000000n);
  assert.equal(r.stakerRewardsNet, 1950000000n);
  assert.equal(r.stakerFinal, 11950000000n);
  assert.equal(r.principalReturned, 10000000000n);
  assert.equal(r.penaltyShareBpsText, '2500.00');
  assert.equal(r.combinedShareBpsText, '3500.00');
  assert.equal(r.earlyExit, true);
  assert.equal(r.atTerm, false);
  assert.equal(r.noAccrual, false);
  assert.equal(r.zeroPenalty, false);
});

test('identities: fee plus penalty plus net is the accrued total, and the final is principal plus net', () => {
  const r = modelStakingExit(DEFAULT);
  assert.equal(r.devFee + r.penalty + r.stakerRewardsNet, r.accruedRewards);
  assert.equal(r.stakerFinal, r.principal + r.stakerRewardsNet);
  assert.equal(r.accruedRewards + r.unaccruedRewards, r.termRewards);
});

test('the penalty base is the accrued rewards only: 750 here, never 2500 of the principal or 1500 of the term rewards', () => {
  const r = modelStakingExit(DEFAULT);
  assert.equal(r.penalty, 750000000n);
  assert.notEqual(r.penalty, 2500000000n);
  assert.notEqual(r.penalty, 1500000000n);
  assert.equal(r.principalReturned, r.principal);
});

test('exiting at the full term is not early: no penalty whatever rate was entered, and the result equals the staking model held to term', () => {
  const r = modelStakingExit({ ...DEFAULT, exitPeriod: 12, exitPenaltyBps: 9000 });
  const held = modelStakingRewards({ amount: '10000', rewardBps: 500, periods: 12, devFeeBps: 1000, mode: 'simple', decimals: 6 });
  assert.equal(r.atTerm, true);
  assert.equal(r.earlyExit, false);
  assert.equal(r.penalty, 0n);
  assert.equal(r.zeroPenalty, true);
  assert.equal(r.accruedRewards, held.totalRewards);
  assert.equal(r.devFee, held.devFee);
  assert.equal(r.stakerFinal, held.stakerFinal);
  assert.equal(r.unaccruedRewards, 0n);
});

test('exiting at period 0 accrues nothing: no fee, no penalty, the principal returns alone', () => {
  const r = modelStakingExit({ ...DEFAULT, exitPeriod: 0 });
  assert.equal(r.accruedRewards, 0n);
  assert.equal(r.devFee, 0n);
  assert.equal(r.penalty, 0n);
  assert.equal(r.stakerRewardsNet, 0n);
  assert.equal(r.stakerFinal, 10000000000n);
  assert.equal(r.noAccrual, true);
  assert.equal(r.unaccruedRewards, 6000000000n);
  assert.equal(r.penaltyShareBpsText, '0.00');
});

test('compound accrual at the exit: rewards floored on the growing balance, penalty on that accrued amount', () => {
  const r = modelStakingExit({ ...DEFAULT, mode: 'compound' });
  assert.equal(r.accruedRewards, 3400956406n);
  assert.equal(r.devFee, 340095640n);
  assert.equal(r.penalty, 850239101n);
  assert.equal(r.stakerFinal, 12210621665n);
  assert.equal(r.unaccruedRewards, 4557606850n);
});

test('a zero penalty rate leaves the staker the whole accrued amount minus the dev fee', () => {
  const r = modelStakingExit({ ...DEFAULT, exitPenaltyBps: 0 });
  assert.equal(r.penalty, 0n);
  assert.equal(r.zeroPenalty, true);
  assert.equal(r.stakerRewardsNet, 2700000000n);
});

test('a zero reward rate accrues nothing at any exit: no fee, no penalty, no refusal', () => {
  const r = modelStakingExit({ ...DEFAULT, rewardBps: 0, exitPenaltyBps: 10000 });
  assert.equal(r.accruedRewards, 0n);
  assert.equal(r.noAccrual, true);
  assert.equal(r.stakerFinal, 10000000000n);
});

test('exit-point rows: period 0, the midpoint, the entered exit, and the term, each priced', () => {
  const r = modelStakingExit(DEFAULT);
  assert.deepEqual(r.rows.map(x => x.periods), [0, 6, 12]);
  assert.equal(r.rows[0].stakerFinal, 10000000000n);
  assert.equal(r.rows[1].penalty, 750000000n);
  assert.equal(r.rows[2].penalty, 0n);
  assert.equal(r.rows[2].stakerFinal, 15400000000n);
  assert.ok(r.rows.every(x => !x.takesAll));
});

test('at zero decimals the per-period reward floors: 10 units at 500 bps accrues nothing, 1000 accrues exactly', () => {
  const dust = modelStakingExit({ amount: '10', rewardBps: 500, periods: 12, devFeeBps: 1000, mode: 'simple', exitPeriod: 6, exitPenaltyBps: 2500, decimals: 0 });
  assert.equal(dust.accruedRewards, 0n);
  assert.equal(dust.noAccrual, true);
  assert.equal(dust.stakerFinal, 10n);
  const r = modelStakingExit({ amount: '1000', rewardBps: 500, periods: 12, devFeeBps: 1000, mode: 'simple', exitPeriod: 6, exitPenaltyBps: 2500, decimals: 0 });
  assert.equal(r.accruedRewards, 300n);
  assert.equal(r.devFee, 30n);
  assert.equal(r.penalty, 75n);
  assert.equal(r.stakerRewardsNet, 195n);
  assert.equal(r.stakerFinal, 1195n);
});

test('beyond float: shares are derived from the floored amounts, so the penalty share reads 1233.99 where 1234 was entered', () => {
  const r = modelStakingExit({ amount: '9999999999.999999', rewardBps: 333, periods: 7, devFeeBps: 777, mode: 'compound', exitPeriod: 3, exitPenaltyBps: 1234, decimals: 6 });
  assert.equal(r.accruedRewards, 1032635960369997n);
  assert.equal(r.devFee, 80235814120748n);
  assert.equal(r.penalty, 127427277509657n);
  assert.equal(r.penaltyShareBpsText, '1233.99');
  assert.equal(r.combinedShareBpsText, '2010.99');
  assert.equal(r.stakerRewardsNet, 824972868739592n);
  assert.equal(r.stakerFinal, 10824972868739591n);
  assert.equal(r.devFee + r.penalty + r.stakerRewardsNet, r.accruedRewards);
});

test('refusal: the dev fee and the penalty together taking all the accrued rewards', () => {
  assert.throws(() => modelStakingExit({ ...DEFAULT, exitPenaltyBps: 9500 }), /together would take all the rewards accrued/);
  assert.throws(() => modelStakingExit({ ...DEFAULT, devFeeBps: 0, exitPenaltyBps: 10000 }), /together would take all the rewards accrued/);
});

test('refusals: an exit period past the term, fractional, or negative', () => {
  assert.throws(() => modelStakingExit({ ...DEFAULT, exitPeriod: 13 }), /Exit period must be a whole number/);
  assert.throws(() => modelStakingExit({ ...DEFAULT, exitPeriod: 6.5 }), /Exit period must be a whole number/);
  assert.throws(() => modelStakingExit({ ...DEFAULT, exitPeriod: -1 }), /Exit period must be a whole number/);
});

test('refusals: an out-of-range or fractional exit penalty', () => {
  assert.throws(() => modelStakingExit({ ...DEFAULT, exitPenaltyBps: -1 }), /Exit penalty/);
  assert.throws(() => modelStakingExit({ ...DEFAULT, exitPenaltyBps: 10001 }), /Exit penalty/);
  assert.throws(() => modelStakingExit({ ...DEFAULT, exitPenaltyBps: 2500.5 }), /Exit penalty/);
});

test('refusals from the base model propagate: zero principal and a dev fee taking all the rewards', () => {
  assert.throws(() => modelStakingExit({ ...DEFAULT, amount: '0' }), /Staked principal must be greater than zero/);
  assert.throws(() => modelStakingExit({ ...DEFAULT, devFeeBps: 10000 }), /dev fee would take all the rewards/);
});

test('the shipped site carries the staking exit panel and its honesty boundary', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /staking-exit-output/);
  assert.match(app, /PRISM stakes nothing, holds no stake, pays no rewards, and exits no position/);
  assert.match(app, /v1\.250/);
});
