import test from 'node:test';
import assert from 'node:assert/strict';
import { modelInterestCoverage } from '../src/domain.js';

const DEFAULT = { earningsBeforeInterest: '1000000', interestExpense: '250000', decimals: 6 };
const CASES = [
  DEFAULT,
  { earningsBeforeInterest: '600000', interestExpense: '600000', decimals: 6 },
  { earningsBeforeInterest: '400000', interestExpense: '1000000', decimals: 6 },
  { earningsBeforeInterest: '0', interestExpense: '250000', decimals: 6 },
  { earningsBeforeInterest: '1000000', interestExpense: '0', decimals: 6 },
  { earningsBeforeInterest: '3', interestExpense: '1.000001', decimals: 6 },
  { earningsBeforeInterest: '7', interestExpense: '2', decimals: 6 },
  { earningsBeforeInterest: '333333', interestExpense: '250000', decimals: 6 },
  { earningsBeforeInterest: '0.000002', interestExpense: '0.000001', decimals: 6 },
  { earningsBeforeInterest: '125', interestExpense: '500', decimals: 0 },
];

test('preload: earnings before interest of 1000000 cover interest expense of 250000 at 40000 bps, the interest is 2500 bps of the earnings, and 750000000000 stands after interest', () => {
  const r = modelInterestCoverage(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.earningsBeforeInterest, 1000000000000n);
  assert.equal(r.interestExpense, 250000000000n);
  assert.equal(r.coverageBps, 40000n);
  assert.equal(r.interestBpsOfEarnings, 2500n);
  assert.equal(r.earningsAfterInterest, 750000000000n);
  assert.equal(r.shortfall, 0n);
  assert.equal(r.hasCoverage, true);
  assert.equal(r.hasEarningsShare, true);
  assert.equal(r.earningsCoverInterest, true);
  assert.equal(r.interestExceedsEarnings, false);
});

test('the earnings after interest are the earnings less the interest expense exactly, and the shortfall is the negative part stated whole, on every stated case', () => {
  for (const input of CASES) {
    const r = modelInterestCoverage(input);
    assert.equal(r.earningsAfterInterest, r.earningsBeforeInterest - r.interestExpense);
    assert.equal(r.shortfall, r.earningsAfterInterest < 0n ? -r.earningsAfterInterest : 0n);
    assert.equal(r.interestExceedsEarnings, r.interestExpense > r.earningsBeforeInterest);
    assert.equal(r.earningsCoverInterest, r.earningsBeforeInterest >= r.interestExpense);
    assert.equal(r.hasCoverage, r.interestExpense > 0n);
    assert.equal(r.hasEarningsShare, r.earningsBeforeInterest > 0n);
  }
});

test('the coverage is the exact floor, on every stated case where a coverage stands', () => {
  for (const input of CASES) {
    const r = modelInterestCoverage(input);
    if (!r.hasCoverage) continue;
    assert.ok(r.coverageBps * r.interestExpense <= r.earningsBeforeInterest * 10000n);
    assert.ok((r.coverageBps + 1n) * r.interestExpense > r.earningsBeforeInterest * 10000n);
    assert.equal(r.coverageRoundedDown, true);
    assert.equal(r.coverageMeasuredOnInterestExpense, true);
  }
});

test('the interest share of the earnings is the exact floor and carries no cap, on every stated case where earnings stand', () => {
  for (const input of CASES) {
    const r = modelInterestCoverage(input);
    if (!r.hasEarningsShare) continue;
    assert.ok(r.interestBpsOfEarnings * r.earningsBeforeInterest <= r.interestExpense * 10000n);
    assert.ok((r.interestBpsOfEarnings + 1n) * r.earningsBeforeInterest > r.interestExpense * 10000n);
  }
});

test('the coverage is measured on the interest expense, never on the earnings: the earnings against themselves would state 10000 bps on the preload, not 40000', () => {
  const r = modelInterestCoverage(DEFAULT);
  assert.notEqual(r.coverageBps, 10000n);
  assert.equal(r.coverageBps, 40000n);
});

test('interest expense is not principal: no principal, debt balance, or maturity is priced, and the coverage is not a debt-service statement', () => {
  const r = modelInterestCoverage(DEFAULT);
  assert.equal(r.principalPriced, false);
  assert.equal(r.debtBalancePriced, false);
  assert.equal(r.maturityPriced, false);
});

