import test from 'node:test';
import assert from 'node:assert/strict';
import { modelOptionSaleBeforeExpiry } from '../src/domain.js';

const DEFAULT = { quantity: '10', premiumPerUnit: '5', salePricePerUnit: '8', decimals: 6 };

test('preload: an option on 10 units whose holder paid a 5 premium per unit, sold before expiry at 8 per unit, returns 80 for a 30 seller net', () => {
  const r = modelOptionSaleBeforeExpiry(DEFAULT);
  assert.equal(r.quantity, 10);
  assert.equal(r.premiumPerUnitAmount, 5000000n);
  assert.equal(r.salePricePerUnitAmount, 8000000n);
  assert.equal(r.premiumTotalAmount, 50000000n);
  assert.equal(r.saleProceedsAmount, 80000000n);
  assert.equal(r.sellerNetAmount, 30000000n);
  assert.equal(r.buyerCostAmount, 80000000n);
  assert.equal(r.breakEvenSalePricePerUnitAmount, 5000000n);
  assert.equal(r.maximumSellerLossAmount, 50000000n);
  assert.equal(r.expiryPayoffForSellerAmount, 0n);
  assert.equal(r.saleCoversPremium, true);
  assert.equal(r.soldAtBreakEven, false);
});

test('the proceeds identity: the seller net plus the premium paid is the proceeds, and the proceeds are the sale price on the quantity stated', () => {
  for (const [quantity, premiumPerUnit, salePricePerUnit, decimals] of [['10', '5', '8', 6], ['10', '5', '3', 6], ['10', '5', '0', 6], ['3', '0.1', '0.25', 6], ['10', '0', '8', 6], ['7', '1', '999', 0]]) {
    const r = modelOptionSaleBeforeExpiry({ quantity, premiumPerUnit, salePricePerUnit, decimals });
    assert.equal(r.sellerNetAmount + r.premiumTotalAmount, r.saleProceedsAmount);
    assert.equal(r.saleProceedsAmount, r.salePricePerUnitAmount * BigInt(r.quantity));
    assert.equal(r.premiumTotalAmount, r.premiumPerUnitAmount * BigInt(r.quantity));
    assert.equal(r.buyerCostAmount, r.saleProceedsAmount);
  }
});

test('the proceeds are measured on the stated sale price for the right itself: no strike and no settlement price enter the model', () => {
  const r = modelOptionSaleBeforeExpiry(DEFAULT);
  assert.equal(r.proceedsMeasuredOnStatedSalePrice, true);
  assert.equal(r.proceedsIsPayoff, false);
  assert.equal(r.expiryPricePriced, false);
  // The same right sold at the premium price returns only the premium — the proceeds track the stated sale price alone.
  assert.equal(modelOptionSaleBeforeExpiry({ quantity: '10', premiumPerUnit: '5', salePricePerUnit: '5', decimals: 6 }).saleProceedsAmount, 50000000n);
});

test('the sale closes the seller position: no payoff remains for the seller at any expiry price', () => {
  const r = modelOptionSaleBeforeExpiry(DEFAULT);
  assert.equal(r.sellerPositionClosed, true);
  assert.equal(r.sellerStillEntitledToPayoff, false);
  assert.equal(r.expiryPayoffForSellerAmount, 0n);
  assert.equal(r.laterExpiryPriceAffectsSeller, false);
});

test('selling at the break-even sale price states a zero seller net: the proceeds exactly return the premium', () => {
  const r = modelOptionSaleBeforeExpiry({ quantity: '10', premiumPerUnit: '5', salePricePerUnit: '5', decimals: 6 });
  assert.equal(r.salePricePerUnitAmount, r.breakEvenSalePricePerUnitAmount);
  assert.equal(r.soldAtBreakEven, true);
  assert.equal(r.saleProceedsAmount, r.premiumTotalAmount);
  assert.equal(r.sellerNetAmount, 0n);
});

test('the break-even sale price per unit is the premium per unit itself, on every stated case', () => {
  for (const [quantity, premiumPerUnit, salePricePerUnit, decimals] of [['10', '5', '8', 6], ['3', '0.1', '0.25', 6], ['7', '999', '998', 0]]) {
    const r = modelOptionSaleBeforeExpiry({ quantity, premiumPerUnit, salePricePerUnit, decimals });
    assert.equal(r.breakEvenSalePricePerUnitAmount, r.premiumPerUnitAmount);
  }
  const b = modelOptionSaleBeforeExpiry({ quantity: '3', premiumPerUnit: '0.1', salePricePerUnit: '0.1', decimals: 6 });
  assert.equal(b.sellerNetAmount, 0n);
});

test('selling below the premium states a partial loss: at 3 per unit the seller recovers 30 of the 50 premium and loses 20', () => {
  const r = modelOptionSaleBeforeExpiry({ quantity: '10', premiumPerUnit: '5', salePricePerUnit: '3', decimals: 6 });
  assert.equal(r.saleProceedsAmount, 30000000n);
  assert.equal(r.sellerNetAmount, -20000000n);
  assert.equal(r.saleCoversPremium, false);
  assert.equal(r.sellerPositionClosed, true);
});

