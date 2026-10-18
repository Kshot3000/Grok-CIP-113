import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelSecurityDepositReturn } from '../src/domain.js';

// Security deposit return model (v1.251): a deposit held against
// stated deductions (unpaid amounts + repair costs). Deductions
// are applied only against what the deposit holds — the return is
// never negative — and deductions beyond the deposit are stated
// separately as an amount still owed, never collected here and
// never netted into the return. Shares are derived from the
// amounts.
const DEFAULT = { depositAmount: '2000', decimals: 6, unpaidAmount: '350', repairAmount: '250' };

test('the preloaded return: 600 of deductions against the 2000 deposit — 1400 returns to the tenant and nothing is still owed', () => {
  const r = modelSecurityDepositReturn(DEFAULT);
  assert.equal(r.depositAmount, 2000000000n);
  assert.equal(r.totalDeductions, 600000000n);
  assert.equal(r.deductionsApplied, 600000000n);
  assert.equal(r.returnedToTenant, 1400000000n);
  assert.equal(r.amountStillOwed, 0n);
  assert.equal(r.returnedShareBpsText, '7000.00');
  assert.equal(r.deductionsShareBpsText, '3000.00');
  assert.equal(r.partialReturn, true);
});

test('identities hold across terms: returned plus applied is the deposit, applied plus still owed is everything claimed, and unpaid plus repair is the claim', () => {
  const cases = [
    DEFAULT,
    { depositAmount: '777', decimals: 6, unpaidAmount: '111', repairAmount: '222' },
    { depositAmount: '9', decimals: 0, unpaidAmount: '20', repairAmount: '5' },
    { depositAmount: '1000', decimals: 2, unpaidAmount: '0', repairAmount: '0' },
  ];
  for (const c of cases) {
    const r = modelSecurityDepositReturn(c);
    assert.equal(r.returnedToTenant + r.deductionsApplied, r.depositAmount);
    assert.equal(r.deductionsApplied + r.amountStillOwed, r.totalDeductions);
    assert.equal(r.unpaidAmount + r.repairAmount, r.totalDeductions);
  }
});

test('no deductions returns the whole deposit: the full-return outcome, with both deduction shares at zero', () => {
  const r = modelSecurityDepositReturn({ ...DEFAULT, unpaidAmount: '0', repairAmount: '0' });
  assert.equal(r.fullReturn, true);
  assert.equal(r.returnedToTenant, r.depositAmount);
  assert.equal(r.deductionsApplied, 0n);
  assert.equal(r.returnedShareBpsText, '10000.00');
  assert.equal(r.unpaidShareBpsText, '0.00');
  assert.equal(r.repairShareBpsText, '0.00');
});

test('deductions beyond the deposit return nothing and state the excess as still owed: 2500 claimed against 2000 leaves 500 owed, never a negative return', () => {
  const r = modelSecurityDepositReturn({ ...DEFAULT, unpaidAmount: '1800', repairAmount: '700' });
  assert.equal(r.deductionsExceedDeposit, true);
  assert.equal(r.totalDeductions, 2500000000n);
  assert.equal(r.deductionsApplied, 2000000000n);
  assert.equal(r.returnedToTenant, 0n);
  assert.equal(r.amountStillOwed, 500000000n);
  assert.equal(r.owedShareBpsText, '2000.00');
  assert.equal(r.deductionsShareBpsText, '10000.00');
});

test('deductions exactly equal to the deposit exhaust it: nothing returns and nothing further is owed — a third outcome, neither partial nor exceeding', () => {
  const r = modelSecurityDepositReturn({ ...DEFAULT, unpaidAmount: '1250', repairAmount: '750' });
  assert.equal(r.depositExhausted, true);
  assert.equal(r.partialReturn, false);
  assert.equal(r.deductionsExceedDeposit, false);
  assert.equal(r.returnedToTenant, 0n);
  assert.equal(r.amountStillOwed, 0n);
});

test('each deduction share is measured against the total claimed, not the deposit: on the preload the unpaid share is 5833.33 and the repair share is 4166.66', () => {
  const r = modelSecurityDepositReturn(DEFAULT);
  assert.equal(r.unpaidShareBpsText, '5833.33');
  assert.equal(r.repairShareBpsText, '4166.66');
});

test('shares are derived from the amounts: on the 777 case with 111 unpaid and 222 repair, 444 returns and the returned share is 5714.28', () => {
  const r = modelSecurityDepositReturn({ depositAmount: '777', decimals: 6, unpaidAmount: '111', repairAmount: '222' });
  assert.equal(r.returnedToTenant, 444000000n);
  assert.equal(r.returnedShareBpsText, '5714.28');
  assert.equal(r.deductionsShareBpsText, '4285.71');
  assert.equal(r.unpaidShareBpsText, '3333.33');
  assert.equal(r.repairShareBpsText, '6666.66');
});

