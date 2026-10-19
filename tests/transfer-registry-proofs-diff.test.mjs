import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkTransferRegistryProofs, diffTransferRegistryProofs, TRANSFER_REGISTRY_PROOFS_COMPARE_FIELDS } from '../src/domain.js';

// TransferAct registry-proof impact (spec: delegate validation
// step 2, the TransferAct constructor, and Reference Inputs,
// re-read 2026-10-10): a proof resolution that conformed when
// modeled can be staled by a change that never touches the proofs
// themselves — a reference input added ahead of a node, a
// registry update re-pointing a node's transfer_logic_script or
// global_state_cs, a covering node's next widened, a global-state
// NFT joining or leaving. Both versions are checked through
// checkTransferRegistryProofs itself, and six positions are
// compared: the status, the resolved node requirements (the
// requirement itself), and the four verdicts.
const BELOW = 'bb'.repeat(28);
const POLICY = 'cc'.repeat(28);
const ABSENT = 'dd'.repeat(28);
const ABOVE = 'ee'.repeat(28);
const TRANSFER_SCRIPT = 'ee'.repeat(28);
const OTHER_SCRIPT = 'ff'.repeat(28);
const GLOBAL = '99'.repeat(28);
const STRANGER = '88'.repeat(28);

const conforming = () => ({
  proofs: [
    { policy: POLICY, proofType: 'TokenExists', nodeIdx: 1, transferCredential: { kind: 'script', hash: TRANSFER_SCRIPT } },
    { policy: ABSENT, proofType: 'TokenDoesNotExist', nodeIdx: 2, transferCredential: null },
  ],
  nodes: [
    null,
    { key: POLICY, next: ABOVE, transfer: { kind: 'script', hash: TRANSFER_SCRIPT }, globalStateCs: '' },
    { key: BELOW, next: ABOVE, transfer: { kind: 'script', hash: OTHER_SCRIPT }, globalStateCs: '' },
  ],
  globalStatePolicies: [],
});

test('an unchanged resolution compares as unchanged on all six positions', () => {
  const d = diffTransferRegistryProofs(conforming(), conforming());
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.changedFields, []);
  assert.equal(d.changedCount, 0);
  assert.equal(d.positionCount, 6);
  assert.deepEqual(d.proofsAdded, []);
  assert.deepEqual(d.proofsRemoved, []);
  assert.equal(d.existsCountBefore, 1);
  assert.equal(d.existsCountAfter, 1);
  assert.equal(d.notExistsCountBefore, 1);
  assert.equal(d.notExistsCountAfter, 1);
  assert.deepEqual(d.nodeIdxChanges, []);
  assert.deepEqual(d.claimedCredentialChanges, []);
  assert.deepEqual(d.changedNodeIndices, []);
  assert.equal(d.referenceCountBefore, 3);
  assert.equal(d.referenceCountAfter, 3);
  assert.deepEqual(d.globalStatePoliciesAdded, []);
  assert.deepEqual(d.globalStatePoliciesRemoved, []);
  assert.deepEqual([...TRANSFER_REGISTRY_PROOFS_COMPARE_FIELDS].map(f => f[0]), ['status', 'resolvedRequirements', 'nodesResolve', 'proofsMatchNodes', 'transferCredentialMatches', 'globalStateReference']);
  assert.deepEqual([...TRANSFER_REGISTRY_PROOFS_COMPARE_FIELDS].map(f => f[1]), ['Status', 'Resolved node requirements', 'Node resolution', 'Proofs match nodes', 'Transfer credential agreement', 'Global-state reference']);
});

test('re-pointing a node’s transfer field without the claim following is BECAME NOT CONFORMING on the status and agreement positions', () => {
  const after = conforming();
  after.nodes[1].transfer = { kind: 'script', hash: OTHER_SCRIPT };
  const d = diffTransferRegistryProofs(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.ok(d.changedFields.includes('Status'));
  assert.ok(d.changedFields.includes('Transfer credential agreement'));
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, false);
  assert.equal(d.after.verdicts.transferCredentialMatches, false);
  assert.deepEqual(d.claimedCredentialChanges, []);
  assert.deepEqual(d.changedNodeIndices, [1]);
});

test('re-pointing a proof’s index at a non-node input is BECAME NOT CONFORMING, the hint change reported per policy', () => {
  const after = conforming();
  after.proofs[0].nodeIdx = 0;
  const d = diffTransferRegistryProofs(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.ok(d.changedFields.includes('Status'));
  assert.ok(d.changedFields.includes('Node resolution'));
  assert.ok(d.changedFields.includes('Proofs match nodes'));
  assert.equal(d.after.verdicts.nodesResolve, false);
  assert.equal(d.after.verdicts.transferCredentialMatches, null);
  assert.deepEqual(d.nodeIdxChanges, [{ policy: POLICY, before: 1, after: 0 }]);
});

test('restoring the index makes the resolution BECAME CONFORMING', () => {
  const before = conforming();
  before.proofs[0].nodeIdx = 0;
  const d = diffTransferRegistryProofs(before, conforming());
  assert.equal(d.change, 'became-conforming');
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.nodeIdxChanges, [{ policy: POLICY, before: 0, after: 1 }]);
});

