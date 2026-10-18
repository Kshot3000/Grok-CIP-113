import test from 'node:test';
import assert from 'node:assert/strict';
import { modelAmmSwap, modelAmmSwapGuard } from '../src/domain.js';

const DEFAULT = { reserveIn: '1000000', reserveOut: '500000', amountIn: '10000', swapFeeBps: 30, protocolFeeShareBps: 2000, minimumAmountOut: '4900', decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, minimumAmountOut: '6000' },
  { ...DEFAULT, minimumAmountOut: '4935.790171' },
  { ...DEFAULT, minimumAmountOut: '4935.790172' },
  { ...DEFAULT, minimumAmountOut: '0' },
  { ...DEFAULT, swapFeeBps: 0 },
  { ...DEFAULT, protocolFeeShareBps: 10000 },
  { reserveIn: '1000000', reserveOut: '500000', amountIn: '10000', swapFeeBps: 30, protocolFeeShareBps: 2000, minimumAmountOut: '4900', decimals: 0 },
  { reserveIn: '2500.5', reserveOut: '1250.25', amountIn: '25.5', swapFeeBps: 30, protocolFeeShareBps: 2000, minimumAmountOut: '12', decimals: 6 },
  { ...DEFAULT, minimumAmountOut: '999999' },
];

test('preload: a minimum of 4900 against the priced output of 4935.790171 executes exactly as the swap model prices it', () => {
  const r = modelAmmSwapGuard(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.reserveIn, 1000000000000n);
  assert.equal(r.reserveOut, 500000000000n);
  assert.equal(r.amountIn, 10000000000n);
  assert.equal(r.minimumAmountOut, 4900000000n);
  assert.equal(r.poolAmountOut, 4935790171n);
  assert.equal(r.executes, true);
  assert.equal(r.amountOutReceived, 4935790171n);
  assert.equal(r.amountInReturned, 0n);
  assert.equal(r.shortfallAmount, 0n);
  assert.equal(r.minimumStated, true);
  assert.equal(r.minimumMetExactly, false);
  assert.equal(r.totalFeeCharged, 30000000n);
  assert.equal(r.protocolFeeCharged, 6000000n);
  assert.equal(r.lpFeeCharged, 24000000n);
  assert.equal(r.reserveInAfter, 1009994000000n);
  assert.equal(r.reserveOutAfter, 495064209829n);
  assert.equal(r.priceImpactBpsText, '98.71');
});

test('the guard composes the swap model unchanged on every stated case: the priced output and fee split are the swap model\'s own', () => {
  for (const input of CASES) {
    const r = modelAmmSwapGuard(input);
    const base = modelAmmSwap(input);
    assert.equal(r.poolAmountOut, base.amountOut);
    assert.equal(r.poolTotalFee, base.totalFee);
    assert.equal(r.poolProtocolFee, base.protocolFee);
    assert.equal(r.poolLpFee, base.lpFee);
    assert.equal(r.priceImpactBpsText, base.priceImpactBpsText);
    assert.equal(r.guardMeasuredOnPoolOutput, true);
  }
});

test('execution is binary on every stated case: the trader receives the whole priced output or nothing, and the amount in is returned whole or not at all', () => {
  for (const input of CASES) {
    const r = modelAmmSwapGuard(input);
    assert.equal(r.executionIsBinary, true);
    assert.equal(r.executes, r.poolAmountOut >= r.minimumAmountOut);
    if (r.executes) {
      assert.equal(r.amountOutReceived, r.poolAmountOut);
      assert.equal(r.amountInReturned, 0n);
      assert.equal(r.shortfallAmount, 0n);
    } else {
      assert.equal(r.amountOutReceived, 0n);
      assert.equal(r.amountInReturned, r.amountIn);
      assert.equal(r.shortfallAmount, r.minimumAmountOut - r.poolAmountOut);
      assert.ok(r.shortfallAmount > 0n);
    }
    assert.ok(r.amountInReturned === 0n || r.amountInReturned === r.amountIn);
  }
});

