import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelCreditLine, modelCreditLineMovement } from '../src/domain.js';

// Credit line movement model (v1.203): the credit-line axis's
// second moment — one stated movement on a revolving line,
// composed from the credit line model unchanged. A draw
// consumes availability exactly, a repayment restores it
// exactly, neither movement may pass its bound (a draw beyond
// the available credit and a repayment beyond what is drawn
// are both refused, never capped silently), no interest, fee,
// or charge is priced into the movement, and the shares are
// derived from the amounts against the limit, floored.
const DEFAULT = { creditLimit: '50000', drawnAmount: '20000', movementKind: 'repay', movementAmount: '10000', decimals: 6 };

test('the preloaded repayment: repaying 10000 on the 20000 drawn against the 50000 line leaves 10000 drawn and restores availability to 40000 exactly', () => {
  const r = modelCreditLineMovement(DEFAULT);
  assert.equal(r.drawnBefore, 20000000000n);
  assert.equal(r.availableBefore, 30000000000n);
  assert.equal(r.movementAmount, 10000000000n);
  assert.equal(r.drawnAfter, 10000000000n);
  assert.equal(r.availableAfter, 40000000000n);
  assert.equal(r.isRepay, true);
  assert.equal(r.isDraw, false);
});

test('a draw consumes availability exactly: drawing 10000 on the preloaded line leaves 30000 drawn and 20000 available', () => {
  const r = modelCreditLineMovement({ ...DEFAULT, movementKind: 'draw' });
  assert.equal(r.drawnAfter, 30000000000n);
  assert.equal(r.availableAfter, 20000000000n);
  assert.equal(r.drawnAfter - r.drawnBefore, r.movementAmount);
  assert.equal(r.availableBefore - r.availableAfter, r.movementAmount);
});

test('identities hold across movements: drawn plus available is the limit before and after, and the position moves by exactly the movement amount', () => {
  const cases = [
    DEFAULT,
    { ...DEFAULT, movementKind: 'draw' },
    { creditLimit: '50000', drawnAmount: '20000', movementKind: 'draw', movementAmount: '30000', decimals: 6 },
    { creditLimit: '50000', drawnAmount: '20000', movementKind: 'repay', movementAmount: '20000', decimals: 6 },
    { creditLimit: '777', drawnAmount: '280', movementKind: 'repay', movementAmount: '100', decimals: 0 },
    { creditLimit: '9007199254740993', drawnAmount: '4503599627370496', movementKind: 'draw', movementAmount: '1', decimals: 0 },
    { creditLimit: '0.000005', drawnAmount: '0.000003', movementKind: 'repay', movementAmount: '0.000002', decimals: 6 },
  ];
  for (const c of cases) {
    const r = modelCreditLineMovement(c);
    assert.equal(r.drawnBefore + r.availableBefore, r.creditLimit);
    assert.equal(r.drawnAfter + r.availableAfter, r.creditLimit);
    const moved = r.isDraw ? r.drawnAfter - r.drawnBefore : r.drawnBefore - r.drawnAfter;
    assert.equal(moved, r.movementAmount);
  }
});

test('the position after the movement is the base model\u2019s own position at those amounts: the after amounts equal modelCreditLine stated on them exactly', () => {
  const r = modelCreditLineMovement(DEFAULT);
  const after = modelCreditLine({ creditLimit: '50000', drawnAmount: '10000', decimals: 6 });
  assert.equal(r.drawnAfter, after.drawnAmount);
  assert.equal(r.availableAfter, after.availableCredit);
  assert.equal(r.drawnAfterShareBpsText, after.drawnShareBpsText);
  assert.equal(r.availableAfterShareBpsText, after.availableShareBpsText);
});

test('no interest, fee, or charge is priced into the movement: the movement is principal only and moves the position by its amount and nothing more', () => {
  const r = modelCreditLineMovement(DEFAULT);
  assert.equal(r.interestPriced, false);
  assert.equal(r.drawnBefore - r.drawnAfter, r.movementAmount);
  assert.equal(r.availableAfter - r.availableBefore, r.movementAmount);
});

test('a draw that takes the last of the availability fills the line: drawn is the whole limit, availability is zero exactly, and the line is fully drawn after', () => {
  const r = modelCreditLineMovement({ creditLimit: '50000', drawnAmount: '20000', movementKind: 'draw', movementAmount: '30000', decimals: 6 });
  assert.equal(r.fillsLine, true);
  assert.equal(r.fullyDrawnAfter, true);
  assert.equal(r.drawnAfter, 50000000000n);
  assert.equal(r.availableAfter, 0n);
  assert.equal(r.drawnAfterShareBpsText, '10000.00');
  assert.equal(r.availableAfterShareBpsText, '0.00');
});

test('a repayment that repays the last of what is drawn clears the line: nothing is drawn after, the whole limit is available again, and the line is undrawn after — the line revolves back to the base position', () => {
  const r = modelCreditLineMovement({ creditLimit: '50000', drawnAmount: '20000', movementKind: 'repay', movementAmount: '20000', decimals: 6 });
  assert.equal(r.clearsLine, true);
  assert.equal(r.undrawnAfter, true);
  assert.equal(r.drawnAfter, 0n);
  assert.equal(r.availableAfter, r.creditLimit);
  assert.equal(r.drawnAfterShareBpsText, '0.00');
  assert.equal(r.availableAfterShareBpsText, '10000.00');
});

