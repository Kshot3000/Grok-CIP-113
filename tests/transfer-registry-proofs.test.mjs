import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkTransferRegistryProofs } from '../src/domain.js';

// TransferAct registry-proof resolution: each RegistryProof is a
// hint — a node_idx into the reference inputs — that the transfer
// delegate resolves and then checks (spec: delegate validation
// step 2, the TransferAct constructor, and Reference Inputs,
// re-read 2026-10-10). A TokenExists proof's node must carry the
// policy and the claimed transfer credential; a TokenDoesNotExist
// proof's node must be the covering node (key < policy < next);
// a matched node's non-empty global_state_cs requires a reference
// input carrying that NFT policy. Positions a proof does not reach
// carry NO verdict.
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

test('a conforming claim passes every position: both proofs resolve and match their nodes, the transfer credential agrees, global state verdictless', () => {
  const v = checkTransferRegistryProofs(conforming());
  assert.equal(v.status, 'conforming');
  assert.equal(v.valid, true);
  assert.deepEqual(v.verdicts, { nodesResolve: true, proofsMatchNodes: true, transferCredentialMatches: true, globalStateReference: null });
  assert.equal(v.proofs[0].nodeResolves, true);
  assert.equal(v.proofs[0].proofMatchesNode, true);
  assert.equal(v.proofs[0].transferCredentialMatches, true);
  assert.equal(v.proofs[0].globalStateMode, 'none');
  assert.equal(v.proofs[0].globalStateReference, null);
  assert.equal(v.proofs[1].proofMatchesNode, true);
  assert.equal(v.proofs[1].transferCredentialMatches, null);
  assert.equal(v.proofs[1].globalStateReference, null);
  assert.equal(v.existsCount, 1);
  assert.equal(v.notExistsCount, 1);
  assert.equal(v.referenceCount, 3);
});

test('a proof whose index lands on a non-node reference input resolves to no node, and every later position for it is verdictless', () => {
  const claim = conforming();
  claim.proofs[0].nodeIdx = 0;
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.valid, false);
  assert.equal(v.verdicts.nodesResolve, false);
  assert.equal(v.verdicts.proofsMatchNodes, false);
  assert.equal(v.proofs[0].nodeResolves, false);
  assert.equal(v.proofs[0].proofMatchesNode, null);
  assert.equal(v.proofs[0].transferCredentialMatches, null);
  assert.equal(v.proofs[0].globalStateReference, null);
  assert.equal(v.proofs[1].proofMatchesNode, true);
});

test('an out-of-range node index resolves to no node, exactly like a non-node input', () => {
  const claim = conforming();
  claim.proofs[1].nodeIdx = 9;
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.proofs[1].nodeResolves, false);
  assert.equal(v.proofs[1].proofMatchesNode, null);
  assert.equal(v.verdicts.nodesResolve, false);
  assert.equal(v.valid, false);
});

test('a TokenExists proof against another policy\'s node fails the match, and its credential and global-state positions are verdictless', () => {
  const claim = conforming();
  claim.proofs[0].nodeIdx = 2;
  claim.nodes[2].globalStateCs = GLOBAL;
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.proofs[0].nodeResolves, true);
  assert.equal(v.proofs[0].proofMatchesNode, false);
  assert.equal(v.proofs[0].transferCredentialMatches, null);
  assert.equal(v.proofs[0].globalStateReference, null);
  assert.equal(v.verdicts.transferCredentialMatches, null);
  assert.equal(v.valid, false);
});

test('a TokenDoesNotExist proof fails when the resolved node is the policy itself — the policy is registered after all', () => {
  const claim = conforming();
  claim.proofs[1] = { policy: POLICY, proofType: 'TokenDoesNotExist', nodeIdx: 1, transferCredential: null };
  claim.proofs = [claim.proofs[1]];
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.proofs[0].proofMatchesNode, false);
  assert.equal(v.valid, false);
});

test('a covering node whose next is not above the policy covers nothing', () => {
  const claim = conforming();
  claim.nodes[2].next = POLICY;
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.proofs[1].proofMatchesNode, false);
  assert.equal(v.verdicts.proofsMatchNodes, false);
  assert.equal(v.valid, false);
});

test('the origin node covers a policy below its next: its empty key is below every policy', () => {
  const claim = conforming();
  claim.nodes[2] = { key: '', next: BELOW, transfer: { kind: 'script', hash: OTHER_SCRIPT }, globalStateCs: '' };
  claim.proofs[1].policy = 'aa'.repeat(28);
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.proofs[1].proofMatchesNode, true);
  assert.equal(v.valid, true);
});

test('a covering node with an empty next shows no covering relationship under the spec formula', () => {
  const claim = conforming();
  claim.nodes[2].next = '';
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.proofs[1].proofMatchesNode, false);
  assert.equal(v.valid, false);
});

test('a node whose transfer field differs from the claimed credential — hash or kind — fails only the agreement position', () => {
  const claim = conforming();
  claim.nodes[1].transfer = { kind: 'script', hash: OTHER_SCRIPT };
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.proofs[0].proofMatchesNode, true);
  assert.equal(v.proofs[0].transferCredentialMatches, false);
  assert.equal(v.verdicts.proofsMatchNodes, true);
  assert.equal(v.verdicts.transferCredentialMatches, false);
  assert.equal(v.valid, false);
  const claim2 = conforming();
  claim2.nodes[1].transfer = { kind: 'pubkey', hash: TRANSFER_SCRIPT };
  const v2 = checkTransferRegistryProofs(claim2);
  assert.equal(v2.proofs[0].transferCredentialMatches, false);
});

