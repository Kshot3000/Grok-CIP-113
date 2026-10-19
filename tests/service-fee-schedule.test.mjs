import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { serviceFeeSchedule } from '../src/domain.js';

const BASE = { amount: '1000', decimals: 6, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 100 };

test('defaults: 100 bps for 3 months, then 200 bps, horizon total 21,000 against a flat 12,000', () => {
  const r = serviceFeeSchedule({ ...BASE });
  assert.equal(r.initialFeePerTransfer, 10000000n);
  assert.equal(r.laterFeePerTransfer, 20000000n);
  assert.equal(r.initialMonths, 3);
  assert.equal(r.laterMonths, 9);
  assert.equal(r.horizonMonths, 12);
  assert.equal(r.monthlyInitialFee, 1000000000n);
  assert.equal(r.monthlyLaterFee, 2000000000n);
  assert.equal(r.totalFee, 21000000000n);
  assert.equal(r.totalGross, 1200000000000n);
  assert.equal(r.flatTotalAtInitialFee, 12000000000n);
  assert.equal(r.differenceVsFlatInitial, -9000000000n);
  assert.equal(r.change, 'increase');
  assert.equal(r.firstLaterMonth, 4);
  assert.equal(r.blendedBpsText, '175.00');
});

test('periods carry their own months, monthly fee, and total', () => {
  const r = serviceFeeSchedule({ ...BASE });
  assert.deepEqual(r.periods.map(p => p.key), ['initial', 'later']);
  assert.deepEqual(r.periods.map(p => p.months), [3, 9]);
  assert.deepEqual(r.periods.map(p => p.totalFee), [3000000000n, 18000000000n]);
  assert.equal(r.periods[0].totalFee + r.periods[1].totalFee, r.totalFee);
  assert.equal(r.totalNet, r.totalGross - r.totalFee);
});

test('a step down is a decrease, stated from the signed difference against the flat horizon', () => {
  const r = serviceFeeSchedule({ amount: '100', decimals: 0, feeBps: 200, fixedFee: '0', maxFee: '', transfersPerMonth: 10, laterBps: 100, initialMonths: 2, horizonMonths: 6 });
  assert.equal(r.initialFeePerTransfer, 2n);
  assert.equal(r.laterFeePerTransfer, 1n);
  assert.equal(r.totalFee, 80n); // 2 months × 20 + 4 months × 10
  assert.equal(r.flatTotalAtInitialFee, 120n);
  assert.equal(r.differenceVsFlatInitial, 40n);
  assert.equal(r.change, 'decrease');
});

test('the blended rate comes from the horizon totals, not an average of the two rates', () => {
  const r = serviceFeeSchedule({ amount: '1000', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 1, laterBps: 33, initialMonths: 1, horizonMonths: 3 });
  // Fees 10 then 3 (floor) then 3: total 16 on 3000 moved = 53.33 bps, not (100+33)/2.
  assert.equal(r.totalFee, 16n);
  assert.equal(r.blendedBpsText, '53.33');
  assert.equal(r.change, 'decrease');
});

test('the cap applies per period and is reported per period', () => {
  const r = serviceFeeSchedule({ amount: '1000', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '15', transfersPerMonth: 1, laterBps: 500, initialMonths: 1, horizonMonths: 4 });
  assert.equal(r.initialFeePerTransfer, 10n);
  assert.equal(r.initialCapApplied, false);
  assert.equal(r.laterFeePerTransfer, 15n);
  assert.equal(r.laterCapApplied, true);
  assert.equal(r.totalFee, 55n);
});

test('a cap can hold two different rates to the same fee: the change is none, stated from the fees', () => {
  const r = serviceFeeSchedule({ amount: '1000', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '10', transfersPerMonth: 1, laterBps: 300, initialMonths: 1, horizonMonths: 2 });
  assert.equal(r.initialFeePerTransfer, 10n);
  assert.equal(r.laterFeePerTransfer, 10n);
  assert.equal(r.change, 'none');
  assert.equal(r.differenceVsFlatInitial, 0n);
});

test('the fixed fee is charged in both periods', () => {
  const r = serviceFeeSchedule({ amount: '1000', decimals: 0, feeBps: 100, fixedFee: '5', maxFee: '', transfersPerMonth: 1, laterBps: 200, initialMonths: 1, horizonMonths: 2 });
  assert.equal(r.initialFeePerTransfer, 15n);
  assert.equal(r.laterFeePerTransfer, 25n);
});

