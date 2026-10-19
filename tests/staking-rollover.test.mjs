import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelStakingRollover, modelStakingRewards } from '../src/domain.js';

// Staking rollover model (v1.280): a finished position restaked into
// a new term on the same terms. The rolled principal is the first
// term's final (principal plus NET rewards), the dev fee is charged
// again on the second term's rewards only, and the comparison with
// one uninterrupted term is stated signed — ahead in simple mode,
// behind in compound mode at the preload rates.
const DEFAULT = { amount: '10000', rewardBps: 500, periods: 12, devFeeBps: 1000, mode: 'simple', rolloverPeriods: 12, decimals: 6 };

test('the preloaded rollover: 10000 earns 6000, 5400 net rolls with the principal, the second term earns 9240', () => {
  const r = modelStakingRollover(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.principal, 10000000000n);
  assert.equal(r.firstRewards, 6000000000n);
  assert.equal(r.firstDevFee, 600000000n);
  assert.equal(r.firstRewardsNet, 5400000000n);
  assert.equal(r.rolloverPrincipal, 15400000000n);
  assert.equal(r.secondRewards, 9240000000n);
  assert.equal(r.secondDevFee, 924000000n);
  assert.equal(r.secondRewardsNet, 8316000000n);
  assert.equal(r.stakerFinal, 23716000000n);
  assert.equal(r.totalRewards, 15240000000n);
  assert.equal(r.totalDevFee, 1524000000n);
  assert.equal(r.totalNet, 13716000000n);
  assert.equal(r.totalDevFeeShareBpsText, '1000.00');
  assert.equal(r.secondShareBpsText, '6062.99');
  assert.equal(r.noFirstRewards, false);
  assert.equal(r.noSecondRewards, false);
});

test('identities: the rolled principal is principal plus first net, the final is rolled plus second net, fees plus net is total rewards', () => {
  const r = modelStakingRollover(DEFAULT);
  assert.equal(r.rolloverPrincipal, r.principal + r.firstRewardsNet);
  assert.equal(r.stakerFinal, r.rolloverPrincipal + r.secondRewardsNet);
  assert.equal(r.totalDevFee + r.totalNet, r.totalRewards);
  assert.equal(r.totalNet, r.firstRewardsNet + r.secondRewardsNet);
});

test('the fee base in the second term is its rewards only: 924 here, never 1540 of the rolled principal', () => {
  const r = modelStakingRollover(DEFAULT);
  assert.equal(r.secondDevFee, 924000000n);
  assert.notEqual(r.secondDevFee, 1540000000n);
});

test('the first term is the staking model unchanged, and the second term is the staking model on the rolled principal', () => {
  const r = modelStakingRollover(DEFAULT);
  const first = modelStakingRewards({ amount: '10000', rewardBps: 500, periods: 12, devFeeBps: 1000, mode: 'simple', decimals: 6 });
  const second = modelStakingRewards({ amount: '15400', rewardBps: 500, periods: 12, devFeeBps: 1000, mode: 'simple', decimals: 6 });
  assert.equal(r.firstRewards, first.totalRewards);
  assert.equal(r.rolloverPrincipal, first.stakerFinal);
  assert.equal(r.secondRewards, second.totalRewards);
  assert.equal(r.stakerFinal, second.stakerFinal);
});

test('simple mode: the rollover finishes ahead of one uninterrupted 24-period term by exactly the second term\u2019s extra earnings', () => {
  const r = modelStakingRollover(DEFAULT);
  assert.equal(r.totalPeriods, 24);
  assert.equal(r.singleTermFinal, 20800000000n);
  assert.equal(r.rolloverDifference, 2916000000n);
  assert.equal(r.rolloverAhead, true);
  assert.equal(r.rolloverBehind, false);
});

test('compound mode: the rollover finishes BEHIND the uninterrupted term — the fee skimmed at the rollover point costs more than the rollover gains', () => {
  const r = modelStakingRollover({ ...DEFAULT, mode: 'compound' });
  assert.equal(r.firstRewards, 7958563256n);
  assert.equal(r.firstDevFee, 795856325n);
  assert.equal(r.rolloverPrincipal, 17162706931n);
  assert.equal(r.secondRewards, 13659048872n);
  assert.equal(r.secondDevFee, 1365904887n);
  assert.equal(r.secondRewardsNet, 12293143985n);
  assert.equal(r.stakerFinal, 29455850916n);
  assert.equal(r.totalRewards, 21617612128n);
  assert.equal(r.totalDevFee, 2161761212n);
  assert.equal(r.singleTermFinal, 30025899480n);
  assert.equal(r.rolloverDifference, -570048564n);
  assert.equal(r.rolloverAhead, false);
  assert.equal(r.rolloverBehind, true);
  assert.equal(r.totalDevFeeShareBpsText, '999.99');
  assert.equal(r.secondShareBpsText, '6318.48');
});

test('a shorter rollover term earns proportionally less in simple mode: 6 periods earns 4620 on the rolled 15400', () => {
  const r = modelStakingRollover({ ...DEFAULT, rolloverPeriods: 6 });
  assert.equal(r.secondRewards, 4620000000n);
  assert.equal(r.secondDevFee, 462000000n);
  assert.equal(r.stakerFinal, 19558000000n);
  assert.equal(r.totalPeriods, 18);
});