test('a sale price of zero is stated, not refused: the right is given away, the position still closes, and the loss is the whole premium', () => {
  const r = modelOptionSaleBeforeExpiry({ quantity: '10', premiumPerUnit: '5', salePricePerUnit: '0', decimals: 6 });
  assert.equal(r.saleProceedsAmount, 0n);
  assert.equal(r.sellerNetAmount, -50000000n);
  assert.equal(r.sellerNetAmount, -r.premiumTotalAmount);
  assert.equal(r.sellerPositionClosed, true);
  assert.equal(r.saleCoversPremium, false);
});

test('the seller loss is floored at the premium: no sale price states a seller net below the negative of the premium', () => {
  for (const salePricePerUnit of ['0', '0.5', '1', '3', '4.999999', '5']) {
    const r = modelOptionSaleBeforeExpiry({ quantity: '10', premiumPerUnit: '5', salePricePerUnit, decimals: 6 });
    assert.equal(r.sellerLossFlooredAtPremium, true);
    assert.ok(r.sellerNetAmount >= -r.premiumTotalAmount);
    assert.equal(r.maximumSellerLossAmount, r.premiumTotalAmount);
  }
});

test('the seller gain is not capped: a stated sale price far above the premium states its whole proceeds as the net above it', () => {
  const r = modelOptionSaleBeforeExpiry({ quantity: '10', premiumPerUnit: '5', salePricePerUnit: '10000', decimals: 6 });
  assert.equal(r.saleProceedsAmount, 100000000000n);
  assert.equal(r.sellerNetAmount, 99950000000n);
  assert.equal(r.saleCoversPremium, true);
});

test('fractional prices state exactly in BigInt: 3 units, a 0.1 premium, sold at 0.25 per unit, nets the seller 0.45', () => {
  const r = modelOptionSaleBeforeExpiry({ quantity: 3, premiumPerUnit: '0.1', salePricePerUnit: '0.25', decimals: 6 });
  assert.equal(r.premiumTotalAmount, 300000n);
  assert.equal(r.saleProceedsAmount, 750000n);
  assert.equal(r.sellerNetAmount, 450000n);
  assert.equal(r.breakEvenSalePricePerUnitAmount, 100000n);
});

test('a premium of zero is stated, not refused: the proceeds stand whole as the seller net and the break-even sale price is zero', () => {
  const r = modelOptionSaleBeforeExpiry({ quantity: '10', premiumPerUnit: '0', salePricePerUnit: '8', decimals: 6 });
  assert.equal(r.premiumTotalAmount, 0n);
  assert.equal(r.sellerNetAmount, 80000000n);
  assert.equal(r.sellerNetAmount, r.saleProceedsAmount);
  assert.equal(r.breakEvenSalePricePerUnitAmount, 0n);
  assert.equal(r.maximumSellerLossAmount, 0n);
});

test('the quantity is a whole count of units: zero, fractional, and over-bound quantities are refused', () => {
  assert.throws(() => modelOptionSaleBeforeExpiry({ quantity: '0', premiumPerUnit: '5', salePricePerUnit: '8', decimals: 6 }), /Quantity must be a whole number of units between 1 and 1,000,000/);
  assert.throws(() => modelOptionSaleBeforeExpiry({ quantity: '2.5', premiumPerUnit: '5', salePricePerUnit: '8', decimals: 6 }), /Quantity must be a whole number of units between 1 and 1,000,000/);
  assert.throws(() => modelOptionSaleBeforeExpiry({ quantity: '1000001', premiumPerUnit: '5', salePricePerUnit: '8', decimals: 6 }), /Quantity must be a whole number of units between 1 and 1,000,000/);
});

test('the proceeds are not a fee and the premium is not a fee, and both prices are stated, never derived', () => {
  const r = modelOptionSaleBeforeExpiry(DEFAULT);
  assert.equal(r.proceedsIsFee, false);
  assert.equal(r.premiumIsFee, false);
  assert.equal(r.salePriceDerived, false);
  assert.equal(r.premiumDerived, false);
});

test('what is not priced stays unpriced: the buyer net, the writer net and position, intrinsic at sale, expiry price, volatility, time value, transfer rules, default risk, fees, and taxes', () => {
  const r = modelOptionSaleBeforeExpiry(DEFAULT);
  assert.equal(r.buyerNetPriced, false);
  assert.equal(r.writerNetPriced, false);
  assert.equal(r.writerPositionClosed, false);
  assert.equal(r.intrinsicAtSalePriced, false);
  assert.equal(r.expiryPricePriced, false);
  assert.equal(r.volatilityPriced, false);
  assert.equal(r.timeValuePriced, false);
  assert.equal(r.transferRulesPriced, false);
  assert.equal(r.defaultRiskPriced, false);
  assert.equal(r.feesPriced, false);
  assert.equal(r.taxesPriced, false);
});
