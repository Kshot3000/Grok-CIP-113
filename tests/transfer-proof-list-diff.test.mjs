import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkTransferProofList, diffTransferProofList, TRANSFER_PROOF_LIST_COMPARE_FIELDS } from '../src/domain.js';

// TransferAct proof-list impact (spec: RegistryProof Requirements,
// re-read 2026-10-11): the required set is DERIVED from the
// transaction the list rides in, so a proof list that conformed
// when modeled can be staled by an assembly change that never
// touches the list — a UTxO spent from a base address added, a
// mint joining — or by the list being rebuilt in another order.
// Both versions are checked through checkTransferProofList itself,
// and four positions are compared: the status, the required
// policies, completeness, and ordering.
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

test('an unchanged transfer compares as unchanged on all four positions', () => {
  const d = diffTransferProofList(conforming(), conforming());
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.changedFields, []);
  assert.equal(d.changedCount, 0);
  assert.equal(d.positionCount, 4);
  assert.deepEqual(d.sourceChangedPolicies, []);
  assert.deepEqual(d.addedProofs, []);
  assert.deepEqual(d.removedProofs, []);
  assert.deepEqual([...TRANSFER_PROOF_LIST_COMPARE_FIELDS].map(f => f[0]), ['status', 'required', 'completeness', 'ordering']);
});

test('dropping a proof makes the list BECAME NOT CONFORMING, on the status and completeness positions', () => {
  const after = conforming();
  after.proofPolicies = [SPENT];
  const d = diffTransferProofList(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Completeness']);
  assert.deepEqual(d.removedProofs, [ALSO_SPENT]);
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, false);
});

test('restoring the dropped proof makes the list BECAME CONFORMING', () => {
  const before = conforming();
  before.proofPolicies = [SPENT];
  const d = diffTransferProofList(before, conforming());
  assert.equal(d.change, 'became-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Completeness']);
  assert.deepEqual(d.addedProofs, [ALSO_SPENT]);
});

test('adding a spent policy and proving it in byte order is REQUIREMENT CHANGED: conforming on both sides, a different required set', () => {
  const after = conforming();
  after.spentPolicies = [SPENT, ALSO_SPENT, EARLIER];
  after.proofPolicies = [EARLIER, SPENT, ALSO_SPENT];
  const d = diffTransferProofList(conforming(), after);
  assert.equal(d.change, 'requirement-changed');
  assert.equal(d.before.valid, true);
  assert.equal(d.after.valid, true);
  assert.deepEqual(d.changedFields, ['Required policies']);
  assert.deepEqual(d.differences[0].before, [SPENT, ALSO_SPENT]);
  assert.deepEqual(d.differences[0].after, [EARLIER, SPENT, ALSO_SPENT]);
  assert.deepEqual(d.addedProofs, [EARLIER]);
});

