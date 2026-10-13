import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkDelegateLogicExecution, diffDelegateLogicExecution, DELEGATE_LOGIC_EXECUTION_COMPARE_FIELDS } from '../src/domain.js';

// Delegate logic-execution impact (spec: delegate validation steps
// 1 and 3, re-read 2026-10-11): the logic credential is read from
// the RegistryNode the redeemer names, so an execution that
// conformed when modeled can be staled by a registry update
// re-pointing that node's logic field, or by assembly adding or
// dropping a withdrawal or a signer. Both versions are checked
// through checkDelegateLogicExecution itself, and four positions
// are compared: the status, the logic credential, the
// logic-execution verdict, and the holder-authorization verdict.
const LOGIC = 'ee'.repeat(28);
const NEW_LOGIC = 'ff'.repeat(28);
const OTHER = 'dd'.repeat(28);
const HOLDER_KEY = 'aa'.repeat(28);
const HOLDER_SCRIPT = 'bb'.repeat(28);
const STRANGER = '99'.repeat(28);

const conforming = () => ({
  action: 'unfracking',
  logicCredential: { kind: 'script', hash: LOGIC },
  withdrawals: [{ kind: 'script', hash: LOGIC }],
  holderCredential: { kind: 'pubkey', hash: HOLDER_KEY },
  signers: [HOLDER_KEY],
});

test('an unchanged execution compares as unchanged on all four positions', () => {
  const d = diffDelegateLogicExecution(conforming(), conforming());
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.equal(d.action, 'unfracking');
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.changedFields, []);
  assert.equal(d.changedCount, 0);
  assert.equal(d.positionCount, 4);
  assert.equal(d.holderCredentialChanged, false);
  assert.deepEqual(d.addedWithdrawals, []);
  assert.deepEqual(d.removedWithdrawals, []);
  assert.deepEqual(d.addedSigners, []);
  assert.deepEqual(d.removedSigners, []);
  assert.deepEqual([...DELEGATE_LOGIC_EXECUTION_COMPARE_FIELDS].map(f => f[0]), ['status', 'logicCredential', 'logicExecution', 'holderAuthorization']);
});

test('dropping the logic credential\u2019s withdrawal makes the execution BECAME NOT CONFORMING, on the status and logic-execution positions', () => {
  const after = conforming();
  after.withdrawals = [];
  const d = diffDelegateLogicExecution(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Logic execution']);
  assert.deepEqual(d.removedWithdrawals, [{ kind: 'script', hash: LOGIC }]);
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, false);
});

test('dropping the holder\u2019s signature makes an unfracking BECAME NOT CONFORMING on the holder-authorization position alone', () => {
  const after = conforming();
  after.signers = [];
  const d = diffDelegateLogicExecution(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Holder authorization']);
  assert.deepEqual(d.removedSigners, [HOLDER_KEY]);
  assert.equal(d.after.verdicts.logicExecution, true);
});

test('restoring the dropped withdrawal makes the execution BECAME CONFORMING', () => {
  const before = conforming();
  before.withdrawals = [];
  const d = diffDelegateLogicExecution(before, conforming());
  assert.equal(d.change, 'became-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Logic execution']);
  assert.deepEqual(d.addedWithdrawals, [{ kind: 'script', hash: LOGIC }]);
});

test('a registry update re-pointing the logic credential to a script the transaction also invokes is REQUIREMENT CHANGED: conforming on both sides, a different credential', () => {
  const after = conforming();
  after.logicCredential = { kind: 'script', hash: NEW_LOGIC };
  after.withdrawals = [{ kind: 'script', hash: NEW_LOGIC }];
  const d = diffDelegateLogicExecution(conforming(), after);
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.changedFields, ['Logic credential']);
  assert.deepEqual(d.differences[0].before, { kind: 'script', hash: LOGIC });
  assert.deepEqual(d.differences[0].after, { kind: 'script', hash: NEW_LOGIC });
  assert.deepEqual(d.addedWithdrawals, [{ kind: 'script', hash: NEW_LOGIC }]);
  assert.deepEqual(d.removedWithdrawals, [{ kind: 'script', hash: LOGIC }]);
});

test('re-pointing the logic credential to a script the transaction does not invoke is BECAME NOT CONFORMING \u2014 the conformance story takes precedence over the credential\u2019s move', () => {
  const after = conforming();
  after.logicCredential = { kind: 'script', hash: NEW_LOGIC };
  const d = diffDelegateLogicExecution(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Logic credential', 'Logic execution']);
});

test('an execution not conforming on both sides whose failing position changed underneath it is STILL NOT CONFORMING', () => {
  const before = conforming();
  before.withdrawals = [{ kind: 'script', hash: OTHER }];
  const after = conforming();
  after.signers = [STRANGER];
  const d = diffDelegateLogicExecution(before, after);
  assert.equal(d.change, 'still-not-conforming');
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, false);
  assert.deepEqual(d.changedFields, ['Logic execution', 'Holder authorization']);
  assert.equal(d.before.verdicts.logicExecution, false);
  assert.equal(d.before.verdicts.holderAuthorization, true);
  assert.equal(d.after.verdicts.logicExecution, true);
  assert.equal(d.after.verdicts.holderAuthorization, false);
});

test('fixing the forbidden shape \u2014 an empty public-key unfracking credential replaced by an executed script \u2014 is BECAME CONFORMING', () => {
  const before = conforming();
  before.logicCredential = { kind: 'pubkey', hash: '' };
  const d = diffDelegateLogicExecution(before, conforming());
  assert.equal(d.change, 'became-conforming');
  assert.equal(d.before.logicForbidden, true);
  assert.equal(d.after.logicForbidden, false);
  assert.deepEqual(d.changedFields, ['Status', 'Logic credential', 'Logic execution']);
});

