import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelAmmLiquidityWithdrawal } from '../src/domain.js';

// Constant-product AMM liquidity withdrawal model (v1.187): burning
// LP tokens pays out pro-rata by the share of the supply burned —
// the same share of both reserves, floored per side, with the
// flooring remainder staying in the pool. Burning the whole supply
// is the one exact case and empties the pool.
const DEFAULT = { reserveIn: '1000000', reserveOut: '500000', lpSupply: '500000', lpBurn: '5000', decimals: 6 };

test('the preloaded withdrawal: burning 5000 LP tokens against 1000000 / 500000 reserves with a 500000 supply withdraws 10000 in and 5000 out', () => {
  const r = modelAmmLiquidityWithdrawal(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.reserveIn, 1000000000000n);
  assert.equal(r.reserveOut, 500000000000n);
  assert.equal(r.lpSupply, 500000000000n);
  assert.equal(r.lpBurn, 5000000000n);
  assert.equal(r.amountIn, 10000000000n);
  assert.equal(r.amountOut, 5000000000n);
  assert.equal(r.remainderInNumerator, 0n);
  assert.equal(r.remainderOutNumerator, 0n);
  assert.equal(r.reserveInAfter, 990000000000n);
  assert.equal(r.reserveOutAfter, 495000000000n);
  assert.equal(r.lpSupplyAfter, 495000000000n);
  assert.equal(r.kBefore, 500000000000000000000000n);
  assert.equal(r.kAfter, 490050000000000000000000n);
  assert.equal(r.withdrawnShareBpsText, '100.00');
  assert.equal(r.fullWithdrawal, false);
  assert.equal(r.partialWithdrawal, true);
  assert.equal(r.noDustLeft, true);
});

test('decimals default to 6', () => {
  const r = modelAmmLiquidityWithdrawal({ reserveIn: '1000000', reserveOut: '500000', lpSupply: '500000', lpBurn: '5000' });
  assert.equal(r.decimals, 6);
  assert.equal(r.amountIn, 10000000000n);
});

test('identities at the preload: the reserves fall by exactly the amounts paid, the supply falls by exactly the burn, each payout is the floor of its pro-rata share, and k never grows', () => {
  const r = modelAmmLiquidityWithdrawal(DEFAULT);
  assert.equal(r.reserveInAfter, r.reserveIn - r.amountIn);
  assert.equal(r.reserveOutAfter, r.reserveOut - r.amountOut);
  assert.equal(r.lpSupplyAfter, r.lpSupply - r.lpBurn);
  assert.ok(r.amountIn * r.lpSupply <= r.lpBurn * r.reserveIn);
  assert.ok(r.lpBurn * r.reserveIn < (r.amountIn + 1n) * r.lpSupply);
  assert.ok(r.amountOut * r.lpSupply <= r.lpBurn * r.reserveOut);
  assert.ok(r.lpBurn * r.reserveOut < (r.amountOut + 1n) * r.lpSupply);
  assert.ok(r.kAfter <= r.kBefore);
});

test('k never grows across withdrawal shapes, partial and full', () => {
  for (const input of [
    DEFAULT,
    { ...DEFAULT, lpBurn: '500000' },
    { ...DEFAULT, lpBurn: '166666' },
    { ...DEFAULT, lpBurn: '1' },
    { reserveIn: '7', reserveOut: '7', lpSupply: '7', lpBurn: '3', decimals: 0 },
  ]) {
    const r = modelAmmLiquidityWithdrawal(input);
    assert.ok(r.kAfter <= r.kBefore);
    assert.equal(r.lpSupplyAfter, r.lpSupply - r.lpBurn);
  }
});

test('both sides pay the same share: the cross-multiplied payouts are equal at the preload, so no withdrawal can take one asset alone', () => {
  const r = modelAmmLiquidityWithdrawal(DEFAULT);
  assert.equal(r.amountIn * r.reserveOut, r.amountOut * r.reserveIn);
});

test('burning the whole supply is the one exact case: both reserves pay out in full, no dust is left, and the pool ends empty', () => {
  const r = modelAmmLiquidityWithdrawal({ ...DEFAULT, lpBurn: '500000' });
  assert.equal(r.amountIn, 1000000000000n);
  assert.equal(r.amountOut, 500000000000n);
  assert.equal(r.reserveInAfter, 0n);
  assert.equal(r.reserveOutAfter, 0n);
  assert.equal(r.lpSupplyAfter, 0n);
  assert.equal(r.kAfter, 0n);
  assert.equal(r.remainderInNumerator, 0n);
  assert.equal(r.remainderOutNumerator, 0n);
  assert.equal(r.noDustLeft, true);
  assert.equal(r.fullWithdrawal, true);
  assert.equal(r.partialWithdrawal, false);
  assert.equal(r.withdrawnShareBpsText, '10000.00');
});

test('the flooring remainder stays in the pool: reserves 1000 / 500 with supply 300, burning 100 pays 333 in and 166 out, and the remainders are stated exactly', () => {
  const r = modelAmmLiquidityWithdrawal({ reserveIn: '1000', reserveOut: '500', lpSupply: '300', lpBurn: '100', decimals: 0 });
  assert.equal(r.amountIn, 333n);
  assert.equal(r.amountOut, 166n);
  assert.equal(r.remainderInNumerator, 100n);
  assert.equal(r.remainderOutNumerator, 200n);
  assert.equal(r.reserveInAfter, 667n);
  assert.equal(r.reserveOutAfter, 334n);
  assert.equal(r.lpSupplyAfter, 200n);
  assert.equal(r.kBefore, 500000n);
  assert.equal(r.kAfter, 222778n);
  assert.equal(r.withdrawnShareBpsText, '3333.33');
  assert.equal(r.noDustLeft, false);
  // The payout is strictly less than the exact pro-rata share on the in side: 333 x 300 < 100 x 1000.
  assert.ok(r.amountIn * r.lpSupply < r.lpBurn * r.reserveIn);
});

