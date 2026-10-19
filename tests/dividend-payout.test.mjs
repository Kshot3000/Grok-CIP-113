import test from 'node:test';
import assert from 'node:assert/strict';
import { modelDividendPayout } from '../src/domain.js';

const DEFAULT = { netIncome: '1000000', dividends: '250000', decimals: 6 };
const CASES = [
  DEFAULT,
  { netIncome: '600000', dividends: '600000', decimals: 6 },
  { netIncome: '400000', dividends: '1000000', decimals: 6 },
  { netIncome: '0', dividends: '250000', decimals: 6 },
  { netIncome: '1000000', dividends: '0', decimals: 6 },
  { netIncome: '3', dividends: '1.000001', decimals: 6 },
  { netIncome: '7', dividends: '2', decimals: 6 },
  { netIncome: '333333', dividends: '250000', decimals: 6 },
  { netIncome: '0.000002', dividends: '0.000001', decimals: 6 },
  { netIncome: '125', dividends: '500', decimals: 0 },
];

test('preload: net income of 1000000 distributing 250000 states a payout of 2500 bps, retains 750000000000, and the retained share is 7500 bps', () => {
  const r = modelDividendPayout(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.netIncome, 1000000000000n);
  assert.equal(r.dividends, 250000000000n);
  assert.equal(r.payoutBps, 2500n);
  assert.equal(r.retainedBps, 7500n);
  assert.equal(r.retainedEarnings, 750000000000n);
  assert.equal(r.shortfall, 0n);
  assert.equal(r.hasPayoutRatio, true);
  assert.equal(r.hasRetainedShare, true);
  assert.equal(r.incomeCoversDividends, true);
  assert.equal(r.dividendsExceedIncome, false);
});

test('the retained earnings are the income less the distribution exactly, and the shortfall is the negative part stated whole, on every stated case', () => {
  for (const input of CASES) {
    const r = modelDividendPayout(input);
    assert.equal(r.retainedEarnings, r.netIncome - r.dividends);
    assert.equal(r.shortfall, r.retainedEarnings < 0n ? -r.retainedEarnings : 0n);
    assert.equal(r.dividendsExceedIncome, r.dividends > r.netIncome);
    assert.equal(r.incomeCoversDividends, r.netIncome >= r.dividends);
    assert.equal(r.hasPayoutRatio, r.netIncome > 0n);
    assert.equal(r.hasRetainedShare, r.netIncome > 0n && r.retainedEarnings >= 0n);
  }
});

test('the payout ratio is the exact floor, on every stated case where a ratio stands', () => {
  for (const input of CASES) {
    const r = modelDividendPayout(input);
    if (!r.hasPayoutRatio) continue;
    assert.ok(r.payoutBps * r.netIncome <= r.dividends * 10000n);
    assert.ok((r.payoutBps + 1n) * r.netIncome > r.dividends * 10000n);
    assert.equal(r.payoutRoundedDown, true);
    assert.equal(r.payoutMeasuredOnNetIncome, true);
  }
});

test('the retained share is the exact floor, and payout plus retained share is 10000 or one less from the flooring, on every stated case where a retained share stands', () => {
  for (const input of CASES) {
    const r = modelDividendPayout(input);
    if (!r.hasRetainedShare) continue;
    assert.ok(r.retainedBps * r.netIncome <= r.retainedEarnings * 10000n);
    assert.ok((r.retainedBps + 1n) * r.netIncome > r.retainedEarnings * 10000n);
    assert.ok(r.payoutBps + r.retainedBps === 10000n || r.payoutBps + r.retainedBps === 9999n);
  }
});

test('the payout is measured on the net income, never on the distribution: the distribution against itself would state 10000 bps on the preload, not 2500', () => {
  const r = modelDividendPayout(DEFAULT);
  assert.notEqual(r.payoutBps, 10000n);
  assert.equal(r.payoutBps, 2500n);
});

