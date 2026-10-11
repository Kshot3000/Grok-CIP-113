import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkDelegateLogicExecution } from '../src/domain.js';

// Delegate logic execution: the execution half of the two delegate
// actions the paired-outputs checker states it does not judge — the
// action's logic credential must appear in the transaction's
// withdrawals (delegate validation step 3), an empty unfracking
// credential forbids the action outright, and the holder must
// authorise an unfracking while a third-party action bypasses holder
// authorization with no verdict (spec: ThirdPartyAct / UnfrackingAct
// constructors and delegate validation steps 1 and 3, re-read
// 2026-10-10).
const LOGIC = 'ee'.repeat(28);
const OTHER_SCRIPT = 'ff'.repeat(28);
const HOLDER_KEY = 'aa'.repeat(28);
const HOLDER_SCRIPT = 'bb'.repeat(28);
const STRANGER = '99'.repeat(28);

const conformingUnfracking = () => ({
  action: 'unfracking',
  logicCredential: { kind: 'script', hash: LOGIC },
  withdrawals: [{ kind: 'script', hash: LOGIC }],
  holderCredential: { kind: 'pubkey', hash: HOLDER_KEY },
  signers: [HOLDER_KEY],
});

test('a conforming unfracking passes both positions: logic executed, holder signed', () => {
  const v = checkDelegateLogicExecution(conformingUnfracking());
  assert.equal(v.status, 'conforming');
  assert.equal(v.valid, true);
  assert.deepEqual(v.verdicts, { logicExecution: true, holderAuthorization: true });
  assert.equal(v.logicMode, 'script');
  assert.equal(v.logicForbidden, false);
  assert.equal(v.logicInWithdrawals, true);
  assert.equal(v.holderMode, 'signature');
  assert.equal(v.holderAuthorized, true);
});

test('the same execution claim conforms as a third-party action, holder authorization bypassed with no verdict', () => {
  const claim = conformingUnfracking();
  claim.action = 'third-party';
  claim.holderCredential = null;
  claim.signers = [];
  const v = checkDelegateLogicExecution(claim);
  assert.equal(v.valid, true);
  assert.equal(v.verdicts.logicExecution, true);
  assert.equal(v.verdicts.holderAuthorization, null);
  assert.equal(v.holderMode, 'bypassed');
  assert.equal(v.holderAuthorized, null);
});

test('a third-party claim with an unauthorising holder still conforms — the bypass is the spec, not an oversight', () => {
  const claim = conformingUnfracking();
  claim.action = 'third-party';
  claim.signers = [STRANGER];
  const v = checkDelegateLogicExecution(claim);
  assert.equal(v.valid, true);
  assert.equal(v.verdicts.holderAuthorization, null);
});

test('a logic credential absent from the withdrawals fails only the execution position', () => {
  const claim = conformingUnfracking();
  claim.withdrawals = [{ kind: 'script', hash: OTHER_SCRIPT }];
  const v = checkDelegateLogicExecution(claim);
  assert.equal(v.valid, false);
  assert.equal(v.status, 'not-conforming');
  assert.equal(v.verdicts.logicExecution, false);
  assert.equal(v.verdicts.holderAuthorization, true);
  assert.equal(v.logicInWithdrawals, false);
});

test('a withdrawal under the same hash but the other kind does not execute the logic script', () => {
  const claim = conformingUnfracking();
  claim.withdrawals = [{ kind: 'pubkey', hash: LOGIC }];
  const v = checkDelegateLogicExecution(claim);
  assert.equal(v.verdicts.logicExecution, false);
});

test('hex case is canonicalised: an uppercase withdrawal still names the logic credential', () => {
  const claim = conformingUnfracking();
  claim.withdrawals = [{ kind: 'script', hash: LOGIC.toUpperCase() }];
  const v = checkDelegateLogicExecution(claim);
  assert.equal(v.verdicts.logicExecution, true);
  assert.equal(v.withdrawals[0].hash, LOGIC);
});

test('an empty public-key unfracking credential forbids the action: no withdrawal list can satisfy it', () => {
  const claim = conformingUnfracking();
  claim.logicCredential = { kind: 'pubkey', hash: '' };
  claim.withdrawals = [{ kind: 'script', hash: LOGIC }, { kind: 'script', hash: HOLDER_SCRIPT }];
  const v = checkDelegateLogicExecution(claim);
  assert.equal(v.logicMode, 'none');
  assert.equal(v.logicForbidden, true);
  assert.equal(v.logicInWithdrawals, false);
  assert.equal(v.verdicts.logicExecution, false);
  assert.equal(v.valid, false);
});

