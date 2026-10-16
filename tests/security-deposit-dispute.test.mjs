import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelSecurityDepositDispute, modelSecurityDepositReturn } from '../src/domain.js';

// Security deposit dispute model (v1.203): the return model
// (v1.203) settles a deposit against stated deductions, but part
// of a claim can be DISPUTED. The undisputed part is applied now,
// the contested part is held back (never more than the deposit
// holds after the undisputed part), and the rest returns now.
// If the dispute is upheld the held amount returns too; if it is
// rejected the held amount is applied and the outcome is the base
// settlement exactly. Shares are derived from the amounts.
const DEFAULT = { depositAmount: '2000', decimals: 6, unpaidAmount: '350', repairAmount: '250', disputedAmount: '250' };

test('the preloaded dispute: the 250 repair cost is disputed — 350 undisputed is applied now, 250 is held, and 1400 returns now', () => {
  const r = modelSecurityDepositDispute(DEFAULT);
  assert.equal(r.totalDeductions, 600000000n);
  assert.equal(r.undisputedDeductions, 350000000n);
  assert.equal(r.undisputedApplied, 350000000n);
  assert.equal(r.heldForDispute, 250000000n);
  assert.equal(r.returnedNow, 1400000000n);
  assert.equal(r.disputeFullyHeld, true);
});

test('identities hold across terms: applied now plus held plus returned now is the deposit, and undisputed plus disputed is everything claimed', () => {
  const cases = [
    DEFAULT,
    { depositAmount: '777', decimals: 6, unpaidAmount: '111', repairAmount: '222', disputedAmount: '100' },
    { depositAmount: '2000', decimals: 6, unpaidAmount: '1800', repairAmount: '700', disputedAmount: '700' },
    { depositAmount: '1000', decimals: 0, unpaidAmount: '1200', repairAmount: '300', disputedAmount: '300' },
  ];
  for (const c of cases) {
    const r = modelSecurityDepositDispute(c);
    assert.equal(r.undisputedApplied + r.heldForDispute + r.returnedNow, r.depositAmount);
    assert.equal(r.undisputedDeductions + r.disputedAmount, r.totalDeductions);
    assert.equal(r.heldForDispute + r.disputedBeyondHeld, r.disputedAmount);
  }
});

test('if the dispute is rejected the outcome is the base settlement exactly: same applied, same returned, same still owed', () => {
  for (const c of [DEFAULT, { depositAmount: '2000', decimals: 6, unpaidAmount: '1800', repairAmount: '700', disputedAmount: '700' }]) {
    const r = modelSecurityDepositDispute(c);
    const b = modelSecurityDepositReturn(c);
    assert.equal(r.ifRejectedApplied, b.deductionsApplied);
    assert.equal(r.ifRejectedReturned, b.returnedToTenant);
    assert.equal(r.ifRejectedStillOwed, b.amountStillOwed);
  }
});

test('if the dispute is upheld the held amount returns too: on the preload 1650 returns in total and only the undisputed 350 was ever applied', () => {
  const r = modelSecurityDepositDispute(DEFAULT);
  assert.equal(r.ifUpheldReturned, 1650000000n);
  assert.equal(r.ifUpheldApplied, 350000000n);
  assert.equal(r.ifUpheldStillOwed, 0n);
  assert.equal(r.ifUpheldReturned + r.ifUpheldApplied, r.depositAmount);
});

test('the amount returned now equals the base model return: the held amount covers the contested part, so a partial release never pays less now than the worst-case final return', () => {
  const cases = [
    DEFAULT,
    { depositAmount: '777', decimals: 6, unpaidAmount: '111', repairAmount: '222', disputedAmount: '100' },
    { depositAmount: '2000', decimals: 6, unpaidAmount: '1800', repairAmount: '700', disputedAmount: '700' },
    { depositAmount: '1000', decimals: 0, unpaidAmount: '1200', repairAmount: '300', disputedAmount: '300' },
  ];
  for (const c of cases) {
    const r = modelSecurityDepositDispute(c);
    assert.equal(r.returnedNow, modelSecurityDepositReturn(c).returnedToTenant);
  }
});

test('no dispute is the base settlement with nothing held: both dispute outcomes agree with each other and with the base model', () => {
  const r = modelSecurityDepositDispute({ ...DEFAULT, disputedAmount: '0' });
  assert.equal(r.noDispute, true);
  assert.equal(r.heldForDispute, 0n);
  assert.equal(r.nothingHeld, true);
  assert.equal(r.returnedNow, 1400000000n);
  assert.equal(r.ifUpheldReturned, r.ifRejectedReturned);
  assert.equal(r.ifUpheldApplied, r.ifRejectedApplied);
});

test('a full dispute applies nothing now: the whole 600 claim is held and 1400 still returns now, and an upheld dispute returns the whole deposit', () => {
  const r = modelSecurityDepositDispute({ ...DEFAULT, disputedAmount: '600' });
  assert.equal(r.fullDispute, true);
  assert.equal(r.undisputedApplied, 0n);
  assert.equal(r.heldForDispute, 600000000n);
  assert.equal(r.returnedNow, 1400000000n);
  assert.equal(r.ifUpheldReturned, 2000000000n);
  assert.equal(r.disputedShareBpsText, '10000.00');
});

