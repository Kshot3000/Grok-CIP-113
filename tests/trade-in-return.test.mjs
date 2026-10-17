import test from 'node:test';
import assert from 'node:assert/strict';
import { modelTradeInReturn, modelTradeInCredit } from '../src/domain.js';

const DEFAULT = { amount: '500', tradeIn: '200', settlement: '200', decimals: 6 };

test('preload: returning a 500 purchase paid with a 200 trade-in refunds the 300 paid by other means and settles the item at its full 200 applied credit — 500 back in money in all', () => {
  const r = modelTradeInReturn(DEFAULT);
  assert.equal(r.purchaseAmount, 500000000n);
  assert.equal(r.appliedAmount, 200000000n);
  assert.equal(r.moneyPaidAmount, 300000000n);
  assert.equal(r.moneyRefundAmount, 300000000n);
  assert.equal(r.itemSettlementAmount, 200000000n);
  assert.equal(r.totalMoneyBackAmount, 500000000n);
  assert.equal(r.notSettledAmount, 0n);
  assert.equal(r.settlementSettlesWholeCredit, true);
  assert.equal(r.settlementShareBpsText, '10000.00');
  assert.equal(r.totalMoneyBackShareBpsText, '10000.00');
});

test('identities: the money refund plus the applied credit is the purchase exactly, and all money back plus what is not settled is the purchase exactly', () => {
  for (const [amount, tradeIn, settlement, decimals] of [['500', '200', '200', 6], ['500', '200', '150', 6], ['500', '600', '500', 6], ['999', '1', '1', 0], ['10', '2.5', '2.5', 6], ['500', '0', '0', 6]]) {
    const r = modelTradeInReturn({ amount, tradeIn, settlement, decimals });
    assert.equal(r.moneyRefundAmount + r.appliedAmount, r.purchaseAmount);
    assert.equal(r.totalMoneyBackAmount + r.notSettledAmount, r.purchaseAmount);
  }
});

test('composition: the applied credit and the money part are the trade-in credit model\u2019s own amounts, unchanged', () => {
  const base = modelTradeInCredit({ amount: '500', tradeIn: '200', decimals: 6 });
  const r = modelTradeInReturn(DEFAULT);
  assert.equal(r.appliedAmount, base.appliedAmount);
  assert.equal(r.moneyRefundAmount, base.remainingDueAmount);
  assert.equal(r.excessAmount, base.excessAmount);
});

test('a partial settlement states its shortfall: settled at 150 of a 200 applied credit, 450 comes back and 50 is not settled', () => {
  const r = modelTradeInReturn({ amount: '500', tradeIn: '200', settlement: '150', decimals: 6 });
  assert.equal(r.totalMoneyBackAmount, 450000000n);
  assert.equal(r.notSettledAmount, 50000000n);
  assert.equal(r.settlementIsPartial, true);
  assert.equal(r.settlementSettlesWholeCredit, false);
  assert.equal(r.settlementShareBpsText, '7500.00');
});

test('the item handed back itself: the money part is refunded, no money settles the item, and its value returns in kind', () => {
  const r = modelTradeInReturn({ amount: '500', tradeIn: '200', settlement: '0', itemBack: true, decimals: 6 });
  assert.equal(r.itemBackInKind, true);
  assert.equal(r.moneyRefundAmount, 300000000n);
  assert.equal(r.itemSettlementAmount, 0n);
  assert.equal(r.totalMoneyBackAmount, 300000000n);
  assert.equal(r.notSettledAmount, 0n);
});

test('a return cannot both hand the item back and pay a money settlement for it: refused', () => {
  assert.throws(() => modelTradeInReturn({ amount: '500', tradeIn: '200', settlement: '100', itemBack: true, decimals: 6 }), /cannot both hand the item back/);
});

test('the settlement is measured on the applied credit, never the stated value: a 600 value against a 500 purchase applied 500, and a 600 settlement is refused', () => {
  assert.throws(() => modelTradeInReturn({ amount: '500', tradeIn: '600', settlement: '600', decimals: 6 }), /cannot exceed the trade-in credit that was applied/);
  const r = modelTradeInReturn({ amount: '500', tradeIn: '600', settlement: '500', decimals: 6 });
  assert.equal(r.appliedAmount, 500000000n);
  assert.equal(r.excessAmount, 100000000n);
  assert.equal(r.moneyRefundAmount, 0n);
  assert.equal(r.totalMoneyBackAmount, 500000000n);
  assert.equal(r.settlementMeasuredOnApplied, true);
});

test('no trade-in stated: the return is an ordinary refund of the whole purchase as money, with no item to settle', () => {
  const r = modelTradeInReturn({ amount: '500', tradeIn: '0', settlement: '0', decimals: 6 });
  assert.equal(r.noTradeInStated, true);
  assert.equal(r.moneyRefundAmount, 500000000n);
  assert.equal(r.totalMoneyBackAmount, 500000000n);
  assert.equal(r.appliedAmount, 0n);
});

test('no money settlement and the item not handed back: the whole applied credit is stated as not settled', () => {
  const r = modelTradeInReturn({ amount: '500', tradeIn: '200', settlement: '0', decimals: 6 });
  assert.equal(r.noMoneySettlement, true);
  assert.equal(r.notSettledAmount, 200000000n);
  assert.equal(r.totalMoneyBackAmount, 300000000n);
});

test('the settlement share floors, never rounds: 1 settled of a 999 applied credit is a 10.01 share', () => {
  const r = modelTradeInReturn({ amount: '999', tradeIn: '999', settlement: '1', decimals: 0 });
  assert.equal(r.itemSettlementAmount, 1n);
  assert.equal(r.notSettledAmount, 998n);
  assert.equal(r.settlementShareBpsText, '10.01');
});

test('fractional amounts state exactly in BigInt: a 10 purchase with a 2.5 trade-in settled whole refunds 7.5 and settles 2.5', () => {
  const r = modelTradeInReturn({ amount: '10', tradeIn: '2.5', settlement: '2.5', decimals: 6 });
  assert.equal(r.moneyRefundAmount, 7500000n);
  assert.equal(r.itemSettlementAmount, 2500000n);
  assert.equal(r.totalMoneyBackAmount, 10000000n);
});

test('a purchase of zero or less is refused, by the trade-in credit model it composes', () => {
  assert.throws(() => modelTradeInReturn({ amount: '0', tradeIn: '100', settlement: '0', decimals: 6 }), /Purchase amount must be greater than zero/);
});

test('the refund is not income: it is the buyer\u2019s own money coming back', () => {
  const r = modelTradeInReturn(DEFAULT);
  assert.equal(r.refundIsIncome, false);
});

test('the settlement is not a resale value: it is measured on the applied credit, not on what the item could be resold for', () => {
  const r = modelTradeInReturn(DEFAULT);
  assert.equal(r.settlementIsResaleValue, false);
});

test('what is not priced stays unpriced: item valuation, return eligibility, refund timing, and what happens to the returned goods', () => {
  const r = modelTradeInReturn(DEFAULT);
  assert.equal(r.itemValuationPriced, false);
  assert.equal(r.returnEligibilityPriced, false);
  assert.equal(r.refundTimingPriced, false);
  assert.equal(r.goodsResalePriced, false);
});