test('a third of the supply, entered in whole tokens: burning 166666 of 500000 withdraws 333332 in and 166666 out, and the share is read from the amounts', () => {
  const r = modelAmmLiquidityWithdrawal({ ...DEFAULT, lpBurn: '166666' });
  assert.equal(r.amountIn, 333332000000n);
  assert.equal(r.amountOut, 166666000000n);
  assert.equal(r.reserveInAfter, 666668000000n);
  assert.equal(r.reserveOutAfter, 333334000000n);
  assert.equal(r.lpSupplyAfter, 333334000000n);
  assert.equal(r.withdrawnShareBpsText, '3333.32');
});

test('burning more than the existing supply is refused', () => {
  assert.throws(() => modelAmmLiquidityWithdrawal({ reserveIn: '100', reserveOut: '100', lpSupply: '100', lpBurn: '101', decimals: 0 }), /Cannot burn more LP tokens than the existing supply\./);
});

test('zero reserves, a zero existing supply, and a zero burn are each refused with their own message', () => {
  assert.throws(() => modelAmmLiquidityWithdrawal({ reserveIn: '0', reserveOut: '100', lpSupply: '100', lpBurn: '10', decimals: 0 }), /Pool reserve in must be greater than zero\./);
  assert.throws(() => modelAmmLiquidityWithdrawal({ reserveIn: '100', reserveOut: '0', lpSupply: '100', lpBurn: '10', decimals: 0 }), /Pool reserve out must be greater than zero\./);
  assert.throws(() => modelAmmLiquidityWithdrawal({ reserveIn: '100', reserveOut: '100', lpSupply: '0', lpBurn: '10', decimals: 0 }), /Existing LP supply must be greater than zero\./);
  assert.throws(() => modelAmmLiquidityWithdrawal({ reserveIn: '100', reserveOut: '100', lpSupply: '100', lpBurn: '0', decimals: 0 }), /LP tokens to burn must be greater than zero\./);
});

test('a dust withdrawal is refused: too small to withdraw even one base unit on either side', () => {
  assert.throws(() => modelAmmLiquidityWithdrawal({ reserveIn: '100', reserveOut: '100', lpSupply: '1000', lpBurn: '1', decimals: 0 }), /The amount burned is too small to withdraw even one base unit from this pool's reserves\./);
});

test('a one-sided dust withdrawal is refused too: the in side would pay but the out side floors to zero', () => {
  assert.throws(() => modelAmmLiquidityWithdrawal({ reserveIn: '100000', reserveOut: '100', lpSupply: '1000', lpBurn: '1', decimals: 0 }), /The amount burned is too small to withdraw even one base unit from this pool's reserves\./);
});

test('a small exact case, hand-checkable in whole units: reserves 1000 / 1000, supply 1000, burning 100 pays 100 of each', () => {
  const r = modelAmmLiquidityWithdrawal({ reserveIn: '1000', reserveOut: '1000', lpSupply: '1000', lpBurn: '100', decimals: 0 });
  assert.equal(r.amountIn, 100n);
  assert.equal(r.amountOut, 100n);
  assert.equal(r.reserveInAfter, 900n);
  assert.equal(r.reserveOutAfter, 900n);
  assert.equal(r.lpSupplyAfter, 900n);
  assert.equal(r.kBefore, 1000000n);
  assert.equal(r.kAfter, 810000n);
  assert.equal(r.withdrawnShareBpsText, '1000.00');
});

test('beyond-float exactness: reserves and supply of 2^53+1, burning half the supply floored, pays exactly and the share reads 4999.99 from the amounts', () => {
  const r = modelAmmLiquidityWithdrawal({ reserveIn: '9007199254740993', reserveOut: '9007199254740993', lpSupply: '9007199254740993', lpBurn: '4503599627370496', decimals: 0 });
  assert.equal(r.amountIn, 4503599627370496n);
  assert.equal(r.amountOut, 4503599627370496n);
  assert.equal(r.reserveInAfter, 4503599627370497n);
  assert.equal(r.reserveOutAfter, 4503599627370497n);
  assert.equal(r.lpSupplyAfter, 4503599627370497n);
  assert.equal(r.kBefore, 81129638414606699710187514626049n);
  assert.equal(r.kAfter, 20282409603651679431146506027009n);
  assert.equal(r.withdrawnShareBpsText, '4999.99');
  assert.ok(r.kAfter <= r.kBefore);
});

test('validation: the amounts are amounts like any other — malformed ones are refused by the amount layer', () => {
  assert.throws(() => modelAmmLiquidityWithdrawal({ ...DEFAULT, reserveIn: 'abc' }), /Enter a positive decimal amount, without commas or exponents\./);
  assert.throws(() => modelAmmLiquidityWithdrawal({ ...DEFAULT, lpBurn: '-5' }), /Enter a positive decimal amount, without commas or exponents\./);
  assert.throws(() => modelAmmLiquidityWithdrawal({ ...DEFAULT, lpSupply: '1.1234567' }), /Use at most 6 decimal places\./);
});

test('wiring: app.js imports the model, renders an amm withdrawal panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelAmmLiquidityWithdrawal/);
  assert.match(app, /data-wliq/);
  assert.match(app, /amm-withdrawal-output/);
  assert.match(app, /v1\.187/);
  assert.match(readme, /AMM liquidity withdrawal model/);
});
