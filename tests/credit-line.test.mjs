import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelCreditLine } from '../src/domain.js';

// Credit line model (v1.230): a NEW axis — a revolving line
// stated by its limit and what is drawn against it right
// now. Availability is the limit minus the drawn amount
// exactly, no interest, fee, or charge is priced (the drawn
// amount is principal only), a drawn amount beyond the
// limit is refused rather than capped silently, and the
// shares are derived from the amounts against the limit,
// floored.
const DEFAULT = { creditLimit: '50000', drawnAmount: '20000', decimals: 6 };

test('the preloaded position: 20000 drawn against a 50000 limit leaves 30000 available, a 4000.00 drawn share and a 6000.00 available share', () => {
  const r = modelCreditLine(DEFAULT);
  assert.equal(r.drawnAmount, 20000000000n);
  assert.equal(r.availableCredit, 30000000000n);
  assert.equal(r.drawnShareBpsText, '4000.00');
  assert.equal(r.availableShareBpsText, '6000.00');
});

test('the default position is nothing drawn when none is stated: the whole limit is available and the line is undrawn', () => {
  const r = modelCreditLine({ creditLimit: '50000', decimals: 6 });
  assert.equal(r.drawnAmount, 0n);
  assert.equal(r.availableCredit, 50000000000n);
  assert.equal(r.undrawn, true);
});

test('identities hold across lines: what is drawn plus what is available is the limit, exactly', () => {
  const cases = [
    DEFAULT,
    { creditLimit: '50000', drawnAmount: '50000', decimals: 6 },
    { creditLimit: '50000', drawnAmount: '0', decimals: 6 },
    { creditLimit: '777', drawnAmount: '280', decimals: 0 },
    { creditLimit: '9007199254740993', drawnAmount: '4503599627370496', decimals: 0 },
    { creditLimit: '0.000005', drawnAmount: '0.000003', decimals: 6 },
  ];
  for (const c of cases) {
    const r = modelCreditLine(c);
    assert.equal(r.drawnAmount + r.availableCredit, r.creditLimit);
  }
});

test('availability is the limit minus what is drawn, never the limit restated: on the preload the borrower can still draw 30000, not the whole 50000 again', () => {
  const r = modelCreditLine(DEFAULT);
  assert.equal(r.availableCredit, r.creditLimit - r.drawnAmount);
  assert.notEqual(r.availableCredit, r.creditLimit);
});

test('no interest, fee, or charge is priced: the drawn amount is principal only, and drawn plus available is the limit and nothing more', () => {
  const r = modelCreditLine(DEFAULT);
  assert.equal(r.interestPriced, false);
  assert.equal(r.drawnAmount, 20000000000n);
  assert.equal(r.drawnAmount + r.availableCredit, r.creditLimit);
});

test('repayment is not priced either: the model states the position repayment acts on, never a schedule, a minimum, or a default outcome', () => {
  const r = modelCreditLine(DEFAULT);
  assert.equal(r.repaymentPriced, false);
});

test('a line drawn to its limit is fully drawn: availability is zero exactly and the drawn share is the whole 10000.00', () => {
  const r = modelCreditLine({ creditLimit: '50000', drawnAmount: '50000', decimals: 6 });
  assert.equal(r.fullyDrawn, true);
  assert.equal(r.availableCredit, 0n);
  assert.equal(r.drawnShareBpsText, '10000.00');
  assert.equal(r.availableShareBpsText, '0.00');
});

test('a fully drawn line is exhausted capacity, not a missing line: the limit and the drawn amount both stand at the full amount', () => {
  const r = modelCreditLine({ creditLimit: '50000', drawnAmount: '50000', decimals: 6 });
  assert.equal(r.creditLimit, 50000000000n);
  assert.equal(r.drawnAmount, r.creditLimit);
  assert.equal(r.undrawn, false);
});

test('an undrawn line is a position, not an absence of one: nothing is drawn, the whole limit is available, and the drawn share is 0.00', () => {
  const r = modelCreditLine({ creditLimit: '50000', drawnAmount: '0', decimals: 6 });
  assert.equal(r.undrawn, true);
  assert.equal(r.fullyDrawn, false);
  assert.equal(r.availableCredit, r.creditLimit);
  assert.equal(r.drawnShareBpsText, '0.00');
  assert.equal(r.availableShareBpsText, '10000.00');
});

test('shares are derived from the amounts against the limit: on the no-decimals 777 line with 280 drawn, 497 remains, with shares 3603.60 and 6396.39', () => {
  const r = modelCreditLine({ creditLimit: '777', drawnAmount: '280', decimals: 0 });
  assert.equal(r.availableCredit, 497n);
  assert.equal(r.drawnShareBpsText, '3603.60');
  assert.equal(r.availableShareBpsText, '6396.39');
});

test('the drawn share is floored, never rounded up: 2 drawn against a limit of 3 states 6666.66, not the 6666.67 rounding would state — rounding up would overstate what is used and understate what remains', () => {
  const r = modelCreditLine({ creditLimit: '3', drawnAmount: '2', decimals: 0 });
  assert.equal(r.drawnShareBpsText, '6666.66');
  assert.equal(r.availableShareBpsText, '3333.33');
});

test('amounts beyond float precision stay exact: a 2^53+1 limit with 4503599627370496 drawn leaves 4503599627370497 available, with shares 4999.99 and 5000.00', () => {
  const r = modelCreditLine({ creditLimit: '9007199254740993', drawnAmount: '4503599627370496', decimals: 0 });
  assert.equal(r.availableCredit, 4503599627370497n);
  assert.equal(r.drawnShareBpsText, '4999.99');
  assert.equal(r.availableShareBpsText, '5000.00');
});

test('a single base unit drawn is stated exactly: 1 drawn against a limit of 1000 leaves 999, a drawn share of 10.00 and an available share of 9990.00', () => {
  const r = modelCreditLine({ creditLimit: '1000', drawnAmount: '1', decimals: 0 });
  assert.equal(r.availableCredit, 999n);
  assert.equal(r.drawnShareBpsText, '10.00');
  assert.equal(r.availableShareBpsText, '9990.00');
});

test('a line of single base units: 3 units drawn against a 5-unit limit leaves 2, with shares 6000.00 and 4000.00', () => {
  const r = modelCreditLine({ creditLimit: '0.000005', drawnAmount: '0.000003', decimals: 6 });
  assert.equal(r.drawnAmount, 3n);
  assert.equal(r.availableCredit, 2n);
  assert.equal(r.drawnShareBpsText, '6000.00');
  assert.equal(r.availableShareBpsText, '4000.00');
});

test('a drawn amount beyond the limit is refused, never capped silently at the limit', () => {
  assert.throws(() => modelCreditLine({ creditLimit: '50000', drawnAmount: '50001', decimals: 6 }), /Drawn amount must not exceed the credit limit/);
  assert.throws(() => modelCreditLine({ creditLimit: '777', drawnAmount: '778', decimals: 0 }), /Drawn amount must not exceed the credit limit/);
});

test('a zero limit is refused: a line that may never be drawn against is not a line', () => {
  assert.throws(() => modelCreditLine({ creditLimit: '0', drawnAmount: '0', decimals: 6 }), /Credit limit must be greater than zero/);
  assert.throws(() => modelCreditLine({ decimals: 6 }), /Credit limit must be greater than zero/);
});

test('a negative drawn amount is refused at parsing, before the model ever sees it', () => {
  assert.throws(() => modelCreditLine({ creditLimit: '50000', drawnAmount: '-1', decimals: 6 }), /Enter a positive decimal amount/);
});
