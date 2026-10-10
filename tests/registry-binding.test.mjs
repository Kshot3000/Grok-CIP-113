import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveIssuancePolicyId, checkRegistryInsertBinding } from '../src/domain.js';

// The RegistryInsert binding: the half of registration the insertion
// planner/verifier state they do not judge — the redeemer's minting
// logic credential and its cryptographic binding to the key (spec:
// "Registry redeemer and the binding of policy to logic"; reference:
// registry.ak RegistryInsert + lib/utils.ak apply_hashed_parameter).
//
// The fixtures are the Foundation reference's OWN registry test
// fixtures (validators/registry.test.ak, re-read 2026-10-10): template
// prefix #0102, postfix #0304, hashed_param #ee…ee (the inner hash of
// its Script minting-logic credential). The pinned policy below is
// what the reference's apply_hashed_parameter computes for them —
// Blake2b-224 of 0x03 ‖ prefix ‖ param ‖ postfix — reproduced here by
// PRISM's own derivation, so the suite pins PRISM to the reference's
// construction, not to a paraphrase of it.
const PREFIX = '0102', POSTFIX = '0304';
const PARAM = 'ee'.repeat(28);
const POLICY = '69bfdc13cf505bf70947baaf61b3ed99932179444f76b9f570ba74be';
const SCRIPT_CRED = { kind: 'script', hash: PARAM };
const OTHER_CRED = { kind: 'script', hash: 'ff'.repeat(28) };
const KEY_CRED = { kind: 'pubkey', hash: '99'.repeat(28) };

const boundClaim = () => ({
  key: POLICY,
  mintingLogic: { ...SCRIPT_CRED },
  datumMintingLogic: { ...SCRIPT_CRED },
  withdrawals: [{ ...KEY_CRED }, { ...SCRIPT_CRED }],
  issuancePrefix: PREFIX,
  issuancePostfix: POSTFIX,
});

test('the derivation reproduces the reference construction on its own fixtures', () => {
  const d = deriveIssuancePolicyId(PREFIX, POSTFIX, SCRIPT_CRED);
  assert.equal(d.policyId, POLICY);
  assert.equal(d.policyId.length, 56);
  assert.deepEqual(Object.keys(d), ['policyId', 'mintingLogic', 'paramHash', 'prefix', 'postfix', 'scriptByteLength']);
  assert.equal(d.paramHash, PARAM);
  assert.equal(d.scriptByteLength, 1 + 2 + 28 + 2);
});

test('the derivation is sensitive to the parameter, the prefix, and the postfix', () => {
  assert.equal(deriveIssuancePolicyId(PREFIX, POSTFIX, OTHER_CRED).policyId, '3c6ef45771041c4e5da1c7548507eb28d2fb3c84c6c49e8c45aef2fa');
  assert.equal(deriveIssuancePolicyId(POSTFIX, PREFIX, SCRIPT_CRED).policyId, '54dd8d57355d92a8ed9df332c2796799dccd74bcddd0fc7202d49bed');
  assert.notEqual(deriveIssuancePolicyId(PREFIX, '0305', SCRIPT_CRED).policyId, POLICY);
  assert.notEqual(deriveIssuancePolicyId('0103', POSTFIX, SCRIPT_CRED).policyId, POLICY);
});

test('an empty prefix or postfix is template data, not a refusal', () => {
  const d = deriveIssuancePolicyId('', '', SCRIPT_CRED);
  assert.equal(d.policyId, '715dd7e4d0d09c7201898c8f117112cacba8b02735010394fb7d2269');
  assert.equal(d.scriptByteLength, 29);
});

test('the derivation refuses a public-key credential — there is no policy to derive', () => {
  assert.throws(() => deriveIssuancePolicyId(PREFIX, POSTFIX, KEY_CRED), /script minting logic credential/);
});

test('the derivation refuses malformed credentials and template bytes', () => {
  assert.throws(() => deriveIssuancePolicyId(PREFIX, POSTFIX, { kind: 'script', hash: 'ee'.repeat(27) }), /28 bytes/);
  assert.throws(() => deriveIssuancePolicyId(PREFIX, POSTFIX, { kind: 'other', hash: PARAM }), /kind must be pubkey or script/);
  assert.throws(() => deriveIssuancePolicyId(PREFIX, POSTFIX, { hash: PARAM }), /both a kind/);
  assert.throws(() => deriveIssuancePolicyId(PREFIX, POSTFIX, { kind: 'script', hash: PARAM, extra: 1 }), /unknown field/);
  assert.throws(() => deriveIssuancePolicyId('010', POSTFIX, SCRIPT_CRED), /even number of hexadecimal/);
  assert.throws(() => deriveIssuancePolicyId('zz', POSTFIX, SCRIPT_CRED), /even number of hexadecimal/);
  assert.throws(() => deriveIssuancePolicyId(12, POSTFIX, SCRIPT_CRED), /hexadecimal string/);
});

