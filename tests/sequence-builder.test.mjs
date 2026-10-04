import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromTemplate, toUnits, simulateTransferSequence, blankSequenceStep, copySequenceSteps, addSequenceStep, removeSequenceStep, moveSequenceStep, updateSequenceStep, MAX_SEQUENCE_STEPS } from '../src/domain.js';

const RWA = fromTemplate('rwa'); // supply 1,000,000 · cap 10,000 · allowlist + pause + eligibility on
const DISTRIBUTION = [
  { from: 'issuer', to: 'approved', amount: '250' },
  { from: 'approved', to: 'pending', amount: '100' },
  { from: 'approved', to: 'blocked', amount: '50' },
  { from: 'issuer', to: 'approved', amount: '100' },
];
const balanceSum = r => Object.values(r.balances).reduce((sum, v) => sum + BigInt(v), 0n);

test('a blank step is a well-formed issuer-to-approved transfer', () => {
  assert.deepEqual(blankSequenceStep(), { from: 'issuer', to: 'approved', amount: '100' });
  assert.notEqual(blankSequenceStep(), blankSequenceStep()); // a fresh object each call
  const r = simulateTransferSequence(RWA, [blankSequenceStep()]);
  assert.equal(r.steps[0].allowed, true);
  assert.equal(r.balances.approved, toUnits('100', RWA.decimals).toString());
});

test('copying a sequence validates it and returns independent step objects', () => {
  const copy = copySequenceSteps(DISTRIBUTION);
  assert.deepEqual(copy, DISTRIBUTION);
  assert.notEqual(copy, DISTRIBUTION);
  assert.notEqual(copy[0], DISTRIBUTION[0]);
  copy[0].amount = '999';
  assert.equal(DISTRIBUTION[0].amount, '250'); // the source list is untouched
  assert.throws(() => copySequenceSteps([]));
  assert.throws(() => copySequenceSteps(Array(13).fill(blankSequenceStep())));
  assert.throws(() => copySequenceSteps('not-an-array'));
  assert.throws(() => copySequenceSteps([null]));
  assert.throws(() => copySequenceSteps([{ from: 'issuer', to: 'stranger', amount: '1' }]));
  assert.throws(() => copySequenceSteps([{ from: 'issuer', to: 'approved', amount: 1 }]));
});

test('adding a step appends without mutating the original list', () => {
  const one = [blankSequenceStep()];
  const two = addSequenceStep(one);
  assert.equal(one.length, 1);
  assert.equal(two.length, 2);
  assert.deepEqual(two[1], blankSequenceStep());
  const explicit = addSequenceStep(one, { from: 'approved', to: 'issuer', amount: '40' });
  assert.deepEqual(explicit[1], { from: 'approved', to: 'issuer', amount: '40' });
  assert.throws(() => addSequenceStep(one, { from: 'issuer', to: 'nobody', amount: '1' }));
  const full = Array.from({ length: MAX_SEQUENCE_STEPS }, () => blankSequenceStep());
  assert.throws(() => addSequenceStep(full), /at most 12/);
});

test('removing a step keeps at least one and never mutates the original', () => {
  const removed = removeSequenceStep(DISTRIBUTION, 1);
  assert.deepEqual(removed.map(s => s.amount), ['250', '50', '100']);
  assert.equal(DISTRIBUTION.length, 4);
  assert.throws(() => removeSequenceStep([blankSequenceStep()], 0), /at least one/);
  assert.throws(() => removeSequenceStep(DISTRIBUTION, 4));
  assert.throws(() => removeSequenceStep(DISTRIBUTION, -1));
  assert.throws(() => removeSequenceStep(DISTRIBUTION, 1.5));
});