test('a distribution above the income states an uncapped payout and a signed shortfall: dividends of 1000000 against income of 400000 state a payout of 25000 bps, retained of -600000000000, and no retained share', () => {
  const r = modelDividendPayout({ netIncome: '400000', dividends: '1000000', decimals: 6 });
  assert.equal(r.payoutBps, 25000n);
  assert.equal(r.retainedEarnings, -600000000000n);
  assert.equal(r.shortfall, 600000000000n);
  assert.equal(r.hasRetainedShare, false);
  assert.equal(r.retainedBps, null);
  assert.equal(r.dividendsExceedIncome, true);
  assert.equal(r.incomeCoversDividends, false);
});

test('a distribution equal to the income states a payout of exactly 10000 bps, retained earnings of zero, and a retained share of zero', () => {
  const r = modelDividendPayout({ netIncome: '600000', dividends: '600000', decimals: 6 });
  assert.equal(r.payoutBps, 10000n);
  assert.equal(r.retainedBps, 0n);
  assert.equal(r.retainedEarnings, 0n);
  assert.equal(r.shortfall, 0n);
  assert.equal(r.incomeCoversDividends, true);
});

test('a distribution of zero is stated, not refused: the payout is zero and the whole income is retained at a retained share of 10000 bps', () => {
  const r = modelDividendPayout({ netIncome: '1000000', dividends: '0', decimals: 6 });
  assert.equal(r.payoutBps, 0n);
  assert.equal(r.retainedBps, 10000n);
  assert.equal(r.retainedEarnings, 1000000000000n);
  assert.equal(r.shortfall, 0n);
});

test('net income of zero states no finite payout ratio, not a refusal and not an infinite figure: the whole distribution stands as shortfall', () => {
  const r = modelDividendPayout({ netIncome: '0', dividends: '250000', decimals: 6 });
  assert.equal(r.hasPayoutRatio, false);
  assert.equal(r.payoutBps, null);
  assert.equal(r.hasRetainedShare, false);
  assert.equal(r.retainedBps, null);
  assert.equal(r.retainedEarnings, -250000000000n);
  assert.equal(r.shortfall, 250000000000n);
  assert.equal(r.incomeCoversDividends, false);
});

test('both figures at zero state no payout ratio, no retained share, and retained earnings of zero', () => {
  const r = modelDividendPayout({ netIncome: '0', dividends: '0', decimals: 6 });
  assert.equal(r.hasPayoutRatio, false);
  assert.equal(r.payoutBps, null);
  assert.equal(r.hasRetainedShare, false);
  assert.equal(r.retainedBps, null);
  assert.equal(r.retainedEarnings, 0n);
  assert.equal(r.shortfall, 0n);
});

test('the flooring is stated exactly: income of 3 distributing 1.000001 states a payout of 3333 bps, a retained share of 6666 bps, and 1999999 retained', () => {
  const r = modelDividendPayout({ netIncome: '3', dividends: '1.000001', decimals: 6 });
  assert.equal(r.payoutBps, 3333n);
  assert.equal(r.retainedBps, 6666n);
  assert.equal(r.retainedEarnings, 1999999n);
});

test('base-unit amounts are exact: income of 0.000002 distributing 0.000001 states a payout of 5000 bps, a retained share of 5000 bps, and 1 retained', () => {
  const r = modelDividendPayout({ netIncome: '0.000002', dividends: '0.000001', decimals: 6 });
  assert.equal(r.payoutBps, 5000n);
  assert.equal(r.retainedBps, 5000n);
  assert.equal(r.retainedEarnings, 1n);
});

test('the payout is not a yield and not a return: no price stands here and no cost is restated', () => {
  const r = modelDividendPayout(DEFAULT);
  assert.equal(r.payoutIsYield, false);
  assert.equal(r.payoutIsReturn, false);
  assert.equal(r.pricePriced, false);
});

test('the payout is not profit, and the distribution is not a fee', () => {
  const r = modelDividendPayout(DEFAULT);
  assert.equal(r.payoutIsProfit, false);
  assert.equal(r.distributionIsFee, false);
});

test('no per-share amount, future income, or tax is priced', () => {
  const r = modelDividendPayout(DEFAULT);
  assert.equal(r.perShareAmountPriced, false);
  assert.equal(r.futureIncomePriced, false);
  assert.equal(r.taxesPriced, false);
});
