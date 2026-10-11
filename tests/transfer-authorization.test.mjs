import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkTransferAuthorization } from '../src/domain.js';

// TransferAct authorization and logic execution: the transfer
// delegate's two non-value requirements, which the output-value
// family states it does not judge — every UTxO spent from
// programmableLogicBase authorised by its own stake credential
// (signature for a public key, execution for a script), and each
// registered token's transfer_logic_script executed via withdraw-zero,
// while a policy proven not registered is an ordinary native token
// with NO verdict (spec: delegate validation steps 1 and 3 and the
// TransferAct constructor, re-read 2026-10-10).
const KEY_HOLDER = 'aa'.repeat(28);
const SCRIPT_HOLDER = 'bb'.repeat(28);
const POLICY = 'cc'.repeat(28);
const UNREGISTERED = 'dd'.repeat(28);
const TRANSFER_SCRIPT = 'ee'.repeat(28);
const OTHER_SCRIPT = 'ff'.repeat(28);
const STRANGER = '99'.repeat(28);

const conforming = () => ({
  spentStakeCredentials: [
    { kind: 'pubkey', hash: KEY_HOLDER },
    { kind: 'script', hash: SCRIPT_HOLDER },
  ],
  tokens: [
    { policy: POLICY, registered: true, transferCredential: { kind: 'script', hash: TRANSFER_SCRIPT } },
    { policy: UNREGISTERED, registered: false, transferCredential: null },
  ],
  withdrawals: [
    { kind: 'script', hash: TRANSFER_SCRIPT },
    { kind: 'script', hash: SCRIPT_HOLDER },
  ],
  signers: [KEY_HOLDER],
});

test('a conforming transfer passes both positions: every input authorised, registered logic executed, unregistered token verdictless', () => {
  const v = checkTransferAuthorization(conforming());
  assert.equal(v.status, 'conforming');
  assert.equal(v.valid, true);
  assert.deepEqual(v.verdicts, { holderAuthorization: true, logicExecution: true });
  assert.equal(v.spentInputs[0].mode, 'signature');
  assert.equal(v.spentInputs[0].authorized, true);
  assert.equal(v.spentInputs[1].mode, 'script-execution');
  assert.equal(v.spentInputs[1].authorized, true);
  assert.equal(v.tokens[0].executed, true);
  assert.equal(v.tokens[1].executed, null);
  assert.equal(v.tokens[1].mode, 'not-required');
  assert.equal(v.registeredCount, 1);
  assert.equal(v.unregisteredCount, 1);
});

test('one unauthorised spent input fails only the authorization position, and names that input', () => {
  const claim = conforming();
  claim.signers = [STRANGER];
  const v = checkTransferAuthorization(claim);
  assert.equal(v.valid, false);
  assert.equal(v.status, 'not-conforming');
  assert.equal(v.verdicts.holderAuthorization, false);
  assert.equal(v.verdicts.logicExecution, true);
  assert.equal(v.spentInputs[0].authorized, false);
  assert.equal(v.spentInputs[1].authorized, true);
});

test('a script stake credential that is not executed authorises nothing, however many signers signed', () => {
  const claim = conforming();
  claim.withdrawals = [{ kind: 'script', hash: TRANSFER_SCRIPT }];
  claim.signers = [KEY_HOLDER, SCRIPT_HOLDER, STRANGER];
  const v = checkTransferAuthorization(claim);
  assert.equal(v.spentInputs[1].authorized, false);
  assert.equal(v.verdicts.holderAuthorization, false);
  assert.equal(v.verdicts.logicExecution, true);
});

test('a registered token whose transfer logic is absent from the withdrawals fails only the execution position', () => {
  const claim = conforming();
  claim.withdrawals = [
    { kind: 'script', hash: OTHER_SCRIPT },
    { kind: 'script', hash: SCRIPT_HOLDER },
  ];
  const v = checkTransferAuthorization(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.logicExecution, false);
  assert.equal(v.verdicts.holderAuthorization, true);
  assert.equal(v.tokens[0].executed, false);
  assert.equal(v.tokens[0].inWithdrawals, false);
});

test('a withdrawal under the same hash but the other kind executes nothing', () => {
  const claim = conforming();
  claim.withdrawals = [
    { kind: 'pubkey', hash: TRANSFER_SCRIPT },
    { kind: 'script', hash: SCRIPT_HOLDER },
  ];
  const v = checkTransferAuthorization(claim);
  assert.equal(v.verdicts.logicExecution, false);
});

test('an unregistered token with a credential entered is reported, never judged — its absence from the withdrawals costs nothing', () => {
  const claim = conforming();
  claim.tokens[1].transferCredential = { kind: 'script', hash: OTHER_SCRIPT };
  const v = checkTransferAuthorization(claim);
  assert.equal(v.valid, true);
  assert.equal(v.tokens[1].executed, null);
  assert.equal(v.tokens[1].inWithdrawals, false);
  assert.equal(v.verdicts.logicExecution, true);
});

