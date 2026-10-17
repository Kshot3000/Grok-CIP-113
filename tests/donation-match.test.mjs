import test from 'node:test';
import assert from 'node:assert/strict';
import { modelDonationMatch } from '../src/domain.js';

const DEFAULT = { amount: '250', matchRateBps: 10000, matchingPool: '1000', decimals: 6 };

test('preload: a 250 contribution at 10000 bps from a 1000 pool is matched 250 whole, 500 is received, and 750 stays in the pool', () => {
  const r = modelDonationMatch(DEFAULT);
  assert.equal(r.amount, 250000000n);
  assert.equal(r.uncappedMatchAmount, 250000000n);
  assert.equal(r.matchAmount, 250000000n);
  assert.equal(r.totalReceivedAmount, 500000000n);
  assert.equal(r.poolRemainingAmount, 750000000n);
  assert.equal(r.unmetMatchAmount, 0n);
  assert.equal(r.matchCappedByPool, false);
  assert.equal(r.noMatchStated, false);
});

test('identities: contribution plus match is the total received exactly, and match plus pool remaining is the pool exactly', () => {
  for (const [amount, matchRateBps, matchingPool, decimals] of [['250', 10000, '1000', 6], ['999', 500, '1000', 0], ['250', 10000, '100', 6], ['2.5', 10000, '1000', 6], ['250', 20000, '1000', 6], ['250', 0, '1000', 6]]) {
    const r = modelDonationMatch({ amount, matchRateBps, matchingPool, decimals });
    assert.equal(r.amount + r.matchAmount, r.totalReceivedAmount);
    assert.equal(r.matchAmount + r.poolRemainingAmount, r.matchingPoolAmount);
    assert.equal(r.matchAmount + r.unmetMatchAmount, r.uncappedMatchAmount);
  }
});

test('the match is measured on the contribution, never on the total received: 10000 bps of the 250 contributed is 250, not a share of the 500 received', () => {
  const r = modelDonationMatch(DEFAULT);
  assert.equal(r.matchAmount, 250000000n);
  assert.equal(r.matchMeasuredOnTotal, false);
});

test('the match is capped by the pool: a 250 contribution at 10000 bps against a 100 pool matches 100, with 150 of stated match unmet and stated', () => {
  const r = modelDonationMatch({ amount: '250', matchRateBps: 10000, matchingPool: '100', decimals: 6 });
  assert.equal(r.uncappedMatchAmount, 250000000n);
  assert.equal(r.matchAmount, 100000000n);
  assert.equal(r.unmetMatchAmount, 150000000n);
  assert.equal(r.totalReceivedAmount, 350000000n);
  assert.equal(r.poolRemainingAmount, 0n);
  assert.equal(r.matchCappedByPool, true);
  assert.equal(r.matchIsWholePool, true);
  assert.equal(r.matchExceedsPool, false);
});

test('a match that reaches the pool exactly is not capped: the pool is taken whole with nothing unmet', () => {
  const r = modelDonationMatch({ amount: '250', matchRateBps: 10000, matchingPool: '250', decimals: 6 });
  assert.equal(r.matchAmount, 250000000n);
  assert.equal(r.unmetMatchAmount, 0n);
  assert.equal(r.matchCappedByPool, false);
  assert.equal(r.matchIsWholePool, true);
  assert.equal(r.poolRemainingAmount, 0n);
});

test('shares are derived from the amounts against the total received: 250 contributed of 500 received is a 5000.00 share, 250 matched a 5000.00 share', () => {
  const r = modelDonationMatch(DEFAULT);
  assert.equal(r.contributionShareBpsText, '5000.00');
  assert.equal(r.matchShareBpsText, '5000.00');
});

test('shares floor, never round: 999 contributed and 49 matched of 1048 received are 9532.44 and 467.55 shares', () => {
  const r = modelDonationMatch({ amount: '999', matchRateBps: 500, matchingPool: '1000', decimals: 0 });
  assert.equal(r.contributionShareBpsText, '9532.44');
  assert.equal(r.matchShareBpsText, '467.55');
});

test('the match floors: 500 bps of a 999 contribution matches 49, never the 50 rounding would state', () => {
  const r = modelDonationMatch({ amount: '999', matchRateBps: 500, matchingPool: '1000', decimals: 0 });
  assert.equal(r.matchAmount, 49n);
  assert.equal(r.totalReceivedAmount, 1048n);
  assert.equal(r.poolRemainingAmount, 951n);
});

