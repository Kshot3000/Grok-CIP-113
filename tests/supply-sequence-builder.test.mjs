import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromTemplate, simulateSupplySequence, blankSupplyStep, copySupplySteps, addSupplyStep, removeSupplyStep, moveSupplyStep, updateSupplyStep, MAX_SUPPLY_SEQUENCE_STEPS } from '../src/domain.js';

const RWA = fromTemplate('rwa'); // supply 1,000,000 · 6 decimals
const SCHEDULE = [
  { action: 'mint', actor: 'issuer', amount: '250000' },
  { action: 'burn', actor: 'issuer', amount: '100000' },
  { action: 'mint', actor: 'issuer', amount: '50000' },
];

test('a blank step is a well-formed issuer mint', () => {
  assert.deepEqual(blankSupplyStep(), { action: 'mint', actor: 'issuer', amount: '100' });
  assert.notEqual(blankSupplyStep(), blankSupplyStep()); // a fresh object each call
  const r = simulateSupplySequence(RWA, [blankSupplyStep()]);
  assert.equal(r.steps[0].allowed, true);
  assert.equal(r.finalSupplyBaseUnits, '1000100000000'); // 1,000,000 + 100, in base units
});

test('copying a supply sequence validates it and returns independent step objects', () => {
  const copy = copySupplySteps(SCHEDULE);
  assert.deepEqual(copy, SCHEDULE);
  assert.notEqual(copy, SCHEDULE);
  assert.notEqual(copy[0], SCHEDULE[0]);
  copy[0].amount = '999';
  assert.equal(SCHEDULE[0].amount, '250000'); // the source list is untouched
  assert.throws(() => copySupplySteps([]));
  assert.throws(() => copySupplySteps(Array(13).fill(blankSupplyStep())));
  assert.throws(() => copySupplySteps('not-an-array'));
  assert.throws(() => copySupplySteps([null]));
  assert.throws(() => copySupplySteps([{ action: 'print', actor: 'issuer', amount: '1' }]));
  assert.throws(() => copySupplySteps([{ action: 'mint', actor: 'stranger', amount: '1' }]));
  assert.throws(() => copySupplySteps([{ action: 'mint', actor: 'issuer', amount: 1 }]));
});

test('adding a supply step appends without mutating the original list', () => {
  const one = [blankSupplyStep()];
  const two = addSupplyStep(one);
  assert.equal(one.length, 1);
  assert.equal(two.length, 2);
  assert.deepEqual(two[1], blankSupplyStep());
  const explicit = addSupplyStep(one, { action: 'burn', actor: 'other', amount: '40' });
  assert.deepEqual(explicit[1], { action: 'burn', actor: 'other', amount: '40' });
  assert.throws(() => addSupplyStep(one, { action: 'mint', actor: 'nobody', amount: '1' }));
  const full = Array.from({ length: MAX_SUPPLY_SEQUENCE_STEPS }, () => blankSupplyStep());
  assert.throws(() => addSupplyStep(full), /at most 12/);
});

test('removing a supply step keeps at least one and never mutates the original', () => {
  const removed = removeSupplyStep(SCHEDULE, 1);
  assert.deepEqual(removed.map(s => s.amount), ['250000', '50000']);
  assert.equal(SCHEDULE.length, 3);
  assert.throws(() => removeSupplyStep([blankSupplyStep()], 0), /at least one/);
  assert.throws(() => removeSupplyStep(SCHEDULE, 3));
  assert.throws(() => removeSupplyStep(SCHEDULE, -1));
  assert.throws(() => removeSupplyStep(SCHEDULE, 1.5));
});

test('moving a supply step swaps neighbours; the edges return an unchanged copy', () => {
  const down = moveSupplyStep(SCHEDULE, 0, 1);
  assert.deepEqual(down.map(s => s.amount), ['100000', '250000', '50000']);
  const up = moveSupplyStep(SCHEDULE, 2, -1);
  assert.deepEqual(up.map(s => s.amount), ['250000', '50000', '100000']);
  assert.equal(SCHEDULE[0].amount, '250000'); // original order untouched
  const edge = moveSupplyStep(SCHEDULE, 0, -1);
  assert.deepEqual(edge, SCHEDULE);
  assert.notEqual(edge, SCHEDULE);
  assert.deepEqual(moveSupplyStep(SCHEDULE, 2, 1), SCHEDULE);
  assert.throws(() => moveSupplyStep(SCHEDULE, 0, 2));
  assert.throws(() => moveSupplyStep(SCHEDULE, 0, 0));
  assert.throws(() => moveSupplyStep(SCHEDULE, 9, 1));
});

