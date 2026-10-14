import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkTransferProofList } from '../src/domain.js';

// TransferAct proof-list completeness and ordering (spec:
// RegistryProof Requirements, re-read 2026-10-11): one proof for
// each distinct non-lovelace policy present in any UTxO spent from
// programmableLogicBase OR in tx.mint — the distinct union, a policy
// both spent and minted proven once — and the list in the policies'
// lexicographic order. Correctness of each proof is judged by the
// proof verifier and the registry-proof checker, not here.
const SPENT = 'cc'.repeat(28);
const ALSO_SPENT = 'dd'.repeat(28);
const MINT_ONLY = 'ee'.repeat(28);
const STRANGER = 'ff'.repeat(28);
const EARLIER = 'bb'.repeat(28);

const conforming = () => ({
  spentPolicies: [SPENT, ALSO_SPENT],
  mintPolicies: [SPENT],
  proofPolicies: [SPENT, ALSO_SPENT],
});

test('a conforming claim passes: the distinct union is proven once each, in lexicographic order, the spent-and-minted policy counted once', () => {
  const v = checkTransferProofList(conforming());
  assert.equal(v.status, 'conforming');
  assert.equal(v.valid, true);
  assert.deepEqual(v.required, [SPENT, ALSO_SPENT]);
  assert.deepEqual(v.completeness, { complete: true, missing: [], extra: [], duplicates: [] });
  assert.deepEqual(v.ordering, { ordered: true, firstOutOfOrder: null });
  assert.equal(v.requiredCount, 2);
  assert.equal(v.proofCount, 2);
  assert.equal(v.spentDistinctCount, 2);
  assert.equal(v.mintDistinctCount, 1);
  assert.equal(v.overlapCount, 1);
  assert.equal(v.perPolicy[0].source, 'spent-and-minted');
  assert.equal(v.perPolicy[0].proven, true);
  assert.equal(v.perPolicy[1].source, 'spent');
});

test('a policy held by two spent UTxOs, or minted under two asset names, is one requirement — occurrences collapse', () => {
  const claim = conforming();
  claim.spentPolicies = [SPENT, ALSO_SPENT, SPENT];
  claim.mintPolicies = [SPENT, SPENT];
  const v = checkTransferProofList(claim);
  assert.equal(v.valid, true);
  assert.equal(v.requiredCount, 2);
  assert.equal(v.spentDistinctCount, 2);
  assert.equal(v.mintDistinctCount, 1);
});

test('a mint-only policy is required: minted tokens are validated through the same list as spent tokens', () => {
  const claim = conforming();
  claim.mintPolicies = [SPENT, MINT_ONLY];
  const missing = checkTransferProofList(claim);
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.completeness.missing, [MINT_ONLY]);
  assert.equal(missing.perPolicy.find(r => r.policy === MINT_ONLY).source, 'minted');
  claim.proofPolicies = [SPENT, ALSO_SPENT, MINT_ONLY];
  const v = checkTransferProofList(claim);
  assert.equal(v.valid, true);
  assert.equal(v.requiredCount, 3);
});

test('a required policy with no proof is missing, named, and fails completeness alone', () => {
  const claim = conforming();
  claim.proofPolicies = [SPENT];
  const v = checkTransferProofList(claim);
  assert.equal(v.valid, false);
  assert.deepEqual(v.completeness.missing, [ALSO_SPENT]);
  assert.equal(v.completeness.complete, false);
  assert.equal(v.ordering.ordered, true);
  assert.equal(v.missingCount, 1);
  assert.equal(v.perPolicy[1].proven, false);
});

test('an empty proof list is a readable claim that fails completeness with every required policy missing', () => {
  const claim = conforming();
  claim.proofPolicies = [];
  const v = checkTransferProofList(claim);
  assert.equal(v.valid, false);
  assert.deepEqual(v.completeness.missing, [SPENT, ALSO_SPENT]);
  assert.equal(v.ordering.ordered, true);
  assert.equal(v.proofCount, 0);
});

test('a proof for a policy the transfer neither spends nor mints is extra, named, and fails completeness alone', () => {
  const claim = conforming();
  claim.proofPolicies = [SPENT, ALSO_SPENT, STRANGER];
  const v = checkTransferProofList(claim);
  assert.equal(v.valid, false);
  assert.deepEqual(v.completeness.extra, [STRANGER]);
  assert.equal(v.completeness.missing.length, 0);
  assert.equal(v.ordering.ordered, true);
  assert.equal(v.extraCount, 1);
});

