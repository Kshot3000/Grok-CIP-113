import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkDelegateRegistryNode } from '../src/domain.js';

// Delegate RegistryNode resolution: the configuration half the
// logic-execution checker states it does not judge — the delegate
// redeemers' registry_node_idx must resolve, among the transaction's
// reference inputs, to the RegistryNode that carries the acted-on
// policy, and that node's field for the action must be the logic
// credential claimed (spec: ThirdPartyAct / UnfrackingAct
// constructors, delegate validation, and Reference Inputs, re-read
// 2026-10-10).
const POLICY = 'aa'.repeat(28);
const OTHER_POLICY = 'bb'.repeat(28);
const LOGIC = 'ee'.repeat(28);
const OTHER_SCRIPT = 'ff'.repeat(28);
const GLOBAL = 'cc'.repeat(28);

const node = (over = {}) => ({
  key: POLICY,
  thirdParty: { kind: 'script', hash: LOGIC },
  unfracking: { kind: 'script', hash: LOGIC },
  globalStateCs: '',
  ...over,
});

const conforming = () => ({
  action: 'unfracking',
  policy: POLICY,
  registryNodeIdx: 1,
  logicCredential: { kind: 'script', hash: LOGIC },
  nodes: [null, node()],
  globalStatePolicies: [],
});

test('a conforming claim passes every judged position: the hint resolves to the node carrying the policy and its credential', () => {
  const v = checkDelegateRegistryNode(conforming());
  assert.equal(v.status, 'conforming');
  assert.equal(v.valid, true);
  assert.deepEqual(v.verdicts, { nodeResolves: true, nodeCarriesPolicy: true, logicCredentialMatches: true, globalStateReference: null });
  assert.equal(v.globalStateMode, 'none');
  assert.equal(v.logicForbidden, false);
  assert.deepEqual(v.nodeLogicCredential, { kind: 'script', hash: LOGIC });
  assert.equal(v.referenceCount, 2);
});

test('the same node conforms under a third-party action, judged against its third-party field', () => {
  const claim = conforming();
  claim.action = 'third-party';
  claim.nodes = [null, node({ unfracking: { kind: 'script', hash: OTHER_SCRIPT } })];
  const v = checkDelegateRegistryNode(claim);
  assert.equal(v.valid, true);
  assert.equal(v.verdicts.logicCredentialMatches, true);
  // And the unfracking reading of that same node fails on agreement alone.
  const claim2 = conforming();
  claim2.nodes = claim.nodes;
  const v2 = checkDelegateRegistryNode(claim2);
  assert.equal(v2.verdicts.logicCredentialMatches, false);
  assert.equal(v2.valid, false);
});

test('an index past the last reference input resolves to no node, and every later position is verdictless', () => {
  const claim = conforming();
  claim.registryNodeIdx = 5;
  const v = checkDelegateRegistryNode(claim);
  assert.equal(v.valid, false);
  assert.equal(v.status, 'not-conforming');
  assert.deepEqual(v.verdicts, { nodeResolves: false, nodeCarriesPolicy: null, logicCredentialMatches: null, globalStateReference: null });
  assert.equal(v.resolvedNode, null);
  assert.equal(v.nodeLogicCredential, null);
});

test('an index landing on a non-node reference input resolves to no node', () => {
  const claim = conforming();
  claim.registryNodeIdx = 0;
  const v = checkDelegateRegistryNode(claim);
  assert.equal(v.verdicts.nodeResolves, false);
  assert.equal(v.verdicts.nodeCarriesPolicy, null);
  assert.equal(v.valid, false);
});

test('a node for a different policy fails only the carries position; agreement with the wrong node is verdictless', () => {
  const claim = conforming();
  claim.nodes = [null, node({ key: OTHER_POLICY })];
  const v = checkDelegateRegistryNode(claim);
  assert.equal(v.verdicts.nodeResolves, true);
  assert.equal(v.verdicts.nodeCarriesPolicy, false);
  assert.equal(v.verdicts.logicCredentialMatches, null);
  assert.equal(v.verdicts.globalStateReference, null);
  assert.equal(v.globalStateMode, null);
  assert.equal(v.valid, false);
});

test('the canonical origin node at the hinted index is not the acted-on policy\u2019s node', () => {
  const claim = conforming();
  claim.nodes = [{
    key: '',
    thirdParty: { kind: 'pubkey', hash: '' },
    unfracking: { kind: 'pubkey', hash: '' },
    globalStateCs: '',
  }];
  claim.registryNodeIdx = 0;
  const v = checkDelegateRegistryNode(claim);
  assert.equal(v.verdicts.nodeResolves, true);
  assert.equal(v.verdicts.nodeCarriesPolicy, false);
  assert.equal(v.valid, false);
});

test('a claimed credential the node does not name fails only the agreement position', () => {
  const claim = conforming();
  claim.logicCredential = { kind: 'script', hash: OTHER_SCRIPT };
  const v = checkDelegateRegistryNode(claim);
  assert.equal(v.verdicts.nodeResolves, true);
  assert.equal(v.verdicts.nodeCarriesPolicy, true);
  assert.equal(v.verdicts.logicCredentialMatches, false);
  assert.equal(v.valid, false);
});