test('an empty third-party logic credential also fails execution, but carries no forbidden reading', () => {
  const claim = conformingUnfracking();
  claim.action = 'third-party';
  claim.logicCredential = { kind: 'pubkey', hash: '' };
  const v = checkDelegateLogicExecution(claim);
  assert.equal(v.logicMode, 'none');
  assert.equal(v.logicForbidden, false);
  assert.equal(v.verdicts.logicExecution, false);
  assert.equal(v.valid, false);
});

test('a public-key logic credential is executed by its own withdraw-zero entry', () => {
  const claim = conformingUnfracking();
  claim.action = 'third-party';
  claim.logicCredential = { kind: 'pubkey', hash: OTHER_SCRIPT };
  claim.withdrawals = [{ kind: 'pubkey', hash: OTHER_SCRIPT }];
  const v = checkDelegateLogicExecution(claim);
  assert.equal(v.logicMode, 'pubkey');
  assert.equal(v.verdicts.logicExecution, true);
  assert.equal(v.valid, true);
});

test('an unfracking holder who did not sign fails only the authorization position', () => {
  const claim = conformingUnfracking();
  claim.signers = [STRANGER];
  const v = checkDelegateLogicExecution(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.logicExecution, true);
  assert.equal(v.verdicts.holderAuthorization, false);
  assert.equal(v.holderAuthorized, false);
});

test('a script holder authorises by execution: its credential among the withdrawals', () => {
  const claim = conformingUnfracking();
  claim.holderCredential = { kind: 'script', hash: HOLDER_SCRIPT };
  claim.signers = [];
  claim.withdrawals = [{ kind: 'script', hash: LOGIC }, { kind: 'script', hash: HOLDER_SCRIPT }];
  const v = checkDelegateLogicExecution(claim);
  assert.equal(v.holderMode, 'script-execution');
  assert.equal(v.holderAuthorized, true);
  assert.equal(v.valid, true);
  claim.withdrawals = [{ kind: 'script', hash: LOGIC }];
  const v2 = checkDelegateLogicExecution(claim);
  assert.equal(v2.holderAuthorized, false);
  assert.equal(v2.verdicts.logicExecution, true);
});

test('an unfracking with no holder named authorises nothing', () => {
  const claim = conformingUnfracking();
  claim.holderCredential = null;
  const v = checkDelegateLogicExecution(claim);
  assert.equal(v.holderMode, 'none');
  assert.equal(v.holderAuthorized, false);
  assert.equal(v.verdicts.holderAuthorization, false);
  assert.equal(v.valid, false);
});

test('refusal discipline: unknown action, unknown or missing field, malformed credentials are refused, never scored', () => {
  assert.throws(() => checkDelegateLogicExecution({ ...conformingUnfracking(), action: 'transfer' }), /third-party or unfracking/);
  assert.throws(() => checkDelegateLogicExecution({ ...conformingUnfracking(), extra: 1 }), /unknown field/);
  const missing = conformingUnfracking();
  delete missing.signers;
  assert.throws(() => checkDelegateLogicExecution(missing), /missing its "signers"/);
  assert.throws(() => checkDelegateLogicExecution({ ...conformingUnfracking(), logicCredential: { kind: 'script', hash: 'abcd' } }), /empty or 28 bytes/);
  assert.throws(() => checkDelegateLogicExecution({ ...conformingUnfracking(), logicCredential: { kind: 'native', hash: LOGIC } }), /pubkey or script/);
  assert.throws(() => checkDelegateLogicExecution({ ...conformingUnfracking(), holderCredential: { kind: 'pubkey', hash: '' } }), /28-byte/);
});

test('refusal discipline: a duplicated withdrawal or signer is refused, never scored in part', () => {
  const claim = conformingUnfracking();
  claim.withdrawals = [{ kind: 'script', hash: LOGIC }, { kind: 'script', hash: LOGIC }];
  assert.throws(() => checkDelegateLogicExecution(claim), /more than once/);
  const claim2 = conformingUnfracking();
  claim2.signers = [HOLDER_KEY, HOLDER_KEY.toUpperCase()];
  assert.throws(() => checkDelegateLogicExecution(claim2), /more than once/);
  const claim3 = conformingUnfracking();
  claim3.signers = ['abcd'];
  assert.throws(() => checkDelegateLogicExecution(claim3), /28-byte/);
});

test('the checker does not mutate its claim', () => {
  const claim = conformingUnfracking();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkDelegateLogicExecution(claim);
  assert.deepEqual(claim, snapshot);
});

test('app wires the logic-execution checker: panel, verdicts, honest boundary, v1.106', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkDelegateLogicExecution/);
  assert.match(app, /logic-execution-action/);
  assert.match(app, /LOGIC EXECUTION · LOCAL MODEL/);
  assert.match(app, /FORBIDDEN/);
  assert.match(app, /v1\.106/);
});
