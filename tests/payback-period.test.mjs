import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPaybackPeriod } from '../src/domain.js';

const DEFAULT = { initialOutlay: '1000000', inflowPerPeriod: '250000', elapsedPeriods: 3, decimals: 6 };
const CASES = [
  DEFAULT,
  { ...DEFAULT, elapsedPeriods: 0 },
  { ...DEFAULT, elapsedPeriods: 4 },
  { ...DEFAULT, elapsedPeriods: 6 },
  { initialOutlay: '100', inflowPerPeriod: '30', elapsedPeriods: 3, decimals: 6 },
  { initialOutlay: '100', inflowPerPeriod: '300', elapsedPeriods: 2, decimals: 6 },
  { initialOutlay: '0.001', inflowPerPeriod: '0.0004', elapsedPeriods: 2, decimals: 6 },
  { initialOutlay: '333333.333333', inflowPerPeriod: '111111.111111', elapsedPeriods: 2, decimals: 6 },
  { initialOutlay: '2', inflowPerPeriod: '1', elapsedPeriods: 1, decimals: 6 },
  { ...DEFAULT, decimals: 0 },
];

test('preload: an outlay of 1000000 at an inflow of 250000 per period pays back in 4 periods, with 750000000000 recovered and 250000000000 unrecovered after 3 periods', () => {
  const r = modelPaybackPeriod(DEFAULT);
  assert.equal(r.decimals, 6);
  assert.equal(r.initialOutlay, 1000000000000n);
  assert.equal(r.inflowPerPeriod, 250000000000n);
  assert.equal(r.periodsToPayback, 4n);
  assert.equal(r.cumulativeInflow, 750000000000n);
  assert.equal(r.recoveredAmount, 750000000000n);
  assert.equal(r.unrecoveredAmount, 250000000000n);
  assert.equal(r.excessInflow, 0n);
  assert.equal(r.neededInFinalPeriod, 250000000000n);
  assert.equal(r.isPaidBack, false);
});

test('the count rounds up, never down: at an inflow of 300000 the payback stands in the 4th period, because 3 periods recover only 900000', () => {
  const r = modelPaybackPeriod({ ...DEFAULT, inflowPerPeriod: '300000' });
  assert.equal(r.countRoundsUp, true);
  assert.equal(r.periodsToPayback, 4n);
  assert.notEqual(r.periodsToPayback, 3n);
  assert.equal(r.recoveredAmount, 900000000000n);
  assert.equal(r.neededInFinalPeriod, 100000000000n);
});

test('recovery is capped at the outlay and both amounts are conserved on every stated case', () => {
  for (const input of CASES) {
    const r = modelPaybackPeriod(input);
    assert.equal(r.recoveryCappedAtOutlay, true);
    assert.ok(r.recoveredAmount <= r.initialOutlay);
    assert.equal(r.recoveredAmount + r.unrecoveredAmount, r.initialOutlay);
    assert.equal(r.recoveredAmount + r.excessInflow, r.cumulativeInflow > r.initialOutlay ? r.cumulativeInflow : r.recoveredAmount + r.excessInflow);
    assert.equal(r.cumulativeInflow, r.inflowPerPeriod * BigInt(r.elapsedPeriods));
    assert.ok(r.neededInFinalPeriod >= 1n && r.neededInFinalPeriod <= r.inflowPerPeriod);
    assert.equal(r.isPaidBack, BigInt(r.elapsedPeriods) >= r.periodsToPayback);
  }
});

test('payback is not profit, and time value, varying inflows, net present value, internal rate of return, after-payback, and taxes are not priced', () => {
  const r = modelPaybackPeriod(DEFAULT);
  assert.equal(r.paybackIsProfit, false);
  assert.equal(r.timeValuePriced, false);
  assert.equal(r.varyingInflowsPriced, false);
  assert.equal(r.npvPriced, false);
  assert.equal(r.irrPriced, false);
  assert.equal(r.afterPaybackPriced, false);
  assert.equal(r.taxesPriced, false);
});

test('zero elapsed periods recover nothing and the whole outlay is unrecovered', () => {
  const r = modelPaybackPeriod({ ...DEFAULT, elapsedPeriods: 0 });
  assert.equal(r.cumulativeInflow, 0n);
  assert.equal(r.recoveredAmount, 0n);
  assert.equal(r.unrecoveredAmount, 1000000000000n);
  assert.equal(r.isPaidBack, false);
});

