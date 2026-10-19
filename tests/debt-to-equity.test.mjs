import test from 'node:test';
import assert from 'node:assert/strict';
import { modelDebtToEquity } from '../src/domain.js';

const DEFAULT = { totalLiabilities: '750000', totalEquity: '250000', decimals: 6 };
const CASES = [
  DEFAULT,
  { totalLiabilities: '250000', totalEquity: '750000', decimals: 6 },
  { totalLiabilities: '500000', totalEquity: '500000', decimals: 6 },
  { totalLiabilities: '1000000', totalEquity: '0', decimals: 6 },
  { totalLiabilities: '0', totalEquity: '1000000', decimals: 6 },
  { totalLiabilities: '3', totalEquity: '1.000001', decimals: 6 },
  { totalLiabilities: '7', totalEquity: '2', decimals: 6 },
  { totalLiabilities: '333333', totalEquity: '250000', decimals: 6 },
  { totalLiabilities: '0.000002', totalEquity: '0.000001', decimals: 6 },
  { totalLiabilities: '125', totalEquity: '500', decimals: 0 },
];

test('preload: liabilities of 750000 against equity of 250000 are funded by capital of 1000000000000, a ratio of 30000 bps, and a capital split of 7500 bps liabilities to 2500 bps equity', () => {
  const r = modelDebtToEquity(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.totalLiabilities, 750000000000n);
  assert.equal(r.totalEquity, 250000000000n);
  assert.equal(r.totalCapital, 1000000000000n);
  assert.equal(r.debtToEquityBps, 30000n);
  assert.equal(r.liabilitiesBpsOfCapital, 7500n);
  assert.equal(r.equityBpsOfCapital, 2500n);
  assert.equal(r.debtExcess, 500000000000n);
  assert.equal(r.equityExcess, 0n);
  assert.equal(r.hasRatio, true);
  assert.equal(r.liabilitiesExceedEquity, true);
});

test('the total capital is the liabilities plus the equity exactly, and debt excess less equity excess is the signed difference, on every stated case', () => {
  for (const input of CASES) {
    const r = modelDebtToEquity(input);
    assert.equal(r.totalCapital, r.totalLiabilities + r.totalEquity);
    assert.equal(r.debtExcess - r.equityExcess, r.totalLiabilities - r.totalEquity);
    assert.ok(!(r.debtExcess > 0n && r.equityExcess > 0n));
    assert.equal(r.liabilitiesExceedEquity, r.totalLiabilities > r.totalEquity);
  }
});

test('the ratio is the exact floor, on every stated case where a ratio stands', () => {
  for (const input of CASES) {
    const r = modelDebtToEquity(input);
    if (!r.hasRatio) continue;
    assert.ok(r.debtToEquityBps * r.totalEquity <= r.totalLiabilities * 10000n);
    assert.ok((r.debtToEquityBps + 1n) * r.totalEquity > r.totalLiabilities * 10000n);
    assert.equal(r.ratioRoundedDown, true);
    assert.equal(r.ratioMeasuredOnEquity, true);
  }
});

test('the capital shares are each the exact floor and together state 10000 bps or one less from the flooring, on every stated case where capital stands', () => {
  for (const input of CASES) {
    const r = modelDebtToEquity(input);
    if (r.liabilitiesBpsOfCapital === null) continue;
    assert.ok(r.liabilitiesBpsOfCapital * r.totalCapital <= r.totalLiabilities * 10000n);
    assert.ok((r.liabilitiesBpsOfCapital + 1n) * r.totalCapital > r.totalLiabilities * 10000n);
    assert.ok(r.equityBpsOfCapital * r.totalCapital <= r.totalEquity * 10000n);
    assert.ok((r.equityBpsOfCapital + 1n) * r.totalCapital > r.totalEquity * 10000n);
    const sum = r.liabilitiesBpsOfCapital + r.equityBpsOfCapital;
    assert.ok(sum === 10000n || sum === 9999n);
  }
});

test('the ratio is measured on the equity, never the capital: stating the liabilities share of capital as the leverage would state 7500 bps on the preload, not 30000', () => {
  const r = modelDebtToEquity(DEFAULT);
  assert.notEqual(r.debtToEquityBps, r.liabilitiesBpsOfCapital);
  assert.ok(r.debtToEquityBps > r.liabilitiesBpsOfCapital);
});