test('updating a supply step patches only action, actor, and amount', () => {
  const edited = updateSupplyStep(SCHEDULE, 1, { action: 'mint', actor: 'other' });
  assert.deepEqual(edited[1], { action: 'mint', actor: 'other', amount: '100000' });
  assert.deepEqual(SCHEDULE[1], { action: 'burn', actor: 'issuer', amount: '100000' }); // untouched
  assert.notEqual(edited[1], SCHEDULE[1]);
  assert.throws(() => updateSupplyStep(SCHEDULE, 0, { note: 'x' }), /has no note field/);
  assert.throws(() => updateSupplyStep(SCHEDULE, 0, { action: 'print' }));
  assert.throws(() => updateSupplyStep(SCHEDULE, 0, { actor: 'stranger' }));
  assert.throws(() => updateSupplyStep(SCHEDULE, 0, { amount: 5 }));
  assert.throws(() => updateSupplyStep(SCHEDULE, 0, null));
  assert.throws(() => updateSupplyStep(SCHEDULE, 7, { amount: '1' }));
});

test('a supply sequence built with the helpers simulates end to end', () => {
  // Start from the schedule preset, turn its burn into an unauthorised
  // attempt, then append a burn that only fits because the first mint applied.
  let steps = copySupplySteps(SCHEDULE);
  steps = updateSupplyStep(steps, 1, { actor: 'other' });
  steps = addSupplyStep(steps, { action: 'burn', actor: 'issuer', amount: '1200000' });
  const r = simulateSupplySequence(RWA, steps);
  // Mint applies (1,250,000), the non-issuer burn is blocked, the second mint
  // applies (1,300,000), and the final burn of 1,200,000 fits what remains.
  assert.deepEqual(r.steps.map(s => s.allowed), [true, false, true, true]);
  assert.equal(r.appliedCount, 3);
  assert.equal(r.finalSupplyBaseUnits, '100000000000'); // exactly 100,000 left
  assert.equal(r.netChangeBaseUnits, '-900000000000');
});

test('order matters: a burn moved ahead of the mints that fund it stays blocked', () => {
  // A burn of 1,200,000 only fits after the schedule's mints land (the running
  // supply reaches exactly 1,200,000); moved to the front, it exceeds the
  // designed supply at that step and is blocked, leaving the rest intact.
  let steps = copySupplySteps(SCHEDULE);
  steps = addSupplyStep(steps, { action: 'burn', actor: 'issuer', amount: '1200000' });
  const inOrder = simulateSupplySequence(RWA, steps);
  assert.deepEqual(inOrder.steps.map(s => s.allowed), [true, true, true, true]);
  assert.equal(inOrder.finalSupplyBaseUnits, '0');
  let reordered = moveSupplyStep(steps, 3, -1);
  reordered = moveSupplyStep(reordered, 2, -1);
  reordered = moveSupplyStep(reordered, 1, -1);
  const moved = simulateSupplySequence(RWA, reordered);
  assert.equal(moved.steps[0].amount, '1200000');
  assert.equal(moved.steps[0].allowed, false); // 1,200,000 > the 1,000,000 modeled at step 1
  assert.equal(moved.appliedCount, 3);
  assert.equal(moved.finalSupplyBaseUnits, '1200000000000');
});

test('the studio wires the custom supply builder into the Test step', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-action="supply-seq-customize"/);
  assert.match(app, /data-action="supply-seq-add"/);
  assert.match(app, /data-supply-seq-field="action"/);
  assert.match(app, /data-supply-seq-field="actor"/);
  assert.match(app, /data-supply-seq-field="amount"/);
  assert.match(app, /data-supply-seq-move/);
  assert.match(app, /data-supply-seq-remove/);
  assert.match(app, /updateSupplyStep\(supplyCustomSteps\(\)/);
  assert.match(app, /simulateSupplySequence\(state\.design,supplySeqSteps\(\)\)/);
  // Entering custom mode starts from the preset being viewed, and choosing a
  // preset (or a new template) leaves custom mode with a fresh slate.
  assert.match(app, /state\.supplySeqMode='custom';supplyCustomSteps\(\)/);
  assert.match(app, /state\.supplySeqPreset=target\.dataset\.supplySeqPreset;state\.supplySeqMode='preset'/);
  assert.match(app, /state\.supplySeqMode='preset';state\.supplySeqCustom=null/);
  // The builder keeps the modeled-supply honesty copy.
  assert.match(app, /Start from the preset you were viewing, then change actions, actors, and amounts/);
});
