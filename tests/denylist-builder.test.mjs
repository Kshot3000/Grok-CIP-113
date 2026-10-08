import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromTemplate, simulateDenylistSequence, blankDenylistStep, copyDenylistSteps, addDenylistStep, removeDenylistStep, moveDenylistStep, updateDenylistStep, MAX_DENYLIST_STEPS } from '../src/domain.js';

const design = fromTemplate('stable'); // freeze-and-seize, supply 1,000,000 PDC, 6 decimals
const LIFECYCLE = [
  { kind: 'transfer', from: 'issuer', to: 'approved', amount: '250' },
  { kind: 'denylist', account: 'approved', listed: true },
  { kind: 'transfer', from: 'approved', to: 'issuer', amount: '100' },
  { kind: 'seize', actor: 'authorised', holder: 'approved', amount: '150' },
  { kind: 'denylist', account: 'approved', listed: false },
  { kind: 'transfer', from: 'approved', to: 'issuer', amount: '100' },
];
const sum = balances => Object.values(balances).reduce((a, v) => a + BigInt(v), 0n).toString();

test('blank denylist steps are well-formed for all three kinds', () => {
  assert.deepEqual(blankDenylistStep(), { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100' });
  assert.deepEqual(blankDenylistStep('denylist'), { kind: 'denylist', account: 'approved', listed: true });
  assert.deepEqual(blankDenylistStep('seize'), { kind: 'seize', actor: 'authorised', holder: 'approved', amount: '100' });
  assert.notEqual(blankDenylistStep(), blankDenylistStep()); // a fresh object each call
  assert.throws(() => blankDenylistStep('pause'));
  // A blank transfer applies; a blank denylist update applies as a state
  // change; a blank seizure is blocked (its holder is not listed yet) —
  // blocked by the model, not malformed.
  const r = simulateDenylistSequence(design, [blankDenylistStep(), blankDenylistStep('denylist'), blankDenylistStep('seize')]);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, true, true]);
  assert.equal(r.balances.approved, '0'); // 100 funded, then 100 seized back
});

test('copying a lifecycle validates all three kinds and returns independent step objects', () => {
  const copy = copyDenylistSteps(LIFECYCLE);
  assert.deepEqual(copy, LIFECYCLE);
  assert.notEqual(copy, LIFECYCLE);
  assert.notEqual(copy[0], LIFECYCLE[0]);
  copy[0].amount = '999';
  assert.equal(LIFECYCLE[0].amount, '250'); // the source list is untouched
  assert.throws(() => copyDenylistSteps([]));
  assert.throws(() => copyDenylistSteps(Array(13).fill(blankDenylistStep())));
  assert.throws(() => copyDenylistSteps('not-an-array'));
  assert.throws(() => copyDenylistSteps([null]));
  assert.throws(() => copyDenylistSteps([{ kind: 'pause', amount: '1' }]));
  assert.throws(() => copyDenylistSteps([{ kind: 'transfer', from: 'stranger', to: 'approved', amount: '1' }]));
  assert.throws(() => copyDenylistSteps([{ kind: 'transfer', from: 'issuer', to: 'approved', amount: 1 }]));
  assert.throws(() => copyDenylistSteps([{ kind: 'denylist', account: 'stranger', listed: true }]));
  assert.throws(() => copyDenylistSteps([{ kind: 'denylist', account: 'approved', listed: 'yes' }]));
  assert.throws(() => copyDenylistSteps([{ kind: 'seize', actor: 'issuer', holder: 'approved', amount: '1' }]));
  assert.throws(() => copyDenylistSteps([{ kind: 'seize', actor: 'authorised', holder: 'stranger', amount: '1' }]));
});

test('adding a lifecycle step appends any kind without mutating the original list', () => {
  const one = [blankDenylistStep()];
  const two = addDenylistStep(one);
  assert.equal(one.length, 1);
  assert.equal(two.length, 2);
  assert.deepEqual(two[1], blankDenylistStep());
  const withSeize = addDenylistStep(one, blankDenylistStep('seize'));
  assert.deepEqual(withSeize[1], { kind: 'seize', actor: 'authorised', holder: 'approved', amount: '100' });
  assert.throws(() => addDenylistStep(one, { kind: 'denylist', account: 'nobody', listed: true }));
  const full = Array.from({ length: MAX_DENYLIST_STEPS }, () => blankDenylistStep());
  assert.throws(() => addDenylistStep(full), /at most 12/);
  assert.equal(MAX_DENYLIST_STEPS, 12);
});

