import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCurrentRatio } from '../src/domain.js';

const DEFAULT = { currentAssets: '1250000', currentLiabilities: '1000000', decimals: 6 };
const CASES = [
  DEFAULT,
  { currentAssets: '800000', currentLiabilities: '1000000', decimals: 6 },
  { currentAssets: '1000000', currentLiabilities: '1000000', decimals: 6 },
  { currentAssets: '1000000', currentLiabilities: '0', decimals: 6 },
  { currentAssets: '0', currentLiabilities: '1000000', decimals: 6 },
  { currentAssets: '3', currentLiabilities: '1.000001', decimals: 6 },
  { currentAssets: '7', currentLiabilities: '2', decimals: 6 },
  { currentAssets: '250000', currentLiabilities: '333333', decimals: 6 },
  { currentAssets: '0.000001', currentLiabilities: '0.000002', decimals: 6 },
  { currentAssets: '500', currentLiabilities: '125', decimals: 0 },
];

test('preload: assets of 1250000 against liabilities of 1000000 leave working capital of 250000000000, a ratio of 12500 bps, and liabilities of 8000 bps of the assets', () => {
  const r = modelCurrentRatio(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.currentAssets, 1250000000000n);
  assert.equal(r.currentLiabilities, 1000000000000n);
  assert.equal(r.workingCapital, 250000000000n);
  assert.equal(r.ratioBps, 12500n);
  assert.equal(r.liabilitiesBpsOfAssets, 8000n);
  assert.equal(r.surplus, 250000000000n);
  assert.equal(r.shortfall, 0n);
  assert.equal(r.hasRatio, true);
  assert.equal(r.coversLiabilities, true);
});

test('the working capital is the assets less the liabilities signed exactly, and surplus less shortfall is the working capital, on every stated case', () => {
  for (const input of CASES) {
    const r = modelCurrentRatio(input);
    assert.equal(r.workingCapital, r.currentAssets - r.currentLiabilities);
    assert.equal(r.surplus - r.shortfall, r.workingCapital);
    assert.ok(!(r.surplus > 0n && r.shortfall > 0n));
    assert.equal(r.coversLiabilities, r.currentAssets >= r.currentLiabilities);
    assert.equal(r.workingCapitalSigned, true);
  }
});

test('the ratio is the exact floor, on every stated case where a ratio stands', () => {
  for (const input of CASES) {
    const r = modelCurrentRatio(input);
    if (!r.hasRatio) continue;
    assert.ok(r.ratioBps * r.currentLiabilities <= r.currentAssets * 10000n);
    assert.ok((r.ratioBps + 1n) * r.currentLiabilities > r.currentAssets * 10000n);
    assert.equal(r.ratioRoundedDown, true);
  }
});

test('the liabilities share of the assets is the exact floor, on every stated case where assets stand', () => {
  for (const input of CASES) {
    const r = modelCurrentRatio(input);
    if (r.liabilitiesBpsOfAssets === null) continue;
    assert.ok(r.liabilitiesBpsOfAssets * r.currentAssets <= r.currentLiabilities * 10000n);
    assert.ok((r.liabilitiesBpsOfAssets + 1n) * r.currentAssets > r.currentLiabilities * 10000n);
  }
});

test('the ratio is measured on the liabilities, never the assets: stating the liabilities share as the coverage would state 8000 bps on the preload, not 12500', () => {
  const r = modelCurrentRatio(DEFAULT);
  assert.notEqual(r.ratioBps, r.liabilitiesBpsOfAssets);
  assert.ok(r.ratioBps > r.liabilitiesBpsOfAssets);
});

test('a shortfall is stated, not refused: assets of 800000 against liabilities of 1000000 state working capital of -200000000000 and a shortfall of 200000000000', () => {
  const r = modelCurrentRatio({ currentAssets: '800000', currentLiabilities: '1000000', decimals: 6 });
  assert.equal(r.workingCapital, -200000000000n);
  assert.equal(r.shortfall, 200000000000n);
  assert.equal(r.surplus, 0n);
  assert.equal(r.ratioBps, 8000n);
  assert.equal(r.coversLiabilities, false);
});