test('a fully bound registration claim verifies on all three positions', () => {
  const v = checkRegistryInsertBinding(boundClaim());
  assert.equal(v.status, 'bound');
  assert.equal(v.valid, true);
  assert.deepEqual(v.verdicts, { datumMatchesRedeemer: true, policyBinding: true, mintingLogicInvoked: true });
  assert.equal(v.expectedPolicyId, POLICY);
  assert.equal(v.key, POLICY);
});

test('a datum credential differing from the redeemer fails only the datum position', () => {
  const byHash = checkRegistryInsertBinding({ ...boundClaim(), datumMintingLogic: { ...OTHER_CRED } });
  assert.deepEqual(byHash.verdicts, { datumMatchesRedeemer: false, policyBinding: true, mintingLogicInvoked: true });
  assert.equal(byHash.valid, false);
  const byKind = checkRegistryInsertBinding({ ...boundClaim(), datumMintingLogic: { kind: 'pubkey', hash: PARAM } });
  assert.equal(byKind.verdicts.datumMatchesRedeemer, false);
  assert.equal(byKind.verdicts.policyBinding, true);
});

test('a key the template does not derive fails only the binding position, naming the expected policy', () => {
  const v = checkRegistryInsertBinding({ ...boundClaim(), key: '3c6ef45771041c4e5da1c7548507eb28d2fb3c84c6c49e8c45aef2fa' });
  assert.deepEqual(v.verdicts, { datumMatchesRedeemer: true, policyBinding: false, mintingLogicInvoked: true });
  assert.equal(v.expectedPolicyId, POLICY);
});

test('a registration that never invokes its minting logic fails only the invocation position', () => {
  const absent = checkRegistryInsertBinding({ ...boundClaim(), withdrawals: [{ ...KEY_CRED }] });
  assert.deepEqual(absent.verdicts, { datumMatchesRedeemer: true, policyBinding: true, mintingLogicInvoked: false });
  const empty = checkRegistryInsertBinding({ ...boundClaim(), withdrawals: [] });
  assert.equal(empty.verdicts.mintingLogicInvoked, false);
  // Kind is part of the credential: a public-key withdrawal of the same
  // hash is a different reward account and does not invoke the script.
  const wrongKind = checkRegistryInsertBinding({ ...boundClaim(), withdrawals: [{ kind: 'pubkey', hash: PARAM }] });
  assert.equal(wrongKind.verdicts.mintingLogicInvoked, false);
});

test('a public-key minting logic credential cannot bind — no expected policy is derived or invented', () => {
  const claim = boundClaim();
  claim.mintingLogic = { kind: 'pubkey', hash: PARAM };
  claim.datumMintingLogic = { kind: 'pubkey', hash: PARAM };
  claim.withdrawals = [{ kind: 'pubkey', hash: PARAM }];
  const v = checkRegistryInsertBinding(claim);
  assert.equal(v.expectedPolicyId, null);
  assert.deepEqual(v.verdicts, { datumMatchesRedeemer: true, policyBinding: false, mintingLogicInvoked: true });
  assert.equal(v.status, 'not-bound');
});

test('uppercase hex verifies and is stated in canonical lowercase', () => {
  const claim = boundClaim();
  claim.key = claim.key.toUpperCase();
  claim.mintingLogic = { kind: 'script', hash: PARAM.toUpperCase() };
  claim.datumMintingLogic = { kind: 'script', hash: PARAM.toUpperCase() };
  claim.withdrawals = [{ kind: 'script', hash: PARAM.toUpperCase() }];
  const v = checkRegistryInsertBinding(claim);
  assert.equal(v.valid, true);
  assert.equal(v.key, POLICY);
  assert.equal(v.mintingLogic.hash, PARAM);
});

test('a malformed binding claim is refused, never scored in part', () => {
  assert.throws(() => checkRegistryInsertBinding(null), /must be an object/);
  assert.throws(() => checkRegistryInsertBinding({ ...boundClaim(), key: 'abcd' }), /28-byte policy ID/);
  assert.throws(() => checkRegistryInsertBinding({ ...boundClaim(), nft: 'x' }), /unknown field/);
  const missing = boundClaim(); delete missing.withdrawals;
  assert.throws(() => checkRegistryInsertBinding(missing), /missing its "withdrawals"/);
  assert.throws(() => checkRegistryInsertBinding({ ...boundClaim(), withdrawals: 'script' }), /must be a list/);
  assert.throws(() => checkRegistryInsertBinding({ ...boundClaim(), withdrawals: [{ ...SCRIPT_CRED }, { ...SCRIPT_CRED }] }), /twice/);
  assert.throws(() => checkRegistryInsertBinding({ ...boundClaim(), issuancePostfix: '030' }), /even number of hexadecimal/);
  assert.throws(() => checkRegistryInsertBinding({ ...boundClaim(), datumMintingLogic: { kind: 'script', hash: 'ee'.repeat(29) } }), /28 bytes/);
});

test('checking does not mutate the claim', () => {
  const claim = boundClaim();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkRegistryInsertBinding(claim);
  assert.deepEqual(claim, snapshot);
});