test('with no registered token modeled, the logic position carries no verdict and authorization alone decides', () => {
  const claim = conforming();
  claim.tokens = [{ policy: UNREGISTERED, registered: false, transferCredential: null }];
  const v = checkTransferAuthorization(claim);
  assert.equal(v.verdicts.logicExecution, null);
  assert.equal(v.valid, true);
  claim.signers = [];
  const v2 = checkTransferAuthorization(claim);
  assert.equal(v2.verdicts.logicExecution, null);
  assert.equal(v2.valid, false);
});

test('a registered token whose transfer credential names nothing fails execution outright, with no forbidden reading invented', () => {
  const claim = conforming();
  claim.tokens[0].transferCredential = { kind: 'pubkey', hash: '' };
  const v = checkTransferAuthorization(claim);
  assert.equal(v.tokens[0].mode, 'none');
  assert.equal(v.tokens[0].executed, false);
  assert.equal(v.verdicts.logicExecution, false);
  assert.equal(v.valid, false);
});

test('a public-key transfer credential is executed by its own withdraw-zero entry', () => {
  const claim = conforming();
  claim.tokens[0].transferCredential = { kind: 'pubkey', hash: OTHER_SCRIPT };
  claim.withdrawals = [
    { kind: 'pubkey', hash: OTHER_SCRIPT },
    { kind: 'script', hash: SCRIPT_HOLDER },
  ];
  const v = checkTransferAuthorization(claim);
  assert.equal(v.tokens[0].mode, 'pubkey');
  assert.equal(v.verdicts.logicExecution, true);
  assert.equal(v.valid, true);
});

test('two registered tokens are judged separately: one executed, one not, fails the aggregate', () => {
  const claim = conforming();
  claim.tokens.push({ policy: STRANGER, registered: true, transferCredential: { kind: 'script', hash: OTHER_SCRIPT } });
  const v = checkTransferAuthorization(claim);
  assert.equal(v.tokens[0].executed, true);
  assert.equal(v.tokens[2].executed, false);
  assert.equal(v.verdicts.logicExecution, false);
  assert.equal(v.registeredCount, 2);
});

test('hex case is canonicalised: uppercase withdrawals and signers still name the same credentials', () => {
  const claim = conforming();
  claim.withdrawals = [
    { kind: 'script', hash: TRANSFER_SCRIPT.toUpperCase() },
    { kind: 'script', hash: SCRIPT_HOLDER.toUpperCase() },
  ];
  claim.signers = [KEY_HOLDER.toUpperCase()];
  const v = checkTransferAuthorization(claim);
  assert.equal(v.valid, true);
  assert.equal(v.withdrawals[0].hash, TRANSFER_SCRIPT);
  assert.equal(v.signers[0], KEY_HOLDER);
});

test('refusal discipline: unknown or missing field, empty spent list, malformed credentials are refused, never scored', () => {
  assert.throws(() => checkTransferAuthorization({ ...conforming(), extra: 1 }), /unknown field/);
  const missing = conforming();
  delete missing.signers;
  assert.throws(() => checkTransferAuthorization(missing), /missing its "signers"/);
  assert.throws(() => checkTransferAuthorization({ ...conforming(), spentStakeCredentials: [] }), /non-empty list/);
  assert.throws(() => checkTransferAuthorization({ ...conforming(), spentStakeCredentials: [{ kind: 'pubkey', hash: '' }] }), /28-byte/);
  assert.throws(() => checkTransferAuthorization({ ...conforming(), spentStakeCredentials: [{ kind: 'native', hash: KEY_HOLDER }] }), /pubkey or script/);
});

test('refusal discipline: a registered token naming no credential, a non-boolean flag, and a duplicated policy are refused', () => {
  const noCred = conforming();
  noCred.tokens[0].transferCredential = null;
  assert.throws(() => checkTransferAuthorization(noCred), /names no transfer credential/);
  const badFlag = conforming();
  badFlag.tokens[0].registered = 'yes';
  assert.throws(() => checkTransferAuthorization(badFlag), /must be a boolean/);
  const dup = conforming();
  dup.tokens.push({ policy: POLICY.toUpperCase(), registered: false, transferCredential: null });
  assert.throws(() => checkTransferAuthorization(dup), /more than once/);
  const unknownField = conforming();
  unknownField.tokens[0].extra = 1;
  assert.throws(() => checkTransferAuthorization(unknownField), /unknown field/);
});

test('refusal discipline: a duplicated withdrawal or signer is refused, never scored in part', () => {
  const claim = conforming();
  claim.withdrawals = [
    { kind: 'script', hash: TRANSFER_SCRIPT },
    { kind: 'script', hash: TRANSFER_SCRIPT },
  ];
  assert.throws(() => checkTransferAuthorization(claim), /more than once/);
  const claim2 = conforming();
  claim2.signers = [KEY_HOLDER, KEY_HOLDER.toUpperCase()];
  assert.throws(() => checkTransferAuthorization(claim2), /more than once/);
});

test('the checker does not mutate its claim', () => {
  const claim = conforming();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkTransferAuthorization(claim);
  assert.deepEqual(claim, snapshot);
});

test('app wires the transfer authorization checker: panel, verdicts, honest boundary, v1.107', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkTransferAuthorization/);
  assert.match(app, /transfer-auth-spent/);
  assert.match(app, /TRANSFER AUTHORIZATION · LOCAL MODEL/);
  assert.match(app, /NO VERDICT/);
  assert.match(app, /v1\.107/);
});
