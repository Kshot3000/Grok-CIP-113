import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelCrowdfundRaise } from '../src/domain.js';

// Crowdfund raise model (v1.276): an all-or-nothing raise — the
// goal is reached and the project is paid, with the platform fee
// charged only on success, or the goal is missed and every
// contribution is refunded in full with no fee. No cap: overfunding
// above the goal is kept whole.
const DEFAULT = { goal: '100000', decimals: 6, raised: '125000', platformFeeBps: 250 };

test('the preloaded raise: 125000 raised against a 100000 goal funds it, fee 3125, project 121875, excess kept whole', () => {
  const r = modelCrowdfundRaise(DEFAULT);
  assert.equal(r.goal, 100000000000n);
  assert.equal(r.raised, 125000000000n);
  assert.equal(r.funded, true);
  assert.equal(r.overfunded, true);
  assert.equal(r.exactlyFunded, false);
  assert.equal(r.excessOverGoal, 25000000000n);
  assert.equal(r.feeWouldBe, 3125000000n);
  assert.equal(r.platformFee, 3125000000n);
  assert.equal(r.projectReceives, 121875000000n);
  assert.equal(r.refundedTotal, 0n);
  assert.equal(r.feeNotCharged, 0n);
  assert.equal(r.shortfall, 0n);
  assert.equal(r.fundedShareBpsText, '12500.00');
  assert.equal(r.feeShareBpsText, '250.00');
  assert.equal(r.projectShareBpsText, '9750.00');
});

test('identities hold across goals, raises, fees, and decimals, in both outcomes', () => {
  const cases = [
    { goal: '5000', decimals: 6, raised: '4000', platformFeeBps: 400 },
    { goal: '250', decimals: 2, raised: '250', platformFeeBps: 125 },
    { goal: '777', decimals: 0, raised: '2000', platformFeeBps: 9999 },
    { goal: '1000000', decimals: 6, raised: '0', platformFeeBps: 0 },
    { goal: '42', decimals: 6, raised: '100000', platformFeeBps: 1 },
  ];
  for (const c of cases) {
    const r = modelCrowdfundRaise(c);
    assert.equal(r.platformFee + r.projectReceives + r.refundedTotal, r.raised);
    if (r.funded) {
      assert.equal(r.platformFee, r.feeWouldBe);
      assert.equal(r.refundedTotal, 0n);
      assert.equal(r.shortfall, 0n);
    } else {
      assert.equal(r.platformFee, 0n);
      assert.equal(r.projectReceives, 0n);
      assert.equal(r.refundedTotal, r.raised);
      assert.equal(r.feeNotCharged, r.feeWouldBe);
      assert.equal(r.shortfall, r.goal - r.raised);
    }
  }
});

test('a missed goal refunds everything in full, charges no fee, and pays the project nothing', () => {
  const r = modelCrowdfundRaise({ ...DEFAULT, raised: '75000' });
  assert.equal(r.funded, false);
  assert.equal(r.goalMissed, true);
  assert.equal(r.refundedTotal, 75000000000n);
  assert.equal(r.platformFee, 0n);
  assert.equal(r.projectReceives, 0n);
  assert.equal(r.feeNotCharged, 1875000000n);
  assert.equal(r.shortfall, 25000000000n);
  assert.equal(r.fundedShareBpsText, '7500.00');
  assert.equal(r.refundedShareBpsText, '10000.00');
});

test('reaching the goal exactly funds the raise, with no excess and no refund', () => {
  const r = modelCrowdfundRaise({ ...DEFAULT, raised: '100000' });
  assert.equal(r.funded, true);
  assert.equal(r.exactlyFunded, true);
  assert.equal(r.overfunded, false);
  assert.equal(r.excessOverGoal, 0n);
  assert.equal(r.platformFee, 2500000000n);
  assert.equal(r.projectReceives, 97500000000n);
  assert.equal(r.fundedShareBpsText, '10000.00');
});

test('one base unit below the goal misses it: the whole raise is refunded', () => {
  const r = modelCrowdfundRaise({ goal: '100', decimals: 0, raised: '99', platformFeeBps: 250 });
  assert.equal(r.funded, false);
  assert.equal(r.shortfall, 1n);
  assert.equal(r.refundedTotal, 99n);
  assert.equal(r.feeNotCharged, 2n);
});

test('overfunding is kept whole, never refunded: there is no cap in this model', () => {
  const r = modelCrowdfundRaise({ ...DEFAULT, raised: '200000' });
  assert.equal(r.overfunded, true);
  assert.equal(r.excessOverGoal, 100000000000n);
  assert.equal(r.refundedTotal, 0n);
  assert.equal(r.projectReceives + r.platformFee, r.raised);
});