test('rollover rows price the second term at the horizon lengths under the same terms', () => {
  const r = modelStakingRollover(DEFAULT);
  assert.deepEqual(r.rows.map(x => x.rolloverPeriods), [1, 6, 12, 24, 36]);
  assert.equal(r.rows[0].secondRewards, 770000000n);
  assert.equal(r.rows[0].stakerFinal, 16093000000n);
  assert.equal(r.rows[4].secondRewards, 27720000000n);
  assert.equal(r.rows[4].stakerFinal, 40348000000n);
});

test('when the two terms total past 120 periods no uninterrupted comparison is priced — the figures stand alone', () => {
  const r = modelStakingRollover({ ...DEFAULT, periods: 100, rolloverPeriods: 36 });
  assert.equal(r.totalPeriods, 136);
  assert.equal(r.singleTermFinal, null);
  assert.equal(r.rolloverDifference, null);
  assert.equal(r.rolloverAhead, null);
  assert.ok(r.stakerFinal > r.principal);
});

test('a zero reward rate earns nothing in either term: nothing to roll, no fee, no refusal', () => {
  const r = modelStakingRollover({ ...DEFAULT, rewardBps: 0 });
  assert.equal(r.firstRewards, 0n);
  assert.equal(r.secondRewards, 0n);
  assert.equal(r.noFirstRewards, true);
  assert.equal(r.noSecondRewards, true);
  assert.equal(r.rolloverPrincipal, 10000000000n);
  assert.equal(r.stakerFinal, 10000000000n);
  assert.equal(r.totalDevFeeShareBpsText, '0.00');
  assert.equal(r.rolloverDifference, 0n);
});

test('a zero dev fee rolls the gross rewards and charges nothing in either term', () => {
  const r = modelStakingRollover({ ...DEFAULT, devFeeBps: 0 });
  assert.equal(r.rolloverPrincipal, 16000000000n);
  assert.equal(r.secondRewards, 9600000000n);
  assert.equal(r.totalDevFee, 0n);
  assert.equal(r.stakerFinal, 25600000000n);
});

test('at zero decimals the per-period rewards floor in both terms: 10 units earns nothing, 1000 earns exactly', () => {
  const dust = modelStakingRollover({ amount: '10', rewardBps: 500, periods: 12, devFeeBps: 1000, mode: 'simple', rolloverPeriods: 12, decimals: 0 });
  assert.equal(dust.firstRewards, 0n);
  assert.equal(dust.secondRewards, 0n);
  assert.equal(dust.stakerFinal, 10n);
  const r = modelStakingRollover({ amount: '1000', rewardBps: 500, periods: 12, devFeeBps: 1000, mode: 'simple', rolloverPeriods: 12, decimals: 0 });
  assert.equal(r.firstRewards, 600n);
  assert.equal(r.firstDevFee, 60n);
  assert.equal(r.rolloverPrincipal, 1540n);
  assert.equal(r.secondRewards, 924n);
  assert.equal(r.secondDevFee, 92n);
  assert.equal(r.secondRewardsNet, 832n);
  assert.equal(r.stakerFinal, 2372n);
});

test('beyond float: shares derived from the floored amounts, total fee share 776.99 where 777 was entered, rollover behind in compound mode', () => {
  const r = modelStakingRollover({ amount: '9999999999.999999', rewardBps: 333, periods: 7, devFeeBps: 777, mode: 'compound', rolloverPeriods: 5, decimals: 6 });
  assert.equal(r.firstRewards, 2577230080664305n);
  assert.equal(r.firstDevFee, 200250777267616n);
  assert.equal(r.rolloverPrincipal, 12376979303396688n);
  assert.equal(r.secondRewards, 2202661070529618n);
  assert.equal(r.secondDevFee, 171146765180151n);
  assert.equal(r.stakerFinal, 14408493608746155n);
  assert.equal(r.rolloverDifference, -32868465617041n);
  assert.equal(r.totalDevFeeShareBpsText, '776.99');
  assert.equal(r.secondShareBpsText, '4608.18');
  assert.equal(r.totalDevFee + r.totalNet, r.totalRewards);
});

test('refusals: a fractional, zero, negative, or over-long rollover term', () => {
  assert.throws(() => modelStakingRollover({ ...DEFAULT, rolloverPeriods: 6.5 }), /Rollover periods must be a whole number/);
  assert.throws(() => modelStakingRollover({ ...DEFAULT, rolloverPeriods: 0 }), /Rollover periods must be a whole number/);
  assert.throws(() => modelStakingRollover({ ...DEFAULT, rolloverPeriods: -1 }), /Rollover periods must be a whole number/);
  assert.throws(() => modelStakingRollover({ ...DEFAULT, rolloverPeriods: 121 }), /Rollover periods must be a whole number/);
});

test('refusals from the base model propagate: zero principal and a dev fee taking all the rewards', () => {
  assert.throws(() => modelStakingRollover({ ...DEFAULT, amount: '0' }), /Staked principal must be greater than zero/);
  assert.throws(() => modelStakingRollover({ ...DEFAULT, devFeeBps: 10000 }), /dev fee would take all the rewards/);
});

test('the shipped site carries the staking rollover panel and its honesty boundary', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /staking-rollover-output/);
  assert.match(app, /PRISM stakes nothing, holds no stake, pays no rewards, and rolls no position over/);
  assert.match(app, /v1\.280/);
});