test('a disputed claim larger than what the deposit holds after the undisputed part is only partly held: 700 disputed against 1800 undisputed on a 2000 deposit holds 200, and 500 of the dispute is beyond the deposit entirely', () => {
  const r = modelSecurityDepositDispute({ depositAmount: '2000', decimals: 6, unpaidAmount: '1800', repairAmount: '700', disputedAmount: '700' });
  assert.equal(r.undisputedApplied, 1800000000n);
  assert.equal(r.heldForDispute, 200000000n);
  assert.equal(r.disputedBeyondHeld, 500000000n);
  assert.equal(r.disputePartlyBeyondHeld, true);
  assert.equal(r.disputeFullyHeld, false);
  assert.equal(r.returnedNow, 0n);
  assert.equal(r.nothingReturnedNow, true);
  assert.equal(r.ifRejectedStillOwed, 500000000n);
  assert.equal(r.ifUpheldReturned, 200000000n);
  assert.equal(r.ifUpheldStillOwed, 0n);
});

test('an undisputed claim that alone exhausts the deposit leaves nothing to hold: the disputed part is entirely beyond the deposit, and an upheld dispute still leaves the undisputed excess owed', () => {
  const r = modelSecurityDepositDispute({ depositAmount: '1000', decimals: 0, unpaidAmount: '1200', repairAmount: '300', disputedAmount: '300' });
  assert.equal(r.undisputedApplied, 1000n);
  assert.equal(r.heldForDispute, 0n);
  assert.equal(r.nothingHeld, true);
  assert.equal(r.disputedBeyondHeld, 300n);
  assert.equal(r.ifUpheldStillOwed, 200n);
  assert.equal(r.ifRejectedStillOwed, 500n);
});

test('shares are derived from the amounts: on the 777 case with 100 disputed, 444 returns now (5714.28), 100 is held (1287.00), and the disputed share of the claim is 3003.00', () => {
  const r = modelSecurityDepositDispute({ depositAmount: '777', decimals: 6, unpaidAmount: '111', repairAmount: '222', disputedAmount: '100' });
  assert.equal(r.returnedNow, 444000000n);
  assert.equal(r.returnedNowShareBpsText, '5714.28');
  assert.equal(r.heldShareBpsText, '1287.00');
  assert.equal(r.undisputedAppliedShareBpsText, '2998.71');
  assert.equal(r.disputedShareBpsText, '3003.00');
  assert.equal(r.ifUpheldReturned, 544000000n);
});

test('on the preload the held share of the deposit is 1250.00 and the disputed share of everything claimed is 4166.66', () => {
  const r = modelSecurityDepositDispute(DEFAULT);
  assert.equal(r.heldShareBpsText, '1250.00');
  assert.equal(r.undisputedAppliedShareBpsText, '1750.00');
  assert.equal(r.disputedShareBpsText, '4166.66');
});

test('amounts beyond float precision stay exact: a 2^53+1 deposit with its single base unit of deductions fully disputed holds that unit and returns 2^53 now', () => {
  const r = modelSecurityDepositDispute({ depositAmount: '9007199254740993', decimals: 0, unpaidAmount: '1', repairAmount: '0', disputedAmount: '1' });
  assert.equal(r.heldForDispute, 1n);
  assert.equal(r.returnedNow, 9007199254740992n);
  assert.equal(r.ifUpheldReturned, 9007199254740993n);
  assert.equal(r.fullDispute, true);
});

test('a disputed amount above everything claimed is refused', () => {
  assert.throws(() => modelSecurityDepositDispute({ ...DEFAULT, disputedAmount: '601' }), /Disputed amount cannot exceed the total deductions claimed/);
});

test('disputing exactly everything claimed is allowed, and disputing when nothing is claimed is refused as exceeding a zero claim', () => {
  const ok = modelSecurityDepositDispute({ ...DEFAULT, disputedAmount: '600' });
  assert.equal(ok.fullDispute, true);
  assert.throws(() => modelSecurityDepositDispute({ depositAmount: '500', decimals: 6, unpaidAmount: '0', repairAmount: '0', disputedAmount: '1' }), /cannot exceed the total deductions claimed/);
});

test('the base validation still governs: a non-positive deposit and malformed amounts are refused through the composed model', () => {
  assert.throws(() => modelSecurityDepositDispute({ ...DEFAULT, depositAmount: '0' }), /Security deposit must be greater than zero/);
  assert.throws(() => modelSecurityDepositDispute({ ...DEFAULT, disputedAmount: '2,50' }), /without commas or exponents/);
  assert.throws(() => modelSecurityDepositDispute({ ...DEFAULT, unpaidAmount: '1e2' }), /without commas or exponents/);
});

test('defaults: an unstated dispute is no dispute, so a deposit stated with deductions alone settles exactly as the base model', () => {
  const r = modelSecurityDepositDispute({ depositAmount: '2000', decimals: 6, unpaidAmount: '350', repairAmount: '250' });
  assert.equal(r.disputedAmount, 0n);
  assert.equal(r.noDispute, true);
  assert.equal(r.returnedNow, 1400000000n);
});

test('the held amount never exceeds the deposit and never exceeds the disputed amount, across claims from zero to twice the deposit', () => {
  for (const disputed of ['0', '100', '600', '1500', '2500']) {
    const total = 2500;
    if (Number(disputed) > total) continue;
    const r = modelSecurityDepositDispute({ depositAmount: '2000', decimals: 0, unpaidAmount: '1800', repairAmount: '700', disputedAmount: disputed });
    assert.ok(r.heldForDispute <= 2000n);
    assert.ok(r.heldForDispute <= r.disputedAmount);
    assert.ok(r.returnedNow >= 0n);
  }
});