test('adding a spent policy WITHOUT proving it is BECAME NOT CONFORMING — the conformance story takes precedence over the required set’s move', () => {
  const after = conforming();
  after.spentPolicies = [SPENT, ALSO_SPENT, MINT_ONLY];
  const d = diffTransferProofList(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Required policies', 'Completeness']);
});

test('a list not conforming on both sides whose missing policy changed underneath it is STILL NOT CONFORMING', () => {
  const before = conforming();
  before.proofPolicies = [SPENT];
  const after = conforming();
  after.spentPolicies = [SPENT, MINT_ONLY];
  after.proofPolicies = [SPENT];
  const d = diffTransferProofList(before, after);
  assert.equal(d.change, 'still-not-conforming');
  assert.equal(d.before.valid, false);
  assert.equal(d.after.valid, false);
  assert.deepEqual(d.changedFields, ['Required policies']);
  assert.deepEqual(d.before.completeness.missing, [ALSO_SPENT]);
  assert.deepEqual(d.after.completeness.missing, [MINT_ONLY]);
});

test('rebuilding the same list in the wrong order breaks only ordering: BECAME NOT CONFORMING on status and ordering', () => {
  const after = conforming();
  after.proofPolicies = [ALSO_SPENT, SPENT];
  const d = diffTransferProofList(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Ordering']);
  assert.deepEqual(d.addedProofs, []);
  assert.deepEqual(d.removedProofs, []);
});

test('an extra proof is BECAME NOT CONFORMING on completeness, and the extra policy is reported as an added proof', () => {
  const after = conforming();
  after.proofPolicies = [SPENT, ALSO_SPENT, STRANGER];
  const d = diffTransferProofList(conforming(), after);
  assert.equal(d.change, 'became-not-conforming');
  assert.deepEqual(d.changedFields, ['Status', 'Completeness']);
  assert.deepEqual(d.addedProofs, [STRANGER]);
});

test('a required policy moving from spent-and-minted to spent-only moves no position: reported as a source change, never counted (pinned)', () => {
  const after = conforming();
  after.mintPolicies = [];
  const d = diffTransferProofList(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.differences, []);
  assert.deepEqual(d.sourceChangedPolicies, [SPENT]);
});

test('a spent policy also joining the mint is likewise a source change only (pinned)', () => {
  const after = conforming();
  after.mintPolicies = [SPENT, ALSO_SPENT];
  const d = diffTransferProofList(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.sourceChangedPolicies, [ALSO_SPENT]);
});

test('an added occurrence of an already-required policy changes nothing at all: occurrences collapse on both sides', () => {
  const after = conforming();
  after.spentPolicies = [SPENT, ALSO_SPENT, SPENT];
  after.mintPolicies = [SPENT, SPENT];
  const d = diffTransferProofList(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.sourceChangedPolicies, []);
  assert.deepEqual(d.differences, []);
});

test('hex case alone is the same transfer: uppercase policies in the after version compare as unchanged', () => {
  const after = conforming();
  after.proofPolicies = [SPENT.toUpperCase(), ALSO_SPENT.toUpperCase()];
  const d = diffTransferProofList(conforming(), after);
  assert.equal(d.change, 'unchanged');
  assert.deepEqual(d.addedProofs, []);
});

test('refusal discipline: a version that cannot be read is refused on either side with the checker’s reason, never compared around', () => {
  const badAfter = conforming();
  badAfter.proofPolicies = ['cc'.repeat(10)];
  assert.throws(() => diffTransferProofList(conforming(), badAfter), /28-byte/);
  const badBefore = conforming();
  badBefore.spentPolicies = [];
  assert.throws(() => diffTransferProofList(badBefore, conforming()), /non-empty list/);
  assert.throws(() => diffTransferProofList({ ...conforming(), proofs: [] }, conforming()), /unknown field/);
});

test('the comparison does not mutate either claim, and its two sides are the checker’s own verdicts', () => {
  const before = conforming();
  const after = conforming();
  after.proofPolicies = [SPENT];
  const bSnap = JSON.parse(JSON.stringify(before));
  const aSnap = JSON.parse(JSON.stringify(after));
  const d = diffTransferProofList(before, after);
  assert.deepEqual(before, bSnap);
  assert.deepEqual(after, aSnap);
  assert.deepEqual(d.before, checkTransferProofList(bSnap));
  assert.deepEqual(d.after, checkTransferProofList(aSnap));
});

test('app wires the transfer proof-list impact comparison: panel, verdicts, honest boundary, v1.247', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /diffTransferProofList/);
  assert.match(app, /proof-list-diff-after-spent/);
  assert.match(app, /proof-list-diff-after-proofs/);
  assert.match(app, /TRANSFER PROOF LIST IMPACT · LOCAL MODEL/);
  assert.match(app, /BECAME NOT CONFORMING/);
  assert.match(app, /REQUIREMENT CHANGED/);
  assert.match(app, /v1\.247/);
});
