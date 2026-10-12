import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFeeDisclosure, FEE_DISCLOSURE_VERDICTS } from '../src/domain.js';

// Service-fee disclosure: the v1.127–v1.134 fee family prices a fee
// exactly, but a fee is only honestly taken when it is disclosed — the
// exact rate (percentage + fixed + cap), the named recipients, shown
// before the user confirms, with its rounding and the recipient's net
// amount stated. Whether the fee can change is reported, never scored;
// the change terms are scored only when changes exist.
const complete = () => ({
  rateDisclosure: 'exact',
  recipientDisclosure: 'named',
  timing: 'before-confirm',
  roundingDisclosure: 'stated',
  netDisclosure: 'shown',
  feeChanges: 'changes-with-notice',
  changeNotice: 'advance',
});

test('a fully disclosed fee is complete — and its fee may change, with advance notice', () => {
  const v = checkFeeDisclosure(complete());
  assert.equal(v.status, 'complete');
  assert.equal(v.valid, true);
  assert.equal(v.canChange, true);
  assert.deepEqual(Object.keys(v.verdicts), FEE_DISCLOSURE_VERDICTS.map(([f]) => f));
  assert.deepEqual(v.verdicts, { rateStated: true, recipientsNamed: true, shownBeforeTransfer: true, roundingStated: true, netAmountShown: true, changeTermsStated: true });
});

test('a fixed fee carries no change-terms verdict — and is complete without one', () => {
  const v = checkFeeDisclosure({ ...complete(), feeChanges: 'fixed', changeNotice: 'not-applicable' });
  assert.equal(v.verdicts.changeTermsStated, null);
  assert.equal(v.canChange, false);
  assert.equal(v.valid, true);
  assert.equal(v.status, 'complete');
});

test('whether the fee can change is reported, never scored: fixed and changeable can both be complete', () => {
  const fixed = checkFeeDisclosure({ ...complete(), feeChanges: 'fixed', changeNotice: 'not-applicable' });
  const changing = checkFeeDisclosure(complete());
  assert.equal(fixed.valid, true);
  assert.equal(changing.valid, true);
  assert.notEqual(fixed.feeChanges, changing.feeChanges);
});

test('a percentage stated alone is not the exact rate: a hidden fixed fee or cap fails rateStated', () => {
  const v = checkFeeDisclosure({ ...complete(), rateDisclosure: 'rate-only' });
  assert.equal(v.verdicts.rateStated, false);
  assert.equal(v.valid, false);
  const none = checkFeeDisclosure({ ...complete(), rateDisclosure: 'none' });
  assert.equal(none.verdicts.rateStated, false);
});

test('"a fee is charged" with no destination fails recipientsNamed — the destination is part of the fee', () => {
  const v = checkFeeDisclosure({ ...complete(), recipientDisclosure: 'unnamed' });
  assert.equal(v.verdicts.recipientsNamed, false);
  assert.equal(v.valid, false);
  const none = checkFeeDisclosure({ ...complete(), recipientDisclosure: 'none' });
  assert.equal(none.verdicts.recipientsNamed, false);
});

test('a fee first shown after the transfer is a deduction, not a disclosure', () => {
  const after = checkFeeDisclosure({ ...complete(), timing: 'after' });
  assert.equal(after.verdicts.shownBeforeTransfer, false);
  assert.equal(after.valid, false);
  const never = checkFeeDisclosure({ ...complete(), timing: 'never' });
  assert.equal(never.verdicts.shownBeforeTransfer, false);
});

test('unstated rounding fails: the fee floors, and who keeps the remainder must be said', () => {
  const v = checkFeeDisclosure({ ...complete(), roundingDisclosure: 'unstated' });
  assert.equal(v.verdicts.roundingStated, false);
  assert.equal(v.valid, false);
});

test('a net amount never shown fails netAmountShown, independently of the rate being stated', () => {
  const v = checkFeeDisclosure({ ...complete(), netDisclosure: 'not-shown' });
  assert.equal(v.verdicts.netAmountShown, false);
  assert.equal(v.verdicts.rateStated, true);
  assert.equal(v.valid, false);
});

test('change terms are scored when the fee can change: at-change and no notice both fail', () => {
  const atChange = checkFeeDisclosure({ ...complete(), changeNotice: 'at-change' });
  assert.equal(atChange.verdicts.changeTermsStated, false);
  assert.equal(atChange.valid, false);
  const none = checkFeeDisclosure({ ...complete(), feeChanges: 'changes-without-notice', changeNotice: 'none' });
  assert.equal(none.verdicts.changeTermsStated, false);
  assert.equal(none.valid, false);
});

test('advance notice rescues neither a hidden rate nor unnamed recipients', () => {
  const v = checkFeeDisclosure({ ...complete(), rateDisclosure: 'none', recipientDisclosure: 'none' });
  assert.equal(v.verdicts.changeTermsStated, true);
  assert.equal(v.valid, false);
  assert.equal(v.status, 'incomplete');
});

test('each scored position fails independently', () => {
  const breaks = [
    ['rateDisclosure', 'rate-only', 'rateStated'],
    ['recipientDisclosure', 'unnamed', 'recipientsNamed'],
    ['timing', 'after', 'shownBeforeTransfer'],
    ['roundingDisclosure', 'unstated', 'roundingStated'],
    ['netDisclosure', 'not-shown', 'netAmountShown'],
    ['changeNotice', 'none', 'changeTermsStated'],
  ];
  for (const [field, value, verdict] of breaks) {
    const v = checkFeeDisclosure({ ...complete(), [field]: value });
    assert.equal(v.verdicts[verdict], false, `${field}=${value}`);
    assert.equal(v.valid, false, `${field}=${value}`);
    for (const [other] of FEE_DISCLOSURE_VERDICTS) if (other !== verdict) assert.equal(v.verdicts[other], true, `${field}=${value} should not fail ${other}`);
  }
});

test('refused: an unknown field — the profile names only its seven fields', () => {
  assert.throws(() => checkFeeDisclosure({ ...complete(), feeAmount: '10' }), /unknown field/);
});

test('refused: a missing field — a profile that cannot be read in full is never scored in part', () => {
  const { timing, ...rest } = complete();
  assert.throws(() => checkFeeDisclosure(rest), /missing its "timing" field/);
});

test('refused: an unknown enum value names the allowed set', () => {
  assert.throws(() => checkFeeDisclosure({ ...complete(), timing: 'eventually' }), /must be one of before-confirm, after, never/);
});

test('refused: a fixed fee naming a change notice — a fee that never changes has no changes to announce', () => {
  assert.throws(() => checkFeeDisclosure({ ...complete(), feeChanges: 'fixed', changeNotice: 'advance' }), /fixed fee names a change notice/);
});

test('refused: a changeable fee naming its notice not-applicable', () => {
  assert.throws(() => checkFeeDisclosure({ ...complete(), changeNotice: 'not-applicable' }), /changeable fee names its change notice not-applicable/);
});

test('refused: a non-object profile', () => {
  assert.throws(() => checkFeeDisclosure(null), /must be an object/);
  assert.throws(() => checkFeeDisclosure(['exact']), /must be an object/);
});