test('a policy proven twice is a duplicate — and out of order with itself, so ordering fails at the second entry', () => {
  const claim = conforming();
  claim.proofPolicies = [SPENT, SPENT, ALSO_SPENT];
  const v = checkTransferProofList(claim);
  assert.equal(v.valid, false);
  assert.deepEqual(v.completeness.duplicates, [SPENT]);
  assert.equal(v.duplicateCount, 1);
  assert.equal(v.ordering.ordered, false);
  assert.equal(v.ordering.firstOutOfOrder, 1);
});

test('a complete list in the wrong order fails ordering alone, at the first out-of-order position', () => {
  const claim = conforming();
  claim.proofPolicies = [ALSO_SPENT, SPENT];
  const v = checkTransferProofList(claim);
  assert.equal(v.valid, false);
  assert.equal(v.completeness.complete, true);
  assert.equal(v.ordering.ordered, false);
  assert.equal(v.ordering.firstOutOfOrder, 1);
});

test('ordering is bytewise lexicographic: a policy sorting before both spent policies fails at its neighbour, not by string length or entry order', () => {
  const claim = conforming();
  claim.spentPolicies = [SPENT, ALSO_SPENT, EARLIER];
  claim.proofPolicies = [SPENT, EARLIER, ALSO_SPENT];
  const v = checkTransferProofList(claim);
  assert.deepEqual(v.required, [EARLIER, SPENT, ALSO_SPENT]);
  assert.equal(v.ordering.firstOutOfOrder, 1);
  claim.proofPolicies = [EARLIER, SPENT, ALSO_SPENT];
  assert.equal(checkTransferProofList(claim).valid, true);
});

test('a transfer minting nothing requires only its spent policies', () => {
  const v = checkTransferProofList({ spentPolicies: [ALSO_SPENT], mintPolicies: [], proofPolicies: [ALSO_SPENT] });
  assert.equal(v.valid, true);
  assert.equal(v.requiredCount, 1);
  assert.equal(v.mintDistinctCount, 0);
  assert.equal(v.overlapCount, 0);
  assert.equal(v.perPolicy[0].source, 'spent');
});

test('missing, extra, and ordering failures are reported together — no position is hidden by another', () => {
  const claim = conforming();
  claim.proofPolicies = [STRANGER, SPENT];
  const v = checkTransferProofList(claim);
  assert.equal(v.valid, false);
  assert.deepEqual(v.completeness.missing, [ALSO_SPENT]);
  assert.deepEqual(v.completeness.extra, [STRANGER]);
  assert.equal(v.ordering.ordered, false);
  assert.equal(v.ordering.firstOutOfOrder, 1);
});

test('hex case is canonicalised: uppercase spent, mint, and proof policies still name the same policies', () => {
  const claim = conforming();
  claim.spentPolicies = [SPENT.toUpperCase(), ALSO_SPENT];
  claim.mintPolicies = [SPENT.toUpperCase()];
  claim.proofPolicies = [SPENT, ALSO_SPENT.toUpperCase()];
  const v = checkTransferProofList(claim);
  assert.equal(v.valid, true);
  assert.deepEqual(v.required, [SPENT, ALSO_SPENT]);
  assert.equal(v.overlapCount, 1);
});

test('refusal discipline: unknown or missing field, empty spent list, and a malformed policy in any list are refused, never scored', () => {
  assert.throws(() => checkTransferProofList({ ...conforming(), extra: 1 }), /unknown field/);
  const missing = conforming();
  delete missing.mintPolicies;
  assert.throws(() => checkTransferProofList(missing), /missing its "mintPolicies"/);
  assert.throws(() => checkTransferProofList({ ...conforming(), spentPolicies: [] }), /non-empty list/);
  assert.throws(() => checkTransferProofList({ ...conforming(), mintPolicies: 'none' }), /must be a list/);
  const badSpent = conforming();
  badSpent.spentPolicies = [SPENT, 'abcd'];
  assert.throws(() => checkTransferProofList(badSpent), /28-byte policy ID/);
  const badProof = conforming();
  badProof.proofPolicies = [SPENT, 42];
  assert.throws(() => checkTransferProofList(badProof), /policy ID string/);
});

test('the checker does not mutate its claim', () => {
  const claim = conforming();
  const snapshot = JSON.parse(JSON.stringify(claim));
  checkTransferProofList(claim);
  assert.deepEqual(claim, snapshot);
});

test('app wires the transfer proof-list checker: panel, verdicts, honest boundary, v1.170', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /checkTransferProofList/);
  assert.match(app, /proof-list-proofs/);
  assert.match(app, /TRANSFER PROOF LIST · LOCAL MODEL/);
  assert.match(app, /MISSING/);
  assert.match(app, /v1\.170/);
});
