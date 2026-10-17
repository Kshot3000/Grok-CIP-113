import test from 'node:test';
import assert from 'node:assert/strict';
import { modelForwardCloseout, modelForwardSettlement } from '../src/domain.js';

const DEFAULT = { quantity: '10', agreedPrice: '100', closeOutPrice: '110', decimals: 6 };

test('preload: closing out 10 units agreed at 100 at a close-out price of 110 pays the long 100 from the short', () => {
  const r = modelForwardCloseout(DEFAULT);
  assert.equal(r.quantity, 10);
  assert.equal(r.agreedPriceAmount, 100000000n);
  assert.equal(r.closeOutPriceAmount, 110000000n);
  assert.equal(r.differencePerUnitAmount, 10000000n);
  assert.equal(r.longAmount, 100000000n);
  assert.equal(r.shortAmount, -100000000n);
  assert.equal(r.paymentAmount, 100000000n);
  assert.equal(r.agreedValueAmount, 1000000000n);
  assert.equal(r.closeOutValueAmount, 1100000000n);
  assert.equal(r.movedShareBpsText, '1000.00');
  assert.equal(r.longReceives, true);
  assert.equal(r.shortReceives, false);
  assert.equal(r.closesEven, false);
});

test('composition: the close-out states exactly what the settlement model states for the close-out price in the settlement price\u2019s place', () => {
  for (const [quantity, agreedPrice, closeOutPrice, decimals] of [['10', '100', '110', 6], ['10', '100', '75', 6], ['10', '100', '100', 6], ['10', '100', '0', 6], ['3', '2.5', '2.75', 6], ['7', '999', '1', 0], ['1', '1', '2', 0]]) {
    const r = modelForwardCloseout({ quantity, agreedPrice, closeOutPrice, decimals });
    const b = modelForwardSettlement({ quantity, agreedPrice, settlementPrice: closeOutPrice, decimals });
    assert.equal(r.longAmount, b.longAmount);
    assert.equal(r.shortAmount, b.shortAmount);
    assert.equal(r.paymentAmount, b.paymentAmount);
    assert.equal(r.differencePerUnitAmount, b.differencePerUnitAmount);
    assert.equal(r.closeOutPriceAmount, b.settlementPriceAmount);
    assert.equal(r.closeOutValueAmount, b.settlementValueAmount);
    assert.equal(r.movedShareBpsText, b.movedShareBpsText);
  }
});

test('zero-sum identity: the long amount and the short amount sum to zero exactly', () => {
  for (const [quantity, agreedPrice, closeOutPrice, decimals] of [['10', '100', '110', 6], ['10', '100', '75', 6], ['10', '100', '100', 6], ['3', '2.5', '2.75', 6]]) {
    const r = modelForwardCloseout({ quantity, agreedPrice, closeOutPrice, decimals });
    assert.equal(r.longAmount + r.shortAmount, 0n);
    assert.equal(r.closeOutValueAmount - r.agreedValueAmount, r.longAmount);
    assert.equal(r.paymentAmount, r.longAmount < 0n ? -r.longAmount : r.longAmount);
  }
});

test('the payment is measured on the difference between the two stated prices, never on the close-out price alone', () => {
  const r = modelForwardCloseout(DEFAULT);
  assert.equal(r.paymentMeasuredOnDifference, true);
  // The close-out price alone on 10 units would be 1,100 — as if the agreed price had never been promised.
  assert.equal(r.paymentAmount, 100000000n);
  assert.notEqual(r.paymentAmount, 1100000000n);
});

test('below the agreed price the long pays the short: closing out at 75 on the preload quantity pays the short 250', () => {
  const r = modelForwardCloseout({ quantity: '10', agreedPrice: '100', closeOutPrice: '75', decimals: 6 });
  assert.equal(r.differencePerUnitAmount, -25000000n);
  assert.equal(r.longAmount, -250000000n);
  assert.equal(r.shortAmount, 250000000n);
  assert.equal(r.paymentAmount, 250000000n);
  assert.equal(r.shortReceives, true);
  assert.equal(r.longReceives, false);
  assert.equal(r.movedShareBpsText, '2500.00');
});