test('moving a step swaps neighbours; the edges return an unchanged copy', () => {
  const down = moveSequenceStep(DISTRIBUTION, 0, 1);
  assert.deepEqual(down.map(s => s.amount), ['100', '250', '50', '100']);
  const up = moveSequenceStep(DISTRIBUTION, 2, -1);
  assert.deepEqual(up.map(s => s.amount), ['250', '50', '100', '100']);
  assert.equal(DISTRIBUTION[0].amount, '250'); // original order untouched
  const edge = moveSequenceStep(DISTRIBUTION, 0, -1);
  assert.deepEqual(edge, DISTRIBUTION);
  assert.notEqual(edge, DISTRIBUTION);
  assert.deepEqual(moveSequenceStep(DISTRIBUTION, 3, 1), DISTRIBUTION);
  assert.throws(() => moveSequenceStep(DISTRIBUTION, 0, 2));
  assert.throws(() => moveSequenceStep(DISTRIBUTION, 0, 0));
  assert.throws(() => moveSequenceStep(DISTRIBUTION, 9, 1));
});

test('updating a step patches only from, to, and amount', () => {
  const edited = updateSequenceStep(DISTRIBUTION, 1, { to: 'approved', amount: '75' });
  assert.deepEqual(edited[1], { from: 'approved', to: 'approved', amount: '75' });
  assert.deepEqual(DISTRIBUTION[1], { from: 'approved', to: 'pending', amount: '100' }); // untouched
  assert.notEqual(edited[1], DISTRIBUTION[1]);
  assert.throws(() => updateSequenceStep(DISTRIBUTION, 0, { note: 'x' }), /has no note field/);
  assert.throws(() => updateSequenceStep(DISTRIBUTION, 0, { to: 'stranger' }));
  assert.throws(() => updateSequenceStep(DISTRIBUTION, 0, { amount: 5 }));
  assert.throws(() => updateSequenceStep(DISTRIBUTION, 0, null));
  assert.throws(() => updateSequenceStep(DISTRIBUTION, 7, { amount: '1' }));
});

test('a sequence built with the helpers simulates end to end', () => {
  // Start from the distribution preset, turn its denied onward step into a
  // self-transfer, then add a spend-back step.
  let steps = copySequenceSteps(DISTRIBUTION);
  steps = updateSequenceStep(steps, 1, { to: 'approved' });
  steps = addSequenceStep(steps, { from: 'approved', to: 'issuer', amount: '40' });
  const r = simulateTransferSequence(RWA, steps);
  // Funding applies, the self-transfer applies (balance unchanged), the
  // frozen recipient is still denied, the second funding and the spend-back apply.
  assert.deepEqual(r.steps.map(s => s.allowed), [true, true, false, true, true]);
  assert.equal(r.appliedCount, 4);
  assert.equal(r.balances.approved, '310000000'); // 250 + 100 − 40
  assert.equal(balanceSum(r), toUnits(RWA.supply, RWA.decimals));
});

test('the studio wires the custom sequence builder into the Test step', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-action="seq-customize"/);
  assert.match(app, /data-action="seq-add"/);
  assert.match(app, /data-seq-field="from"/);
  assert.match(app, /data-seq-field="to"/);
  assert.match(app, /data-seq-field="amount"/);
  assert.match(app, /data-seq-move/);
  assert.match(app, /data-seq-remove/);
  assert.match(app, /updateSequenceStep\(customSteps\(\)/);
  assert.match(app, /simulateTransferSequence\(state\.design,seqSteps\(\)\)/);
  // Entering custom mode starts from the preset being viewed, and choosing a
  // preset (or a new template) leaves custom mode with a fresh slate.
  assert.match(app, /state\.seqMode='custom';customSteps\(\)/);
  assert.match(app, /state\.seqPreset=target\.dataset\.seqPreset;state\.seqMode='preset'/);
  assert.match(app, /state\.seqMode='preset';state\.seqCustom=null;state\.tab='design'/);
  // The builder keeps the modeled-ledger honesty copy.
  assert.match(app, /Start from the preset you were viewing/);
});
