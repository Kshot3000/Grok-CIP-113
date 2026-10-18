import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCashRunway } from '../src/domain.js';

const DEFAULT = { cashBalance: '1000000', netBurnPerPeriod: '300000', elapsedPeriods: 2, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, elapsedPeriods: 0 },
  { ...DEFAULT, elapsedPeriods: 4 },
  { ...DEFAULT, netBurnPerPeriod: '0' },
  { cashBalance: '100', netBurnPerPeriod: '30', elapsedPeriods: 3, decimals: 6 },
  { cashBalance: '0.001', netBurnPerPeriod: '0.0004', elapsedPeriods: 2, decimals: 6 },
  { cashBalance: '1000000', netBurnPerPeriod: '300000', elapsedPeriods: 2, decimals: 0 },
  { cashBalance: '7', netBurnPerPeriod: '2', elapsedPeriods: 3, decimals: 6 },
  { cashBalance: '0.5', netBurnPerPeriod: '0.25', elapsedPeriods: 1, decimals: 6 },
  { cashBalance: '1000000', netBurnPerPeriod: '1000000', elapsedPeriods: 1, decimals: 6 },
];

test('preload: a balance of 1000000 burning 300000 per period covers 3 full periods with 100000000000 left, and after 2 elapsed periods 400000000000 remains', () => {
  const r = modelCashRunway(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.cashBalance, 1000000000000n);
  assert.equal(r.netBurnPerPeriod, 300000000000n);
  assert.equal(r.elapsedPeriods, 2);
  assert.equal(r.fullPeriodsCovered, 3n);
  assert.equal(r.remainderAfterFullPeriods, 100000000000n);
  assert.equal(r.shortfallForOneMorePeriod, 200000000000n);
  assert.equal(r.burnedInElapsedPeriods, 600000000000n);
  assert.equal(r.cashRemainingAfterElapsed, 400000000000n);
  assert.equal(r.exhaustedWithinElapsed, false);
});

test('the runway is not rounded up: a fourth period would need 1200000000000, more than the 1000000000000 that stands', () => {
  const r = modelCashRunway(DEFAULT);
  assert.equal(r.runwayCountsFullPeriodsOnly, true);
  assert.notEqual(r.fullPeriodsCovered, 4n);
  assert.ok((r.fullPeriodsCovered + 1n) * r.netBurnPerPeriod > r.cashBalance);
  assert.equal((r.fullPeriodsCovered + 1n) * r.netBurnPerPeriod - r.cashBalance, r.shortfallForOneMorePeriod);
});

test('burned plus remaining is the balance exactly, and full periods plus remainder reconstruct it, on every stated case', () => {
  for (const input of CASES) {
    const r = modelCashRunway(input);
    assert.equal(r.burnedInElapsedPeriods + r.cashRemainingAfterElapsed, r.cashBalance);
    assert.ok(r.burnedInElapsedPeriods <= r.cashBalance);
    if (r.netBurnPerPeriod > 0n) {
      assert.equal(r.fullPeriodsCovered * r.netBurnPerPeriod + r.remainderAfterFullPeriods, r.cashBalance);
      assert.ok(r.remainderAfterFullPeriods < r.netBurnPerPeriod);
      assert.equal(r.shortfallForOneMorePeriod, r.netBurnPerPeriod - r.remainderAfterFullPeriods);
    }
  }
});