test('the fee is floored on the total raised, never rounded up', () => {
  const r = modelCrowdfundRaise({ goal: '7', decimals: 6, raised: '11', platformFeeBps: 333 });
  assert.equal(r.feeWouldBe, 366300n);
  assert.equal(r.platformFee, 366300n);
  assert.equal(r.projectReceives, 10633700n);
});

test('shares are derived from the amounts, not from any contributor count', () => {
  const missed = modelCrowdfundRaise({ goal: '7', decimals: 6, raised: '3', platformFeeBps: 333 });
  assert.equal(missed.fundedShareBpsText, '4285.71');
  assert.equal(missed.feeNotCharged, 99900n);
  assert.equal(missed.refundedTotal, 3000000n);
  const funded = modelCrowdfundRaise({ goal: '7', decimals: 6, raised: '11', platformFeeBps: 333 });
  assert.equal(funded.fundedShareBpsText, '15714.28');
  assert.equal(funded.feeShareBpsText, '333.00');
  assert.equal(funded.projectShareBpsText, '9667.00');
});

test('no contributions yet: nothing to pay out, nothing to refund, the whole goal still needed', () => {
  const r = modelCrowdfundRaise({ ...DEFAULT, raised: '0' });
  assert.equal(r.noContributions, true);
  assert.equal(r.funded, false);
  assert.equal(r.shortfall, r.goal);
  assert.equal(r.refundedTotal, 0n);
  assert.equal(r.feeNotCharged, 0n);
  assert.equal(r.fundedShareBpsText, '0.00');
  assert.equal(r.refundedShareBpsText, '0.00');
});

test('with no platform fee, a funded project receives the whole raise', () => {
  const r = modelCrowdfundRaise({ ...DEFAULT, platformFeeBps: 0 });
  assert.equal(r.noFee, true);
  assert.equal(r.platformFee, 0n);
  assert.equal(r.projectReceives, r.raised);
});

test('a stated fee flooring to zero at decimals 0 is stated, never presented as a fee that is taken', () => {
  const r = modelCrowdfundRaise({ goal: '100', decimals: 0, raised: '150', platformFeeBps: 1 });
  assert.equal(r.feeFloorsToZero, true);
  assert.equal(r.platformFee, 0n);
  assert.equal(r.projectReceives, 150n);
  assert.equal(r.fundedShareBpsText, '15000.00');
});

test('a fee that would take the whole funded raise is refused', () => {
  assert.throws(() => modelCrowdfundRaise({ goal: '10', decimals: 6, raised: '20', platformFeeBps: 10000 }), /Platform fee must not take the whole crowdfund raise\./);
});

test('a whole-raise fee on a missed raise is not refused and not charged: the raise is refunded instead', () => {
  const r = modelCrowdfundRaise({ goal: '100', decimals: 6, raised: '20', platformFeeBps: 10000 });
  assert.equal(r.funded, false);
  assert.equal(r.platformFee, 0n);
  assert.equal(r.refundedTotal, 20000000n);
  assert.equal(r.feeNotCharged, 20000000n);
});

test('the goal must be greater than zero', () => {
  assert.throws(() => modelCrowdfundRaise({ ...DEFAULT, goal: '0' }), /Crowdfund goal must be greater than zero\./);
});

test('invalid platform fees are refused', () => {
  assert.throws(() => modelCrowdfundRaise({ ...DEFAULT, platformFeeBps: -1 }), /Platform fee must be a whole number of basis points between 0 and 10,000\./);
  assert.throws(() => modelCrowdfundRaise({ ...DEFAULT, platformFeeBps: 10001 }), /Platform fee must be a whole number of basis points between 0 and 10,000\./);
  assert.throws(() => modelCrowdfundRaise({ ...DEFAULT, platformFeeBps: 2.5 }), /Platform fee must be a whole number of basis points between 0 and 10,000\./);
});

test('bad amounts are refused by the amount parser', () => {
  assert.throws(() => modelCrowdfundRaise({ ...DEFAULT, raised: '-1' }), /positive decimal amount/);
  assert.throws(() => modelCrowdfundRaise({ ...DEFAULT, goal: '1,000' }), /positive decimal amount/);
});

test('wiring: app.js imports the model, renders a crowdfund panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelCrowdfundRaise/);
  assert.match(app, /data-crowd/);
  assert.match(app, /crowd-output/);
  assert.match(app, /v1\.276/);
  assert.match(readme, /Crowdfund raise model/);
});