test('a credential matching the hash but not the kind does not agree with the node', () => {
  const claim = conforming();
  claim.logicCredential = { kind: 'pubkey', hash: LOGIC };
  const v = checkDelegateRegistryNode(claim);
  assert.equal(v.verdicts.logicCredentialMatches, false);
});

test('hex case is canonicalised: uppercase policy, key, and credential still resolve and agree', () => {
  const claim = conforming();
  claim.policy = POLICY.toUpperCase();
  claim.nodes = [null, node({ key: POLICY.toUpperCase() })];
  claim.logicCredential = { kind: 'script', hash: LOGIC.toUpperCase() };
  const v = checkDelegateRegistryNode(claim);
  assert.equal(v.valid, true);
  assert.equal(v.policy, POLICY);
  assert.equal(v.resolvedNode.key, POLICY);
});

test('a node with global state passes when a reference input carries that NFT policy, and fails only there when none does', () => {
  const claim = conforming();
  claim.nodes = [null, node({ globalStateCs: GLOBAL })];
  claim.globalStatePolicies = [GLOBAL];
  const v = checkDelegateRegistryNode(claim);
  assert.equal(v.globalStateMode, 'present');
  assert.equal(v.verdicts.globalStateReference, true);
  assert.equal(v.valid, true);
  claim.globalStatePolicies = [OTHER_POLICY];
  const v2 = checkDelegateRegistryNode(claim);
  assert.equal(v2.verdicts.globalStateReference, false);
  assert.equal(v2.verdicts.logicCredentialMatches, true);
  assert.equal(v2.valid, false);
});

test('an unfracking node whose field is the empty public-key credential forbids the action even when the claim matches it exactly', () => {
  const claim = conforming();
  claim.nodes = [null, node({ unfracking: { kind: 'pubkey', hash: '' } })];
  claim.logicCredential = { kind: 'pubkey', hash: '' };
  const v = checkDelegateRegistryNode(claim);
  assert.equal(v.verdicts.logicCredentialMatches, true);
  assert.equal(v.logicForbidden, true);
  assert.equal(v.valid, false);
  assert.equal(v.status, 'not-conforming');
});

test('an empty third-party field carries no forbidden reading: agreement alone decides', () => {
  const claim = conforming();
  claim.action = 'third-party';
  claim.nodes = [null, node({ thirdParty: { kind: 'pubkey', hash: '' } })];
  claim.logicCredential = { kind: 'pubkey', hash: '' };
  const v = checkDelegateRegistryNode(claim);
  assert.equal(v.logicForbidden, false);
  assert.equal(v.verdicts.logicCredentialMatches, true);
  assert.equal(v.valid, true);
});

test('refusal discipline: unknown action, unknown or missing field, malformed policy or index are refused, never scored', () => {
  assert.throws(() => checkDelegateRegistryNode({ ...conforming(), action: 'transfer' }), /third-party or unfracking/);
  assert.throws(() => checkDelegateRegistryNode({ ...conforming(), extra: 1 }), /unknown field/);
  const missing = conforming();
  delete missing.nodes;
  assert.throws(() => checkDelegateRegistryNode(missing), /missing its "nodes"/);
  assert.throws(() => checkDelegateRegistryNode({ ...conforming(), policy: 'abcd' }), /28-byte/);
  assert.throws(() => checkDelegateRegistryNode({ ...conforming(), registryNodeIdx: 1.5 }), /non-negative integer/);
  assert.throws(() => checkDelegateRegistryNode({ ...conforming(), registryNodeIdx: -1 }), /non-negative integer/);
  assert.throws(() => checkDelegateRegistryNode({ ...conforming(), logicCredential: { kind: 'native', hash: LOGIC } }), /pubkey or script/);
});

test('refusal discipline: a malformed node entry or a duplicated global-state policy is refused, never scored in part', () => {
  const badKey = conforming();
  badKey.nodes = [null, node({ key: 'abcd' })];
  assert.throws(() => checkDelegateRegistryNode(badKey), /empty \(the origin node/);
  const extraField = conforming();
  extraField.nodes = [null, { ...node(), minting: { kind: 'script', hash: LOGIC } }];
  assert.throws(() => checkDelegateRegistryNode(extraField), /unknown field/);
  const missingField = conforming();
  const partial = node();
  delete partial.unfracking;
  missingField.nodes = [null, partial];
  assert.throws(() => checkDelegateRegistryNode(missingField), /missing its "unfracking"/);
  const badGlobal = conforming();
  badGlobal.nodes = [null, node({ globalStateCs: 'abcd' })];
  assert.throws(() => checkDelegateRegistryNode(badGlobal), /global_state_cs must be empty or a 28-byte/);
  const dup = conforming();
  dup.globalStatePolicies = [GLOBAL, GLOBAL.toUpperCase()];
  assert.throws(() => checkDelegateRegistryNode(dup), /more than once/);
});

test('the checker does not mutate its claim', () => {
  const claim = conforming();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkDelegateRegistryNode(claim);
  assert.deepEqual(claim, snapshot);
});

test('app wires the registry-node checker: panel, verdicts, honest boundary, v1.106', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkDelegateRegistryNode/);
  assert.match(app, /registry-node-check-action/);
  assert.match(app, /REGISTRY NODE · LOCAL MODEL/);
  assert.match(app, /FORBIDDEN/);
  assert.match(app, /v1\.106/);
});
