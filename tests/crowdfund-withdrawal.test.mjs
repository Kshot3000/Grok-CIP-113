import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelCrowdfundWithdrawal } from '../src/domain.js';

// Crowdfund withdrawal model (v1.273): a contributor withdraws before
// the deadline; the withdrawn amount is returned with no fee and never
// refunded twice, and the outcome and fee are repriced on what remains.
// A withdrawal can flip a funded raise to missed, and then the project
// receives nothing at all.
const DEFAULT = { goal: '100000', decimals: 6, raised: '125000', platformFeeBps: 250, withdrawal: '30000' };

test('the preloaded withdrawal: 30000 out of 125000 leaves 95000, below the 100000 goal, so the raise flips to missed', () => {
  const r = modelCrowdfundWithdrawal(DEFAULT);
  assert.equal(r.withdrawal, 30000000000n);
  assert.equal(r.raisedAfter, 95000000000n);
  assert.equal(r.fundedBefore, true);
  assert.equal(r.fundedAfter, false);
  assert.equal(r.flipsToMissed, true);
  assert.equal(r.projectBefore, 121875000000n);
  assert.equal(r.projectAfter, 0n);
  assert.equal(r.platformFeeBefore, 3125000000n);
  assert.equal(r.platformFeeAfter, 0n);
  assert.equal(r.feeNotChargedAfter, 2375000000n);
  assert.equal(r.refundedRemaining, 95000000000n);
  assert.equal(r.shortfallAfter, 5000000000n);
  assert.equal(r.withdrawnShareBpsText, '2400.00');
  assert.equal(r.remainingShareBpsText, '7600.00');
});

test('identities hold across goals, raises, fees, withdrawals, and decimals', () => {
  const cases = [
    { goal: '5000', decimals: 6, raised: '4000', platformFeeBps: 400, withdrawal: '1000' },
    { goal: '250', decimals: 2, raised: '250', platformFeeBps: 125, withdrawal: '250' },
    { goal: '777', decimals: 0, raised: '2000', platformFeeBps: 999, withdrawal: '123' },
    { goal: '1000000', decimals: 6, raised: '0', platformFeeBps: 0, withdrawal: '0' },
    { goal: '42', decimals: 6, raised: '100000', platformFeeBps: 1, withdrawal: '99999' },
  ];
  for (const c of cases) {
    const r = modelCrowdfundWithdrawal(c);
    assert.equal(r.withdrawal + r.raisedAfter, r.raised);
    assert.equal(r.withdrawal + r.platformFeeAfter + r.projectAfter + r.refundedRemaining, r.raised);
    if (r.fundedAfter) assert.equal(r.refundedRemaining, 0n);
    else assert.equal(r.refundedRemaining, r.raisedAfter);
  }
});

test('a withdrawal that leaves the raise funded reprices the fee on what remains, never on the original total', () => {
  const r = modelCrowdfundWithdrawal({ ...DEFAULT, withdrawal: '20000' });
  assert.equal(r.staysFunded, true);
  assert.equal(r.raisedAfter, 105000000000n);
  assert.equal(r.platformFeeAfter, 2625000000n);
  assert.equal(r.platformFeeBefore, 3125000000n);
  assert.equal(r.feeReduced, true);
  assert.equal(r.projectAfter, 102375000000n);
  assert.equal(r.excessAfter, 5000000000n);
  assert.equal(r.refundedRemaining, 0n);
});

test('a flipped raise pays the project nothing at all, not a reduced amount', () => {
  const r = modelCrowdfundWithdrawal(DEFAULT);
  assert.equal(r.flipsToMissed, true);
  assert.equal(r.projectAfter, 0n);
  assert.equal(r.platformFeeAfter, 0n);
  assert.equal(r.withdrawal + r.refundedRemaining, r.raised);
});

test('withdrawing down to exactly the goal still funds the raise, with no excess', () => {
  const r = modelCrowdfundWithdrawal({ goal: '100', decimals: 0, raised: '101', platformFeeBps: 250, withdrawal: '1' });
  assert.equal(r.fundedAfter, true);
  assert.equal(r.staysFunded, true);
  assert.equal(r.raisedAfter, 100n);
  assert.equal(r.excessAfter, 0n);
  assert.equal(r.platformFeeAfter, 2n);
  assert.equal(r.projectAfter, 98n);
});

test('one base unit more of withdrawal flips that same raise to missed by one base unit', () => {
  const r = modelCrowdfundWithdrawal({ goal: '100', decimals: 0, raised: '101', platformFeeBps: 250, withdrawal: '2' });
  assert.equal(r.flipsToMissed, true);
  assert.equal(r.raisedAfter, 99n);
  assert.equal(r.shortfallAfter, 1n);
  assert.equal(r.refundedRemaining, 99n);
  assert.equal(r.feeNotChargedAfter, 2n);
  assert.equal(r.projectAfter, 0n);
});