test('removing a lifecycle step keeps at least one and never mutates the original', () => {
  const removed = removeDenylistStep(LIFECYCLE, 1);
  assert.deepEqual(removed.map(s => s.kind), ['transfer', 'transfer', 'seize', 'denylist', 'transfer']);
  assert.equal(LIFECYCLE.length, 6);
  assert.throws(() => removeDenylistStep([blankDenylistStep()], 0), /at least one/);
  assert.throws(() => removeDenylistStep(LIFECYCLE, 6));
  assert.throws(() => removeDenylistStep(LIFECYCLE, -1));
  assert.throws(() => removeDenylistStep(LIFECYCLE, 1.5));
});

test('moving a lifecycle step swaps neighbours across kinds; the edges return an unchanged copy', () => {
  const down = moveDenylistStep(LIFECYCLE, 0, 1);
  assert.deepEqual(down.map(s => s.kind), ['denylist', 'transfer', 'transfer', 'seize', 'denylist', 'transfer']);
  assert.equal(LIFECYCLE[0].kind, 'transfer'); // original order untouched
  const edge = moveDenylistStep(LIFECYCLE, 0, -1);
  assert.deepEqual(edge, LIFECYCLE);
  assert.notEqual(edge, LIFECYCLE);
  assert.deepEqual(moveDenylistStep(LIFECYCLE, 5, 1), LIFECYCLE);
  assert.throws(() => moveDenylistStep(LIFECYCLE, 0, 2));
  assert.throws(() => moveDenylistStep(LIFECYCLE, 0, 0));
  assert.throws(() => moveDenylistStep(LIFECYCLE, 9, 1));
});

test('updating a lifecycle step patches only the fields its kind carries', () => {
  const edited = updateDenylistStep(LIFECYCLE, 0, { to: 'pending', amount: '300' });
  assert.deepEqual(edited[0], { kind: 'transfer', from: 'issuer', to: 'pending', amount: '300' });
  assert.deepEqual(LIFECYCLE[0], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '250' }); // untouched
  const unlisted = updateDenylistStep(LIFECYCLE, 1, { listed: false });
  assert.deepEqual(unlisted[1], { kind: 'denylist', account: 'approved', listed: false });
  const byOther = updateDenylistStep(LIFECYCLE, 3, { actor: 'other' });
  assert.deepEqual(byOther[3], { kind: 'seize', actor: 'other', holder: 'approved', amount: '150' });
  assert.throws(() => updateDenylistStep(LIFECYCLE, 0, { account: 'approved' }), /has no account field/);
  assert.throws(() => updateDenylistStep(LIFECYCLE, 1, { amount: '5' }), /has no amount field/);
  assert.throws(() => updateDenylistStep(LIFECYCLE, 3, { from: 'issuer' }), /has no from field/);
  assert.throws(() => updateDenylistStep(LIFECYCLE, 0, { note: 'x' }), /has no note field/);
  assert.throws(() => updateDenylistStep(LIFECYCLE, 0, { kind: 'pause' }));
  assert.throws(() => updateDenylistStep(LIFECYCLE, 1, { listed: 'true' })); // the flag is a boolean, not a string
  assert.throws(() => updateDenylistStep(LIFECYCLE, 0, { amount: 5 }));
  assert.throws(() => updateDenylistStep(LIFECYCLE, 0, null));
  assert.throws(() => updateDenylistStep(LIFECYCLE, 7, { amount: '1' }));
});