test('zero initial months: the whole horizon pays the later rate', () => {
  const r = serviceFeeSchedule({ ...BASE, laterBps: 200, initialMonths: 0, horizonMonths: 3 });
  assert.equal(r.initialMonths, 0);
  assert.equal(r.periods[0].totalFee, 0n);
  assert.equal(r.totalFee, 6000000000n); // 3 months × 2000
  assert.equal(r.firstLaterMonth, 1);
});

test('a step scheduled beyond the horizon carries no months and refuses nothing, even at a takes-all later rate', () => {
  const r = serviceFeeSchedule({ amount: '100', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 1, laterBps: 10000, initialMonths: 2, horizonMonths: 2 });
  assert.equal(r.laterMonths, 0);
  assert.equal(r.laterFeePerTransfer, 100n);
  assert.equal(r.totalFee, 2n);
  assert.equal(r.firstLaterMonth, null);
  assert.equal(r.change, 'increase'); // the scheduled step is still described, it just never lands in this horizon
});

test('a takes-all later rate is refused when the later period carries months', () => {
  assert.throws(() => serviceFeeSchedule({ amount: '100', decimals: 0, feeBps: 100, fixedFee: '0', maxFee: '', transfersPerMonth: 1, laterBps: 10000, initialMonths: 1, horizonMonths: 2 }), /later fee would take the whole transfer/);
});

test('the initial rate validations propagate from the base split', () => {
  assert.throws(() => serviceFeeSchedule({ ...BASE, feeBps: 10001 }), /Fee must be a whole number of basis points/);
  assert.throws(() => serviceFeeSchedule({ ...BASE, fixedFee: '1000' }), /would take the whole transfer/);
});

test('the later rate must be a whole number of basis points in range', () => {
  assert.throws(() => serviceFeeSchedule({ ...BASE, laterBps: 10001 }), /Later fee must be a whole number/);
  assert.throws(() => serviceFeeSchedule({ ...BASE, laterBps: -1 }), /Later fee must be a whole number/);
  assert.throws(() => serviceFeeSchedule({ ...BASE, laterBps: 1.5 }), /Later fee must be a whole number/);
});

test('the horizon must be a whole number of months between 1 and 36', () => {
  assert.throws(() => serviceFeeSchedule({ ...BASE, horizonMonths: 0 }), /Horizon must be a whole number of months between 1 and 36/);
  assert.throws(() => serviceFeeSchedule({ ...BASE, horizonMonths: 37 }), /Horizon must be a whole number of months between 1 and 36/);
  assert.throws(() => serviceFeeSchedule({ ...BASE, horizonMonths: 2.5 }), /Horizon must be a whole number of months between 1 and 36/);
});

test('the initial months must be a whole number within the horizon, naming it', () => {
  assert.throws(() => serviceFeeSchedule({ ...BASE, initialMonths: -1 }), /between 0 and the horizon of 12/);
  assert.throws(() => serviceFeeSchedule({ ...BASE, initialMonths: 13 }), /between 0 and the horizon of 12/);
  assert.throws(() => serviceFeeSchedule({ ...BASE, initialMonths: 1.5 }), /between 0 and the horizon of 12/);
});

test('equal rates collect exactly the flat total', () => {
  const r = serviceFeeSchedule({ ...BASE, laterBps: 100, initialMonths: 5, horizonMonths: 12 });
  assert.equal(r.change, 'none');
  assert.equal(r.totalFee, r.flatTotalAtInitialFee);
  assert.equal(r.blendedBpsText, '100.00');
});

test('exactness beyond float range: the horizon totals are exact BigInt', () => {
  const r = serviceFeeSchedule({ amount: '9007199254740993', decimals: 0, feeBps: 5000, fixedFee: '0', maxFee: '', transfersPerMonth: 1, laterBps: 2500, initialMonths: 1, horizonMonths: 2 });
  assert.equal(r.initialFeePerTransfer, 4503599627370496n);
  assert.equal(r.laterFeePerTransfer, 2251799813685248n);
  assert.equal(r.totalFee, 6755399441055744n);
});

test('panel wiring: the schedule renders in app.js with its time fields', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /serviceFeeSchedule\(/);
  assert.match(app, /data-fee="laterBps"/);
  assert.match(app, /data-fee="initialMonths"/);
  assert.match(app, /data-fee="horizonMonths"/);
  assert.match(app, /schedule-fee-table/);
  assert.match(app, /v1\.281/);
});