test('a withdrawal from a raise already missing its goal changes who holds the money, not the outcome', () => {
  const r = modelCrowdfundWithdrawal({ ...DEFAULT, raised: '75000', withdrawal: '25000' });
  assert.equal(r.staysMissed, true);
  assert.equal(r.fundedBefore, false);
  assert.equal(r.platformFeeBefore, 0n);
  assert.equal(r.platformFeeAfter, 0n);
  assert.equal(r.feeReduced, false);
  assert.equal(r.refundedRemaining, 50000000000n);
  assert.equal(r.withdrawal + r.refundedRemaining, r.raised);
  assert.equal(r.withdrawnShareBpsText, '3333.33');
});

test('a full withdrawal leaves nothing to fund, pay out, or refund a second time', () => {
  const r = modelCrowdfundWithdrawal({ ...DEFAULT, withdrawal: '125000' });
  assert.equal(r.fullWithdrawal, true);
  assert.equal(r.nothingRemains, true);
  assert.equal(r.raisedAfter, 0n);
  assert.equal(r.refundedRemaining, 0n);
  assert.equal(r.platformFeeAfter, 0n);
  assert.equal(r.projectAfter, 0n);
  assert.equal(r.withdrawnShareBpsText, '10000.00');
});

test('no withdrawal: the after outcome is the before outcome, stated identically', () => {
  const r = modelCrowdfundWithdrawal({ ...DEFAULT, withdrawal: '0' });
  assert.equal(r.noWithdrawal, true);
  assert.equal(r.raisedAfter, r.raised);
  assert.equal(r.platformFeeAfter, r.platformFeeBefore);
  assert.equal(r.projectAfter, r.projectBefore);
  assert.equal(r.feeReduced, false);
  assert.equal(r.staysFunded, true);
});

test('the withdrawn amount is never refunded twice: the end-of-raise refund covers only what remains', () => {
  const r = modelCrowdfundWithdrawal({ ...DEFAULT, raised: '80000', withdrawal: '30000' });
  assert.equal(r.staysMissed, true);
  assert.equal(r.refundedRemaining, 50000000000n);
  assert.equal(r.withdrawal + r.refundedRemaining, 80000000000n);
});

test('the fee on what remains is floored on the remaining raise', () => {
  const r = modelCrowdfundWithdrawal({ goal: '7', decimals: 6, raised: '11', platformFeeBps: 333, withdrawal: '4' });
  assert.equal(r.raisedAfter, 7000000n);
  assert.equal(r.platformFeeBefore, 366300n);
  assert.equal(r.platformFeeAfter, 233100n);
  assert.equal(r.projectAfter, 6766900n);
});

test('shares are derived from the amounts, not from any contributor count', () => {
  const r = modelCrowdfundWithdrawal({ goal: '7', decimals: 6, raised: '11', platformFeeBps: 333, withdrawal: '3' });
  assert.equal(r.withdrawnShareBpsText, '2727.27');
  assert.equal(r.remainingShareBpsText, '7272.72');
  assert.equal(r.projectAfterShareBpsText, '7030.54');
  assert.equal(r.platformFeeAfter, 266400n);
  assert.equal(r.excessAfter, 1000000n);
});

test('withdrawing more than was raised is refused', () => {
  assert.throws(() => modelCrowdfundWithdrawal({ ...DEFAULT, withdrawal: '125001' }), /Withdrawal must not exceed the total raised/);
});

test('a withdrawal from a raise with no contributions is refused unless it is zero', () => {
  assert.throws(() => modelCrowdfundWithdrawal({ ...DEFAULT, raised: '0', withdrawal: '1' }), /Withdrawal must not exceed the total raised/);
  const r = modelCrowdfundWithdrawal({ ...DEFAULT, raised: '0', withdrawal: '0' });
  assert.equal(r.noWithdrawal, true);
  assert.equal(r.nothingRemains, true);
  assert.equal(r.raisedAfter, 0n);
});

test('the base raise refusals propagate: a fee taking the whole funded raise is refused', () => {
  assert.throws(() => modelCrowdfundWithdrawal({ ...DEFAULT, platformFeeBps: 10000, withdrawal: '1' }), /Platform fee must not take the whole crowdfund raise\./);
});

test('bad withdrawal amounts are refused by the amount parser', () => {
  assert.throws(() => modelCrowdfundWithdrawal({ ...DEFAULT, withdrawal: '-1' }), /positive decimal amount/);
  assert.throws(() => modelCrowdfundWithdrawal({ ...DEFAULT, withdrawal: '1,000' }), /positive decimal amount/);
});

test('wiring: app.js imports the model, renders a crowdfund withdrawal panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelCrowdfundWithdrawal/);
  assert.match(app, /data-crowdw/);
  assert.match(app, /crowdw-output/);
  assert.match(app, /v1\.273/);
  assert.match(readme, /Crowdfund withdrawal model/);
});
