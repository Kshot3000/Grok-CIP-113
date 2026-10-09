import test from 'node:test';
import assert from 'node:assert/strict';
import { planRegistryProofs } from '../src/domain.js';

// Modeled registry keys: 28-byte policy IDs as 56 lowercase hex chars.
// A/C/E mirror the spec's own worked example (registry [A, C, E], prove D).
const A = '11'.repeat(28), C = '33'.repeat(28), E = '55'.repeat(28), D = '44'.repeat(28);
const B = '22'.repeat(28), F = '66'.repeat(28), LOW = '00'.repeat(28), HIGH = 'ff'.repeat(28);

test("the spec's worked example: D is proved absent by covering node C", () => {
  const plan = planRegistryProofs([A, C, E], [D]);
  assert.equal(plan.proofs.length, 1);
  const p = plan.proofs[0];
  assert.equal(p.status, 'unregistered');
  assert.equal(p.proofType, 'TokenDoesNotExist');
  assert.equal(p.nodeKey, C);
  assert.equal(p.nextKey, E);
  assert.equal(p.nodeIndex, 1);
  // The covering relationship itself: nodeKey < policy < nextKey.
  assert.ok(p.nodeKey < p.policy && p.policy < p.nextKey);
});

test('a registered policy is proved by its own node (TokenExists)', () => {
  const plan = planRegistryProofs([A, C, E], [C]);
  const p = plan.proofs[0];
  assert.equal(p.status, 'registered');
  assert.equal(p.proofType, 'TokenExists');
  assert.equal(p.nodeIndex, 1);
  assert.equal(p.nodeKey, C);
  assert.equal(p.nextKey, E);
  // The last node's next is null in the model — no successor is invented.
  const last = planRegistryProofs([A, C, E], [E]).proofs[0];
  assert.equal(last.nodeIndex, 2);
  assert.equal(last.nextKey, null);
});

test('proofs are ordered lexicographically and duplicates collapse to one distinct proof', () => {
  const plan = planRegistryProofs([A, C, E], [E, D, A, A, D]);
  assert.equal(plan.queriedCount, 3);
  assert.deepEqual(plan.proofs.map(p => p.policy), [A, D, E]);
  assert.deepEqual(plan.proofs.map(p => p.proofType), ['TokenExists', 'TokenDoesNotExist', 'TokenExists']);
  assert.equal(plan.registeredCount, 2);
  assert.equal(plan.unregisteredCount, 1);
  assert.equal(plan.unprovableCount, 0);
});

test('an interior absence is covered by the immediate predecessor, at either end of the list', () => {
  const betweenAC = planRegistryProofs([A, C, E], [B]).proofs[0];
  assert.equal(betweenAC.nodeKey, A);
  assert.equal(betweenAC.nextKey, C);
  const betweenCE = planRegistryProofs([A, C, E], [D]).proofs[0];
  assert.equal(betweenCE.nodeKey, C);
  // A policy just above a key is covered by that key, not the next one.
  const justAbove = planRegistryProofs([A, C, E], ['34'.repeat(28)]).proofs[0];
  assert.equal(justAbove.nodeKey, C);
  assert.equal(justAbove.nextKey, E);
});

test('boundary absences have no covering node in the model and are reported, never invented', () => {
  const before = planRegistryProofs([A, C, E], [LOW]).proofs[0];
  assert.equal(before.status, 'unprovable');
  assert.equal(before.reason, 'before-first');
  assert.equal(before.proofType, null);
  assert.equal(before.nodeKey, null);
  const after = planRegistryProofs([A, C, E], [HIGH]).proofs[0];
  assert.equal(after.status, 'unprovable');
  assert.equal(after.reason, 'after-last');
  const empty = planRegistryProofs([], [A]).proofs[0];
  assert.equal(empty.status, 'unprovable');
  assert.equal(empty.reason, 'empty-registry');
});

test('a single-node registry proves its own key and nothing interior', () => {
  const plan = planRegistryProofs([C], [C, B, F]);
  assert.deepEqual(plan.proofs.map(p => p.status), ['unprovable', 'registered', 'unprovable']);
  assert.deepEqual(plan.proofs.map(p => p.reason), ['before-first', null, 'after-last']);
});

test('an empty query list plans no proofs against a valid registry', () => {
  const plan = planRegistryProofs([A, C], []);
  assert.deepEqual(plan.proofs, []);
  assert.equal(plan.registrySize, 2);
  assert.equal(plan.queriedCount, 0);
});

test('uppercase policy IDs are the same IDs, stated in canonical lowercase', () => {
  const plan = planRegistryProofs([A.toUpperCase(), C.toUpperCase()], [C.toUpperCase(), D.toUpperCase()]);
  assert.deepEqual(plan.keys, [A, C]);
  assert.equal(plan.proofs[0].policy, C);
  assert.equal(plan.proofs[0].status, 'registered');
  // D is after the last key of this two-node list — a boundary case.
  assert.equal(plan.proofs[1].policy, D);
  assert.equal(plan.proofs[1].reason, 'after-last');
});

test('a registry list that breaks the linked-list invariants is refused, never silently fixed', () => {
  assert.throws(() => planRegistryProofs([C, A], [A]), /lexicographic/);
  assert.throws(() => planRegistryProofs([A, A], [A]), /unique/);
  assert.throws(() => planRegistryProofs(['abcd'], [A]), /28-byte policy ID/);
  assert.throws(() => planRegistryProofs([A, 'zz'.repeat(28)], [A]), /28-byte policy ID/);
  assert.throws(() => planRegistryProofs('not-a-list', [A]), /array/);
});

test('a malformed policy to prove is refused with its position', () => {
  assert.throws(() => planRegistryProofs([A], ['abcd']), /Policy to prove 1 is not a 28-byte policy ID/);
  assert.throws(() => planRegistryProofs([A], [A, 42]), /must be a policy ID string/);
  assert.throws(() => planRegistryProofs([A], 'not-a-list'), /array/);
});

test('planning never mutates its inputs', () => {
  const registry = Object.freeze([A, C, E]);
  const queried = Object.freeze([E, D, A]);
  const plan = planRegistryProofs(registry, queried);
  assert.deepEqual([...registry], [A, C, E]);
  assert.deepEqual([...queried], [E, D, A]);
  assert.equal(plan.proofs.length, 3);
});
