import test from 'node:test';
import assert from 'node:assert/strict';
import { planRegistryProofs, diffRegistryProofs } from '../src/domain.js';

// Same modeled registries as the planner/verifier tests: the spec's
// [A, C, E] example, extended with the keys a registry change would add.
const A = '11'.repeat(28), B = '22'.repeat(28), C = '33'.repeat(28), D = '44'.repeat(28);
const E = '55'.repeat(28), MID = '40'.repeat(28), HIGH = '48'.repeat(28), LOW = '00'.repeat(28);

test('identical lists leave every proof unchanged, with no keys added or removed', () => {
  const d = diffRegistryProofs([A, C, E], [A, C, E], [C, D, E]);
  assert.equal(d.allUnchanged, true);
  assert.equal(d.unchangedCount, 3);
  assert.equal(d.changedCount, 0);
  assert.deepEqual(d.addedKeys, []);
  assert.deepEqual(d.removedKeys, []);
  assert.deepEqual(d.perPolicy.map(p => p.change), ['unchanged', 'unchanged', 'unchanged']);
  assert.deepEqual(d.perPolicy.map(p => p.changedFields), [[], [], []]);
});

test('inserting a key registers it and shifts the node indices after it', () => {
  // Before [A, C, E], after [A, B, C, E]: B registers; C keeps its node and
  // its next (E) but moves from index 1 to 2; D keeps covering node C and
  // next E but that node moves with it.
  const d = diffRegistryProofs([A, C, E], [A, B, C, E], [B, C, D]);
  assert.deepEqual(d.addedKeys, [B]);
  assert.deepEqual(d.removedKeys, []);
  assert.equal(d.beforeSize, 3);
  assert.equal(d.afterSize, 4);
  const [b, c, dd] = d.perPolicy;
  assert.equal(b.change, 'newly-registered');
  assert.equal(b.before.status, 'unregistered');
  assert.equal(b.before.nodeKey, A);
  assert.equal(b.after.status, 'registered');
  assert.equal(b.after.nodeIndex, 1);
  assert.equal(c.change, 'proof-changed');
  assert.deepEqual(c.changedFields, ['node index']);
  assert.equal(dd.change, 'proof-changed');
  assert.deepEqual(dd.changedFields, ['node index']);
  assert.equal(dd.before.nodeKey, C);
  assert.equal(dd.after.nodeKey, C);
  assert.equal(d.newlyRegisteredCount, 1);
  assert.equal(d.proofChangedCount, 2);
});

test('a successor change alone is a proof change in the next-key position only', () => {
  // HIGH (0x48…) inserts between C and E: C stays registered at index 1,
  // but its node's next is now HIGH, not E.
  const d = diffRegistryProofs([A, C, E], [A, C, HIGH, E], [C]);
  assert.equal(d.perPolicy[0].change, 'proof-changed');
  assert.deepEqual(d.perPolicy[0].changedFields, ['next key']);
  assert.equal(d.perPolicy[0].before.nextKey, E);
  assert.equal(d.perPolicy[0].after.nextKey, HIGH);
});

test('a covering-node change names the node-key position alongside the index', () => {
  // MID (0x40…) inserts between C and D: D's covering node becomes MID.
  const d = diffRegistryProofs([A, C, E], [A, C, MID, E], [D]);
  assert.equal(d.perPolicy[0].change, 'proof-changed');
  assert.deepEqual(d.perPolicy[0].changedFields, ['node index', 'node key']);
  assert.equal(d.perPolicy[0].before.nodeKey, C);
  assert.equal(d.perPolicy[0].after.nodeKey, MID);
  assert.equal(d.perPolicy[0].after.nextKey, E);
});

test('removing the last key deregisters it past the end and strands the policy it covered past', () => {
  const d = diffRegistryProofs([A, C, E], [A, C], [D, E]);
  assert.deepEqual(d.removedKeys, [E]);
  const [dd, e] = d.perPolicy;
  // D was provable by covering node C (next E); with E gone D sorts after
  // the new last key, so it is unprovable in the after model.
  assert.equal(dd.change, 'newly-unprovable');
  assert.equal(dd.after.status, 'unprovable');
  assert.equal(dd.after.reason, 'after-last');
  // E was registered; now it is not — the registration story takes
  // precedence over the provability story even though E is also
  // unprovable in the after model.
  assert.equal(e.change, 'no-longer-registered');
  assert.equal(e.before.status, 'registered');
  assert.equal(e.after.status, 'unprovable');
  assert.equal(d.noLongerRegisteredCount, 1);
  assert.equal(d.newlyUnprovableCount, 1);
});

