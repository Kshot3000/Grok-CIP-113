import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelAmmLiquidityDeposit } from '../src/domain.js';

// Constant-product AMM liquidity deposit model (v1.241): a deposit
// into an existing pool, taken in full on both sides, with the LP
// tokens minted governed by the LIMITING side — the smaller of the
// two sides priced against the existing supply. Any excess over
// the pool's ratio mints nothing extra, and the provider's share
// is derived from the amounts, never from the deposit alone.
const DEFAULT = { reserveIn: '1000000', reserveOut: '500000', lpSupply: '500000', depositIn: '10000', depositOut: '6000', decimals: 6 };

test('the preloaded deposit: 10000 in and 6000 out against 1000000 / 500000 reserves with a 500000 supply mints 5000 LP tokens, limited by the in side', () => {
  const r = modelAmmLiquidityDeposit(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.reserveIn, 1000000000000n);
  assert.equal(r.reserveOut, 500000000000n);
  assert.equal(r.lpSupply, 500000000000n);
  assert.equal(r.depositIn, 10000000000n);
  assert.equal(r.depositOut, 6000000000n);
  assert.equal(r.lpFromIn, 5000000000n);
  assert.equal(r.lpFromOut, 6000000000n);
  assert.equal(r.lpMinted, 5000000000n);
  assert.equal(r.pairedOut, 5000000000n);
  assert.equal(r.pairedIn, 12000000000n);
  assert.equal(r.excessIn, 0n);
  assert.equal(r.excessOut, 1000000000n);
  assert.equal(r.reserveInAfter, 1010000000000n);
  assert.equal(r.reserveOutAfter, 506000000000n);
  assert.equal(r.lpSupplyAfter, 505000000000n);
  assert.equal(r.kBefore, 500000000000000000000000n);
  assert.equal(r.kAfter, 511060000000000000000000n);
  assert.equal(r.providerShareBpsText, '99.00');
  assert.equal(r.limitingSide, 'in');
  assert.equal(r.inLimited, true);
  assert.equal(r.outLimited, false);
  assert.equal(r.balanced, false);
});

test('decimals default to 6', () => {
  const r = modelAmmLiquidityDeposit({ reserveIn: '1000000', reserveOut: '500000', lpSupply: '500000', depositIn: '10000', depositOut: '6000' });
  assert.equal(r.decimals, 6);
  assert.equal(r.lpMinted, 5000000000n);
});

test('identities at the preload: both deposits enter in full, the supply grows by exactly the minted amount, the minted amount is the minimum of the two sides, and k never shrinks', () => {
  const r = modelAmmLiquidityDeposit(DEFAULT);
  assert.equal(r.reserveInAfter, r.reserveIn + r.depositIn);
  assert.equal(r.reserveOutAfter, r.reserveOut + r.depositOut);
  assert.equal(r.lpSupplyAfter, r.lpSupply + r.lpMinted);
  assert.equal(r.lpMinted, r.lpFromIn < r.lpFromOut ? r.lpFromIn : r.lpFromOut);
  assert.ok(r.kAfter >= r.kBefore);
});

test('k never shrinks across deposit shapes, balanced and imbalanced', () => {
  for (const input of [
    DEFAULT,
    { ...DEFAULT, depositOut: '5000' },
    { ...DEFAULT, depositIn: '12000', depositOut: '5000' },
    { ...DEFAULT, depositIn: '1', depositOut: '1' },
    { reserveIn: '7', reserveOut: '7', lpSupply: '7', depositIn: '7', depositOut: '7', decimals: 0 },
  ]) {
    const r = modelAmmLiquidityDeposit(input);
    assert.ok(r.kAfter >= r.kBefore);
    assert.equal(r.lpSupplyAfter, r.lpSupply + r.lpMinted);
  }
});

test('a balanced deposit at the pool ratio mints the same from both sides and carries no excess', () => {
  const r = modelAmmLiquidityDeposit({ ...DEFAULT, depositOut: '5000' });
  assert.equal(r.lpFromIn, 5000000000n);
  assert.equal(r.lpFromOut, 5000000000n);
  assert.equal(r.lpMinted, 5000000000n);
  assert.equal(r.excessIn, 0n);
  assert.equal(r.excessOut, 0n);
  assert.equal(r.limitingSide, 'balanced');
  assert.equal(r.balanced, true);
  assert.equal(r.reserveOutAfter, 505000000000n);
  assert.equal(r.kAfter, 510050000000000000000000n);
});

test('an in-heavy deposit is limited by the out side and its excess in mints nothing', () => {
  const r = modelAmmLiquidityDeposit({ ...DEFAULT, depositIn: '12000', depositOut: '5000' });
  assert.equal(r.lpFromIn, 6000000000n);
  assert.equal(r.lpFromOut, 5000000000n);
  assert.equal(r.lpMinted, 5000000000n);
  assert.equal(r.excessIn, 2000000000n);
  assert.equal(r.excessOut, 0n);
  assert.equal(r.limitingSide, 'out');
  assert.equal(r.outLimited, true);
  // The excess still enters the reserve in full.
  assert.equal(r.reserveInAfter, 1012000000000n);
});

test('the excess is not rewarded: a larger out deposit beyond the ratio mints exactly the same LP as the balanced deposit', () => {
  const balanced = modelAmmLiquidityDeposit({ ...DEFAULT, depositOut: '5000' });
  const heavy = modelAmmLiquidityDeposit(DEFAULT);
  assert.equal(heavy.lpMinted, balanced.lpMinted);
  assert.ok(heavy.reserveOutAfter > balanced.reserveOutAfter);
});