test('a claim of unpaid amounts alone is stated whole: no repair flag set and the unpaid share of the claim is the whole claim', () => {
  const r = modelSecurityDepositReturn({ ...DEFAULT, repairAmount: '0' });
  assert.equal(r.noRepair, true);
  assert.equal(r.noUnpaid, false);
  assert.equal(r.totalDeductions, 350000000n);
  assert.equal(r.unpaidShareBpsText, '10000.00');
  assert.equal(r.returnedToTenant, 1650000000n);
});

test('a claim of repair costs alone is stated whole: no unpaid flag set and the repair share of the claim is the whole claim', () => {
  const r = modelSecurityDepositReturn({ ...DEFAULT, unpaidAmount: '0' });
  assert.equal(r.noUnpaid, true);
  assert.equal(r.noRepair, false);
  assert.equal(r.totalDeductions, 250000000n);
  assert.equal(r.repairShareBpsText, '10000.00');
  assert.equal(r.returnedToTenant, 1750000000n);
});

test('the return can never be negative: across claims from zero to twice the deposit, returned plus applied is always the deposit and returned is never below zero', () => {
  for (const claim of ['0', '1', '999', '1999', '2000', '2001', '4000']) {
    const r = modelSecurityDepositReturn({ depositAmount: '2000', decimals: 0, unpaidAmount: claim, repairAmount: '0' });
    assert.ok(r.returnedToTenant >= 0n);
    assert.equal(r.returnedToTenant + r.deductionsApplied, 2000n);
    assert.ok(r.deductionsApplied <= 2000n);
  }
});

test('one base unit of deductions over a one-unit deposit leaves one base unit still owed, in base units', () => {
  const r = modelSecurityDepositReturn({ depositAmount: '1', decimals: 0, unpaidAmount: '2', repairAmount: '0' });
  assert.equal(r.deductionsApplied, 1n);
  assert.equal(r.returnedToTenant, 0n);
  assert.equal(r.amountStillOwed, 1n);
  assert.equal(r.owedShareBpsText, '5000.00');
});

test('amounts beyond float precision stay exact: a 2^53+1 deposit with a single base unit deducted returns 2^53 exactly', () => {
  const r = modelSecurityDepositReturn({ depositAmount: '9007199254740993', decimals: 0, unpaidAmount: '1', repairAmount: '0' });
  assert.equal(r.returnedToTenant, 9007199254740992n);
  assert.equal(r.deductionsApplied, 1n);
  assert.equal(r.returnedShareBpsText, '9999.99');
});

test('a non-positive deposit is refused', () => {
  assert.throws(() => modelSecurityDepositReturn({ ...DEFAULT, depositAmount: '0' }), /Security deposit must be greater than zero/);
});

test('amounts are validated as amounts: commas and exponents are refused in the deposit and in either deduction', () => {
  assert.throws(() => modelSecurityDepositReturn({ ...DEFAULT, depositAmount: '2,000' }), /without commas or exponents/);
  assert.throws(() => modelSecurityDepositReturn({ ...DEFAULT, unpaidAmount: '1e2' }), /without commas or exponents/);
  assert.throws(() => modelSecurityDepositReturn({ ...DEFAULT, repairAmount: '2,50' }), /without commas or exponents/);
});

test('defaults: an unstated deduction is zero, so a deposit stated alone returns in full', () => {
  const r = modelSecurityDepositReturn({ depositAmount: '500', decimals: 6 });
  assert.equal(r.unpaidAmount, 0n);
  assert.equal(r.repairAmount, 0n);
  assert.equal(r.fullReturn, true);
  assert.equal(r.returnedToTenant, 500000000n);
});

test('more decimal places than stated are refused through the amount validation', () => {
  assert.throws(() => modelSecurityDepositReturn({ depositAmount: '1.5', decimals: 0, unpaidAmount: '0', repairAmount: '0' }), /at most 0 decimal places/);
});

test('when deductions exceed the deposit the still-owed amount is exactly the excess — never more, never collected from the return', () => {
  const r = modelSecurityDepositReturn({ depositAmount: '100', decimals: 0, unpaidAmount: '60', repairAmount: '55' });
  assert.equal(r.totalDeductions, 115n);
  assert.equal(r.amountStillOwed, 15n);
  assert.equal(r.amountStillOwed, r.totalDeductions - r.depositAmount);
});