test('a close-out price equal to the agreed price closes even: no payment changes hands, and the contract still ends', () => {
  const r = modelForwardCloseout({ quantity: '10', agreedPrice: '100', closeOutPrice: '100', decimals: 6 });
  assert.equal(r.closesEven, true);
  assert.equal(r.longAmount, 0n);
  assert.equal(r.shortAmount, 0n);
  assert.equal(r.paymentAmount, 0n);
  assert.equal(r.longReceives, false);
  assert.equal(r.shortReceives, false);
  assert.equal(r.movedShareBpsText, '0.00');
  assert.equal(r.contractExtinguished, true);
  assert.equal(r.settlementStillDue, false);
});

test('the close-out extinguishes the contract: no settlement remains due afterwards, at any price', () => {
  const r = modelForwardCloseout(DEFAULT);
  assert.equal(r.contractExtinguished, true);
  assert.equal(r.settlementStillDue, false);
  assert.equal(r.remainingSettlementAmount, 0n);
});

test('a close-out price of zero is stated, not refused: the long pays the short the whole agreed value to end the contract', () => {
  const r = modelForwardCloseout({ quantity: '10', agreedPrice: '100', closeOutPrice: '0', decimals: 6 });
  assert.equal(r.closeOutPriceAmount, 0n);
  assert.equal(r.longAmount, -1000000000n);
  assert.equal(r.paymentAmount, 1000000000n);
  assert.equal(r.paymentAmount, r.agreedValueAmount);
  assert.equal(r.movedShareBpsText, '10000.00');
});

test('fractional prices state exactly in BigInt: 3 units agreed at 2.5 closed out at 2.75 pay the long 0.75', () => {
  const r = modelForwardCloseout({ quantity: 3, agreedPrice: '2.5', closeOutPrice: '2.75', decimals: 6 });
  assert.equal(r.differencePerUnitAmount, 250000n);
  assert.equal(r.longAmount, 750000n);
  assert.equal(r.shortAmount, -750000n);
  assert.equal(r.movedShareBpsText, '1000.00');
});

test('the move share is measured against the agreed price it moved from: closing out at 1 against an agreed 999 is a 99.89% move, floored', () => {
  const r = modelForwardCloseout({ quantity: '7', agreedPrice: '999', closeOutPrice: '1', decimals: 0 });
  assert.equal(r.differencePerUnitAmount, -998n);
  assert.equal(r.longAmount, -6986n);
  assert.equal(r.movedShareBpsText, '9989.98');
});

test('the quantity is a whole count of units: zero, fractional, and over-bound quantities are refused', () => {
  assert.throws(() => modelForwardCloseout({ quantity: '0', agreedPrice: '100', closeOutPrice: '110', decimals: 6 }), /Quantity must be a whole number of units between 1 and 1,000,000/);
  assert.throws(() => modelForwardCloseout({ quantity: '2.5', agreedPrice: '100', closeOutPrice: '110', decimals: 6 }), /Quantity must be a whole number of units between 1 and 1,000,000/);
  assert.throws(() => modelForwardCloseout({ quantity: '1000001', agreedPrice: '100', closeOutPrice: '110', decimals: 6 }), /Quantity must be a whole number of units between 1 and 1,000,000/);
});

test('an agreed price of zero is refused: a forward promises a price, and a share of the move needs that base', () => {
  assert.throws(() => modelForwardCloseout({ quantity: '10', agreedPrice: '0', closeOutPrice: '110', decimals: 6 }), /Agreed price must be greater than zero/);
});

test('the close-out is zero-sum stated: one side\u2019s receipt is the other side\u2019s payment, never new money', () => {
  const r = modelForwardCloseout(DEFAULT);
  assert.equal(r.closeoutIsZeroSum, true);
});

test('the payment is not a fee and no premium is priced: ending a forward early states no price for the agreement itself', () => {
  const r = modelForwardCloseout(DEFAULT);
  assert.equal(r.paymentIsFee, false);
  assert.equal(r.premiumPriced, false);
});

test('what is not priced stays unpriced: the later price, delivery, margin, default risk, fees, and close-out consent', () => {
  const r = modelForwardCloseout(DEFAULT);
  assert.equal(r.laterPricePriced, false);
  assert.equal(r.deliveryPriced, false);
  assert.equal(r.marginPriced, false);
  assert.equal(r.defaultRiskPriced, false);
  assert.equal(r.feesPriced, false);
  assert.equal(r.closeoutConsentPriced, false);
});
