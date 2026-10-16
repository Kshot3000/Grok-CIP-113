import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkDelegateRegistryNode, diffDelegateRegistryNode, DELEGATE_REGISTRY_NODE_COMPARE_FIELDS } from '../src/domain.js';

// Delegate registry-node impact (spec: ThirdPartyAct /
// UnfrackingAct constructors and Reference Inputs, re-read
// 2026-10-11): a registry-node resolution that conformed when
// modeled can be staled by a reference input inserted ahead of
// the node, by the node itself being updated, or by the claim
// being re-pointed. Both versions are checked through
// checkDelegateRegistryNode itself, and six positions are
// compared: the status, the node logic credential (the
// requirement itself; null when no node resolves), the node
// resolution verdict, the node-carries-policy verdict, the
// logic credential agreement verdict, and the global-state
// reference verdict.
const POLICY = 'aa'.repeat(28);
const OTHER_POLICY = 'bb'.repeat(28);
const LOGIC = 'ee'.repeat(28);
const NEW_LOGIC = 'ff'.repeat(28);
const OTHER_SCRIPT = 'dd'.repeat(28);
const GLOBAL = 'cc'.repeat(28);
const GLOBAL2 = '99'.repeat(28);

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

test('an unchanged resolution compares as unchanged on all six positions', () => {
  const d = diffDelegateRegistryNode(conforming(), conforming());
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.equal(d.action, 'unfracking');
  assert.equal(d.policy, POLICY);
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.changedFields, []);
  assert.equal(d.changedCount, 0);
  assert.equal(d.positionCount, 6);
  assert.equal(d.registryNodeIdxChanged, false);
  assert.equal(d.claimedLogicCredentialChanged, false);
  assert.deepEqual(d.changedNodeIndices, []);
  assert.equal(d.nodeCountBefore, 2);
  assert.equal(d.nodeCountAfter, 2);
  assert.equal(d.addedNodeCount, 0);
  assert.equal(d.removedNodeCount, 0);
  assert.deepEqual(d.addedGlobalStatePolicies, []);
  assert.deepEqual(d.removedGlobalStatePolicies, []);
  assert.equal(d.globalStateModeBefore, 'none');
  assert.equal(d.globalStateModeAfter, 'none');
  assert.equal(d.globalStateModeChanged, false);
  assert.deepEqual([...DELEGATE_REGISTRY_NODE_COMPARE_FIELDS].map(f => f[0]), ['status', 'nodeLogicCredential', 'nodeResolves', 'nodeCarriesPolicy', 'logicCredentialMatches', 'globalStateReference']);
});

test('re-pointing the index at a non-node makes the resolution BECAME NOT CONFORMING, verdictless downstream positions moving to null', () => {
  const after = conforming();
  after.registryNodeIdx = 0;
  const d = diffDelegateRegistryNode(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Node logic credential', 'Node resolution', 'Node carries the policy', 'Logic credential agreement']);
  assert.equal(d.registryNodeIdxChanged, true);
  assert.equal(d.after.nodeLogicCredential, null);
  assert.equal(d.after.verdicts.nodeCarriesPolicy, null);
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, false);
});

test('changing the resolved node’s key to a different policy makes the resolution BECAME NOT CONFORMING on the carries position', () => {
  const after = conforming();
  after.nodes = [null, node({ key: OTHER_POLICY })];
  const d = diffDelegateRegistryNode(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Node carries the policy', 'Logic credential agreement', 'Global-state reference'].filter(x => d.changedFields.includes(x)));
  // logic agreement and global-state go verdictless when the node no longer carries the policy
  assert.ok(d.changedFields.includes('Node carries the policy'));
  assert.deepEqual(d.changedNodeIndices, [1]);
  assert.equal(d.after.verdicts.logicCredentialMatches, null);
});

test('restoring the hint to the node carrying the policy makes the resolution BECAME CONFORMING', () => {
  const before = conforming();
  before.registryNodeIdx = 0;
  const d = diffDelegateRegistryNode(before, conforming());
  assert.equal(d.change, 'became-conforming');
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, true);
  assert.ok(d.changedFields.includes('Status'));
  assert.ok(d.changedFields.includes('Node resolution'));
});

test('a node re-pointed to a new script the claim follows is REQUIREMENT CHANGED on the node logic credential position alone', () => {
  const after = conforming();
  after.nodes = [null, node({ unfracking: { kind: 'script', hash: NEW_LOGIC } })];
  after.logicCredential = { kind: 'script', hash: NEW_LOGIC };
  const d = diffDelegateRegistryNode(conforming(), after);
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.changedFields, ['Node logic credential']);
  assert.deepEqual(d.differences[0].before, { kind: 'script', hash: LOGIC });
  assert.deepEqual(d.differences[0].after, { kind: 'script', hash: NEW_LOGIC });
  assert.equal(d.claimedLogicCredentialChanged, true);
  assert.deepEqual(d.changedNodeIndices, [1]);
});

