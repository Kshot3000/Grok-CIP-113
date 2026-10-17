import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCallOptionSettlement } from '../src/domain.js';

const DEFAULT = { quantity: '10', strikePrice: '100', settlementPrice: '125', premiumPerUnit: '5', decimals: 6 };

test('preload: a call on 10 units with strike 100 settling at 125 with a 5 premium pays the holder 250, for a 200 holder net', () => {
  const r = modelCallOptionSettlement(DEFAULT);
  assert.equal(r.quantity, 10);
  assert.equal(r.strikePriceAmount, 100000000n);
  assert.equal(r.settlementPriceAmount, 125000000n);
  assert.equal(r.premiumPerUnitAmount, 5000000n);
  assert.equal(r.intrinsicPerUnitAmount, 25000000n);
  assert.equal(r.payoffAmount, 250000000n);
  assert.equal(r.premiumTotalAmount, 50000000n);
  assert.equal(r.holderNetAmount, 200000000n);
  assert.equal(r.writerNetAmount, -200000000n);
  assert.equal(r.breakEvenPriceAmount, 105000000n);
  assert.equal(r.strikeValueAmount, 1000000000n);
  assert.equal(r.settlementValueAmount, 1250000000n);
  assert.equal(r.exercised, true);
  assert.equal(r.expiresWorthless, false);
});

test('zero-sum net identity: counting the premium, the holder net and the writer net sum to zero exactly', () => {
  for (const [quantity, strikePrice, settlementPrice, premiumPerUnit, decimals] of [['10', '100', '125', '5', 6], ['10', '100', '75', '5', 6], ['10', '100', '100', '5', 6], ['10', '100', '105', '5', 6], ['3', '2.5', '2.75', '0.1', 6], ['10', '100', '125', '0', 6]]) {
    const r = modelCallOptionSettlement({ quantity, strikePrice, settlementPrice, premiumPerUnit, decimals });
    assert.equal(r.holderNetAmount + r.writerNetAmount, 0n);
    assert.equal(r.payoffAmount - r.premiumTotalAmount, r.holderNetAmount);
    assert.equal(r.premiumTotalAmount, r.premiumPerUnitAmount * BigInt(r.quantity));
  }
});

test('the payoff is measured on the part above the strike, never on the settlement price alone', () => {
  const r = modelCallOptionSettlement(DEFAULT);
  assert.equal(r.payoffMeasuredAboveStrike, true);
  // The settlement price alone on 10 units would be 1,250 — as if the strike had never been promised.
  assert.equal(r.payoffAmount, 250000000n);
  assert.notEqual(r.payoffAmount, 1250000000n);
});

test('below the strike the option expires worthless: no payoff, and the holder loses the premium alone', () => {
  const r = modelCallOptionSettlement({ quantity: '10', strikePrice: '100', settlementPrice: '75', premiumPerUnit: '5', decimals: 6 });
  assert.equal(r.intrinsicPerUnitAmount, 0n);
  assert.equal(r.payoffAmount, 0n);
  assert.equal(r.exercised, false);
  assert.equal(r.expiresWorthless, true);
  assert.equal(r.holderNetAmount, -50000000n);
  assert.equal(r.holderNetAmount, -r.premiumTotalAmount);
  assert.equal(r.writerNetAmount, 50000000n);
});

test('at the strike the option also expires worthless: there is nothing above the strike to exercise for', () => {
  const r = modelCallOptionSettlement({ quantity: '10', strikePrice: '100', settlementPrice: '100', premiumPerUnit: '5', decimals: 6 });
  assert.equal(r.intrinsicPerUnitAmount, 0n);
  assert.equal(r.payoffAmount, 0n);
  assert.equal(r.expiresWorthless, true);
  assert.equal(r.holderNetAmount, -50000000n);
});

test('the holder loss is floored at the premium: no settlement price states a holder net below the negative of the premium', () => {
  for (const settlementPrice of ['0', '1', '50', '99', '100']) {
    const r = modelCallOptionSettlement({ quantity: '10', strikePrice: '100', settlementPrice, premiumPerUnit: '5', decimals: 6 });
    assert.equal(r.holderLossFlooredAtPremium, true);
    assert.equal(r.holderNetAmount, -50000000n);
    assert.ok(r.holderNetAmount >= -r.premiumTotalAmount);
  }
});

test('a settlement price of zero is stated, not refused: the option expires and the holder loses the premium alone', () => {
  const r = modelCallOptionSettlement({ quantity: '10', strikePrice: '100', settlementPrice: '0', premiumPerUnit: '5', decimals: 6 });
  assert.equal(r.settlementPriceAmount, 0n);
  assert.equal(r.payoffAmount, 0n);
  assert.equal(r.holderNetAmount, -r.premiumTotalAmount);
});