test('switching a step kind converts it: amount kept where both kinds carry one, no stale fields', () => {
  const toSeize = updateDenylistStep(LIFECYCLE, 0, { kind: 'seize' });
  assert.deepEqual(toSeize[0], { kind: 'seize', actor: 'authorised', holder: 'approved', amount: '250' }); // amount kept
  const toDenylist = updateDenylistStep(LIFECYCLE, 0, { kind: 'denylist' });
  assert.deepEqual(toDenylist[0], { kind: 'denylist', account: 'approved', listed: true }); // amount dropped — this kind carries none
  const fromDenylist = updateDenylistStep(LIFECYCLE, 1, { kind: 'transfer' });
  assert.deepEqual(fromDenylist[1], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100' }); // default amount — the old kind had none to keep
  const fromDenylistSized = updateDenylistStep(LIFECYCLE, 1, { kind: 'seize', amount: '75' });
  assert.deepEqual(fromDenylistSized[1], { kind: 'seize', actor: 'authorised', holder: 'approved', amount: '75' });
  assert.deepEqual(LIFECYCLE[0], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '250' }); // untouched
  assert.deepEqual(LIFECYCLE[1], { kind: 'denylist', account: 'approved', listed: true }); // untouched
});

test('a lifecycle built with the helpers simulates end to end', () => {
  // Start from the listed-mid-flight shape, shrink the seizure, then append
  // a second listing-and-seizure round the first round leaves funded.
  let steps = copyDenylistSteps(LIFECYCLE);
  steps = updateDenylistStep(steps, 3, { amount: '100' });
  steps = addDenylistStep(steps, { kind: 'denylist', account: 'approved', listed: true });
  steps = addDenylistStep(steps, { kind: 'seize', actor: 'authorised', holder: 'approved', amount: '50' });
  const r = simulateDenylistSequence(design, steps);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, true, false, true, true, true, true, true]);
  assert.equal(r.appliedCount, 7);
  assert.equal(r.seizedBaseUnits, (150n * 1000000n).toString());
  assert.equal(sum(r.balances), (1000000n * 1000000n).toString());
});

test('order matters across kinds: listing before funding blocks what listing after funding allows', () => {
  // The same funding transfer and the same listing: fund first and the
  // transfer applies (the listing then governs later steps); list first
  // and the identical transfer is blocked on the recipient check alone.
  const fundFirst = simulateDenylistSequence(design, [
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100' },
    { kind: 'denylist', account: 'approved', listed: true },
  ]);
  assert.deepEqual(fundFirst.steps.map(s => s.allowed), [true, true]);
  let steps = copyDenylistSteps(fundFirst.steps.map((s, i) => i === 0
    ? { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100' }
    : { kind: 'denylist', account: 'approved', listed: true }));
  steps = moveDenylistStep(steps, 1, -1);
  const listFirst = simulateDenylistSequence(design, steps);
  assert.deepEqual(listFirst.steps.map(s => s.allowed), [true, false]);
  assert.deepEqual(listFirst.steps[1].checks.filter(c => !c.pass).map(c => c.name), ['Recipient not denylisted']);
  assert.equal(listFirst.balances.approved, '0');
});

test('the studio wires the custom denylist builder into the Test step', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-action="denylist-customize"/);
  assert.match(app, /data-action="denylist-add-transfer"/);
  assert.match(app, /data-action="denylist-add-denylist"/);
  assert.match(app, /data-action="denylist-add-seize"/);
  assert.match(app, /data-denylist-field="kind"/);
  assert.match(app, /data-denylist-field="from"/);
  assert.match(app, /data-denylist-field="to"/);
  assert.match(app, /data-denylist-field="account"/);
  assert.match(app, /data-denylist-field="listed"/);
  assert.match(app, /data-denylist-field="actor"/);
  assert.match(app, /data-denylist-field="holder"/);
  assert.match(app, /data-denylist-field="amount"/);
  assert.match(app, /data-denylist-move/);
  assert.match(app, /data-denylist-remove/);
  assert.match(app, /updateDenylistStep\(denylistCustomSteps\(\)/);
  assert.match(app, /simulateDenylistSequence\(state\.design,denylistSteps\(\)\)/);
  // Entering custom mode starts from the preset being viewed, and choosing a
  // preset (or a new template) leaves custom mode with a fresh slate.
  assert.match(app, /state\.denylistMode='custom';denylistCustomSteps\(\)/);
  assert.match(app, /state\.denylistPreset=target\.dataset\.denylistPreset;state\.denylistMode='preset'/);
  assert.match(app, /state\.denylistMode='preset';state\.denylistCustom=null/);
  // The builder explains the kind conversion and keeps the module-only boundary.
  assert.match(app, /Switching a step's kind converts it/);
  assert.match(app, /No on-chain denylist is read/);
});