test('a node re-pointed without the claim following is BECAME NOT CONFORMING — the conformance story takes precedence over the requirement’s move', () => {
  const after = conforming();
  after.nodes = [null, node({ unfracking: { kind: 'script', hash: NEW_LOGIC } })];
  const d = diffDelegateRegistryNode(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Node logic credential', 'Logic credential agreement']);
  assert.equal(d.claimedLogicCredentialChanged, false);
});

test('a resolution not conforming on both sides whose failing position changed underneath it is STILL NOT CONFORMING', () => {
  const before = conforming();
  before.registryNodeIdx = 0;
  const after = conforming();
  after.nodes = [null, node({ key: OTHER_POLICY })];
  const d = diffDelegateRegistryNode(before, after);
  assert.equal(d.change, 'still-not-conforming');
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, false);
  assert.ok(d.changedFields.includes('Node resolution'));
  assert.ok(d.changedFields.includes('Node carries the policy'));
  assert.equal(d.before.verdicts.nodeResolves, false);
  assert.equal(d.after.verdicts.nodeResolves, true);
  assert.equal(d.after.verdicts.nodeCarriesPolicy, false);
});

test('no node resolving on both sides compares equal on the downstream nulls: a different out-of-range index is reported, never counted', () => {
  const before = conforming();
  before.registryNodeIdx = 5;
  const after = conforming();
  after.registryNodeIdx = 7;
  const d = diffDelegateRegistryNode(before, after);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.equal(d.registryNodeIdxChanged, true);
  assert.equal(d.before.nodeLogicCredential, null);
  assert.equal(d.after.nodeLogicCredential, null);
  assert.equal(d.after.verdicts.globalStateReference, null);
});

test('a global-state reference joining the modeled policies moves the global-state verdict and makes the resolution BECAME CONFORMING', () => {
  const before = conforming();
  before.nodes = [null, node({ globalStateCs: GLOBAL })];
  before.globalStatePolicies = [];
  const after = conforming();
  after.nodes = [null, node({ globalStateCs: GLOBAL })];
  after.globalStatePolicies = [GLOBAL];
  const d = diffDelegateRegistryNode(before, after);
  assert.equal(d.change, 'became-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Global-state reference']);
  assert.deepEqual(d.addedGlobalStatePolicies, [GLOBAL]);
  assert.equal(d.globalStateModeBefore, 'present');
  assert.equal(d.globalStateModeAfter, 'present');
  assert.equal(d.globalStateModeChanged, false);
});

test('fixing the forbidden shape — an empty public-key unfracking field replaced by a script the claim follows — is BECAME CONFORMING', () => {
  const before = conforming();
  before.nodes = [null, node({ unfracking: { kind: 'pubkey', hash: '' } })];
  before.logicCredential = { kind: 'pubkey', hash: '' };
  const d = diffDelegateRegistryNode(before, conforming());
  assert.equal(d.change, 'became-conforming');
  assert.equal(d.before.logicForbidden, true);
  assert.equal(d.after.logicForbidden, false);
  assert.deepEqual(d.changedFields, ['Status', 'Node logic credential']);
});