test('a third-party holder change is reported, never counted: the position is bypassed on both sides (pinned)', () => {
  const before = { action: 'third-party', logicCredential: { kind: 'script', hash: LOGIC }, withdrawals: [{ kind: 'script', hash: LOGIC }], holderCredential: null, signers: [] };
  const after = { action: 'third-party', logicCredential: { kind: 'script', hash: LOGIC }, withdrawals: [{ kind: 'script', hash: LOGIC }], holderCredential: { kind: 'pubkey', hash: STRANGER }, signers: [STRANGER] };
  const d = diffDelegateLogicExecution(before, after);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.equal(d.holderCredentialChanged, true);
  assert.deepEqual(d.addedSigners, [STRANGER]);
  assert.equal(d.before.verdicts.holderAuthorization, null);
  assert.equal(d.after.verdicts.holderAuthorization, null);
});

test('an unfracking holder becoming a script that is not executed is BECAME NOT CONFORMING, with the credential change itself reported, never counted', () => {
  const after = conforming();
  after.holderCredential = { kind: 'script', hash: HOLDER_SCRIPT };
  const d = diffDelegateLogicExecution(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Holder authorization']);
  assert.equal(d.holderCredentialChanged, true);
  assert.equal(d.after.holderMode, 'script-execution');
});

test('an unrelated withdrawal and an extra signer joining change no position and are reported as the lists\u2019 own changes', () => {
  const after = conforming();
  after.withdrawals = [{ kind: 'script', hash: LOGIC }, { kind: 'script', hash: OTHER }];
  after.signers = [HOLDER_KEY, STRANGER];
  const d = diffDelegateLogicExecution(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.addedWithdrawals, [{ kind: 'script', hash: OTHER }]);
  assert.deepEqual(d.addedSigners, [STRANGER]);
  assert.deepEqual(d.removedWithdrawals, []);
  assert.deepEqual(d.removedSigners, []);
});

test('hex case alone is the same execution: uppercase hashes in the after version compare as unchanged', () => {
  const after = conforming();
  after.logicCredential = { kind: 'script', hash: LOGIC.toUpperCase() };
  after.withdrawals = [{ kind: 'script', hash: LOGIC.toUpperCase() }];
  after.signers = [HOLDER_KEY.toUpperCase()];
  const d = diffDelegateLogicExecution(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.holderCredentialChanged, false);
  assert.deepEqual(d.addedWithdrawals, []);
  assert.deepEqual(d.addedSigners, []);
});

test('a third-party execution compares under its own action: the holder position is no verdict on both sides and compares equal', () => {
  const before = { action: 'third-party', logicCredential: { kind: 'script', hash: LOGIC }, withdrawals: [{ kind: 'script', hash: LOGIC }], holderCredential: null, signers: [] };
  const after = { action: 'third-party', logicCredential: { kind: 'script', hash: NEW_LOGIC }, withdrawals: [{ kind: 'script', hash: NEW_LOGIC }], holderCredential: null, signers: [] };
  const d = diffDelegateLogicExecution(before, after);
  assert.equal(d.action, 'third-party');
  assert.equal(d.change, 'requirement-changed');
  assert.deepEqual(d.changedFields, ['Logic credential']);
});

test('refusal discipline: different actions are refused, and a version that cannot be read is refused on either side with the checker\u2019s reason, never compared around', () => {
  const otherAction = conforming();
  otherAction.action = 'third-party';
  assert.throws(() => diffDelegateLogicExecution(conforming(), otherAction), /declare different actions/);
  const badAfter = conforming();
  badAfter.withdrawals = [{ kind: 'script', hash: LOGIC }, { kind: 'script', hash: LOGIC }];
  assert.throws(() => diffDelegateLogicExecution(conforming(), badAfter), /more than once/);
  const badBefore = conforming();
  badBefore.logicCredential = { kind: 'script', hash: 'abcd' };
  assert.throws(() => diffDelegateLogicExecution(badBefore, conforming()), /empty or 28 bytes/);
  assert.throws(() => diffDelegateLogicExecution({ ...conforming(), extra: 1 }, conforming()), /unknown field/);
  const dupSigner = conforming();
  dupSigner.signers = [HOLDER_KEY, HOLDER_KEY];
  assert.throws(() => diffDelegateLogicExecution(conforming(), dupSigner), /more than once/);
});

test('the comparison does not mutate either claim, and its two sides are the checker\u2019s own verdicts', () => {
  const before = conforming();
  const after = conforming();
  after.withdrawals = [];
  const bSnap = JSON.parse(JSON.stringify(before));
  const aSnap = JSON.parse(JSON.stringify(after));
  const d = diffDelegateLogicExecution(before, after);
  assert.deepEqual(before, bSnap);
  assert.deepEqual(after, aSnap);
  assert.deepEqual(d.before, checkDelegateLogicExecution(bSnap));
  assert.deepEqual(d.after, checkDelegateLogicExecution(aSnap));
});

test('app wires the delegate logic-execution impact comparison: panel, verdicts, honest boundary, v1.146', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /diffDelegateLogicExecution/);
  assert.match(app, /logic-execution-diff-after-withdrawals/);
  assert.match(app, /logic-execution-diff-after-signers/);
  assert.match(app, /DELEGATE LOGIC EXECUTION IMPACT · LOCAL MODEL/);
  assert.match(app, /BECAME NOT CONFORMING/);
  assert.match(app, /REQUIREMENT CHANGED/);
  assert.match(app, /v1\.146/);
});