test('where the priced output falls short of the minimum, the swap does not execute: nothing is received, the whole amount in is returned, and the reserves are unchanged', () => {
  const r = modelAmmSwapGuard({ ...DEFAULT, minimumAmountOut: '6000' });
  assert.equal(r.executes, false);
  assert.equal(r.poolAmountOut, 4935790171n);
  assert.equal(r.shortfallAmount, 1064209829n);
  assert.equal(r.amountOutReceived, 0n);
  assert.equal(r.amountInReturned, 10000000000n);
  assert.equal(r.reserveInAfter, r.reserveIn);
  assert.equal(r.reserveOutAfter, r.reserveOut);
});

test('no fee is charged on a swap that does not execute, at any fee shape', () => {
  for (const input of [{ ...DEFAULT, minimumAmountOut: '6000' }, { ...DEFAULT, minimumAmountOut: '6000', protocolFeeShareBps: 10000 }, { ...DEFAULT, minimumAmountOut: '6000', swapFeeBps: 100 }]) {
    const r = modelAmmSwapGuard(input);
    assert.equal(r.executes, false);
    assert.equal(r.feeChargedWhenRefused, false);
    assert.equal(r.totalFeeCharged, 0n);
    assert.equal(r.protocolFeeCharged, 0n);
    assert.equal(r.lpFeeCharged, 0n);
    assert.ok(r.poolTotalFee > 0n);
  }
});

test('where the swap executes, the fee charged is exactly the swap model\'s fee and the reserves after are the swap model\'s own', () => {
  for (const input of CASES) {
    const r = modelAmmSwapGuard(input);
    const base = modelAmmSwap(input);
    if (r.executes) {
      assert.equal(r.totalFeeCharged, base.totalFee);
      assert.equal(r.protocolFeeCharged + r.lpFeeCharged, r.totalFeeCharged);
      assert.equal(r.reserveInAfter, base.reserveInAfter);
      assert.equal(r.reserveOutAfter, base.reserveOutAfter);
    }
  }
});

test('a minimum the priced output meets exactly executes: reaching the minimum is enough', () => {
  const r = modelAmmSwapGuard({ ...DEFAULT, minimumAmountOut: '4935.790171' });
  assert.equal(r.minimumAmountOut, 4935790171n);
  assert.equal(r.minimumMetExactly, true);
  assert.equal(r.executes, true);
  assert.equal(r.amountOutReceived, 4935790171n);
  assert.equal(r.shortfallAmount, 0n);
});

test('a minimum one base unit above the priced output refuses the swap, with a shortfall of exactly one base unit', () => {
  const r = modelAmmSwapGuard({ ...DEFAULT, minimumAmountOut: '4935.790172' });
  assert.equal(r.executes, false);
  assert.equal(r.minimumMetExactly, false);
  assert.equal(r.shortfallAmount, 1n);
  assert.equal(r.amountOutReceived, 0n);
  assert.equal(r.amountInReturned, 10000000000n);
});

test('the guard is measured on the priced output, never on a quoted price: a minimum a fee-free quote would meet still refuses when the priced output falls short', () => {
  const quote = modelAmmSwap({ reserveIn: '1000000', reserveOut: '500000', amountIn: '10000', swapFeeBps: 0, protocolFeeShareBps: 2000, decimals: 6 });
  assert.equal(quote.amountOut, 4950495049n);
  const r = modelAmmSwapGuard({ ...DEFAULT, minimumAmountOut: '4940' });
  // The fee-free quote of 4950.495049 would meet a 4940 minimum; the output the pool actually prices, 4935.790171 after the stated fee, does not.
  assert.ok(quote.amountOut >= r.minimumAmountOut);
  assert.equal(r.poolAmountOut, 4935790171n);
  assert.equal(r.executes, false);
  assert.equal(r.shortfallAmount, 4209829n);
  assert.equal(r.quotedPricePriced, false);
  assert.notEqual(r.amountOutReceived, quote.amountOut);
});

