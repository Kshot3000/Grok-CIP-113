import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelAmmSwap } from '../src/domain.js';

// Constant-product AMM swap model (v1.170): a swap priced against
// two reserves by the constant product, with a disclosed protocol
// fee taken as a share OF THE SWAP FEE — never of the amount in.
// The fee split sums exactly to the total fee, only the protocol
// fee leaves the pool, the product of the reserves after the swap
// is never below the product before it, and the price impact is
// derived from the amounts, never from entered rates.
const DEFAULT = { reserveIn: '1000000', reserveOut: '500000', amountIn: '10000', swapFeeBps: 30, protocolFeeShareBps: 2000, decimals: 6 };

test('the preloaded swap: 10000 in against 1000000 / 500000 reserves at a 30 bps fee with a 2000 bps protocol share buys 4935.790171 out', () => {
  const r = modelAmmSwap(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.reserveIn, 1000000000000n);
  assert.equal(r.reserveOut, 500000000000n);
  assert.equal(r.amountIn, 10000000000n);
  assert.equal(r.swapFeeBps, 30);
  assert.equal(r.protocolFeeShareBps, 2000);
  assert.equal(r.totalFee, 30000000n);
  assert.equal(r.protocolFee, 6000000n);
  assert.equal(r.lpFee, 24000000n);
  assert.equal(r.amountInAfterFee, 9970000000n);
  assert.equal(r.amountOut, 4935790171n);
  assert.equal(r.reserveInAfter, 1009994000000n);
  assert.equal(r.reserveOutAfter, 495064209829n);
  assert.equal(r.kBefore, 500000000000000000000000n);
  assert.equal(r.kAfter, 500011881542031026000000n);
  assert.equal(r.priceImpactBpsText, '98.71');
  assert.equal(r.protocolFeeShareOfFeeBpsText, '2000.00');
  assert.equal(r.feeFree, false);
  assert.equal(r.noProtocolFee, false);
  assert.equal(r.allFeeToProtocol, false);
});

test('decimals and both fee rates default: 6 decimals, a 30 bps swap fee, and a 2000 bps protocol share of it', () => {
  const r = modelAmmSwap({ reserveIn: '1000000', reserveOut: '500000', amountIn: '10000' });
  assert.equal(r.decimals, 6);
  assert.equal(r.swapFeeBps, 30);
  assert.equal(r.protocolFeeShareBps, 2000);
  assert.equal(r.totalFee, 30000000n);
  assert.equal(r.amountOut, 4935790171n);
});

test('identities at the preload: the fee split sums, only the protocol fee leaves, the out reserve falls by exactly the amount out, and k never shrinks', () => {
  const r = modelAmmSwap(DEFAULT);
  assert.equal(r.protocolFee + r.lpFee, r.totalFee);
  assert.equal(r.amountInAfterFee + r.totalFee, r.amountIn);
  assert.equal(r.reserveInAfter, r.reserveIn + r.amountIn - r.protocolFee);
  assert.equal(r.reserveOutAfter + r.amountOut, r.reserveOut);
  assert.ok(r.kAfter >= r.kBefore);
});

test('k never shrinks across fee shapes, including the whole fee to the protocol and a fee-free swap', () => {
  for (const input of [
    { ...DEFAULT, protocolFeeShareBps: 10000 },
    { ...DEFAULT, protocolFeeShareBps: 0 },
    { ...DEFAULT, swapFeeBps: 0 },
    { ...DEFAULT, swapFeeBps: 9999, protocolFeeShareBps: 10000 },
    { reserveIn: '7', reserveOut: '7', amountIn: '7', swapFeeBps: 0, decimals: 0 },
  ]) {
    const r = modelAmmSwap(input);
    assert.ok(r.kAfter >= r.kBefore);
    assert.equal(r.protocolFee + r.lpFee, r.totalFee);
    assert.equal(r.reserveInAfter, r.reserveIn + r.amountIn - r.protocolFee);
  }
});