test('settling at the break-even price states a zero holder net: the payoff exactly covers the premium', () => {
  const r = modelCallOptionSettlement({ quantity: '10', strikePrice: '100', settlementPrice: '105', premiumPerUnit: '5', decimals: 6 });
  assert.equal(r.settlementPriceAmount, r.breakEvenPriceAmount);
  assert.equal(r.payoffAmount, 50000000n);
  assert.equal(r.payoffAmount, r.premiumTotalAmount);
  assert.equal(r.holderNetAmount, 0n);
  assert.equal(r.writerNetAmount, 0n);
  assert.equal(r.exercised, true);
});

test('the break-even price is the strike plus the premium per unit, on every stated case', () => {
  for (const [quantity, strikePrice, settlementPrice, premiumPerUnit, decimals] of [['10', '100', '125', '5', 6], ['3', '2.5', '2.75', '0.1', 6], ['7', '999', '1000', '1', 0]]) {
    const r = modelCallOptionSettlement({ quantity, strikePrice, settlementPrice, premiumPerUnit, decimals });
    assert.equal(r.breakEvenPriceAmount, r.strikePriceAmount + r.premiumPerUnitAmount);
  }
  const b = modelCallOptionSettlement({ quantity: '3', strikePrice: '2.5', settlementPrice: '2.6', premiumPerUnit: '0.1', decimals: 6 });
  assert.equal(b.holderNetAmount, 0n);
});

test('fractional prices state exactly in BigInt: 3 units, strike 2.5, settling at 2.75 with a 0.1 premium nets the holder 0.45', () => {
  const r = modelCallOptionSettlement({ quantity: 3, strikePrice: '2.5', settlementPrice: '2.75', premiumPerUnit: '0.1', decimals: 6 });
  assert.equal(r.intrinsicPerUnitAmount, 250000n);
  assert.equal(r.payoffAmount, 750000n);
  assert.equal(r.premiumTotalAmount, 300000n);
  assert.equal(r.holderNetAmount, 450000n);
  assert.equal(r.breakEvenPriceAmount, 2600000n);
});

test('a premium of zero is stated, not refused: the payoff stands whole as the holder net and the strike is the break-even', () => {
  const r = modelCallOptionSettlement({ quantity: '10', strikePrice: '100', settlementPrice: '125', premiumPerUnit: '0', decimals: 6 });
  assert.equal(r.premiumTotalAmount, 0n);
  assert.equal(r.holderNetAmount, 250000000n);
  assert.equal(r.holderNetAmount, r.payoffAmount);
  assert.equal(r.breakEvenPriceAmount, r.strikePriceAmount);
});

test('the quantity is a whole count of units: zero, fractional, and over-bound quantities are refused', () => {
  assert.throws(() => modelCallOptionSettlement({ quantity: '0', strikePrice: '100', settlementPrice: '125', premiumPerUnit: '5', decimals: 6 }), /Quantity must be a whole number of units between 1 and 1,000,000/);
  assert.throws(() => modelCallOptionSettlement({ quantity: '2.5', strikePrice: '100', settlementPrice: '125', premiumPerUnit: '5', decimals: 6 }), /Quantity must be a whole number of units between 1 and 1,000,000/);
  assert.throws(() => modelCallOptionSettlement({ quantity: '1000001', strikePrice: '100', settlementPrice: '125', premiumPerUnit: '5', decimals: 6 }), /Quantity must be a whole number of units between 1 and 1,000,000/);
});

test('a strike price of zero is refused: an option promises a strike, and the payoff needs that base', () => {
  assert.throws(() => modelCallOptionSettlement({ quantity: '10', strikePrice: '0', settlementPrice: '125', premiumPerUnit: '5', decimals: 6 }), /Strike price must be greater than zero/);
});

test('the payoff is not a fee and the premium is not a fee, and the premium is stated, never derived', () => {
  const r = modelCallOptionSettlement(DEFAULT);
  assert.equal(r.payoffIsFee, false);
  assert.equal(r.premiumIsFee, false);
  assert.equal(r.premiumDerived, false);
});

test('what is not priced stays unpriced: delivery, early exercise, volatility, time value, margin, default risk, and fees', () => {
  const r = modelCallOptionSettlement(DEFAULT);
  assert.equal(r.deliveryPriced, false);
  assert.equal(r.earlyExercisePriced, false);
  assert.equal(r.volatilityPriced, false);
  assert.equal(r.timeValuePriced, false);
  assert.equal(r.marginPriced, false);
  assert.equal(r.defaultRiskPriced, false);
  assert.equal(r.feesPriced, false);
});
