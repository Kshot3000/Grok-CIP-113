import test from 'node:test';
import assert from 'node:assert/strict';
import { modelMatchingPoolPosition, modelDonationMatch } from '../src/domain.js';

const DEFAULT = { startingPool: '1000', matchesMade: '250', decimals: 6 };

test('preload: a 1000 pool that has paid 250 in matches holds 750, a 2500.00 drawn share and a 7500.00 remaining share', () => {
  const r = modelMatchingPoolPosition(DEFAULT);
  assert.equal(r.startingPoolAmount, 1000000000n);
  assert.equal(r.matchesMadeAmount, 250000000n);
  assert.equal(r.poolRemainingAmount, 750000000n);
  assert.equal(r.drawnShareBpsText, '2500.00');
  assert.equal(r.remainingShareBpsText, '7500.00');
  assert.equal(r.poolExhausted, false);
  assert.equal(r.noMatchesMade, false);
});

test('identity: matches made plus pool remaining is the starting pool exactly', () => {
  for (const [startingPool, matchesMade, decimals] of [['1000', '250', 6], ['999', '1', 0], ['1000', '1000', 6], ['1000', '0', 6], ['10', '2.5', 6], ['0', '0', 6]]) {
    const r = modelMatchingPoolPosition({ startingPool, matchesMade, decimals });
    assert.equal(r.matchesMadeAmount + r.poolRemainingAmount, r.startingPoolAmount);
  }
});

test('composition: the remainder here is the pool remaining the matching model states for the same draw', () => {
  const m = modelDonationMatch({ amount: '250', matchRateBps: 10000, matchingPool: '1000', decimals: 6 });
  const r = modelMatchingPoolPosition({ startingPool: '1000', matchesMade: '250', decimals: 6 });
  assert.equal(r.matchesMadeAmount, m.matchAmount);
  assert.equal(r.poolRemainingAmount, m.poolRemainingAmount);
});

test('a later match draws on the remainder, never the starting pool: what remains is 750, not the 1000 the pool started with', () => {
  const r = modelMatchingPoolPosition(DEFAULT);
  assert.equal(r.poolRemainingAmount, 750000000n);
  assert.equal(r.laterMatchDrawsOnStartingPool, false);
  assert.equal(r.laterMatchPricedHere, false);
});

test('matches made beyond the starting pool are refused: a pool cannot have paid out more than it held', () => {
  assert.throws(() => modelMatchingPoolPosition({ startingPool: '100', matchesMade: '250', decimals: 6 }), /cannot exceed the starting pool/);
  assert.throws(() => modelMatchingPoolPosition({ startingPool: '0', matchesMade: '1', decimals: 0 }), /cannot exceed the starting pool/);
});

test('no matches made states the pool stands whole at its starting amount', () => {
  const r = modelMatchingPoolPosition({ startingPool: '1000', matchesMade: '0', decimals: 6 });
  assert.equal(r.noMatchesMade, true);
  assert.equal(r.poolStandsWhole, true);
  assert.equal(r.poolRemainingAmount, r.startingPoolAmount);
  assert.equal(r.drawnShareBpsText, '0.00');
  assert.equal(r.remainingShareBpsText, '10000.00');
});

test('a pool drawn whole is exhausted: nothing remains and a later contribution can be matched with nothing from it', () => {
  const r = modelMatchingPoolPosition({ startingPool: '1000', matchesMade: '1000', decimals: 6 });
  assert.equal(r.poolRemainingAmount, 0n);
  assert.equal(r.poolExhausted, true);
  assert.equal(r.poolStandsWhole, false);
  assert.equal(r.remainingShareBpsText, '0.00');
});

test('a pool that started empty holds nothing and has drawn nothing', () => {
  const r = modelMatchingPoolPosition({ startingPool: '0', matchesMade: '0', decimals: 6 });
  assert.equal(r.poolWasEmpty, true);
  assert.equal(r.noMatchesMade, true);
  assert.equal(r.poolStandsWhole, false);
  assert.equal(r.poolExhausted, false);
  assert.equal(r.poolRemainingAmount, 0n);
  assert.equal(r.drawnShareBpsText, '0.00');
  assert.equal(r.remainingShareBpsText, '0.00');
});

test('shares floor, never round: 1 drawn of a 999 pool is a 10.01 share, and the 998 remaining is a 9989.98 share', () => {
  const r = modelMatchingPoolPosition({ startingPool: '999', matchesMade: '1', decimals: 0 });
  assert.equal(r.drawnShareBpsText, '10.01');
  assert.equal(r.remainingShareBpsText, '9989.98');
  assert.equal(r.poolRemainingAmount, 998n);
});

test('fractional draws state exactly in BigInt: 2.5 drawn of a 10 pool leaves 7.5', () => {
  const r = modelMatchingPoolPosition({ startingPool: '10', matchesMade: '2.5', decimals: 6 });
  assert.equal(r.matchesMadeAmount, 2500000n);
  assert.equal(r.poolRemainingAmount, 7500000n);
});

test('one base unit drawn states the smallest possible position change exactly', () => {
  const r = modelMatchingPoolPosition({ startingPool: '1000', matchesMade: '1', decimals: 0 });
  assert.equal(r.poolRemainingAmount, 999n);
  assert.equal(r.noMatchesMade, false);
  assert.equal(r.poolExhausted, false);
});

test('a match once paid does not return to the pool, and what remains is not new money', () => {
  const r = modelMatchingPoolPosition(DEFAULT);
  assert.equal(r.drawnReturnsToPool, false);
  assert.equal(r.remainingIsNewMoney, false);
});

test('what was drawn is matches paid from the pool, not contributions paid into it', () => {
  const r = modelMatchingPoolPosition(DEFAULT);
  assert.equal(r.matchesAreContributions, false);
});

test('what is not priced stays unpriced: pool funding, replenishment, a later match, and eligibility', () => {
  const r = modelMatchingPoolPosition(DEFAULT);
  assert.equal(r.poolFundingPriced, false);
  assert.equal(r.replenishmentPriced, false);
  assert.equal(r.laterMatchPricedHere, false);
  assert.equal(r.eligibilityPriced, false);
});