test('a dust swap is refused: an amount in too small to buy even one base unit out at these reserves', () => {
  assert.throws(() => modelAmmSwap({ reserveIn: '1000000', reserveOut: '1000000', amountIn: '1', swapFeeBps: 0, decimals: 0 }), /The amount in is too small to buy even one base unit out at this pool's reserves\./);
});

test('a takes-all swap fee is refused: at 10000 bps the trader would receive nothing', () => {
  assert.throws(() => modelAmmSwap({ reserveIn: '1000', reserveOut: '1000', amountIn: '100', swapFeeBps: 10000, decimals: 0 }), /The swap fee would take the whole amount in — the trader would receive nothing\. Lower the swap fee rate\./);
});

test('zero reserves and a zero amount in are each refused with their own message', () => {
  assert.throws(() => modelAmmSwap({ reserveIn: '0', reserveOut: '100', amountIn: '10', decimals: 0 }), /Pool reserve in must be greater than zero\./);
  assert.throws(() => modelAmmSwap({ reserveIn: '100', reserveOut: '0', amountIn: '10', decimals: 0 }), /Pool reserve out must be greater than zero\./);
  assert.throws(() => modelAmmSwap({ reserveIn: '100', reserveOut: '100', amountIn: '0', decimals: 0 }), /Swap amount in must be greater than zero\./);
});

test('bad fee rates are refused: both bps fields must be whole numbers between 0 and 10,000', () => {
  for (const bad of [-1, 10001, 1.5]) assert.throws(() => modelAmmSwap({ ...DEFAULT, swapFeeBps: bad }), /Swap fee must be a whole number of basis points between 0 and 10,000\./);
  for (const bad of [-1, 10001, 2.5]) assert.throws(() => modelAmmSwap({ ...DEFAULT, protocolFeeShareBps: bad }), /Protocol fee share must be a whole number of basis points between 0 and 10,000\./);
});

test('a fee-free swap is purely constant-product: the whole amount in prices against the pool and nothing is split', () => {
  const r = modelAmmSwap({ ...DEFAULT, swapFeeBps: 0 });
  assert.equal(r.totalFee, 0n);
  assert.equal(r.protocolFee, 0n);
  assert.equal(r.lpFee, 0n);
  assert.equal(r.amountInAfterFee, 10000000000n);
  assert.equal(r.amountOut, 4950495049n); // floor(10000 x 500000 / 1001000) in base units, the constant-product amount with no fee.
  assert.equal(r.priceImpactBpsText, '99.00');
  assert.equal(r.protocolFeeShareOfFeeBpsText, '0.00');
  assert.equal(r.feeFree, true);
  assert.equal(r.noProtocolFee, true);
});

test('a protocol share of zero: the whole fee is the LP fee, it all stays in the pool, and nothing leaves', () => {
  const r = modelAmmSwap({ ...DEFAULT, protocolFeeShareBps: 0 });
  assert.equal(r.protocolFee, 0n);
  assert.equal(r.lpFee, r.totalFee);
  assert.equal(r.lpFee, 30000000n);
  assert.equal(r.reserveInAfter, r.reserveIn + r.amountIn);
  assert.equal(r.reserveInAfter, 1010000000000n);
  assert.equal(r.protocolFeeShareOfFeeBpsText, '0.00');
  assert.equal(r.noProtocolFee, true);
  assert.equal(r.allFeeToProtocol, false);
});

test('a protocol share of 10000: the whole fee leaves to the protocol, the LP fee is zero, and k still does not shrink', () => {
  const r = modelAmmSwap({ ...DEFAULT, protocolFeeShareBps: 10000 });
  assert.equal(r.protocolFee, 30000000n);
  assert.equal(r.lpFee, 0n);
  assert.equal(r.reserveInAfter, 1009970000000n);
  assert.equal(r.kAfter, 500000000000995130000000n);
  assert.ok(r.kAfter >= r.kBefore);
  assert.equal(r.protocolFeeShareOfFeeBpsText, '10000.00');
  assert.equal(r.allFeeToProtocol, true);
  assert.equal(r.noProtocolFee, false);
});

test('a small exact case, hand-checkable in whole units: reserves 1000 / 1000, 100 in, a 1000 bps fee split 2000 bps to the protocol', () => {
  const r = modelAmmSwap({ reserveIn: '1000', reserveOut: '1000', amountIn: '100', swapFeeBps: 1000, protocolFeeShareBps: 2000, decimals: 0 });
  assert.equal(r.totalFee, 10n);
  assert.equal(r.protocolFee, 2n);
  assert.equal(r.lpFee, 8n);
  assert.equal(r.amountInAfterFee, 90n);
  assert.equal(r.amountOut, 82n); // floor(90 x 1000 / 1090).
  assert.equal(r.reserveInAfter, 1098n);
  assert.equal(r.reserveOutAfter, 918n);
  assert.equal(r.kBefore, 1000000n);
  assert.equal(r.kAfter, 1007964n);
  assert.equal(r.priceImpactBpsText, '888.88');
  assert.equal(r.protocolFeeShareOfFeeBpsText, '2000.00');
});

test('the protocol share of the fee is derived from the floored amounts, not the entered rate: a fee of 1 split at 5000 bps floors the protocol fee to zero', () => {
  const r = modelAmmSwap({ reserveIn: '1000', reserveOut: '1000', amountIn: '100', swapFeeBps: 100, protocolFeeShareBps: 5000, decimals: 0 });
  assert.equal(r.totalFee, 1n);
  assert.equal(r.protocolFee, 0n);
  assert.equal(r.lpFee, 1n);
  assert.equal(r.protocolFeeShareOfFeeBpsText, '0.00');
  assert.equal(r.noProtocolFee, true);
});

test('beyond-float exactness: reserves and an amount in of 2^53+1 price exactly, and the derived protocol share reads 1999.99, not the entered 2000', () => {
  const r = modelAmmSwap({ reserveIn: '9007199254740993', reserveOut: '9007199254740993', amountIn: '9007199254740993', swapFeeBps: 30, protocolFeeShareBps: 2000, decimals: 0 });
  assert.equal(r.totalFee, 27021597764222n);
  assert.equal(r.protocolFee, 5404319552844n);
  assert.equal(r.lpFee, 21617278211378n);
  assert.equal(r.amountInAfterFee, 8980177656976771n);
  assert.equal(r.amountOut, 4496834079607796n);
  assert.equal(r.reserveInAfter, 18008994189929142n);
  assert.equal(r.reserveOutAfter, 4510365175133197n);
  assert.equal(r.kBefore, 81129638414606699710187514626049n);
  assert.equal(r.kAfter, 81227140233432481793545841926974n);
  assert.equal(r.priceImpactBpsText, '4992.48');
  assert.equal(r.protocolFeeShareOfFeeBpsText, '1999.99');
  assert.ok(r.kAfter >= r.kBefore);
});

test('price impact grows with trade size: the same pool at 1000, 10000, and 100000 in', () => {
  const small = modelAmmSwap({ ...DEFAULT, amountIn: '1000' });
  const mid = modelAmmSwap(DEFAULT);
  const big = modelAmmSwap({ ...DEFAULT, amountIn: '100000' });
  assert.equal(small.priceImpactBpsText, '9.96');
  assert.equal(small.amountOut, 498003490n);
  assert.equal(mid.priceImpactBpsText, '98.71');
  assert.equal(big.priceImpactBpsText, '906.61');
  assert.equal(big.amountOut, 45330544694n);
  assert.ok(Number(big.priceImpactBpsText) > Number(mid.priceImpactBpsText) && Number(mid.priceImpactBpsText) > Number(small.priceImpactBpsText));
});

test('validation: the amounts are amounts like any other — malformed ones are refused by the amount layer', () => {
  assert.throws(() => modelAmmSwap({ ...DEFAULT, reserveIn: 'abc' }), /Enter a positive decimal amount, without commas or exponents\./);
  assert.throws(() => modelAmmSwap({ ...DEFAULT, amountIn: '-5' }), /Enter a positive decimal amount, without commas or exponents\./);
  assert.throws(() => modelAmmSwap({ ...DEFAULT, reserveOut: '1.1234567' }), /Use at most 6 decimal places\./);
});

test('wiring: app.js imports the model, renders an amm swap panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelAmmSwap/);
  assert.match(app, /data-swap/);
  assert.match(app, /amm-swap-output/);
  assert.match(app, /v1\.170/);
  assert.match(readme, /AMM swap model/);
});