test('the remaining cash is not profit, and gross outflows, inflows, burn changes, new funding, and taxes are not priced', () => {
  const r = modelCashRunway(DEFAULT);
  assert.equal(r.remainingCashIsProfit, false);
  assert.equal(r.burnTakenAsStatedNet, true);
  assert.equal(r.grossOutflowsPriced, false);
  assert.equal(r.inflowsPriced, false);
  assert.equal(r.burnChangesPriced, false);
  assert.equal(r.newFundingPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('a net burn of zero is stated, not refused: no finite count, nothing burned, and the whole balance stands', () => {
  const r = modelCashRunway({ ...DEFAULT, netBurnPerPeriod: '0', elapsedPeriods: 5 });
  assert.equal(r.fullPeriodsCovered, null);
  assert.equal(r.remainderAfterFullPeriods, 1000000000000n);
  assert.equal(r.shortfallForOneMorePeriod, 0n);
  assert.equal(r.burnedInElapsedPeriods, 0n);
  assert.equal(r.cashRemainingAfterElapsed, 1000000000000n);
  assert.equal(r.exhaustedWithinElapsed, false);
});

test('zero elapsed periods burn nothing: the whole balance remains and nothing is exhausted', () => {
  const r = modelCashRunway({ ...DEFAULT, elapsedPeriods: 0 });
  assert.equal(r.burnedInElapsedPeriods, 0n);
  assert.equal(r.cashRemainingAfterElapsed, r.cashBalance);
  assert.equal(r.exhaustedWithinElapsed, false);
});

test('elapsed periods beyond the runway cap the burn at the balance: at 4 elapsed the burn is the whole balance and nothing remains', () => {
  const r = modelCashRunway({ ...DEFAULT, elapsedPeriods: 4 });
  assert.equal(r.burnedInElapsedPeriods, 1000000000000n);
  assert.equal(r.cashRemainingAfterElapsed, 0n);
  assert.equal(r.exhaustedWithinElapsed, true);
});

test('an exact division leaves no remainder: a burn equal to the balance covers 1 period, and the shortfall for one more is the whole burn', () => {
  const r = modelCashRunway({ cashBalance: '1000000', netBurnPerPeriod: '1000000', elapsedPeriods: 1, decimals: 6 });
  assert.equal(r.fullPeriodsCovered, 1n);
  assert.equal(r.remainderAfterFullPeriods, 0n);
  assert.equal(r.shortfallForOneMorePeriod, 1000000000000n);
  assert.equal(r.cashRemainingAfterElapsed, 0n);
  assert.equal(r.exhaustedWithinElapsed, true);
});

test('on tiny amounts of 0.001 burning 0.0004, the runway is 2 periods, the remainder is 200, and after 2 elapsed periods 200 remains', () => {
  const r = modelCashRunway({ cashBalance: '0.001', netBurnPerPeriod: '0.0004', elapsedPeriods: 2, decimals: 6 });
  assert.equal(r.fullPeriodsCovered, 2n);
  assert.equal(r.remainderAfterFullPeriods, 200n);
  assert.equal(r.shortfallForOneMorePeriod, 200n);
  assert.equal(r.burnedInElapsedPeriods, 800n);
  assert.equal(r.cashRemainingAfterElapsed, 200n);
});

test('fractional amounts are exact: 123456.789 burning 10000.25 covers 12 periods with 3453789000 left, and after 5 elapsed periods 73455539000 remains', () => {
  const r = modelCashRunway({ cashBalance: '123456.789', netBurnPerPeriod: '10000.25', elapsedPeriods: 5, decimals: 6 });
  assert.equal(r.fullPeriodsCovered, 12n);
  assert.equal(r.remainderAfterFullPeriods, 3453789000n);
  assert.equal(r.shortfallForOneMorePeriod, 6546461000n);
  assert.equal(r.burnedInElapsedPeriods, 50001250000n);
  assert.equal(r.cashRemainingAfterElapsed, 73455539000n);
});

test('a larger burn always states a shorter or equal runway on the same balance', () => {
  const low = modelCashRunway({ ...DEFAULT, netBurnPerPeriod: '100000' });
  const high = modelCashRunway({ ...DEFAULT, netBurnPerPeriod: '400000' });
  assert.equal(low.fullPeriodsCovered, 10n);
  assert.equal(high.fullPeriodsCovered, 2n);
  assert.ok(high.fullPeriodsCovered < low.fullPeriodsCovered);
});

test('a cash balance of zero is refused', () => {
  assert.throws(() => modelCashRunway({ ...DEFAULT, cashBalance: '0' }), /Cash balance must be greater than zero/);
});

test('a negative elapsed count is refused', () => {
  assert.throws(() => modelCashRunway({ ...DEFAULT, elapsedPeriods: -1 }), /Elapsed periods must be a whole number/);
});

test('a fractional elapsed count is refused', () => {
  assert.throws(() => modelCashRunway({ ...DEFAULT, elapsedPeriods: 2.5 }), /Elapsed periods must be a whole number/);
});

test('an elapsed count beyond 10000 is refused', () => {
  assert.throws(() => modelCashRunway({ ...DEFAULT, elapsedPeriods: 10001 }), /Elapsed periods must be a whole number/);
});