test('interest above the earnings states signed earnings after interest: interest of 1000000 against earnings of 400000 states coverage of 4000 bps, an interest share of 25000 bps, and a shortfall of 600000000000', () => {
  const r = modelInterestCoverage({ earningsBeforeInterest: '400000', interestExpense: '1000000', decimals: 6 });
  assert.equal(r.coverageBps, 4000n);
  assert.equal(r.interestBpsOfEarnings, 25000n);
  assert.equal(r.earningsAfterInterest, -600000000000n);
  assert.equal(r.shortfall, 600000000000n);
  assert.equal(r.interestExceedsEarnings, true);
  assert.equal(r.earningsCoverInterest, false);
});

test('interest equal to the earnings states coverage of exactly 10000 bps and earnings after interest of zero', () => {
  const r = modelInterestCoverage({ earningsBeforeInterest: '600000', interestExpense: '600000', decimals: 6 });
  assert.equal(r.coverageBps, 10000n);
  assert.equal(r.interestBpsOfEarnings, 10000n);
  assert.equal(r.earningsAfterInterest, 0n);
  assert.equal(r.shortfall, 0n);
  assert.equal(r.earningsCoverInterest, true);
});

test('interest expense of zero states no finite coverage, not a refusal and not an infinite figure: the whole earnings stand after interest', () => {
  const r = modelInterestCoverage({ earningsBeforeInterest: '1000000', interestExpense: '0', decimals: 6 });
  assert.equal(r.hasCoverage, false);
  assert.equal(r.coverageBps, null);
  assert.equal(r.interestBpsOfEarnings, 0n);
  assert.equal(r.earningsAfterInterest, 1000000000000n);
  assert.equal(r.shortfall, 0n);
});

test('earnings of zero are stated, not refused: the coverage is zero, no share of the earnings stands, and the whole interest expense is shortfall', () => {
  const r = modelInterestCoverage({ earningsBeforeInterest: '0', interestExpense: '250000', decimals: 6 });
  assert.equal(r.coverageBps, 0n);
  assert.equal(r.hasEarningsShare, false);
  assert.equal(r.interestBpsOfEarnings, null);
  assert.equal(r.earningsAfterInterest, -250000000000n);
  assert.equal(r.shortfall, 250000000000n);
  assert.equal(r.earningsCoverInterest, false);
});

test('both figures at zero state no coverage, no earnings share, and earnings after interest of zero', () => {
  const r = modelInterestCoverage({ earningsBeforeInterest: '0', interestExpense: '0', decimals: 6 });
  assert.equal(r.hasCoverage, false);
  assert.equal(r.coverageBps, null);
  assert.equal(r.hasEarningsShare, false);
  assert.equal(r.interestBpsOfEarnings, null);
  assert.equal(r.earningsAfterInterest, 0n);
  assert.equal(r.shortfall, 0n);
});

test('the flooring is stated exactly: earnings of 3 against interest of 1.000001 state coverage of 29999 bps, an interest share of 3333 bps, and 1999999 after interest', () => {
  const r = modelInterestCoverage({ earningsBeforeInterest: '3', interestExpense: '1.000001', decimals: 6 });
  assert.equal(r.coverageBps, 29999n);
  assert.equal(r.interestBpsOfEarnings, 3333n);
  assert.equal(r.earningsAfterInterest, 1999999n);
});

test('base-unit amounts are exact: earnings of 0.000002 against interest of 0.000001 state coverage of 20000 bps, an interest share of 5000 bps, and 1 after interest', () => {
  const r = modelInterestCoverage({ earningsBeforeInterest: '0.000002', interestExpense: '0.000001', decimals: 6 });
  assert.equal(r.coverageBps, 20000n);
  assert.equal(r.interestBpsOfEarnings, 5000n);
  assert.equal(r.earningsAfterInterest, 1n);
});

test('the coverage is not solvency, not cash flow, not profit, and not a fee', () => {
  const r = modelInterestCoverage(DEFAULT);
  assert.equal(r.coverageIsSolvency, false);
  assert.equal(r.coverageIsCashFlow, false);
  assert.equal(r.coverageIsProfit, false);
  assert.equal(r.coverageIsFee, false);
});

test('no tax is priced: the earnings stand before taxes by their stated name', () => {
  const r = modelInterestCoverage(DEFAULT);
  assert.equal(r.taxesPriced, false);
});
