import test from 'node:test';
import assert from 'node:assert/strict';
import { modelFreeCashFlow } from '../src/domain.js';

const DEFAULT = { operatingCashFlow: '1000000', capitalExpenditure: '250000', decimals: 6 };
const CASES = [
  DEFAULT,
  { operatingCashFlow: '600000', capitalExpenditure: '600000', decimals: 6 },
  { operatingCashFlow: '400000', capitalExpenditure: '1000000', decimals: 6 },
  { operatingCashFlow: '0', capitalExpenditure: '250000', decimals: 6 },
  { operatingCashFlow: '1000000', capitalExpenditure: '0', decimals: 6 },
  { operatingCashFlow: '3', capitalExpenditure: '1.000001', decimals: 6 },
  { operatingCashFlow: '7', capitalExpenditure: '2', decimals: 6 },
  { operatingCashFlow: '333333', capitalExpenditure: '250000', decimals: 6 },
  { operatingCashFlow: '0.000002', capitalExpenditure: '0.000001', decimals: 6 },
  { operatingCashFlow: '125', capitalExpenditure: '500', decimals: 0 },
];

test('preload: operating cash flow of 1000000 less capital expenditure of 250000 leaves free cash flow of 750000000000, the expenditure consumed 2500 bps and 7500 bps was left free', () => {
  const r = modelFreeCashFlow(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.operatingCashFlow, 1000000000000n);
  assert.equal(r.capitalExpenditure, 250000000000n);
  assert.equal(r.freeCashFlow, 750000000000n);
  assert.equal(r.shortfall, 0n);
  assert.equal(r.capitalExpenditureBpsOfCashFlow, 2500n);
  assert.equal(r.freeCashFlowBpsOfCashFlow, 7500n);
  assert.equal(r.shortfallBpsOfCashFlow, null);
  assert.equal(r.hasShares, true);
  assert.equal(r.expenditureExceedsCashFlow, false);
});

test('the free cash flow is the operating cash flow less the expenditure exactly, and the shortfall is the negative part stated whole, on every stated case', () => {
  for (const input of CASES) {
    const r = modelFreeCashFlow(input);
    assert.equal(r.freeCashFlow, r.operatingCashFlow - r.capitalExpenditure);
    assert.equal(r.shortfall, r.freeCashFlow < 0n ? -r.freeCashFlow : 0n);
    assert.equal(r.expenditureExceedsCashFlow, r.capitalExpenditure > r.operatingCashFlow);
    assert.equal(r.hasShares, r.operatingCashFlow > 0n);
  }
});

test('the expenditure share is the exact floor and carries no cap, on every stated case where shares stand', () => {
  for (const input of CASES) {
    const r = modelFreeCashFlow(input);
    if (!r.hasShares) continue;
    assert.ok(r.capitalExpenditureBpsOfCashFlow * r.operatingCashFlow <= r.capitalExpenditure * 10000n);
    assert.ok((r.capitalExpenditureBpsOfCashFlow + 1n) * r.operatingCashFlow > r.capitalExpenditure * 10000n);
    assert.equal(r.sharesRoundedDown, true);
    assert.equal(r.sharesMeasuredOnOperatingCashFlow, true);
  }
});

test('where the free cash flow stands at or above zero its share is the exact floor and the two shares together state 10000 bps or one less from the flooring, on every stated case', () => {
  for (const input of CASES) {
    const r = modelFreeCashFlow(input);
    if (!r.hasShares || r.freeCashFlow < 0n) continue;
    assert.ok(r.freeCashFlowBpsOfCashFlow * r.operatingCashFlow <= r.freeCashFlow * 10000n);
    assert.ok((r.freeCashFlowBpsOfCashFlow + 1n) * r.operatingCashFlow > r.freeCashFlow * 10000n);
    const sum = r.capitalExpenditureBpsOfCashFlow + r.freeCashFlowBpsOfCashFlow;
    assert.ok(sum === 10000n || sum === 9999n);
    assert.equal(r.shortfallBpsOfCashFlow, null);
  }
});

test('the shares are measured on the operating cash flow, never on the expenditure: the expenditure share of the expenditure itself would state 10000 bps on the preload, not 2500', () => {
  const r = modelFreeCashFlow(DEFAULT);
  assert.notEqual(r.capitalExpenditureBpsOfCashFlow, 10000n);
  assert.equal(r.capitalExpenditureBpsOfCashFlow, 2500n);
});

test('the free cash flow is signed, never floored at zero: expenditure of 1000000 against operating cash flow of 400000 states free cash flow of -600000000000 and a shortfall of 600000000000', () => {
  const r = modelFreeCashFlow({ operatingCashFlow: '400000', capitalExpenditure: '1000000', decimals: 6 });
  assert.equal(r.freeCashFlow, -600000000000n);
  assert.equal(r.shortfall, 600000000000n);
  assert.equal(r.capitalExpenditureBpsOfCashFlow, 25000n);
  assert.equal(r.freeCashFlowBpsOfCashFlow, null);
  assert.equal(r.shortfallBpsOfCashFlow, 15000n);
  assert.equal(r.expenditureExceedsCashFlow, true);
});

