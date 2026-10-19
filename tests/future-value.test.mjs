import test from 'node:test';
import assert from 'node:assert/strict';
import { modelFutureValue } from '../src/domain.js';

const DEFAULT = { presentAmount: '1000000', growthRateBps: 500, periods: 10, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, growthRateBps: 0 },
  { ...DEFAULT, periods: 0 },
  { ...DEFAULT, presentAmount: '0' },
  { presentAmount: '333', growthRateBps: 700, periods: 7, decimals: 6 },
  { presentAmount: '0.000001', growthRateBps: 100000, periods: 5, decimals: 6 },
  { presentAmount: '123456.789', growthRateBps: 333, periods: 25, decimals: 6 },
  { ...DEFAULT, periods: 1 },
  { presentAmount: '1', growthRateBps: 10000, periods: 3, decimals: 0 },
  { presentAmount: '999', growthRateBps: 1, periods: 2, decimals: 6 },
];

test('preload: an amount of 1000000 at 500 bps over 10 periods grows to 1628894626777, a growth of 628894626777', () => {
  const r = modelFutureValue(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.presentAmount, 1000000000000n);
  assert.equal(r.growthRateBps, 500);
  assert.equal(r.periods, 10);
  assert.equal(r.futureValue, 1628894626777n);
  assert.equal(r.growthAmount, 628894626777n);
  assert.equal(r.futureValueIfGrownOnce, 1050000000000n);
});

test('present amount plus growth is the future value exactly, on every stated case', () => {
  for (const input of CASES) {
    const r = modelFutureValue(input);
    assert.equal(r.presentAmount + r.growthAmount, r.futureValue);
    assert.ok(r.growthAmount >= 0n);
  }
});

test('the future value is the exact floor of present times (10000 + rate)^periods over 10000^periods, on every stated case', () => {
  for (const input of CASES) {
    const r = modelFutureValue(input);
    const p = BigInt(r.periods);
    const num = r.presentAmount * (10000n + BigInt(r.growthRateBps)) ** p;
    const den = 10000n ** p;
    assert.ok(r.futureValue * den <= num);
    assert.ok(num < (r.futureValue + 1n) * den);
    assert.equal(r.futureValueRoundedDown, true);
    assert.equal(r.growthCompoundsEveryPeriod, true);
  }
});

test('the rate compounds every period: the preload future value is not the 1050000000000 that growing once would state', () => {
  const r = modelFutureValue(DEFAULT);
  assert.notEqual(r.futureValue, r.futureValueIfGrownOnce);
  assert.ok(r.futureValue > r.futureValueIfGrownOnce);
});

test('compounding exceeds growing once wherever the rate is positive and more than one period stands, and equals it at exactly one period', () => {
  for (const input of CASES) {
    const r = modelFutureValue(input);
    if (r.growthRateBps > 0 && r.periods > 1 && r.presentAmount > 0n) assert.ok(r.futureValue >= r.futureValueIfGrownOnce);
    if (r.periods === 1) assert.equal(r.futureValue, r.futureValueIfGrownOnce);
  }
  const one = modelFutureValue({ ...DEFAULT, periods: 1 });
  assert.equal(one.futureValue, 1050000000000n);
  assert.equal(one.growthAmount, 50000000000n);
});

test('at a growth rate of zero the amount stays itself and the growth is zero, stated not refused', () => {
  const r = modelFutureValue({ ...DEFAULT, growthRateBps: 0 });
  assert.equal(r.futureValue, 1000000000000n);
  assert.equal(r.growthAmount, 0n);
  assert.equal(r.futureValueIfGrownOnce, 1000000000000n);
});

test('with no periods standing the amount stays itself and the growth is zero, stated not refused', () => {
  const r = modelFutureValue({ ...DEFAULT, periods: 0 });
  assert.equal(r.futureValue, 1000000000000n);
  assert.equal(r.growthAmount, 0n);
});