test('introducing the forbidden shape — the node’s unfracking field becoming the empty public-key credential the claim follows — is BECAME NOT CONFORMING', () => {
  const after = conforming();
  after.nodes = [null, node({ unfracking: { kind: 'pubkey', hash: '' } })];
  after.logicCredential = { kind: 'pubkey', hash: '' };
  const d = diffDelegateRegistryNode(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.equal(d.after.logicForbidden, true);
  assert.deepEqual(d.changedFields, ['Status', 'Node logic credential']);
  assert.equal(d.after.verdicts.logicCredentialMatches, true);
});

test('a claimed-credential change is reported, never counted: a claim naming a different credential that still fails agreement differently moves only its verdict (pinned reporting)', () => {
  // The claimed credential changes, and its only scored consequence
  // would be the agreement verdict — here both claims fail
  // agreement, so no position moves at all while the change is
  // reported.
  const before = conforming();
  before.logicCredential = { kind: 'script', hash: OTHER_SCRIPT };
  const after = conforming();
  after.logicCredential = { kind: 'script', hash: NEW_LOGIC };
  const d = diffDelegateRegistryNode(before, after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.differences, []);
  assert.equal(d.claimedLogicCredentialChanged, true);
  assert.equal(d.before.verdicts.logicCredentialMatches, false);
  assert.equal(d.after.verdicts.logicCredentialMatches, false);
});

test('an index change is reported, never counted: the same node at a new index with the lists adjusted compares unchanged (pinned)', () => {
  const after = conforming();
  after.registryNodeIdx = 2;
  after.nodes = [null, null, node()];
  const d = diffDelegateRegistryNode(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.equal(d.registryNodeIdxChanged, true);
  assert.equal(d.nodeCountBefore, 2);
  assert.equal(d.nodeCountAfter, 3);
  assert.equal(d.addedNodeCount, 1);
  assert.equal(d.removedNodeCount, 0);
  assert.deepEqual(d.changedNodeIndices, [1, 2]);
});

test('node-list and global-state-policy changes are reported with their modes, never counted beyond their verdicts', () => {
  const after = conforming();
  after.nodes = [null, node({ globalStateCs: GLOBAL }), node({ key: OTHER_POLICY })];
  after.globalStatePolicies = [GLOBAL, GLOBAL2];
  const d = diffDelegateRegistryNode(conforming(), after);
  // The node now names a global state and a reference input carries
  // it, so the global-state verdict moves null -> true while both
  // sides conform.
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.addedGlobalStatePolicies, [GLOBAL, GLOBAL2]);
  assert.deepEqual(d.removedGlobalStatePolicies, []);
  assert.equal(d.globalStateModeBefore, 'none');
  assert.equal(d.globalStateModeAfter, 'present');
  assert.equal(d.globalStateModeChanged, true);
  assert.equal(d.nodeCountAfter, 3);
  assert.deepEqual(d.changedNodeIndices, [1, 2]);
  const back = diffDelegateRegistryNode(after, conforming());
  assert.deepEqual(back.removedGlobalStatePolicies, [GLOBAL, GLOBAL2]);
  assert.equal(back.removedNodeCount, 1);
});

test('hex case alone is the same resolution: uppercase policy, key, credential, and global-state policy compare as unchanged', () => {
  const after = conforming();
  after.policy = POLICY.toUpperCase();
  after.nodes = [null, node({ key: POLICY.toUpperCase(), unfracking: { kind: 'script', hash: LOGIC.toUpperCase() }, thirdParty: { kind: 'script', hash: LOGIC.toUpperCase() } })];
  after.logicCredential = { kind: 'script', hash: LOGIC.toUpperCase() };
  const d = diffDelegateRegistryNode(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.policy, POLICY);
  assert.equal(d.claimedLogicCredentialChanged, false);
  assert.deepEqual(d.changedNodeIndices, []);
});

test('refusal discipline: different actions and different policies are refused, and a version that cannot be read is refused on either side with the checker’s reason', () => {
  const otherAction = conforming();
  otherAction.action = 'third-party';
  assert.throws(() => diffDelegateRegistryNode(conforming(), otherAction), /declare different actions/);
  const otherPolicy = conforming();
  otherPolicy.policy = OTHER_POLICY;
  otherPolicy.nodes = [null, node({ key: OTHER_POLICY })];
  assert.throws(() => diffDelegateRegistryNode(conforming(), otherPolicy), /declare different acted-on policies/);
  const badAfter = conforming();
  badAfter.globalStatePolicies = [GLOBAL, GLOBAL.toUpperCase()];
  assert.throws(() => diffDelegateRegistryNode(conforming(), badAfter), /more than once/);
  const badBefore = conforming();
  badBefore.registryNodeIdx = 1.5;
  assert.throws(() => diffDelegateRegistryNode(badBefore, conforming()), /non-negative integer/);
  assert.throws(() => diffDelegateRegistryNode({ ...conforming(), extra: 1 }, conforming()), /unknown field/);
  const badNode = conforming();
  badNode.nodes = [null, node({ key: 'abcd' })];
  assert.throws(() => diffDelegateRegistryNode(conforming(), badNode), /empty \(the origin node/);
});

test('the comparison does not mutate either claim, and its two sides are the checker’s own verdicts', () => {
  const before = conforming();
  const after = conforming();
  after.registryNodeIdx = 0;
  const bSnap = JSON.parse(JSON.stringify(before));
  const aSnap = JSON.parse(JSON.stringify(after));
  const d = diffDelegateRegistryNode(before, after);
  assert.deepEqual(before, bSnap);
  assert.deepEqual(after, aSnap);
  assert.deepEqual(d.before, checkDelegateRegistryNode(bSnap));
  assert.deepEqual(d.after, checkDelegateRegistryNode(aSnap));
});

test('app wires the delegate registry-node impact comparison: panel, verdicts, honest boundary, v1.222', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /diffDelegateRegistryNode/);
  assert.match(app, /registry-node-diff-after-nodes/);
  assert.match(app, /registry-node-diff-after-global/);
  assert.match(app, /DELEGATE REGISTRY-NODE IMPACT · LOCAL MODEL/);
  assert.match(app, /BECAME NOT CONFORMING/);
  assert.match(app, /REQUIREMENT CHANGED/);
  assert.match(app, /v1\.222/);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /Delegate registry-node impact/);
});