test('re-pointing a node’s transfer field WITH the claim following it is REQUIREMENT CHANGED on the resolved-requirements position alone', () => {
  const after = conforming();
  after.nodes[1].transfer = { kind: 'script', hash: OTHER_SCRIPT };
  after.proofs[0].transferCredential = { kind: 'script', hash: OTHER_SCRIPT };
  const d = diffTransferRegistryProofs(conforming(), after);
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.changedFields, ['Resolved node requirements']);
  const req = d.differences[0];
  assert.equal(req.field, 'resolvedRequirements');
  assert.deepEqual(req.before.find(e => e.policy === POLICY).transfer, { kind: 'script', hash: TRANSFER_SCRIPT });
  assert.deepEqual(req.after.find(e => e.policy === POLICY).transfer, { kind: 'script', hash: OTHER_SCRIPT });
  assert.deepEqual(d.claimedCredentialChanges, [POLICY]);
  assert.deepEqual(d.changedNodeIndices, [1]);
});

test('the conformance story takes precedence: a requirement move that also breaks agreement is BECAME NOT CONFORMING, not REQUIREMENT CHANGED', () => {
  const after = conforming();
  after.nodes[1].transfer = { kind: 'script', hash: OTHER_SCRIPT };
  const d = diffTransferRegistryProofs(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.ok(d.changedFields.includes('Resolved node requirements'));
  assert.ok(d.changedFields.includes('Transfer credential agreement'));
});

test('a resolution not conforming on both sides whose failing position changed underneath it is STILL NOT CONFORMING', () => {
  const before = conforming();
  before.nodes[1].transfer = { kind: 'script', hash: OTHER_SCRIPT };
  const after = conforming();
  after.proofs[0].nodeIdx = 0;
  const d = diffTransferRegistryProofs(before, after);
  assert.equal(d.change, 'still-not-conforming');
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, false);
  assert.equal(d.before.verdicts.transferCredentialMatches, false);
  assert.equal(d.after.verdicts.transferCredentialMatches, null);
  assert.ok(d.changedFields.includes('Node resolution'));
});

test('verdictless positions on both sides compare equal: a covering node’s transfer field is no part of a does-not-exist proof’s requirement (pinned)', () => {
  const before = conforming();
  before.proofs = [before.proofs[1]];
  const after = conforming();
  after.proofs = [after.proofs[1]];
  after.nodes[2].transfer = { kind: 'script', hash: TRANSFER_SCRIPT };
  const d = diffTransferRegistryProofs(before, after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.differences, []);
  assert.equal(d.before.verdicts.transferCredentialMatches, null);
  assert.equal(d.after.verdicts.transferCredentialMatches, null);
  assert.equal(d.before.verdicts.globalStateReference, null);
  assert.equal(d.after.verdicts.globalStateReference, null);
  assert.deepEqual(d.changedNodeIndices, [2]);
});

test('widening a covering node’s next while it still covers is REQUIREMENT CHANGED on the bounds in the requirement', () => {
  const after = conforming();
  after.nodes[2].next = OTHER_SCRIPT;
  const d = diffTransferRegistryProofs(conforming(), after);
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.changedFields, ['Resolved node requirements']);
  const req = d.differences[0];
  assert.equal(req.before.find(e => e.policy === ABSENT).next, ABOVE);
  assert.equal(req.after.find(e => e.policy === ABSENT).next, OTHER_SCRIPT);
});

test('a matched node gaining a global-state policy whose NFT is not referenced is BECAME NOT CONFORMING on the global-state position', () => {
  const after = conforming();
  after.nodes[1].globalStateCs = GLOBAL;
  const d = diffTransferRegistryProofs(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.ok(d.changedFields.includes('Status'));
  assert.ok(d.changedFields.includes('Global-state reference'));
  assert.equal(d.after.verdicts.globalStateReference, false);
});

test('a matched node gaining a global-state policy whose NFT is referenced is REQUIREMENT CHANGED, the global verdict moving null to true alongside the requirement', () => {
  const after = conforming();
  after.nodes[1].globalStateCs = GLOBAL;
  after.globalStatePolicies = [GLOBAL];
  const d = diffTransferRegistryProofs(conforming(), after);
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.changedFields, ['Resolved node requirements', 'Global-state reference']);
  assert.equal(d.before.verdicts.globalStateReference, null);
  assert.equal(d.after.verdicts.globalStateReference, true);
  assert.deepEqual(d.globalStatePoliciesAdded, [GLOBAL]);
});

test('the same nodes at new indices compare unchanged: index changes are reported per policy, never counted (pinned)', () => {
  const after = conforming();
  after.nodes = [null, null, after.nodes[1], after.nodes[2]];
  after.proofs[0].nodeIdx = 2;
  after.proofs[1].nodeIdx = 3;
  const d = diffTransferRegistryProofs(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.nodeIdxChanges, [
    { policy: POLICY, before: 1, after: 2 },
    { policy: ABSENT, before: 2, after: 3 },
  ]);
  assert.deepEqual(d.changedNodeIndices, [1, 2, 3]);
  assert.equal(d.referenceCountBefore, 3);
  assert.equal(d.referenceCountAfter, 4);
});

