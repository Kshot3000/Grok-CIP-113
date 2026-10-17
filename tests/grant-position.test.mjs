import test from 'node:test';
import assert from 'node:assert/strict';
import { modelGrantPosition, modelMilestoneGrant } from '../src/domain.js';

const DEFAULT = { grant: '1000', released: '250', decimals: 6 };

test('preload: 250 released of a 1000 grant leaves 750 reserved, a 2500.00 released share and a 7500.00 reserved share', () => {
  const r = modelGrantPosition(DEFAULT);
  assert.equal(r.grantAmount, 1000000000n);
  assert.equal(r.releasedAmount, 250000000n);
  assert.equal(r.reservedAmount, 750000000n);
  assert.equal(r.releasedShareBpsText, '2500.00');
  assert.equal(r.reservedShareBpsText, '7500.00');
  assert.equal(r.noReleasesMade, false);
  assert.equal(r.grantFullyReleased, false);
});

test('identity: released plus reserved is the total grant exactly', () => {
  for (const [grant, released, decimals] of [['1000', '250', 6], ['999', '1', 0], ['1000', '1000', 6], ['1000', '0', 6], ['10', '2.5', 6], ['0', '0', 6]]) {
    const r = modelGrantPosition({ grant, released, decimals });
    assert.equal(r.releasedAmount + r.reservedAmount, r.grantAmount);
  }
});

test('composition: the position after the release model tranche is that release exactly', () => {
  const g = modelMilestoneGrant({ grant: '1000', trancheRateBps: 2500, decimals: 6 });
  const r = modelGrantPosition(DEFAULT);
  assert.equal(r.releasedAmount, g.releasedAmount);
  assert.equal(r.reservedAmount, g.reservedAmount);
});

test('a later tranche is measured on the total grant, never on the reserved remainder, but can release at most what remains reserved', () => {
  const r = modelGrantPosition(DEFAULT);
  assert.equal(r.laterTrancheMeasuredOnReserved, false);
  assert.equal(r.laterTrancheExceedsReserved, false);
  assert.equal(r.laterTranchePricedHere, false);
});

test('released beyond the total grant is refused: a grant cannot have released more than it stated', () => {
  assert.throws(() => modelGrantPosition({ grant: '100', released: '101', decimals: 6 }), /Released cannot exceed the total grant/);
  assert.throws(() => modelGrantPosition({ grant: '0', released: '1', decimals: 6 }), /Released cannot exceed the total grant/);
});

test('nothing released states the grant stands reserved whole', () => {
  const r = modelGrantPosition({ grant: '1000', released: '0', decimals: 6 });
  assert.equal(r.noReleasesMade, true);
  assert.equal(r.grantReservedWhole, true);
  assert.equal(r.releasedAmount, 0n);
  assert.equal(r.reservedAmount, r.grantAmount);
  assert.equal(r.reservedShareBpsText, '10000.00');
});

test('a grant released whole states it is fully released: nothing remains reserved for later milestones', () => {
  const r = modelGrantPosition({ grant: '1000', released: '1000', decimals: 6 });
  assert.equal(r.releasedAmount, r.grantAmount);
  assert.equal(r.reservedAmount, 0n);
  assert.equal(r.grantFullyReleased, true);
  assert.equal(r.grantReservedWhole, false);
  assert.equal(r.releasedShareBpsText, '10000.00');
});

test('an empty grant released and reserves nothing', () => {
  const r = modelGrantPosition({ grant: '0', released: '0', decimals: 6 });
  assert.equal(r.grantWasEmpty, true);
  assert.equal(r.noReleasesMade, true);
  assert.equal(r.releasedAmount, 0n);
  assert.equal(r.reservedAmount, 0n);
  assert.equal(r.releasedShareBpsText, '0.00');
  assert.equal(r.reservedShareBpsText, '0.00');
});

test('the shares floor, never round: 1 released of a 999 grant is a 10.01 released share and a 9989.98 reserved share', () => {
  const r = modelGrantPosition({ grant: '999', released: '1', decimals: 0 });
  assert.equal(r.releasedAmount, 1n);
  assert.equal(r.reservedAmount, 998n);
  assert.equal(r.releasedShareBpsText, '10.01');
  assert.equal(r.reservedShareBpsText, '9989.98');
});

test('fractional amounts state exactly in BigInt: 2.5 released of a 10 grant leaves 7.5 reserved', () => {
  const r = modelGrantPosition({ grant: '10', released: '2.5', decimals: 6 });
  assert.equal(r.releasedAmount, 2500000n);
  assert.equal(r.reservedAmount, 7500000n);
});

test('a release once paid does not come back to fund later milestones', () => {
  const r = modelGrantPosition(DEFAULT);
  assert.equal(r.releasedReturnsToReserve, false);
});

test('what remains reserved is not yet the recipient money and is not new money', () => {
  const r = modelGrantPosition(DEFAULT);
  assert.equal(r.reservedIsRecipientMoney, false);
  assert.equal(r.reservedIsNewMoney, false);
});

test('what was released is grant tranches, not contributions paid in by anyone', () => {
  const r = modelGrantPosition(DEFAULT);
  assert.equal(r.releasesAreContributions, false);
});

test('what is not priced stays unpriced: grant funding, later tranches, milestone verification, eligibility, and clawback', () => {
  const r = modelGrantPosition(DEFAULT);
  assert.equal(r.grantFundingPriced, false);
  assert.equal(r.laterTranchePricedHere, false);
  assert.equal(r.milestoneVerificationPriced, false);
  assert.equal(r.eligibilityPriced, false);
  assert.equal(r.clawbackPriced, false);
});
