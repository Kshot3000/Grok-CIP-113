import test from 'node:test';
import assert from 'node:assert/strict';
import { modelMilestoneGrant } from '../src/domain.js';

const DEFAULT = { grant: '1000', trancheRateBps: 2500, decimals: 6 };

test('preload: a 2500 bps tranche of a 1000 grant releases 250 and reserves 750, a 2500.00 released share and a 7500.00 reserved share', () => {
  const r = modelMilestoneGrant(DEFAULT);
  assert.equal(r.grantAmount, 1000000000n);
  assert.equal(r.trancheRateBps, 2500);
  assert.equal(r.releasedAmount, 250000000n);
  assert.equal(r.reservedAmount, 750000000n);
  assert.equal(r.releasedShareBpsText, '2500.00');
  assert.equal(r.reservedShareBpsText, '7500.00');
  assert.equal(r.noReleaseStated, false);
  assert.equal(r.trancheReleasesWhole, false);
});

test('identity: released plus reserved is the total grant exactly', () => {
  for (const [grant, trancheRateBps, decimals] of [['1000', 2500, 6], ['999', 5000, 0], ['1000', 10000, 6], ['1000', 0, 6], ['10', 2500, 6], ['0', 2500, 6]]) {
    const r = modelMilestoneGrant({ grant, trancheRateBps, decimals });
    assert.equal(r.releasedAmount + r.reservedAmount, r.grantAmount);
  }
});

test('the release is measured on the total grant, never on the reserved remainder it leaves', () => {
  const r = modelMilestoneGrant(DEFAULT);
  assert.equal(r.releasedAmount, 250000000n);
  assert.equal(r.releaseMeasuredOnReserved, false);
  assert.equal(r.laterTranchesPriced, false);
});

test('a tranche rate beyond the whole is refused: a release cannot exceed the grant that funds it', () => {
  assert.throws(() => modelMilestoneGrant({ grant: '100', trancheRateBps: 10001, decimals: 6 }), /whole number of basis points between 0 and 10,000/);
  assert.throws(() => modelMilestoneGrant({ grant: '100', trancheRateBps: 2.5, decimals: 6 }), /whole number of basis points between 0 and 10,000/);
  assert.throws(() => modelMilestoneGrant({ grant: '100', trancheRateBps: -1, decimals: 6 }), /whole number of basis points between 0 and 10,000/);
  const r = modelMilestoneGrant(DEFAULT);
  assert.equal(r.releaseExceedsGrant, false);
});

test('no tranche stated releases nothing and the grant stands reserved whole', () => {
  const r = modelMilestoneGrant({ grant: '1000', trancheRateBps: 0, decimals: 6 });
  assert.equal(r.noTrancheStated, true);
  assert.equal(r.noReleaseStated, true);
  assert.equal(r.grantReservedWhole, true);
  assert.equal(r.releasedAmount, 0n);
  assert.equal(r.reservedAmount, r.grantAmount);
  assert.equal(r.reservedShareBpsText, '10000.00');
});

test('a tranche of the whole releases the grant whole: nothing remains reserved for later milestones', () => {
  const r = modelMilestoneGrant({ grant: '1000', trancheRateBps: 10000, decimals: 6 });
  assert.equal(r.releasedAmount, r.grantAmount);
  assert.equal(r.reservedAmount, 0n);
  assert.equal(r.trancheReleasesWhole, true);
  assert.equal(r.grantReservedWhole, false);
  assert.equal(r.releasedShareBpsText, '10000.00');
});

test('no grant stated releases nothing and reserves nothing', () => {
  const r = modelMilestoneGrant({ grant: '0', trancheRateBps: 2500, decimals: 6 });
  assert.equal(r.noGrantStated, true);
  assert.equal(r.noReleaseStated, true);
  assert.equal(r.releasedAmount, 0n);
  assert.equal(r.reservedAmount, 0n);
  assert.equal(r.releasedShareBpsText, '0.00');
  assert.equal(r.reservedShareBpsText, '0.00');
});

test('the release floors, never rounds: 5000 bps of a 999 grant releases 499, not 500, a 4994.99 share', () => {
  const r = modelMilestoneGrant({ grant: '999', trancheRateBps: 5000, decimals: 0 });
  assert.equal(r.releasedAmount, 499n);
  assert.equal(r.reservedAmount, 500n);
  assert.equal(r.releasedShareBpsText, '4994.99');
  assert.equal(r.reservedShareBpsText, '5005.00');
});

test('a stated tranche flooring to zero on a one-base-unit grant releases nothing at that size', () => {
  const r = modelMilestoneGrant({ grant: '1', trancheRateBps: 5000, decimals: 0 });
  assert.equal(r.releasedAmount, 0n);
  assert.equal(r.trancheFloorsToZero, true);
  assert.equal(r.grantReservedWhole, true);
});

test('fractional grants state exactly in BigInt: 2500 bps of a 10 grant releases 2.5 and reserves 7.5', () => {
  const r = modelMilestoneGrant({ grant: '10', trancheRateBps: 2500, decimals: 6 });
  assert.equal(r.releasedAmount, 2500000n);
  assert.equal(r.reservedAmount, 7500000n);
});

test('a released tranche is not a payment for goods, not a loan, and not a match', () => {
  const r = modelMilestoneGrant(DEFAULT);
  assert.equal(r.releaseIsPaymentForGoods, false);
  assert.equal(r.releaseIsLoan, false);
  assert.equal(r.releaseIsMatch, false);
});

test('what stays reserved is not yet the recipient money and has not been released', () => {
  const r = modelMilestoneGrant(DEFAULT);
  assert.equal(r.reservedIsRecipientMoney, false);
});

test('what is not priced stays unpriced: milestone verification, eligibility, later tranches, clawback, and timing', () => {
  const r = modelMilestoneGrant(DEFAULT);
  assert.equal(r.milestoneVerificationPriced, false);
  assert.equal(r.eligibilityPriced, false);
  assert.equal(r.laterTranchesPriced, false);
  assert.equal(r.clawbackPriced, false);
  assert.equal(r.releaseTimingPriced, false);
});