test('assets equal to the liabilities state a ratio of exactly 10000 bps and working capital of zero', () => {
  const r = modelCurrentRatio({ currentAssets: '1000000', currentLiabilities: '1000000', decimals: 6 });
  assert.equal(r.ratioBps, 10000n);
  assert.equal(r.liabilitiesBpsOfAssets, 10000n);
  assert.equal(r.workingCapital, 0n);
  assert.equal(r.coversLiabilities, true);
});

test('liabilities of zero state no finite ratio, not a refusal and not an infinite figure: the working capital is the assets themselves', () => {
  const r = modelCurrentRatio({ currentAssets: '1000000', currentLiabilities: '0', decimals: 6 });
  assert.equal(r.hasRatio, false);
  assert.equal(r.ratioBps, null);
  assert.equal(r.workingCapital, 1000000000000n);
  assert.equal(r.liabilitiesBpsOfAssets, 0n);
  assert.equal(r.coversLiabilities, true);
});

test('assets of zero are stated, not refused: the ratio is zero, the liabilities share stands against nothing, and the whole liabilities are shortfall', () => {
  const r = modelCurrentRatio({ currentAssets: '0', currentLiabilities: '1000000', decimals: 6 });
  assert.equal(r.ratioBps, 0n);
  assert.equal(r.liabilitiesBpsOfAssets, null);
  assert.equal(r.workingCapital, -1000000000000n);
  assert.equal(r.shortfall, 1000000000000n);
  assert.equal(r.coversLiabilities, false);
});

test('both figures at zero state working capital of zero and no finite ratio', () => {
  const r = modelCurrentRatio({ currentAssets: '0', currentLiabilities: '0', decimals: 6 });
  assert.equal(r.workingCapital, 0n);
  assert.equal(r.hasRatio, false);
  assert.equal(r.ratioBps, null);
  assert.equal(r.liabilitiesBpsOfAssets, null);
});

test('the flooring is stated exactly: assets of 3 against liabilities of 1.000001 state a ratio of 29999 bps and liabilities of 3333 bps of the assets', () => {
  const r = modelCurrentRatio({ currentAssets: '3', currentLiabilities: '1.000001', decimals: 6 });
  assert.equal(r.ratioBps, 29999n);
  assert.equal(r.liabilitiesBpsOfAssets, 3333n);
  assert.equal(r.workingCapital, 1999999n);
});

test('the ratio carries no cap: assets of 7 against liabilities of 2 state a ratio of 35000 bps', () => {
  const r = modelCurrentRatio({ currentAssets: '7', currentLiabilities: '2', decimals: 6 });
  assert.equal(r.ratioBps, 35000n);
  assert.equal(r.liabilitiesBpsOfAssets, 2857n);
});

test('base-unit amounts are exact: assets of 0.000001 against liabilities of 0.000002 state working capital of -1 and a ratio of 5000 bps', () => {
  const r = modelCurrentRatio({ currentAssets: '0.000001', currentLiabilities: '0.000002', decimals: 6 });
  assert.equal(r.workingCapital, -1n);
  assert.equal(r.ratioBps, 5000n);
  assert.equal(r.shortfall, 1n);
});

test('the ratio is not solvency, not profit, and not a fee', () => {
  const r = modelCurrentRatio(DEFAULT);
  assert.equal(r.ratioIsSolvency, false);
  assert.equal(r.ratioIsProfit, false);
  assert.equal(r.ratioIsFee, false);
});

test('no asset quality, timing, off-statement obligation, or tax is priced', () => {
  const r = modelCurrentRatio(DEFAULT);
  assert.equal(r.assetQualityPriced, false);
  assert.equal(r.timingPriced, false);
  assert.equal(r.offStatementPriced, false);
  assert.equal(r.taxesPriced, false);
});