test('a match rate above the whole matches more than the contribution: 20000 bps of 250 matches 500, for 750 received', () => {
  const r = modelDonationMatch({ amount: '250', matchRateBps: 20000, matchingPool: '1000', decimals: 6 });
  assert.equal(r.matchAmount, 500000000n);
  assert.equal(r.totalReceivedAmount, 750000000n);
  assert.equal(r.contributionShareBpsText, '3333.33');
  assert.equal(r.matchShareBpsText, '6666.66');
});

test('no rate stated matches nothing: the contribution stands alone and the pool stands whole', () => {
  const r = modelDonationMatch({ amount: '250', matchRateBps: 0, matchingPool: '1000', decimals: 6 });
  assert.equal(r.noMatchRateStated, true);
  assert.equal(r.matchAmount, 0n);
  assert.equal(r.totalReceivedAmount, r.amount);
  assert.equal(r.poolRemainingAmount, r.matchingPoolAmount);
  assert.equal(r.noMatchStated, true);
});

test('nothing contributed states no matching: nothing is matched, nothing is received, and the pool stands whole', () => {
  const r = modelDonationMatch({ amount: '0', matchRateBps: 10000, matchingPool: '1000', decimals: 6 });
  assert.equal(r.noContributionStated, true);
  assert.equal(r.matchAmount, 0n);
  assert.equal(r.totalReceivedAmount, 0n);
  assert.equal(r.poolRemainingAmount, r.matchingPoolAmount);
});

test('an empty pool matches nothing, however large the stated rate, and the whole stated match is unmet', () => {
  const r = modelDonationMatch({ amount: '250', matchRateBps: 10000, matchingPool: '0', decimals: 6 });
  assert.equal(r.matchingPoolEmpty, true);
  assert.equal(r.matchAmount, 0n);
  assert.equal(r.unmetMatchAmount, 250000000n);
  assert.equal(r.matchCappedByPool, true);
  assert.equal(r.totalReceivedAmount, r.amount);
});

test('a stated rate flooring to zero on a one-base-unit contribution matches nothing at that size', () => {
  const r = modelDonationMatch({ amount: '1', matchRateBps: 500, matchingPool: '1000', decimals: 0 });
  assert.equal(r.matchAmount, 0n);
  assert.equal(r.matchFloorsToZero, true);
  assert.equal(r.totalReceivedAmount, 1n);
  assert.equal(r.poolRemainingAmount, 1000n);
});

test('a match rate beyond the stated bound, negative, or fractional is refused', () => {
  assert.throws(() => modelDonationMatch({ amount: '250', matchRateBps: 100001, matchingPool: '1000', decimals: 6 }), /whole number of basis points/);
  assert.throws(() => modelDonationMatch({ amount: '250', matchRateBps: -1, matchingPool: '1000', decimals: 6 }), /whole number of basis points/);
  assert.throws(() => modelDonationMatch({ amount: '250', matchRateBps: 2.5, matchingPool: '1000', decimals: 6 }), /whole number of basis points/);
});

test('fractional contributions match exactly in BigInt: 2.5 contributed at 10000 bps matches 2.5, for 5 received', () => {
  const r = modelDonationMatch({ amount: '2.5', matchRateBps: 10000, matchingPool: '1000', decimals: 6 });
  assert.equal(r.matchAmount, 2500000n);
  assert.equal(r.totalReceivedAmount, 5000000n);
  assert.equal(r.poolRemainingAmount, 997500000n);
});

test('the match is not the donor money, not a discount, and not yield, and a contribution is not a purchase', () => {
  const r = modelDonationMatch(DEFAULT);
  assert.equal(r.matchIsDonorMoney, false);
  assert.equal(r.matchIsDiscount, false);
  assert.equal(r.matchIsYield, false);
  assert.equal(r.contributionIsPurchase, false);
});

test('what is not priced stays unpriced: eligibility, pool funding, replenishment, per-donor caps, timing, and verification', () => {
  const r = modelDonationMatch(DEFAULT);
  assert.equal(r.eligibilityPriced, false);
  assert.equal(r.poolFundingPriced, false);
  assert.equal(r.poolReplenishmentPriced, false);
  assert.equal(r.perDonorCapPriced, false);
  assert.equal(r.matchTimingPriced, false);
  assert.equal(r.verificationPriced, false);
});
