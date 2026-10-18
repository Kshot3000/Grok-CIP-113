import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelCashRounding } from '../src/domain.js';

// Cash rounding model (v1.271): a NEW axis — a stated amount
// rounded to the NEAREST stated increment, ties up, with the
// adjustment stated signed and never silently absorbed, and
// the adjustment never exceeding half the increment.
const DEFAULT = { amount: '103', increment: '5', decimals: 6 };

test('the preloaded rounding: 103 to the nearest 5 states 105 paid and an adjustment of +2, shares 10194.17 paid and 194.17 adjustment', () => {
  const r = modelCashRounding(DEFAULT);
  assert.equal(r.amount, 103000000n);
  assert.equal(r.increment, 5000000n);
  assert.equal(r.roundedAmount, 105000000n);
  assert.equal(r.adjustment, 2000000n);
  assert.equal(r.adjustmentMagnitude, 2000000n);
  assert.equal(r.roundsUp, true);
  assert.equal(r.roundsDown, false);
  assert.equal(r.roundedShareBpsText, '10194.17');
  assert.equal(r.adjustmentShareBpsText, '194.17');
});

test('identity holds across roundings: stated amount plus adjustment is the rounded amount, exactly', () => {
  const cases = [
    DEFAULT,
    { amount: '102', increment: '5', decimals: 6 },
    { amount: '105', increment: '5', decimals: 6 },
    { amount: '2', increment: '5', decimals: 6 },
    { amount: '777', increment: '25', decimals: 0 },
    { amount: '9007199254740993', increment: '1000', decimals: 0 },
  ];
  for (const c of cases) {
    const r = modelCashRounding(c);
    assert.equal(r.amount + r.adjustment, r.roundedAmount);
    assert.equal(r.roundedAmount % r.increment, 0n);
  }
});

test('rounding is to the NEAREST multiple, never floored down: flooring 103 to the nearest 5 below states 100 and quietly keeps 3', () => {
  const r = modelCashRounding(DEFAULT);
  const flooredDown = r.amount - r.remainderBelow; // Computed test-side: the position flooring would state.
  assert.equal(flooredDown, 100000000n);
  assert.equal(r.roundedAmount, 105000000n);
  assert.equal(r.roundedAmount - flooredDown, r.increment);
});

test('below half rounds down: 102 to the nearest 5 states 100 paid and an adjustment of -2', () => {
  const r = modelCashRounding({ amount: '102', increment: '5', decimals: 6 });
  assert.equal(r.roundedAmount, 100000000n);
  assert.equal(r.adjustment, -2000000n);
  assert.equal(r.roundsDown, true);
  assert.equal(r.roundedShareBpsText, '9803.92');
  assert.equal(r.adjustmentShareBpsText, '196.07');
});

test('an amount already a multiple states no adjustment: 105 to the nearest 5 is payable as stated', () => {
  const r = modelCashRounding({ amount: '105', increment: '5', decimals: 6 });
  assert.equal(r.roundedAmount, 105000000n);
  assert.equal(r.adjustment, 0n);
  assert.equal(r.exact, true);
  assert.equal(r.roundedShareBpsText, '10000.00');
});

test('a tie rounds UP under the stated rule: 102.5 to the nearest 5 states 105, flagged as a tie', () => {
  const r = modelCashRounding({ amount: '102.5', increment: '5', decimals: 6 });
  assert.equal(r.tie, true);
  assert.equal(r.roundsUp, true);
  assert.equal(r.roundedAmount, 105000000n);
  assert.equal(r.adjustment, 2500000n);
  assert.equal(r.adjustmentShareBpsText, '243.90');
});

test('the adjustment never exceeds half the increment in magnitude, and equals it exactly at a tie', () => {
  const cases = [DEFAULT, { amount: '102', increment: '5', decimals: 6 }, { amount: '102.5', increment: '5', decimals: 6 }, { amount: '777', increment: '25', decimals: 0 }, { amount: '3', increment: '5', decimals: 0 }];
  for (const c of cases) {
    const r = modelCashRounding(c);
    assert.ok(r.adjustmentMagnitude * 2n <= r.increment);
  }
  const tie = modelCashRounding({ amount: '102.5', increment: '5', decimals: 6 });
  assert.equal(tie.adjustmentMagnitude * 2n, tie.increment);
});

test('an amount smaller than half the increment rounds to zero, stated as such: 2 to the nearest 5 pays nothing', () => {
  const r = modelCashRounding({ amount: '2', increment: '5', decimals: 6 });
  assert.equal(r.roundedAmount, 0n);
  assert.equal(r.roundsToZero, true);
  assert.equal(r.adjustment, -2000000n);
  assert.equal(r.roundedShareBpsText, '0.00');
});

test('an increment of one base unit rounds nothing: every amount is already a multiple', () => {
  const r = modelCashRounding({ amount: '1000', increment: '0.000001', decimals: 6 });
  assert.equal(r.increment, 1n);
  assert.equal(r.incrementIsOneBaseUnit, true);
  assert.equal(r.exact, true);
  assert.equal(r.adjustment, 0n);
});

test('a 777 amount at no decimals to the nearest 25: remainder 2 rounds down to 775, adjustment -2, shares 9974.25 and 25.74', () => {
  const r = modelCashRounding({ amount: '777', increment: '25', decimals: 0 });
  assert.equal(r.remainderBelow, 2n);
  assert.equal(r.distanceAbove, 23n);
  assert.equal(r.roundedAmount, 775n);
  assert.equal(r.adjustment, -2n);
  assert.equal(r.roundedShareBpsText, '9974.25');
  assert.equal(r.adjustmentShareBpsText, '25.74');
});

test('a 2^53+1 amount stays exact: 9007199254740993 to the nearest 1000 rounds up by exactly 7', () => {
  const r = modelCashRounding({ amount: '9007199254740993', increment: '1000', decimals: 0 });
  assert.equal(r.remainderBelow, 993n);
  assert.equal(r.roundedAmount, 9007199254741000n);
  assert.equal(r.adjustment, 7n);
  assert.equal(r.roundsUp, true);
});

test('an increment of zero is refused, and an amount of zero is refused', () => {
  assert.throws(() => modelCashRounding({ amount: '100', increment: '0', decimals: 6 }), /Rounding increment must be greater than zero/);
  assert.throws(() => modelCashRounding({ amount: '0', increment: '5', decimals: 6 }), /Amount must be greater than zero/);
});

test('who bears the adjustment is never priced: the amounts are the same under every bearer', () => {
  const r = modelCashRounding(DEFAULT);
  assert.equal(r.bearerPriced, false);
  assert.equal(r.applicabilityPriced, false);
});

test('shares are derived from the amounts and floored, never rounded: the preload paid share states 10194.17, not 10194.18', () => {
  const r = modelCashRounding(DEFAULT);
  assert.equal(r.roundedShareBpsText, '10194.17'); // 105/103 = 10194.1747... hundredths of a basis point, floored.
});

test('both candidate distances are stated: the preload sits 3 above the multiple below and 2 below the multiple above', () => {
  const r = modelCashRounding(DEFAULT);
  assert.equal(r.remainderBelow, 3000000n);
  assert.equal(r.distanceAbove, 2000000n);
  assert.equal(r.remainderBelow + r.distanceAbove, r.increment);
});

test('wiring: app.js imports the model, renders a cash rounding panel, and the README documents it', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(app, /modelCashRounding/);
  assert.match(app, /data-cashround/);
  assert.match(app, /cashround-output/);
  assert.match(app, /v1\.271/);
  assert.match(readme, /Cash rounding model/);
});