test('the shortfall share is the exact floor where the free cash flow is negative, on every stated case', () => {
  for (const input of CASES) {
    const r = modelFreeCashFlow(input);
    if (!r.hasShares || r.freeCashFlow >= 0n) continue;
    assert.ok(r.shortfallBpsOfCashFlow * r.operatingCashFlow <= r.shortfall * 10000n);
    assert.ok((r.shortfallBpsOfCashFlow + 1n) * r.operatingCashFlow > r.shortfall * 10000n);
    assert.equal(r.capitalExpenditureBpsOfCashFlow - r.shortfallBpsOfCashFlow, 10000n);
  }
});

test('expenditure equal to the operating cash flow states free cash flow of zero, an expenditure share of 10000 bps, and a free share of zero', () => {
  const r = modelFreeCashFlow({ operatingCashFlow: '600000', capitalExpenditure: '600000', decimals: 6 });
  assert.equal(r.freeCashFlow, 0n);
  assert.equal(r.shortfall, 0n);
  assert.equal(r.capitalExpenditureBpsOfCashFlow, 10000n);
  assert.equal(r.freeCashFlowBpsOfCashFlow, 0n);
  assert.equal(r.expenditureExceedsCashFlow, false);
});

test('operating cash flow of zero states no finite share, not a refusal and not an infinite figure: the free cash flow is the expenditure negated', () => {
  const r = modelFreeCashFlow({ operatingCashFlow: '0', capitalExpenditure: '250000', decimals: 6 });
  assert.equal(r.hasShares, false);
  assert.equal(r.capitalExpenditureBpsOfCashFlow, null);
  assert.equal(r.freeCashFlowBpsOfCashFlow, null);
  assert.equal(r.shortfallBpsOfCashFlow, null);
  assert.equal(r.freeCashFlow, -250000000000n);
  assert.equal(r.shortfall, 250000000000n);
});

test('an expenditure of zero is stated, not refused: the whole operating cash flow is free at 10000 bps', () => {
  const r = modelFreeCashFlow({ operatingCashFlow: '1000000', capitalExpenditure: '0', decimals: 6 });
  assert.equal(r.freeCashFlow, 1000000000000n);
  assert.equal(r.capitalExpenditureBpsOfCashFlow, 0n);
  assert.equal(r.freeCashFlowBpsOfCashFlow, 10000n);
  assert.equal(r.expenditureExceedsCashFlow, false);
});

test('both figures at zero state free cash flow of zero and no shares', () => {
  const r = modelFreeCashFlow({ operatingCashFlow: '0', capitalExpenditure: '0', decimals: 6 });
  assert.equal(r.freeCashFlow, 0n);
  assert.equal(r.shortfall, 0n);
  assert.equal(r.hasShares, false);
  assert.equal(r.capitalExpenditureBpsOfCashFlow, null);
  assert.equal(r.expenditureExceedsCashFlow, false);
});

test('the flooring is stated exactly: operating cash flow of 3 less expenditure of 1.000001 leaves 1999999, an expenditure share of 3333 bps, and a free share of 6666 bps', () => {
  const r = modelFreeCashFlow({ operatingCashFlow: '3', capitalExpenditure: '1.000001', decimals: 6 });
  assert.equal(r.freeCashFlow, 1999999n);
  assert.equal(r.capitalExpenditureBpsOfCashFlow, 3333n);
  assert.equal(r.freeCashFlowBpsOfCashFlow, 6666n);
});

test('base-unit amounts are exact: operating cash flow of 0.000002 less expenditure of 0.000001 leaves 1, split 5000 bps to 5000 bps', () => {
  const r = modelFreeCashFlow({ operatingCashFlow: '0.000002', capitalExpenditure: '0.000001', decimals: 6 });
  assert.equal(r.freeCashFlow, 1n);
  assert.equal(r.capitalExpenditureBpsOfCashFlow, 5000n);
  assert.equal(r.freeCashFlowBpsOfCashFlow, 5000n);
});

test('the free cash flow is not profit, not a fee, and not a distribution', () => {
  const r = modelFreeCashFlow(DEFAULT);
  assert.equal(r.freeCashFlowIsProfit, false);
  assert.equal(r.freeCashFlowIsFee, false);
  assert.equal(r.freeCashFlowIsDistribution, false);
});

test('no expenditure split, working-capital change, debt flow, or tax is priced', () => {
  const r = modelFreeCashFlow(DEFAULT);
  assert.equal(r.capexSplitPriced, false);
  assert.equal(r.workingCapitalPriced, false);
  assert.equal(r.debtFlowsPriced, false);
  assert.equal(r.taxesPriced, false);
});