test('a dust deposit is refused: too small to mint even one base unit of LP token', () => {
  assert.throws(() => modelAmmLiquidityDeposit({ reserveIn: '1000000', reserveOut: '1000000', lpSupply: '1000', depositIn: '1', depositOut: '1', decimals: 0 }), /The deposit is too small to mint even one base unit of LP token at this pool's reserves and supply\./);
});

test('zero reserves, a zero existing supply, and zero deposits are each refused with their own message', () => {
  assert.throws(() => modelAmmLiquidityDeposit({ reserveIn: '0', reserveOut: '100', lpSupply: '100', depositIn: '10', depositOut: '10', decimals: 0 }), /Pool reserve in must be greater than zero\./);
  assert.throws(() => modelAmmLiquidityDeposit({ reserveIn: '100', reserveOut: '0', lpSupply: '100', depositIn: '10', depositOut: '10', decimals: 0 }), /Pool reserve out must be greater than zero\./);
  assert.throws(() => modelAmmLiquidityDeposit({ reserveIn: '100', reserveOut: '100', lpSupply: '0', depositIn: '10', depositOut: '10', decimals: 0 }), /Existing LP supply must be greater than zero\./);
  assert.throws(() => modelAmmLiquidityDeposit({ reserveIn: '100', reserveOut: '100', lpSupply: '100', depositIn: '0', depositOut: '10', decimals: 0 }), /Deposit in must be greater than zero\./);
  assert.throws(() => modelAmmLiquidityDeposit({ reserveIn: '100', reserveOut: '100', lpSupply: '100', depositIn: '10', depositOut: '0', decimals: 0 }), /Deposit out must be greater than zero\./);
});

test('a small exact case, hand-checkable in whole units: reserves 1000 / 1000, supply 1000, deposit 100 / 100 mints 100', () => {
  const r = modelAmmLiquidityDeposit({ reserveIn: '1000', reserveOut: '1000', lpSupply: '1000', depositIn: '100', depositOut: '100', decimals: 0 });
  assert.equal(r.lpMinted, 100n);
  assert.equal(r.reserveInAfter, 1100n);
  assert.equal(r.reserveOutAfter, 1100n);
  assert.equal(r.lpSupplyAfter, 1100n);
  assert.equal(r.kBefore, 1000000n);
  assert.equal(r.kAfter, 1210000n);
  assert.equal(r.providerShareBpsText, '909.09');
  assert.equal(r.balanced, true);
});

test('the provider share is derived from the amounts after the deposit, not the deposit over the old supply: the preload reads 99.00, not 100.00', () => {
  const r = modelAmmLiquidityDeposit(DEFAULT);
  assert.equal(r.providerShareBpsText, '99.00');
});

test('beyond-float exactness: reserves, supply, and deposits of 2^53+1 price exactly, limited by the out side, with the excess in stated exactly', () => {
  const r = modelAmmLiquidityDeposit({ reserveIn: '9007199254740993', reserveOut: '9007199254740993', lpSupply: '9007199254740993', depositIn: '9007199254740993', depositOut: '4503599627370496', decimals: 0 });
  assert.equal(r.lpFromIn, 9007199254740993n);
  assert.equal(r.lpFromOut, 4503599627370496n);
  assert.equal(r.lpMinted, 4503599627370496n);
  assert.equal(r.excessIn, 4503599627370497n);
  assert.equal(r.excessOut, 0n);
  assert.equal(r.reserveInAfter, 18014398509481986n);
  assert.equal(r.reserveOutAfter, 13510798882111489n);
  assert.equal(r.lpSupplyAfter, 13510798882111489n);
  assert.equal(r.kBefore, 81129638414606699710187514626049n);
  assert.equal(r.kAfter, 243388915243820090123363289137154n);
  assert.equal(r.providerShareBpsText, '3333.33');
  assert.equal(r.limitingSide, 'out');
  assert.ok(r.kAfter >= r.kBefore);
});

test('doubling the pool exactly: a deposit equal to both reserves mints exactly the existing supply', () => {
  const r = modelAmmLiquidityDeposit({ reserveIn: '1000', reserveOut: '500', lpSupply: '250', depositIn: '1000', depositOut: '500', decimals: 0 });
  assert.equal(r.lpMinted, 250n);
  assert.equal(r.lpSupplyAfter, 500n);
  assert.equal(r.providerShareBpsText, '5000.00');
  assert.equal(r.balanced, true);
});

test('validation: the amounts are amounts like any other — malformed ones are refused by the amount layer', () => {
  assert.throws(() => modelAmmLiquidityDeposit({ ...DEFAULT, reserveIn: 'abc' }), /Enter a positive decimal amount, without commas or exponents\./);
  assert.throws(() => modelAmmLiquidityDeposit({ ...DEFAULT, depositIn: '-5' }), /Enter a positive decimal amount, without commas or exponents\./);
  assert.throws(() => modelAmmLiquidityDeposit({ ...DEFAULT, lpSupply: '1.1234567' }), /Use at most 6 decimal places\./);
});

test('wiring: app.js imports the model, renders an amm liquidity panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelAmmLiquidityDeposit/);
  assert.match(app, /data-liq/);
  assert.match(app, /amm-liquidity-output/);
  assert.match(app, /v1\.241/);
  assert.match(readme, /AMM liquidity deposit model/);
});