test('equity above the liabilities is stated: liabilities of 250000 against equity of 750000 state a ratio of 3333 bps and an equity excess of 500000000000', () => {
  const r = modelDebtToEquity({ totalLiabilities: '250000', totalEquity: '750000', decimals: 6 });
  assert.equal(r.debtToEquityBps, 3333n);
  assert.equal(r.equityExcess, 500000000000n);
  assert.equal(r.debtExcess, 0n);
  assert.equal(r.liabilitiesExceedEquity, false);
});

test('liabilities equal to the equity state a ratio of exactly 10000 bps and a capital split of 5000 bps each', () => {
  const r = modelDebtToEquity({ totalLiabilities: '500000', totalEquity: '500000', decimals: 6 });
  assert.equal(r.debtToEquityBps, 10000n);
  assert.equal(r.liabilitiesBpsOfCapital, 5000n);
  assert.equal(r.equityBpsOfCapital, 5000n);
  assert.equal(r.debtExcess, 0n);
  assert.equal(r.equityExcess, 0n);
});

test('equity of zero states no finite ratio, not a refusal and not an infinite figure: the whole capital is creditor-funded', () => {
  const r = modelDebtToEquity({ totalLiabilities: '1000000', totalEquity: '0', decimals: 6 });
  assert.equal(r.hasRatio, false);
  assert.equal(r.debtToEquityBps, null);
  assert.equal(r.totalCapital, 1000000000000n);
  assert.equal(r.liabilitiesBpsOfCapital, 10000n);
  assert.equal(r.equityBpsOfCapital, 0n);
  assert.equal(r.debtExcess, 1000000000000n);
});

test('liabilities of zero are stated, not refused: the ratio is zero and the whole capital is equity', () => {
  const r = modelDebtToEquity({ totalLiabilities: '0', totalEquity: '1000000', decimals: 6 });
  assert.equal(r.debtToEquityBps, 0n);
  assert.equal(r.liabilitiesBpsOfCapital, 0n);
  assert.equal(r.equityBpsOfCapital, 10000n);
  assert.equal(r.equityExcess, 1000000000000n);
  assert.equal(r.liabilitiesExceedEquity, false);
});

test('both figures at zero state capital of zero, no finite ratio, and no capital shares', () => {
  const r = modelDebtToEquity({ totalLiabilities: '0', totalEquity: '0', decimals: 6 });
  assert.equal(r.totalCapital, 0n);
  assert.equal(r.hasRatio, false);
  assert.equal(r.debtToEquityBps, null);
  assert.equal(r.liabilitiesBpsOfCapital, null);
  assert.equal(r.equityBpsOfCapital, null);
});

test('the flooring is stated exactly: liabilities of 3 against equity of 1.000001 state a ratio of 29999 bps and capital shares of 7499 and 2500 bps', () => {
  const r = modelDebtToEquity({ totalLiabilities: '3', totalEquity: '1.000001', decimals: 6 });
  assert.equal(r.debtToEquityBps, 29999n);
  assert.equal(r.liabilitiesBpsOfCapital, 7499n);
  assert.equal(r.equityBpsOfCapital, 2500n);
  assert.equal(r.debtExcess, 1999999n);
});

test('the ratio carries no cap: liabilities of 7 against equity of 2 state a ratio of 35000 bps', () => {
  const r = modelDebtToEquity({ totalLiabilities: '7', totalEquity: '2', decimals: 6 });
  assert.equal(r.debtToEquityBps, 35000n);
  assert.equal(r.liabilitiesBpsOfCapital, 7777n);
  assert.equal(r.equityBpsOfCapital, 2222n);
});

test('base-unit amounts are exact: liabilities of 0.000002 against equity of 0.000001 state capital of 3 and a ratio of 20000 bps', () => {
  const r = modelDebtToEquity({ totalLiabilities: '0.000002', totalEquity: '0.000001', decimals: 6 });
  assert.equal(r.totalCapital, 3n);
  assert.equal(r.debtToEquityBps, 20000n);
  assert.equal(r.debtExcess, 1n);
});

test('the leverage is not solvency, not profit, and not a fee', () => {
  const r = modelDebtToEquity(DEFAULT);
  assert.equal(r.leverageIsSolvency, false);
  assert.equal(r.leverageIsProfit, false);
  assert.equal(r.leverageIsFee, false);
});

test('no interest cost, maturity, asset value, off-statement obligation, or tax is priced', () => {
  const r = modelDebtToEquity(DEFAULT);
  assert.equal(r.interestCostPriced, false);
  assert.equal(r.maturityPriced, false);
  assert.equal(r.assetValuesPriced, false);
  assert.equal(r.offStatementPriced, false);
  assert.equal(r.taxesPriced, false);
});