test('a minimum of zero is stated, not refused: it guards against nothing and the swap executes as priced', () => {
  const r = modelAmmSwapGuard({ ...DEFAULT, minimumAmountOut: '0' });
  assert.equal(r.minimumStated, false);
  assert.equal(r.minimumMetExactly, false);
  assert.equal(r.executes, true);
  assert.equal(r.amountOutReceived, 4935790171n);
  const missing = modelAmmSwapGuard({ reserveIn: '1000000', reserveOut: '500000', amountIn: '10000', swapFeeBps: 30, protocolFeeShareBps: 2000, decimals: 6 });
  assert.equal(missing.minimumAmountOut, 0n);
  assert.equal(missing.executes, true);
});

test('a fee-free swap under the guard executes with nothing to charge', () => {
  const r = modelAmmSwapGuard({ ...DEFAULT, swapFeeBps: 0 });
  assert.equal(r.poolAmountOut, 4950495049n);
  assert.equal(r.executes, true);
  assert.equal(r.amountOutReceived, 4950495049n);
  assert.equal(r.totalFeeCharged, 0n);
  assert.equal(r.reserveInAfter, 1010000000000n);
  assert.equal(r.reserveOutAfter, 495049504951n);
});

test('a minimum above the whole reserve out is stated, not refused, and refuses the swap: no priced output can reach it', () => {
  const r = modelAmmSwapGuard({ ...DEFAULT, minimumAmountOut: '999999' });
  assert.equal(r.executes, false);
  assert.ok(r.minimumAmountOut > r.reserveOut);
  assert.equal(r.amountOutReceived, 0n);
  assert.equal(r.amountInReturned, r.amountIn);
});

test('the swap model\'s own refusals pass through the guard unchanged: a trade too small to buy one base unit out is refused as unpriceable, not as a guard refusal', () => {
  assert.throws(() => modelAmmSwapGuard({ reserveIn: '1000000', reserveOut: '500000', amountIn: '0.000001', swapFeeBps: 30, protocolFeeShareBps: 2000, minimumAmountOut: '0', decimals: 6 }), /too small to buy even one base unit/);
  assert.throws(() => modelAmmSwapGuard({ ...DEFAULT, reserveIn: '0' }), /Pool reserve in must be greater than zero/);
});

test('fractional and zero-decimal statements state exactly in BigInt', () => {
  const dec0 = modelAmmSwapGuard({ reserveIn: '1000000', reserveOut: '500000', amountIn: '10000', swapFeeBps: 30, protocolFeeShareBps: 2000, minimumAmountOut: '4900', decimals: 0 });
  assert.equal(dec0.poolAmountOut, 4935n);
  assert.equal(dec0.executes, true);
  assert.equal(dec0.amountOutReceived, 4935n);
  const frac = modelAmmSwapGuard({ reserveIn: '2500.5', reserveOut: '1250.25', amountIn: '25.5', swapFeeBps: 30, protocolFeeShareBps: 2000, minimumAmountOut: '12', decimals: 6 });
  assert.equal(frac.poolAmountOut, 12583805n);
  assert.equal(frac.executes, true);
  assert.equal(frac.totalFeeCharged, 76500n);
});

test('the minimum is not a fee, and there is no partial fill at a worse price', () => {
  const r = modelAmmSwapGuard({ ...DEFAULT, minimumAmountOut: '6000' });
  assert.equal(r.minimumIsFee, false);
  assert.equal(r.partialFillPriced, false);
  // A partial fill would pay something out below the minimum; the refused swap pays exactly nothing out.
  assert.equal(r.amountOutReceived, 0n);
});

test('what is not priced stays unpriced: later prices, retries, routing, deadlines, and quoted prices', () => {
  const r = modelAmmSwapGuard(DEFAULT);
  assert.equal(r.laterPricePriced, false);
  assert.equal(r.retryPriced, false);
  assert.equal(r.routingPriced, false);
  assert.equal(r.deadlinePriced, false);
  assert.equal(r.quotedPricePriced, false);
});