test('a part movement neither fills nor clears: the preloaded repayment leaves the line part drawn with availability part restored', () => {
  const r = modelCreditLineMovement(DEFAULT);
  assert.equal(r.fillsLine, false);
  assert.equal(r.clearsLine, false);
  assert.equal(r.fullyDrawnAfter, false);
  assert.equal(r.undrawnAfter, false);
});

test('shares are derived from the amounts against the limit: the preloaded repayment is a 2000.00 movement share, leaving a 2000.00 drawn share and an 8000.00 available share', () => {
  const r = modelCreditLineMovement(DEFAULT);
  assert.equal(r.movementShareBpsText, '2000.00');
  assert.equal(r.drawnAfterShareBpsText, '2000.00');
  assert.equal(r.availableAfterShareBpsText, '8000.00');
});

test('shares on the no-decimals 777 line: repaying 100 of the 280 drawn leaves 180 drawn and 597 available, with a 1287.00 movement share, a 2316.60 drawn share and a 7683.39 available share', () => {
  const r = modelCreditLineMovement({ creditLimit: '777', drawnAmount: '280', movementKind: 'repay', movementAmount: '100', decimals: 0 });
  assert.equal(r.drawnAfter, 180n);
  assert.equal(r.availableAfter, 597n);
  assert.equal(r.movementShareBpsText, '1287.00');
  assert.equal(r.drawnAfterShareBpsText, '2316.60');
  assert.equal(r.availableAfterShareBpsText, '7683.39');
});

test('the movement share is floored, never rounded up: a movement of 1 against a limit of 3 states 3333.33, and the drawn share after drawing it states 6666.66, not the 6666.67 rounding would state', () => {
  const r = modelCreditLineMovement({ creditLimit: '3', drawnAmount: '1', movementKind: 'draw', movementAmount: '1', decimals: 0 });
  assert.equal(r.movementShareBpsText, '3333.33');
  assert.equal(r.drawnAfterShareBpsText, '6666.66');
  assert.equal(r.availableAfterShareBpsText, '3333.33');
});

test('amounts beyond float precision stay exact: drawing a single base unit against a 2^53+1 limit with 4503599627370496 drawn leaves 4503599627370497 drawn and 4503599627370496 available', () => {
  const r = modelCreditLineMovement({ creditLimit: '9007199254740993', drawnAmount: '4503599627370496', movementKind: 'draw', movementAmount: '1', decimals: 0 });
  assert.equal(r.drawnAfter, 4503599627370497n);
  assert.equal(r.availableAfter, 4503599627370496n);
  assert.equal(r.movementShareBpsText, '0.00');
});

test('single base units move exactly: repaying 2 units of the 3 drawn against a 5-unit limit leaves 1 drawn and 4 available', () => {
  const r = modelCreditLineMovement({ creditLimit: '0.000005', drawnAmount: '0.000003', movementKind: 'repay', movementAmount: '0.000002', decimals: 6 });
  assert.equal(r.drawnAfter, 1n);
  assert.equal(r.availableAfter, 4n);
  assert.equal(r.movementShareBpsText, '4000.00');
});

test('a draw beyond the available credit is refused, never capped silently at what is available', () => {
  assert.throws(() => modelCreditLineMovement({ creditLimit: '50000', drawnAmount: '20000', movementKind: 'draw', movementAmount: '30001', decimals: 6 }), /Draw amount must not exceed the available credit/);
  assert.throws(() => modelCreditLineMovement({ creditLimit: '50000', drawnAmount: '50000', movementKind: 'draw', movementAmount: '1', decimals: 6 }), /Draw amount must not exceed the available credit/);
});

test('a repayment beyond what is drawn is refused, never capped silently at the drawn amount — the drawn amount never goes below zero and availability never above the limit', () => {
  assert.throws(() => modelCreditLineMovement({ creditLimit: '50000', drawnAmount: '20000', movementKind: 'repay', movementAmount: '20001', decimals: 6 }), /Repayment amount must not exceed the drawn amount/);
  assert.throws(() => modelCreditLineMovement({ creditLimit: '50000', drawnAmount: '0', movementKind: 'repay', movementAmount: '1', decimals: 6 }), /Repayment amount must not exceed the drawn amount/);
});

test('a movement of nothing is refused, an unknown movement kind is refused, and the base refusals are inherited: a zero limit and a drawn amount beyond the limit', () => {
  assert.throws(() => modelCreditLineMovement({ ...DEFAULT, movementAmount: '0' }), /Movement amount must be greater than zero/);
  assert.throws(() => modelCreditLineMovement({ ...DEFAULT, movementKind: 'move' }), /Movement kind must be draw or repay/);
  assert.throws(() => modelCreditLineMovement({ creditLimit: '0', drawnAmount: '0', movementKind: 'draw', movementAmount: '1', decimals: 6 }), /Credit limit must be greater than zero/);
  assert.throws(() => modelCreditLineMovement({ creditLimit: '50000', drawnAmount: '50001', movementKind: 'repay', movementAmount: '1', decimals: 6 }), /Drawn amount must not exceed the credit limit/);
});

test('a negative movement amount is refused at parsing, before the model ever sees it', () => {
  assert.throws(() => modelCreditLineMovement({ ...DEFAULT, movementAmount: '-1' }), /Enter a positive decimal amount/);
});
