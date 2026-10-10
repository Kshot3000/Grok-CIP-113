import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planRegistryInsertion, diffRegistryInsertion, REGISTRY_INSERT_COMPARE_FIELDS } from '../src/domain.js';

// Registry insertion comparison — the comparison counterpart to the
// insertion planner/verifier pair. Planning says where a policy would
// insert into one modeled registry; comparing says how that planned
// insertion changes when the registry itself changes first. Both sides
// are planned by planRegistryInsertion itself, so compare and plan can
// never disagree. Four positions only: the plan's successorKey restates
// its new node's next, so it is verified by the plan, never counted as
// a difference of its own.
const A = '11'.repeat(28), B = '22'.repeat(28), C = '33'.repeat(28), MID = '3f'.repeat(28), D = '44'.repeat(28), E = '55'.repeat(28);
const LOW = '0a'.repeat(28);

test('the same registry on both sides compares as unchanged on all four positions', () => {
  const r = diffRegistryInsertion([A, C, E], [A, C, E], D);
  assert.equal(r.change, 'unchanged');
  assert.equal(r.unchanged, true);
  assert.deepEqual(r.differences, []);
  assert.deepEqual(r.changedFields, []);
  assert.equal(REGISTRY_INSERT_COMPARE_FIELDS.length, 4);
});

test('comparison returns exactly its eleven keys, and each difference exactly four', () => {
  const r = diffRegistryInsertion([A, C, E], [A, C, D, E], D);
  assert.deepEqual(Object.keys(r).sort(), ['addedKeys', 'after', 'afterSize', 'before', 'beforeSize', 'change', 'changedFields', 'differences', 'policy', 'removedKeys', 'unchanged'].sort());
  for (const diff of r.differences) assert.deepEqual(Object.keys(diff).sort(), ['after', 'before', 'field', 'label']);
});

test('both sides are the planner returns planRegistryInsertion itself produces', () => {
  const r = diffRegistryInsertion([A, C, E], [A, B, C, E], D);
  assert.deepEqual(r.before, planRegistryInsertion([A, C, E], D));
  assert.deepEqual(r.after, planRegistryInsertion([A, B, C, E], D));
});

test('the after list registering the policy itself is newly registered — status and prev node differ, index and next do not', () => {
  // Before: D would insert at index 2, spending C, pointing at E.
  // After: D IS node 2, pointing at E — the same index and next, so the
  // registration story is exactly two differences, not four.
  const r = diffRegistryInsertion([A, C, E], [A, C, D, E], D);
  assert.equal(r.change, 'newly-registered');
  assert.deepEqual(r.differences, [
    { field: 'status', label: 'Status', before: 'insertable', after: 'already-registered' },
    { field: 'prevNode', label: 'Prev node', before: C, after: null },
  ]);
  assert.deepEqual(r.addedKeys, [D]);
  assert.deepEqual(r.removedKeys, []);
});

test('the reverse change is no longer registered', () => {
  const r = diffRegistryInsertion([A, C, D, E], [A, C, E], D);
  assert.equal(r.change, 'no-longer-registered');
  assert.deepEqual(r.changedFields, ['Status', 'Prev node']);
  assert.deepEqual(r.removedKeys, [D]);
});

test('an insertion ahead of the position shifts the insertion index alone', () => {
  const r = diffRegistryInsertion([A, C, E], [A, B, C, E], D);
  assert.equal(r.change, 'position-changed');
  assert.deepEqual(r.differences, [{ field: 'insertionIndex', label: 'Insertion index', before: 2, after: 3 }]);
});

test('an insertion between prev node and policy replaces the prev node as well as the index', () => {
  const r = diffRegistryInsertion([A, C, E], [A, C, MID, E], D);
  assert.equal(r.change, 'position-changed');
  assert.deepEqual(r.differences, [
    { field: 'insertionIndex', label: 'Insertion index', before: 2, after: 3 },
    { field: 'prevNode', label: 'Prev node', before: C, after: MID },
  ]);
});

test('removing the successor is ONE difference — the node next — never two', () => {
  // The plan's successorKey restates the new node's next; counting both
  // would double-count this single change.
  const r = diffRegistryInsertion([A, C, E], [A, C], D);
  assert.equal(r.change, 'position-changed');
  assert.deepEqual(r.differences, [{ field: 'nodeNext', label: 'Node next', before: E, after: 'terminal' }]);
});

test('a registered policy whose node is shifted by an earlier insertion is node-changed on its index alone', () => {
  const r = diffRegistryInsertion([A, C, E], [A, B, C, E], C);
  assert.equal(r.change, 'node-changed');
  assert.deepEqual(r.differences, [{ field: 'insertionIndex', label: 'Insertion index', before: 1, after: 2 }]);
});

test('a registered last node losing its successor is node-changed on its next alone — a key against the terminal', () => {
  const r = diffRegistryInsertion([A, C, E], [A, C], C);
  assert.equal(r.change, 'node-changed');
  assert.deepEqual(r.differences, [{ field: 'nodeNext', label: 'Node next', before: E, after: 'terminal' }]);
});

test('a policy sorting before every key keeps the origin prev node on both sides while its next changes', () => {
  const r = diffRegistryInsertion([A, C, E], [], LOW);
  assert.equal(r.change, 'position-changed');
  assert.deepEqual(r.differences, [{ field: 'nodeNext', label: 'Node next', before: A, after: 'terminal' }]);
});

test('an empty registry gaining exactly the policy is newly registered', () => {
  const r = diffRegistryInsertion([], [D], D);
  assert.equal(r.change, 'newly-registered');
  assert.equal(r.beforeSize, 0);
  assert.equal(r.afterSize, 1);
});

test('values compare in the canonical form the planner writes — hex case alone compares as unchanged', () => {
  const upper = keys => keys.map(k => k.toUpperCase());
  const r = diffRegistryInsertion(upper([A, C, E]), [A, C, E], D.toUpperCase());
  assert.equal(r.change, 'unchanged');
  assert.equal(r.policy, D);
});

test('a list that breaks the registry invariants is refused on either side, with the planner reason', () => {
  assert.throws(() => diffRegistryInsertion([C, A], [A, C, E], D), /sorted in lexicographic/);
  assert.throws(() => diffRegistryInsertion([A, C, E], [C, A], D), /sorted in lexicographic/);
  assert.throws(() => diffRegistryInsertion([A, A], [A], D), /more than once/);
});

test('a policy that is not a 28-byte ID is refused, never compared', () => {
  assert.throws(() => diffRegistryInsertion([A, C, E], [A, C, E], 'zz'), /28-byte policy ID/);
  assert.throws(() => diffRegistryInsertion([A, C, E], [A, C, E], '44'.repeat(10)), /28-byte policy ID/);
});

test('the app wires the insertion comparison into the registry panel at the current version', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /diffRegistryInsertion/);
  assert.match(app, /registryInsertDiffPreview/);
  assert.match(app, /registry-insert-diff-result/);
  assert.match(app, /registry-insert-diff-after/);
  assert.match(app, /v1\.101/);
});
