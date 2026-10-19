import test from 'node:test';
import assert from 'node:assert/strict';
import { modelSimpleReturn } from '../src/domain.js';

const DEFAULT = { cost: '1000000', proceeds: '1250000', decimals: 6 };
const CASES = [
  DEFAULT,
  { cost: '1000000', proceeds: '800000', decimals: 6 },
  { cost: '1000000', proceeds: '1000000', decimals: 6 },
  { cost: '1000000', proceeds: '0', decimals: 6 },
  { cost: '3', proceeds: '1.000001', decimals: 6 },
  { cost: '7', proceeds: '2', decimals: 6 },
  { cost: '250000', proceeds: '333333', decimals: 6 },
  { cost: '0.000001', proceeds: '0.000002', decimals: 6 },
  { cost: '999', proceeds: '1000', decimals: 6 },
  { cost: '500', proceeds: '125', decimals: 0 },
];

test('preload: a cost of 1000000 returned proceeds of 1250000, a gain of 250000000000 and a return of 2500 bps on the cost', () => {
  const r = modelSimpleReturn(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.cost, 1000000000000n);
  assert.equal(r.proceeds, 1250000000000n);
  assert.equal(r.gainOrLossAmount, 250000000000n);
  assert.equal(r.gainBps, 2500n);
  assert.equal(r.lossBps, 0n);
  assert.equal(r.proceedsBpsOfCost, 12500n);
  assert.equal(r.isGain, true);
  assert.equal(r.isLoss, false);
});

test('the gain or loss is the proceeds less the cost exactly, on every stated case', () => {
  for (const input of CASES) {
    const r = modelSimpleReturn(input);
    assert.equal(r.gainOrLossAmount, r.proceeds - r.cost);
    assert.equal(r.isGain, r.gainOrLossAmount > 0n);
    assert.equal(r.isLoss, r.gainOrLossAmount < 0n);
    assert.ok(!(r.gainBps > 0n && r.lossBps > 0n));
  }
});

test('the proceeds share of the cost is the exact floor, on every stated case', () => {
  for (const input of CASES) {
    const r = modelSimpleReturn(input);
    assert.ok(r.proceedsBpsOfCost * r.cost <= r.proceeds * 10000n);
    assert.ok((r.proceedsBpsOfCost + 1n) * r.cost > r.proceeds * 10000n);
    assert.equal(r.returnRoundedDown, true);
    assert.equal(r.returnMeasuredOnCost, true);
  }
});

test('on a gain the proceeds share is exactly 10000 plus the gain rate, on every stated gain case', () => {
  for (const input of CASES) {
    const r = modelSimpleReturn(input);
    if (!r.isGain) continue;
    assert.equal(r.proceedsBpsOfCost, 10000n + r.gainBps);
    assert.equal(r.lossBps, 0n);
    assert.ok(r.gainBps * r.cost <= r.gainOrLossAmount * 10000n);
    assert.ok((r.gainBps + 1n) * r.cost > r.gainOrLossAmount * 10000n);
  }
});

test('on a loss the proceeds share plus the loss rate is 10000 or one less from the flooring, on every stated loss case', () => {
  for (const input of CASES) {
    const r = modelSimpleReturn(input);
    if (!r.isLoss) continue;
    assert.equal(r.gainBps, 0n);
    const sum = r.proceedsBpsOfCost + r.lossBps;
    assert.ok(sum === 10000n || sum === 9999n);
    const loss = -r.gainOrLossAmount;
    assert.ok(r.lossBps * r.cost <= loss * 10000n);
    assert.ok((r.lossBps + 1n) * r.cost > loss * 10000n);
  }
});

test('the return is measured on the cost, never the proceeds: the preload gain measured on the proceeds would state only 2000 bps', () => {
  const r = modelSimpleReturn(DEFAULT);
  const onProceeds = r.gainOrLossAmount * 10000n / r.proceeds;
  assert.equal(onProceeds, 2000n);
  assert.notEqual(r.gainBps, onProceeds);
  assert.ok(r.gainBps > onProceeds);
});

test('a loss is stated, not refused: proceeds of 800000 on a cost of 1000000 lose 200000000000, a loss rate of 2000 bps', () => {
  const r = modelSimpleReturn({ cost: '1000000', proceeds: '800000', decimals: 6 });
  assert.equal(r.gainOrLossAmount, -200000000000n);
  assert.equal(r.lossBps, 2000n);
  assert.equal(r.proceedsBpsOfCost, 8000n);
  assert.equal(r.isLoss, true);
});

test('proceeds of zero are stated, not refused: the whole cost is lost and the loss rate is exactly 10000 bps', () => {
  const r = modelSimpleReturn({ cost: '1000000', proceeds: '0', decimals: 6 });
  assert.equal(r.gainOrLossAmount, -1000000000000n);
  assert.equal(r.lossBps, 10000n);
  assert.equal(r.proceedsBpsOfCost, 0n);
});

test('proceeds equal to the cost state a return of zero: no gain, no loss, and the proceeds are 10000 bps of the cost', () => {
  const r = modelSimpleReturn({ cost: '1000000', proceeds: '1000000', decimals: 6 });
  assert.equal(r.gainOrLossAmount, 0n);
  assert.equal(r.gainBps, 0n);
  assert.equal(r.lossBps, 0n);
  assert.equal(r.proceedsBpsOfCost, 10000n);
  assert.equal(r.isGain, false);
  assert.equal(r.isLoss, false);
});

test('the flooring is stated exactly: proceeds of 1.000001 on a cost of 3 state a loss rate of 6666 bps and proceeds of 3333 bps of the cost', () => {
  const r = modelSimpleReturn({ cost: '3', proceeds: '1.000001', decimals: 6 });
  assert.equal(r.gainOrLossAmount, -1999999n);
  assert.equal(r.lossBps, 6666n);
  assert.equal(r.proceedsBpsOfCost, 3333n);
  assert.equal(r.proceedsBpsOfCost + r.lossBps, 9999n);
});

test('the return carries no cap: proceeds of 1000 on a cost of 999 state a gain rate of 10 bps, and doubling a cost states 10000 bps of gain', () => {
  const small = modelSimpleReturn({ cost: '999', proceeds: '1000', decimals: 6 });
  assert.equal(small.gainBps, 10n);
  const doubled = modelSimpleReturn({ cost: '500', proceeds: '1000', decimals: 6 });
  assert.equal(doubled.gainBps, 10000n);
  assert.equal(doubled.proceedsBpsOfCost, 20000n);
});

test('base-unit amounts are exact: proceeds of 0.000002 on a cost of 0.000001 state a gain of 1 and a gain rate of 10000 bps', () => {
  const r = modelSimpleReturn({ cost: '0.000001', proceeds: '0.000002', decimals: 6 });
  assert.equal(r.gainOrLossAmount, 1n);
  assert.equal(r.gainBps, 10000n);
  assert.equal(r.proceedsBpsOfCost, 20000n);
});

test('no time stands inside the return: it is never annualized and no holding period is priced', () => {
  const r = modelSimpleReturn(DEFAULT);
  assert.equal(r.annualized, false);
  assert.equal(r.timePriced, false);
});

test('the return is not a guarantee and not a fee, and no separate amount or tax is priced', () => {
  const r = modelSimpleReturn(DEFAULT);
  assert.equal(r.returnIsGuarantee, false);
  assert.equal(r.returnIsFee, false);
  assert.equal(r.separateAmountsPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a cost of zero is refused: a return on nothing would state an infinite rate', () => {
  assert.throws(() => modelSimpleReturn({ ...DEFAULT, cost: '0' }), /Cost must be greater than zero/);
});