test('a does-not-exist proof’s entered credential changing is reported, never counted: the checker gives it no verdict (pinned)', () => {
  const after = conforming();
  after.proofs[1].transferCredential = { kind: 'script', hash: STRANGER };
  const d = diffTransferRegistryProofs(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.claimedCredentialChanges, [ABSENT]);
});

test('changing only the claimed credential is BECAME NOT CONFORMING, the claimed change reported alongside its verdict consequence', () => {
  const after = conforming();
  after.proofs[0].transferCredential = { kind: 'script', hash: OTHER_SCRIPT };
  const d = diffTransferRegistryProofs(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.ok(d.changedFields.includes('Transfer credential agreement'));
  assert.deepEqual(d.claimedCredentialChanges, [POLICY]);
  assert.deepEqual(d.changedNodeIndices, []);
});

test('proof-list and global-state policy changes are reported as added/removed sets with counts, never counted beyond their positions', () => {
  const after = conforming();
  after.proofs = [after.proofs[0]];
  after.globalStatePolicies = [GLOBAL];
  const d = diffTransferRegistryProofs(conforming(), after);
  assert.equal(d.change, 'requirement-changed');
  assert.deepEqual(d.proofsAdded, []);
  assert.deepEqual(d.proofsRemoved, [ABSENT]);
  assert.equal(d.notExistsCountBefore, 1);
  assert.equal(d.notExistsCountAfter, 0);
  assert.deepEqual(d.globalStatePoliciesAdded, [GLOBAL]);
  const back = diffTransferRegistryProofs(after, conforming());
  assert.deepEqual(back.proofsAdded, [ABSENT]);
  assert.deepEqual(back.globalStatePoliciesRemoved, [GLOBAL]);
});

test('hex case alone is the same resolution: uppercase policies, keys, and credentials compare as unchanged', () => {
  const after = conforming();
  after.proofs[0].policy = POLICY.toUpperCase();
  after.proofs[0].transferCredential = { kind: 'script', hash: TRANSFER_SCRIPT.toUpperCase() };
  after.nodes[1].key = POLICY.toUpperCase();
  after.nodes[1].transfer = { kind: 'script', hash: TRANSFER_SCRIPT.toUpperCase() };
  const d = diffTransferRegistryProofs(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.nodeIdxChanges, []);
  assert.deepEqual(d.claimedCredentialChanges, []);
});

test('refusal discipline: a version that cannot be read is refused on either side with the checker’s reason, never compared around', () => {
  assert.throws(() => diffTransferRegistryProofs({ ...conforming(), extra: 1 }, conforming()), /unknown field/);
  assert.throws(() => diffTransferRegistryProofs(conforming(), { ...conforming(), extra: 1 }), /unknown field/);
  const badType = conforming();
  badType.proofs[0].proofType = 'TokenMaybeExists';
  assert.throws(() => diffTransferRegistryProofs(conforming(), badType), /TokenExists or TokenDoesNotExist/);
  const dupBefore = conforming();
  dupBefore.proofs.push({ policy: POLICY.toUpperCase(), proofType: 'TokenDoesNotExist', nodeIdx: 2, transferCredential: null });
  assert.throws(() => diffTransferRegistryProofs(dupBefore, conforming()), /more than once/);
  const emptyAfter = conforming();
  emptyAfter.proofs = [];
  assert.throws(() => diffTransferRegistryProofs(conforming(), emptyAfter), /non-empty list/);
});

test('the comparison does not mutate either claim', () => {
  const before = conforming();
  const after = conforming();
  after.nodes[1].transfer = { kind: 'script', hash: OTHER_SCRIPT };
  const bSnap = JSON.parse(JSON.stringify(before));
  const aSnap = JSON.parse(JSON.stringify(after));
  diffTransferRegistryProofs(before, after);
  assert.deepEqual(before, bSnap);
  assert.deepEqual(after, aSnap);
});

test('the comparison’s two sides are the checker’s own verdicts', () => {
  const before = conforming();
  const after = conforming();
  after.nodes[1].transfer = { kind: 'script', hash: OTHER_SCRIPT };
  const d = diffTransferRegistryProofs(before, after);
  assert.deepEqual(d.before, checkTransferRegistryProofs(JSON.parse(JSON.stringify(before))));
  assert.deepEqual(d.after, checkTransferRegistryProofs(JSON.parse(JSON.stringify(after))));
});

test('app wires the transfer registry-proof impact comparison: panel, verdicts, honest boundary, v1.280', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /diffTransferRegistryProofs/);
  assert.match(app, /transfer-proof-diff-after-proofs/);
  assert.match(app, /transfer-proof-diff-after-nodes/);
  assert.match(app, /transfer-proof-diff-after-global/);
  assert.match(app, /TRANSFER REGISTRY-PROOF IMPACT · LOCAL MODEL/);
  assert.match(app, /BECAME NOT CONFORMING/);
  assert.match(app, /REQUIREMENT CHANGED/);
  assert.match(app, /v1\.280/);
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /Transfer registry-proof impact/);
});