test('a present amount of zero is stated, not refused: an amount of nothing grows to nothing at any rate', () => {
  const r = modelFutureValue({ ...DEFAULT, presentAmount: '0' });
  assert.equal(r.futureValue, 0n);
  assert.equal(r.growthAmount, 0n);
  assert.equal(r.futureValueIfGrownOnce, 0n);
});

test('a stated amount of 333 at 700 bps over 7 periods grows to 534725231, a growth of 201725231', () => {
  const r = modelFutureValue({ presentAmount: '333', growthRateBps: 700, periods: 7, decimals: 6 });
  assert.equal(r.presentAmount, 333000000n);
  assert.equal(r.futureValue, 534725231n);
  assert.equal(r.growthAmount, 201725231n);
  assert.equal(r.futureValueIfGrownOnce, 356310000n);
});

test('a tiny amount at the highest stated rate compounds exactly: 1 base unit at 100000 bps over 5 periods grows to 161051', () => {
  const r = modelFutureValue({ presentAmount: '0.000001', growthRateBps: 100000, periods: 5, decimals: 6 });
  assert.equal(r.presentAmount, 1n);
  assert.equal(r.futureValue, 161051n);
  assert.equal(r.growthAmount, 161050n);
  assert.equal(r.futureValueIfGrownOnce, 11n);
});

test('fractional amounts are exact: 123456.789 at 333 bps over 25 periods grows to 280011399308, a growth of 156554610308', () => {
  const r = modelFutureValue({ presentAmount: '123456.789', growthRateBps: 333, periods: 25, decimals: 6 });
  assert.equal(r.presentAmount, 123456789000n);
  assert.equal(r.futureValue, 280011399308n);
  assert.equal(r.growthAmount, 156554610308n);
});

test('a rate of 10000 bps doubles the amount every period: 1 at 10000 bps over 3 periods grows to exactly 8', () => {
  const r = modelFutureValue({ presentAmount: '1', growthRateBps: 10000, periods: 3, decimals: 0 });
  assert.equal(r.futureValue, 8n);
  assert.equal(r.growthAmount, 7n);
  assert.equal(r.futureValueIfGrownOnce, 2n);
});

test('a rate of 1 bp grows 999 over 2 periods to 999199809, a growth of 199809', () => {
  const r = modelFutureValue({ presentAmount: '999', growthRateBps: 1, periods: 2, decimals: 6 });
  assert.equal(r.futureValue, 999199809n);
  assert.equal(r.growthAmount, 199809n);
  assert.equal(r.futureValueIfGrownOnce, 999099900n);
});

test('the growth is not a payment and not a fee, and no contribution, withdrawal, rate change, or tax is priced', () => {
  const r = modelFutureValue(DEFAULT);
  assert.equal(r.growthIsPayment, false);
  assert.equal(r.growthIsFee, false);
  assert.equal(r.contributionsPriced, false);
  assert.equal(r.withdrawalsPriced, false);
  assert.equal(r.rateChangesPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a growth rate above 100000 bps, negative, or fractional is refused, and periods above 100, negative, or fractional are refused', () => {
  assert.throws(() => modelFutureValue({ ...DEFAULT, growthRateBps: 100001 }), /Growth rate must be a whole number of basis points/);
  assert.throws(() => modelFutureValue({ ...DEFAULT, growthRateBps: -1 }), /Growth rate must be a whole number of basis points/);
  assert.throws(() => modelFutureValue({ ...DEFAULT, growthRateBps: 2.5 }), /Growth rate must be a whole number of basis points/);
  assert.throws(() => modelFutureValue({ ...DEFAULT, periods: 101 }), /Periods must be a whole number/);
  assert.throws(() => modelFutureValue({ ...DEFAULT, periods: -1 }), /Periods must be a whole number/);
  assert.throws(() => modelFutureValue({ ...DEFAULT, periods: 1.5 }), /Periods must be a whole number/);
});
