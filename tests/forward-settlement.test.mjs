import test from 'node:test';
import assert from 'node:assert/strict';
import { modelForwardSettlement } from '../src/domain.js';

const DEFAULT = { quantity: '10', agreedPrice: '100', settlementPrice: '125', decimals: 6 };

test('preload: settling 10 units agreed at 100 at a settlement price of 125 pays the long 250 from the short', () => {
  const r = modelForwardSettlement(DEFAULT);
  assert.equal(r.quantity, 10);
  assert.equal(r.agreedPriceAmount, 100000000n);
  assert.equal(r.settlementPriceAmount, 125000000n);
  assert.equal(r.differencePerUnitAmount, 25000000n);
  assert.equal(r.longAmount, 250000000n);
  assert.equal(r.shortAmount, -250000000n);
  assert.equal(r.paymentAmount, 250000000n);
  assert.equal(r.agreedValueAmount, 1000000000n);
  assert.equal(r.settlementValueAmount, 1250000000n);
  assert.equal(r.movedShareBpsText, '2500.00');
  assert.equal(r.longReceives, true);
  assert.equal(r.shortReceives, false);
  assert.equal(r.settlesEven, false);
});

test('zero-sum identity: the long amount and the short amount sum to zero exactly, and settlement value minus agreed value is the long amount', () => {
  for (const [quantity, agreedPrice, settlementPrice, decimals] of [['10', '100', '125', 6], ['10', '100', '75', 6], ['10', '100', '100', 6], ['10', '100', '0', 6], ['3', '2.5', '2.75', 6], ['7', '999', '1', 0], ['1', '1', '2', 0]]) {
    const r = modelForwardSettlement({ quantity, agreedPrice, settlementPrice, decimals });
    assert.equal(r.longAmount + r.shortAmount, 0n);
    assert.equal(r.settlementValueAmount - r.agreedValueAmount, r.longAmount);
    assert.equal(r.paymentAmount, r.longAmount < 0n ? -r.longAmount : r.longAmount);
  }
});

test('the payment is measured on the difference between the two stated prices, never on the settlement price alone', () => {
  const r = modelForwardSettlement(DEFAULT);
  assert.equal(r.paymentMeasuredOnDifference, true);
  // The settlement price alone on 10 units would be 1,250 — as if the agreed price had never been promised.
  assert.equal(r.paymentAmount, 250000000n);
  assert.notEqual(r.paymentAmount, 1250000000n);
});

test('below the agreed price the long pays the short: settling at 75 on the preload quantity pays the short 250', () => {
  const r = modelForwardSettlement({ quantity: '10', agreedPrice: '100', settlementPrice: '75', decimals: 6 });
  assert.equal(r.differencePerUnitAmount, -25000000n);
  assert.equal(r.longAmount, -250000000n);
  assert.equal(r.shortAmount, 250000000n);
  assert.equal(r.paymentAmount, 250000000n);
  assert.equal(r.shortReceives, true);
  assert.equal(r.longReceives, false);
  assert.equal(r.movedShareBpsText, '2500.00');
});

test('a settlement price equal to the agreed price settles even: no payment changes hands', () => {
  const r = modelForwardSettlement({ quantity: '10', agreedPrice: '100', settlementPrice: '100', decimals: 6 });
  assert.equal(r.settlesEven, true);
  assert.equal(r.longAmount, 0n);
  assert.equal(r.shortAmount, 0n);
  assert.equal(r.paymentAmount, 0n);
  assert.equal(r.longReceives, false);
  assert.equal(r.shortReceives, false);
  assert.equal(r.movedShareBpsText, '0.00');
});

test('a settlement price of zero is stated, not refused: the long pays the short the whole agreed value', () => {
  const r = modelForwardSettlement({ quantity: '10', agreedPrice: '100', settlementPrice: '0', decimals: 6 });
  assert.equal(r.settlementPriceAmount, 0n);
  assert.equal(r.longAmount, -1000000000n);
  assert.equal(r.paymentAmount, 1000000000n);
  assert.equal(r.paymentAmount, r.agreedValueAmount);
  assert.equal(r.movedShareBpsText, '10000.00');
});

test('fractional prices state exactly in BigInt: 3 units agreed at 2.5 settling at 2.75 pay the long 0.75', () => {
  const r = modelForwardSettlement({ quantity: 3, agreedPrice: '2.5', settlementPrice: '2.75', decimals: 6 });
  assert.equal(r.differencePerUnitAmount, 250000n);
  assert.equal(r.longAmount, 750000n);
  assert.equal(r.shortAmount, -750000n);
  assert.equal(r.movedShareBpsText, '1000.00');
});

test('the move share is measured against the agreed price it moved from: settling at 1 against an agreed 999 is a 99.89% move, floored', () => {
  const r = modelForwardSettlement({ quantity: '7', agreedPrice: '999', settlementPrice: '1', decimals: 0 });
  assert.equal(r.differencePerUnitAmount, -998n);
  assert.equal(r.longAmount, -6986n);
  assert.equal(r.movedShareBpsText, '9989.98');
});

test('the quantity is a whole count of units: zero, fractional, and over-bound quantities are refused', () => {
  assert.throws(() => modelForwardSettlement({ quantity: '0', agreedPrice: '100', settlementPrice: '125', decimals: 6 }), /Quantity must be a whole number of units between 1 and 1,000,000/);
  assert.throws(() => modelForwardSettlement({ quantity: '2.5', agreedPrice: '100', settlementPrice: '125', decimals: 6 }), /Quantity must be a whole number of units between 1 and 1,000,000/);
  assert.throws(() => modelForwardSettlement({ quantity: '1000001', agreedPrice: '100', settlementPrice: '125', decimals: 6 }), /Quantity must be a whole number of units between 1 and 1,000,000/);
});

test('an agreed price of zero is refused: a forward promises a price, and a share of the move needs that base', () => {
  assert.throws(() => modelForwardSettlement({ quantity: '10', agreedPrice: '0', settlementPrice: '125', decimals: 6 }), /Agreed price must be greater than zero/);
});

test('the settlement is zero-sum stated: one side\u2019s receipt is the other side\u2019s payment, never new money', () => {
  const r = modelForwardSettlement(DEFAULT);
  assert.equal(r.settlementIsZeroSum, true);
});

test('the payment is not a fee: no service is charged for', () => {
  const r = modelForwardSettlement(DEFAULT);
  assert.equal(r.paymentIsFee, false);
});

test('no premium is priced: a forward states no upfront price for the agreement itself', () => {
  const r = modelForwardSettlement(DEFAULT);
  assert.equal(r.premiumPriced, false);
});

test('cash settlement only: physical delivery of the underlying is not modeled', () => {
  const r = modelForwardSettlement(DEFAULT);
  assert.equal(r.deliveryPriced, false);
});

test('what is not priced stays unpriced: margin, liquidation before settlement, default risk, fees, and settlement timing', () => {
  const r = modelForwardSettlement(DEFAULT);
  assert.equal(r.marginPriced, false);
  assert.equal(r.liquidationPriced, false);
  assert.equal(r.defaultRiskPriced, false);
  assert.equal(r.feesPriced, false);
  assert.equal(r.settlementTimingPriced, false);
});
