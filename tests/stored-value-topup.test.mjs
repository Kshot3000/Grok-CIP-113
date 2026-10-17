import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelStoredValueTopUp } from '../src/domain.js';

// Stored-value top-up model (v1.225): the stored-value
// axis's second moment — a later load adds to a standing
// balance. The balance afterwards is the standing balance
// plus the load, exactly: no bonus invented, no fee taken.
// Identity: standing + load === balance afterwards.
const DEFAULT = { balanceAmount: '150', loadAmount: '100', decimals: 6 };

test('the preloaded top-up: the 150 left standing after a purchase, topped up by 100, stands at 250 afterwards', () => {
  const r = modelStoredValueTopUp(DEFAULT);
  assert.equal(r.balanceAmount, 150000000n);
  assert.equal(r.loadAmount, 100000000n);
  assert.equal(r.newBalanceAmount, 250000000n);
  assert.equal(r.loadShareOfNewBalanceBpsText, '4000.00');
  assert.equal(r.priorShareOfNewBalanceBpsText, '6000.00');
  assert.equal(r.noLoadStated, false);
  assert.equal(r.opensBalance, false);
});

test('identity holds across cases: standing + load is the balance afterwards, and it minus the load is what stood', () => {
  const cases = [
    DEFAULT,
    { balanceAmount: '0', loadAmount: '100', decimals: 6 },
    { balanceAmount: '150', loadAmount: '0', decimals: 6 },
    { balanceAmount: '150', loadAmount: '150', decimals: 6 },
    { balanceAmount: '999', loadAmount: '1', decimals: 0 },
    { balanceAmount: '0.000002', loadAmount: '0.000001', decimals: 6 },
  ];
  for (const c of cases) {
    const r = modelStoredValueTopUp(c);
    assert.equal(r.balanceAmount + r.loadAmount, r.newBalanceAmount);
    assert.equal(r.newBalanceAmount - r.loadAmount, r.balanceAmount);
    assert.ok(r.loadAmount <= r.newBalanceAmount);
    assert.ok(r.balanceAmount <= r.newBalanceAmount);
  }
});

test('a load of zero states no top-up: the balance stands as it was', () => {
  const r = modelStoredValueTopUp({ balanceAmount: '150', loadAmount: '0', decimals: 6 });
  assert.equal(r.noLoadStated, true);
  assert.equal(r.newBalanceAmount, 150000000n);
  assert.equal(r.loadShareOfNewBalanceBpsText, '0.00');
  assert.equal(r.priorShareOfNewBalanceBpsText, '10000.00');
});

test('a load onto an empty balance opens it at the load whole', () => {
  const r = modelStoredValueTopUp({ balanceAmount: '0', loadAmount: '100', decimals: 6 });
  assert.equal(r.opensBalance, true);
  assert.equal(r.newBalanceAmount, 100000000n);
  assert.equal(r.loadShareOfNewBalanceBpsText, '10000.00');
  assert.equal(r.priorShareOfNewBalanceBpsText, '0.00');
});

test('a load equal to the standing balance doubles it exactly', () => {
  const r = modelStoredValueTopUp({ balanceAmount: '150', loadAmount: '150', decimals: 6 });
  assert.equal(r.loadEqualsPriorBalance, true);
  assert.equal(r.newBalanceAmount, 300000000n);
  assert.equal(r.newBalanceAmount, r.balanceAmount * 2n);
  assert.equal(r.loadShareOfNewBalanceBpsText, '5000.00');
});

test('a load larger than the standing balance is stated by its share of the balance afterwards', () => {
  const r = modelStoredValueTopUp({ balanceAmount: '100', loadAmount: '150', decimals: 6 });
  assert.equal(r.loadExceedsPriorBalance, true);
  assert.equal(r.newBalanceAmount, 250000000n);
  assert.equal(r.loadShareOfNewBalanceBpsText, '6000.00');
  assert.equal(r.priorShareOfNewBalanceBpsText, '4000.00');
});

test('shares are floored from the amounts: a load of 2 onto 1 standing is 6666.66 of the 3 afterwards, never rounded up', () => {
  const r = modelStoredValueTopUp({ balanceAmount: '1', loadAmount: '2', decimals: 0 });
  assert.equal(r.newBalanceAmount, 3n);
  assert.equal(r.loadShareOfNewBalanceBpsText, '6666.66');
  assert.equal(r.priorShareOfNewBalanceBpsText, '3333.33');
});

test('one base unit loaded onto 999 standing states 1000 afterwards exactly', () => {
  const r = modelStoredValueTopUp({ balanceAmount: '999', loadAmount: '1', decimals: 0 });
  assert.equal(r.newBalanceAmount, 1000n);
  assert.equal(r.loadShareOfNewBalanceBpsText, '10.00');
  assert.equal(r.priorShareOfNewBalanceBpsText, '9990.00');
});

test('the smallest units add exactly: 0.000001 loaded onto 0.000002 standing states 0.000003', () => {
  const r = modelStoredValueTopUp({ balanceAmount: '0.000002', loadAmount: '0.000001', decimals: 6 });
  assert.equal(r.newBalanceAmount, 3n);
  assert.equal(r.loadShareOfNewBalanceBpsText, '3333.33');
});

test('no value is created beyond the load: the balance afterwards never exceeds standing plus load', () => {
  for (const c of [DEFAULT, { balanceAmount: '0', loadAmount: '5', decimals: 6 }, { balanceAmount: '7', loadAmount: '7', decimals: 0 }]) {
    const r = modelStoredValueTopUp(c);
    assert.equal(r.valueCreatedBeyondLoad, false);
    assert.equal(r.newBalanceAmount, r.balanceAmount + r.loadAmount);
  }
});

test('a top-up is not income, not cashback, not credit, and pays for no purchase', () => {
  const r = modelStoredValueTopUp(DEFAULT);
  assert.equal(r.topUpIsIncome, false);
  assert.equal(r.topUpIsCashback, false);
  assert.equal(r.topUpIsCredit, false);
  assert.equal(r.topUpAppliesToPurchase, false);
});

test('a negative load and a negative standing balance are refused', () => {
  assert.throws(() => modelStoredValueTopUp({ balanceAmount: '10', loadAmount: '-1', decimals: 6 }), /positive decimal/);
  assert.throws(() => modelStoredValueTopUp({ balanceAmount: '-1', loadAmount: '1', decimals: 6 }), /positive decimal/);
});

test('what is not priced stays unpriced: load fee, load bonus, balance cap, load tender, and expiry', () => {
  const r = modelStoredValueTopUp(DEFAULT);
  assert.equal(r.loadFeePriced, false);
  assert.equal(r.loadBonusPriced, false);
  assert.equal(r.balanceCapPriced, false);
  assert.equal(r.loadTenderPriced, false);
  assert.equal(r.balanceExpiryPriced, false);
});