test('at the payback period the outlay is recovered exactly, with no excess and nothing unrecovered', () => {
  const r = modelPaybackPeriod({ ...DEFAULT, elapsedPeriods: 4 });
  assert.equal(r.recoveredAmount, 1000000000000n);
  assert.equal(r.unrecoveredAmount, 0n);
  assert.equal(r.excessInflow, 0n);
  assert.equal(r.isPaidBack, true);
});

test('inflow beyond the outlay is excess, never recovered: after 6 periods the cumulative inflow is 1500000000000, recovery stays 1000000000000, and the excess is 500000000000', () => {
  const r = modelPaybackPeriod({ ...DEFAULT, elapsedPeriods: 6 });
  assert.equal(r.cumulativeInflow, 1500000000000n);
  assert.equal(r.recoveredAmount, 1000000000000n);
  assert.notEqual(r.recoveredAmount, 1500000000000n);
  assert.equal(r.excessInflow, 500000000000n);
  assert.equal(r.isPaidBack, true);
});

test('only part of the final period inflow is needed: on 100 at 30 per period, payback is the 4th period and only 10000000 of its inflow is needed', () => {
  const r = modelPaybackPeriod({ initialOutlay: '100', inflowPerPeriod: '30', elapsedPeriods: 3, decimals: 6 });
  assert.equal(r.periodsToPayback, 4n);
  assert.equal(r.recoveredAmount, 90000000n);
  assert.equal(r.unrecoveredAmount, 10000000n);
  assert.equal(r.neededInFinalPeriod, 10000000n);
});

test('an inflow above the whole outlay pays back in the first period and needs only the outlay from it', () => {
  const r = modelPaybackPeriod({ initialOutlay: '100', inflowPerPeriod: '300', elapsedPeriods: 2, decimals: 6 });
  assert.equal(r.periodsToPayback, 1n);
  assert.equal(r.neededInFinalPeriod, 100000000n);
  assert.equal(r.recoveredAmount, 100000000n);
  assert.equal(r.excessInflow, 500000000n);
});

test('on a tiny outlay of 0.001 at 0.0004 per period, payback is the 3rd period, 800 is recovered after 2 periods, and 200 is needed in the final period', () => {
  const r = modelPaybackPeriod({ initialOutlay: '0.001', inflowPerPeriod: '0.0004', elapsedPeriods: 2, decimals: 6 });
  assert.equal(r.periodsToPayback, 3n);
  assert.equal(r.recoveredAmount, 800n);
  assert.equal(r.unrecoveredAmount, 200n);
  assert.equal(r.neededInFinalPeriod, 200n);
});

test('fractional amounts are exact: 333333.333333 at 111111.111111 per period pays back in exactly 3 periods', () => {
  const r = modelPaybackPeriod({ initialOutlay: '333333.333333', inflowPerPeriod: '111111.111111', elapsedPeriods: 2, decimals: 6 });
  assert.equal(r.periodsToPayback, 3n);
  assert.equal(r.recoveredAmount, 222222222222n);
  assert.equal(r.unrecoveredAmount, 111111111111n);
  assert.equal(r.neededInFinalPeriod, 111111111111n);
});

test('more elapsed periods always recover at least as much and never raise the unrecovered amount', () => {
  const early = modelPaybackPeriod({ ...DEFAULT, elapsedPeriods: 1 });
  const late = modelPaybackPeriod({ ...DEFAULT, elapsedPeriods: 3 });
  assert.ok(late.recoveredAmount > early.recoveredAmount);
  assert.ok(late.unrecoveredAmount < early.unrecoveredAmount);
});

test('an initial outlay of zero is refused', () => {
  assert.throws(() => modelPaybackPeriod({ ...DEFAULT, initialOutlay: '0' }), /Initial outlay must be greater than zero/);
});

test('an inflow per period of zero is refused', () => {
  assert.throws(() => modelPaybackPeriod({ ...DEFAULT, inflowPerPeriod: '0' }), /Inflow per period must be greater than zero/);
});

test('elapsed periods beyond 10000 or not whole are refused', () => {
  assert.throws(() => modelPaybackPeriod({ ...DEFAULT, elapsedPeriods: 10001 }), /Elapsed periods must be a whole number/);
  assert.throws(() => modelPaybackPeriod({ ...DEFAULT, elapsedPeriods: -1 }), /Elapsed periods must be a whole number/);
  assert.throws(() => modelPaybackPeriod({ ...DEFAULT, elapsedPeriods: 2.5 }), /Elapsed periods must be a whole number/);
});