test('a policy provable against no list becomes provable when a registry appears', () => {
  const d = diffRegistryProofs([], [A, C, E], [D]);
  assert.equal(d.perPolicy[0].change, 'newly-provable');
  assert.equal(d.perPolicy[0].before.status, 'unprovable');
  assert.equal(d.perPolicy[0].before.reason, 'empty-registry');
  assert.equal(d.perPolicy[0].after.status, 'unregistered');
  assert.equal(d.newlyProvableCount, 1);
});

test('registration takes precedence over provability when a policy crosses both', () => {
  // B sorts before the first key of [C, E] (unprovable there); in
  // [A, B, C, E] it is registered — newly-registered, not newly-provable.
  const d = diffRegistryProofs([C, E], [A, B, C, E], [B]);
  assert.equal(d.perPolicy[0].before.status, 'unprovable');
  assert.equal(d.perPolicy[0].change, 'newly-registered');
});

test('emptying the registry makes a registered policy no longer registered', () => {
  const d = diffRegistryProofs([A, C, E], [], [C]);
  assert.deepEqual(d.removedKeys, [A, C, E]);
  assert.equal(d.perPolicy[0].change, 'no-longer-registered');
  assert.equal(d.perPolicy[0].after.reason, 'empty-registry');
});

test('a policy unprovable on both sides is unchanged — the verdict is compared, not the list', () => {
  // LOW sorts before the first key of both lists; the lists differ, but
  // the proof entries differ in no position — both are the same
  // unprovable verdict, and the change is honestly 'unchanged'.
  const d = diffRegistryProofs([A, C, E], [B, C, E], [LOW]);
  assert.equal(d.perPolicy[0].change, 'unchanged');
  assert.equal(d.perPolicy[0].before.reason, 'before-first');
  assert.equal(d.perPolicy[0].after.reason, 'before-first');
});

test('queried duplicates collapse and the comparison is ordered lexicographically', () => {
  const d = diffRegistryProofs([A, C, E], [A, B, C, E], [D, B, B, C]);
  assert.equal(d.queriedCount, 3);
  assert.deepEqual(d.perPolicy.map(p => p.policy), [B, C, D]);
});

test('either list breaking the registry invariants is refused, never diffed around', () => {
  assert.throws(() => diffRegistryProofs([C, A, E], [A, C, E], [D]), /sorted in lexicographic/);
  assert.throws(() => diffRegistryProofs([A, C, E], [A, C, C], [D]), /must be unique/);
  assert.throws(() => diffRegistryProofs([A, C, E], [A, C, E], ['abcd']), /not a 28-byte policy ID/);
  assert.throws(() => diffRegistryProofs('nope', [A, C, E], [D]), /must be an array/);
  assert.throws(() => diffRegistryProofs([A, C, E], [A, C, E], 'nope'), /must be an array/);
});

test("the diff's after proofs are the planner's own output for the after list", () => {
  const afterPlan = planRegistryProofs([A, B, C, E], [B, C, D]);
  const d = diffRegistryProofs([A, C, E], [A, B, C, E], [B, C, D]);
  assert.deepEqual(d.perPolicy.map(p => p.after), afterPlan.proofs);
  const beforePlan = planRegistryProofs([A, C, E], [B, C, D]);
  assert.deepEqual(d.perPolicy.map(p => p.before), beforePlan.proofs);
});

test('counts are consistent: unchanged plus every change class sums to the queried count', () => {
  const d = diffRegistryProofs([A, C, E], [A, B, C], [B, C, D, E]);
  const sum = d.unchangedCount + d.newlyRegisteredCount + d.noLongerRegisteredCount
    + d.newlyProvableCount + d.newlyUnprovableCount + d.proofChangedCount;
  assert.equal(sum, d.queriedCount);
  assert.equal(d.changedCount, d.queriedCount - d.unchangedCount);
  assert.equal(d.allUnchanged, d.changedCount === 0);
});
