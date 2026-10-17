import test from 'node:test';
import assert from 'node:assert/strict';
import { modelTradeInCredit, modelStoredValuePayment } from '../src/domain.js';

const DEFAULT = { amount: '500', tradeIn: '200', decimals: 6 };

test('preload: a 200 trade-in value against a 500 purchase applies 200 and leaves 300 due', () => {
  const r = modelTradeInCredit(DEFAULT);
  assert.equal(r.purchaseAmount, 500000000n);
  assert.equal(r.tradeInAmount, 200000000n);
  assert.equal(r.appliedAmount, 200000000n);
  assert.equal(r.remainingDueAmount, 300000000n);
  assert.equal(r.excessAmount, 0n);
  assert.equal(r.appliedShareBpsText, '4000.00');
  assert.equal(r.tradeInUsedShareBpsText, '10000.00');
  assert.equal(r.tradeInIsPartial, true);
  assert.equal(r.tradeInCoversWhole, false);
});

test('identities: applied plus remaining due is the purchase exactly, and applied plus excess is the trade-in value exactly', () => {
  for (const [amount, tradeIn, decimals] of [['500', '200', 6], ['500', '600', 6], ['500', '500', 6], ['999', '1', 0], ['500', '0', 6], ['10', '2.5', 6]]) {
    const r = modelTradeInCredit({ amount, tradeIn, decimals });
    assert.equal(r.appliedAmount + r.remainingDueAmount, r.purchaseAmount);
    assert.equal(r.appliedAmount + r.excessAmount, r.tradeInAmount);
  }
});

test('a trade-in beyond the purchase applies only the purchase: the excess is stated, never paid out or carried', () => {
  const r = modelTradeInCredit({ amount: '500', tradeIn: '600', decimals: 6 });
  assert.equal(r.appliedAmount, 500000000n);
  assert.equal(r.remainingDueAmount, 0n);
  assert.equal(r.excessAmount, 100000000n);
  assert.equal(r.tradeInExceedsPurchase, true);
  assert.equal(r.tradeInCoversWhole, true);
  assert.equal(r.appliedShareBpsText, '10000.00');
  assert.equal(r.tradeInUsedShareBpsText, '8333.33');
  assert.equal(r.excessPaidAsCash, false);
  assert.equal(r.excessCarriedAsCredit, false);
});

test('distinction: stored value keeps its excess standing, a trade-in states its excess as not applied', () => {
  const sv = modelStoredValuePayment({ amount: '500', balanceAmount: '600', decimals: 6 });
  assert.equal(sv.balanceRemainingAmount, 100000000n);
  const ti = modelTradeInCredit({ amount: '500', tradeIn: '600', decimals: 6 });
  assert.equal(ti.excessAmount, 100000000n);
  assert.equal(ti.creditIsStoredValue, false);
});

test('no trade-in stated states no credit: the whole purchase remains due', () => {
  const r = modelTradeInCredit({ amount: '500', tradeIn: '0', decimals: 6 });
  assert.equal(r.noTradeInStated, true);
  assert.equal(r.appliedAmount, 0n);
  assert.equal(r.remainingDueAmount, r.purchaseAmount);
  assert.equal(r.appliedShareBpsText, '0.00');
});

test('a trade-in exactly equal to the purchase leaves nothing due and nothing unapplied', () => {
  const r = modelTradeInCredit({ amount: '500', tradeIn: '500', decimals: 6 });
  assert.equal(r.tradeInExactlyCovers, true);
  assert.equal(r.tradeInCoversWhole, true);
  assert.equal(r.remainingDueAmount, 0n);
  assert.equal(r.excessAmount, 0n);
});

test('a purchase of zero or less is refused', () => {
  assert.throws(() => modelTradeInCredit({ amount: '0', tradeIn: '100', decimals: 6 }), /Purchase amount must be greater than zero/);
});

test('the applied share floors, never rounds: 1 applied of a 999 purchase is a 10.01 share', () => {
  const r = modelTradeInCredit({ amount: '999', tradeIn: '1', decimals: 0 });
  assert.equal(r.appliedAmount, 1n);
  assert.equal(r.remainingDueAmount, 998n);
  assert.equal(r.appliedShareBpsText, '10.01');
  assert.equal(r.tradeInUsedShareBpsText, '10000.00');
});

test('fractional amounts state exactly in BigInt: 2.5 of trade-in value against a 10 purchase leaves 7.5 due', () => {
  const r = modelTradeInCredit({ amount: '10', tradeIn: '2.5', decimals: 6 });
  assert.equal(r.appliedAmount, 2500000n);
  assert.equal(r.remainingDueAmount, 7500000n);
});

test('the credit is not a discount: the price stands whole, paid partly with the item value', () => {
  const r = modelTradeInCredit(DEFAULT);
  assert.equal(r.creditIsDiscount, false);
});

test('the credit is not stored value: no money was loaded or held before the purchase', () => {
  const r = modelTradeInCredit(DEFAULT);
  assert.equal(r.creditIsStoredValue, false);
});

test('the credit is not cashback: nothing comes back to the buyer afterwards', () => {
  const r = modelTradeInCredit(DEFAULT);
  assert.equal(r.creditIsCashback, false);
});

test('excess value is never paid as cash and never carried as credit in this model', () => {
  const r = modelTradeInCredit({ amount: '500', tradeIn: '600', decimals: 6 });
  assert.equal(r.excessPaidAsCash, false);
  assert.equal(r.excessCarriedAsCredit, false);
});

test('what is not priced stays unpriced: item valuation, condition, resale value, and how the remainder due is paid', () => {
  const r = modelTradeInCredit(DEFAULT);
  assert.equal(r.itemValuationPriced, false);
  assert.equal(r.itemConditionPriced, false);
  assert.equal(r.resaleValuePriced, false);
  assert.equal(r.remainingDuePaymentPriced, false);
});