test('an empty transfer field matches an empty claim exactly — agreement is judged here, execution is the authorization checker\'s verdict', () => {
  const claim = conforming();
  claim.nodes[1].transfer = { kind: 'pubkey', hash: '' };
  claim.proofs[0].transferCredential = { kind: 'pubkey', hash: '' };
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.proofs[0].transferCredentialMatches, true);
  assert.equal(v.valid, true);
});

test('a matched node naming a global-state policy passes only when a reference input carries that NFT policy', () => {
  const claim = conforming();
  claim.nodes[1].globalStateCs = GLOBAL;
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.proofs[0].globalStateMode, 'present');
  assert.equal(v.proofs[0].globalStateReference, false);
  assert.equal(v.verdicts.globalStateReference, false);
  assert.equal(v.valid, false);
  claim.globalStatePolicies = [GLOBAL];
  const v2 = checkTransferRegistryProofs(claim);
  assert.equal(v2.proofs[0].globalStateReference, true);
  assert.equal(v2.valid, true);
});

test('a covering node\'s own global_state_cs is a different token\'s configuration and carries no verdict', () => {
  const claim = conforming();
  claim.nodes[2].globalStateCs = STRANGER;
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.proofs[1].globalStateMode, null);
  assert.equal(v.proofs[1].globalStateReference, null);
  assert.equal(v.valid, true);
});

test('a TokenDoesNotExist proof carrying a credential is reported, never judged — its disagreement with the covering node costs nothing', () => {
  const claim = conforming();
  claim.proofs[1].transferCredential = { kind: 'script', hash: STRANGER };
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.proofs[1].transferCredentialMatches, null);
  assert.equal(v.valid, true);
});

test('hex case is canonicalised: uppercase node keys, credentials, and policies still name the same records', () => {
  const claim = conforming();
  claim.nodes[1].key = POLICY.toUpperCase();
  claim.nodes[1].transfer = { kind: 'script', hash: TRANSFER_SCRIPT.toUpperCase() };
  claim.proofs[0].policy = POLICY.toUpperCase();
  const v = checkTransferRegistryProofs(claim);
  assert.equal(v.valid, true);
  assert.equal(v.proofs[0].policy, POLICY);
  assert.equal(v.nodes[1].key, POLICY);
});

test('refusal discipline: unknown or missing field, empty proofs, unknown proof type, malformed index are refused, never scored', () => {
  assert.throws(() => checkTransferRegistryProofs({ ...conforming(), extra: 1 }), /unknown field/);
  const missing = conforming();
  delete missing.nodes;
  assert.throws(() => checkTransferRegistryProofs(missing), /missing its "nodes"/);
  assert.throws(() => checkTransferRegistryProofs({ ...conforming(), proofs: [] }), /non-empty list/);
  const badType = conforming();
  badType.proofs[0].proofType = 'TokenMaybeExists';
  assert.throws(() => checkTransferRegistryProofs(badType), /TokenExists or TokenDoesNotExist/);
  const badIdx = conforming();
  badIdx.proofs[0].nodeIdx = 1.5;
  assert.throws(() => checkTransferRegistryProofs(badIdx), /non-negative integer/);
  const negIdx = conforming();
  negIdx.proofs[0].nodeIdx = -1;
  assert.throws(() => checkTransferRegistryProofs(negIdx), /non-negative integer/);
});

test('refusal discipline: an exists proof naming no credential, a duplicated policy, a malformed node, and a duplicated global-state policy are refused', () => {
  const noCred = conforming();
  noCred.proofs[0].transferCredential = null;
  assert.throws(() => checkTransferRegistryProofs(noCred), /names no transfer credential/);
  const dup = conforming();
  dup.proofs.push({ policy: POLICY.toUpperCase(), proofType: 'TokenDoesNotExist', nodeIdx: 2, transferCredential: null });
  assert.throws(() => checkTransferRegistryProofs(dup), /more than once/);
  const badNode = conforming();
  badNode.nodes[1] = { key: POLICY, transfer: { kind: 'script', hash: TRANSFER_SCRIPT }, globalStateCs: '' };
  assert.throws(() => checkTransferRegistryProofs(badNode), /missing its "next"/);
  const badKey = conforming();
  badKey.nodes[1].key = 'abcd';
  assert.throws(() => checkTransferRegistryProofs(badKey), /28-byte policy ID/);
  const dupGlobal = conforming();
  dupGlobal.globalStatePolicies = [GLOBAL, GLOBAL.toUpperCase()];
  assert.throws(() => checkTransferRegistryProofs(dupGlobal), /more than once/);
  const unknownNodeField = conforming();
  unknownNodeField.nodes[1].extra = 1;
  assert.throws(() => checkTransferRegistryProofs(unknownNodeField), /unknown field/);
});

test('the checker does not mutate its claim', () => {
  const claim = conforming();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkTransferRegistryProofs(claim);
  assert.deepEqual(claim, snapshot);
});

test('app wires the transfer registry-proof checker: panel, verdicts, honest boundary, v1.108', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkTransferRegistryProofs/);
  assert.match(app, /transfer-proof-nodes/);
  assert.match(app, /TRANSFER REGISTRY PROOFS · LOCAL MODEL/);
  assert.match(app, /NO VERDICT/);
  assert.match(app, /v1\.108/);
});
