import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromTemplate, simulateTimeline, blankTimelineStep, copyTimelineSteps, addTimelineStep, removeTimelineStep, moveTimelineStep, updateTimelineStep, MAX_TIMELINE_STEPS } from '../src/domain.js';

const RWA = fromTemplate('rwa'); // supply 1,000,000 · 6 decimals · cap 10,000 · allowlist + eligibility on
const LIFECYCLE = [
  { kind: 'supply', action: 'mint', actor: 'issuer', amount: '50000' },
  { kind: 'transfer', from: 'issuer', to: 'approved', amount: '10000' },
  { kind: 'transfer', from: 'issuer', to: 'approved', amount: '10000' },
  { kind: 'supply', action: 'burn', actor: 'issuer', amount: '30000' },
];
const sum = balances => Object.values(balances).reduce((a, v) => a + BigInt(v), 0n).toString();

test('blank timeline steps are well-formed for both kinds', () => {
  assert.deepEqual(blankTimelineStep(), { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100' });
  assert.deepEqual(blankTimelineStep('supply'), { kind: 'supply', action: 'mint', actor: 'issuer', amount: '100' });
  assert.notEqual(blankTimelineStep(), blankTimelineStep()); // a fresh object each call
  assert.throws(() => blankTimelineStep('airdrop'));
  assert.equal(simulateTimeline(RWA, [blankTimelineStep()]).steps[0].allowed, true);
  const minted = simulateTimeline(RWA, [blankTimelineStep('supply')]);
  assert.equal(minted.steps[0].allowed, true);
  assert.equal(minted.finalSupplyBaseUnits, '1000100000000'); // 1,000,000 + 100, in base units
});

test('copying a timeline validates both kinds and returns independent step objects', () => {
  const copy = copyTimelineSteps(LIFECYCLE);
  assert.deepEqual(copy, LIFECYCLE);
  assert.notEqual(copy, LIFECYCLE);
  assert.notEqual(copy[0], LIFECYCLE[0]);
  copy[1].amount = '999';
  assert.equal(LIFECYCLE[1].amount, '10000'); // the source list is untouched
  assert.throws(() => copyTimelineSteps([]));
  assert.throws(() => copyTimelineSteps(Array(13).fill(blankTimelineStep())));
  assert.throws(() => copyTimelineSteps('not-an-array'));
  assert.throws(() => copyTimelineSteps([null]));
  assert.throws(() => copyTimelineSteps([{ kind: 'airdrop', amount: '1' }]));
  assert.throws(() => copyTimelineSteps([{ kind: 'transfer', from: 'stranger', to: 'approved', amount: '1' }]));
  assert.throws(() => copyTimelineSteps([{ kind: 'supply', action: 'print', actor: 'issuer', amount: '1' }]));
  assert.throws(() => copyTimelineSteps([{ kind: 'supply', action: 'mint', actor: 'stranger', amount: '1' }]));
  assert.throws(() => copyTimelineSteps([{ kind: 'transfer', from: 'issuer', to: 'approved', amount: 1 }]));
});

test('adding a timeline step appends either kind without mutating the original list', () => {
  const one = [blankTimelineStep()];
  const two = addTimelineStep(one);
  assert.equal(one.length, 1);
  assert.equal(two.length, 2);
  assert.deepEqual(two[1], blankTimelineStep());
  const withSupply = addTimelineStep(one, blankTimelineStep('supply'));
  assert.deepEqual(withSupply[1], { kind: 'supply', action: 'mint', actor: 'issuer', amount: '100' });
  assert.throws(() => addTimelineStep(one, { kind: 'transfer', from: 'nobody', to: 'approved', amount: '1' }));
  const full = Array.from({ length: MAX_TIMELINE_STEPS }, () => blankTimelineStep());
  assert.throws(() => addTimelineStep(full), /at most 12/);
});

test('removing a timeline step keeps at least one and never mutates the original', () => {
  const removed = removeTimelineStep(LIFECYCLE, 0);
  assert.deepEqual(removed.map(s => s.kind), ['transfer', 'transfer', 'supply']);
  assert.equal(LIFECYCLE.length, 4);
  assert.throws(() => removeTimelineStep([blankTimelineStep()], 0), /at least one/);
  assert.throws(() => removeTimelineStep(LIFECYCLE, 4));
  assert.throws(() => removeTimelineStep(LIFECYCLE, -1));
  assert.throws(() => removeTimelineStep(LIFECYCLE, 1.5));
});

test('moving a timeline step swaps neighbours across kinds; the edges return an unchanged copy', () => {
  const down = moveTimelineStep(LIFECYCLE, 0, 1);
  assert.deepEqual(down.map(s => s.kind), ['transfer', 'supply', 'transfer', 'supply']);
  assert.equal(LIFECYCLE[0].kind, 'supply'); // original order untouched
  const edge = moveTimelineStep(LIFECYCLE, 0, -1);
  assert.deepEqual(edge, LIFECYCLE);
  assert.notEqual(edge, LIFECYCLE);
  assert.deepEqual(moveTimelineStep(LIFECYCLE, 3, 1), LIFECYCLE);
  assert.throws(() => moveTimelineStep(LIFECYCLE, 0, 2));
  assert.throws(() => moveTimelineStep(LIFECYCLE, 0, 0));
  assert.throws(() => moveTimelineStep(LIFECYCLE, 9, 1));
});

test('updating a timeline step patches only the fields its kind carries', () => {
  const edited = updateTimelineStep(LIFECYCLE, 1, { to: 'pending', amount: '250' });
  assert.deepEqual(edited[1], { kind: 'transfer', from: 'issuer', to: 'pending', amount: '250' });
  assert.deepEqual(LIFECYCLE[1], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '10000' }); // untouched
  const editedSupply = updateTimelineStep(LIFECYCLE, 0, { action: 'burn' });
  assert.deepEqual(editedSupply[0], { kind: 'supply', action: 'burn', actor: 'issuer', amount: '50000' });
  assert.throws(() => updateTimelineStep(LIFECYCLE, 1, { action: 'mint' }), /has no action field/);
  assert.throws(() => updateTimelineStep(LIFECYCLE, 0, { from: 'issuer' }), /has no from field/);
  assert.throws(() => updateTimelineStep(LIFECYCLE, 0, { note: 'x' }), /has no note field/);
  assert.throws(() => updateTimelineStep(LIFECYCLE, 0, { kind: 'airdrop' }));
  assert.throws(() => updateTimelineStep(LIFECYCLE, 0, { amount: 5 }));
  assert.throws(() => updateTimelineStep(LIFECYCLE, 0, null));
  assert.throws(() => updateTimelineStep(LIFECYCLE, 7, { amount: '1' }));
});

test('switching a step kind converts it: amount kept, new kind defaults, no stale fields', () => {
  const toSupply = updateTimelineStep(LIFECYCLE, 1, { kind: 'supply' });
  assert.deepEqual(toSupply[1], { kind: 'supply', action: 'mint', actor: 'issuer', amount: '10000' });
  const toSupplyBurn = updateTimelineStep(LIFECYCLE, 1, { kind: 'supply', action: 'burn', actor: 'other' });
  assert.deepEqual(toSupplyBurn[1], { kind: 'supply', action: 'burn', actor: 'other', amount: '10000' });
  const backToTransfer = updateTimelineStep(toSupply, 1, { kind: 'transfer' });
  assert.deepEqual(backToTransfer[1], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '10000' });
  assert.deepEqual(LIFECYCLE[1], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '10000' }); // untouched
});

test('a timeline built with the helpers simulates end to end', () => {
  // Start from the lifecycle preset, turn its burn into an unauthorised
  // attempt, then append one more distribution the mint at step 1 funds.
  let steps = copyTimelineSteps(LIFECYCLE);
  steps = updateTimelineStep(steps, 3, { actor: 'other' });
  steps = addTimelineStep(steps, { kind: 'transfer', from: 'issuer', to: 'approved', amount: '5000' });
  const r = simulateTimeline(RWA, steps);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, true, true, false, true]);
  assert.equal(r.appliedCount, 4);
  assert.equal(r.finalSupplyBaseUnits, '1050000000000');
  assert.deepEqual(r.balances, { issuer: '1025000000000', approved: '25000000000', pending: '0', blocked: '0' });
  assert.equal(sum(r.balances), r.finalSupplyBaseUnits);
});

test('order matters across kinds: the same burn and transfer land differently when swapped', () => {
  // Burn everything first and the distribution has no balance to draw on;
  // distribute first and the burn of the full original supply is blocked on
  // the issuer's remaining holding instead. Same two steps, two outcomes —
  // only visible because one list mixes both kinds against one state.
  const burnFirst = simulateTimeline(RWA, [
    { kind: 'supply', action: 'burn', actor: 'issuer', amount: '1000000' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100' },
  ]);
  assert.deepEqual(burnFirst.steps.map(s => s.allowed), [true, false]);
  assert.equal(burnFirst.steps[1].checks.find(c => c.name === 'Sender balance').pass, false);
  assert.equal(burnFirst.finalSupplyBaseUnits, '0');
  let steps = copyTimelineSteps([
    { kind: 'supply', action: 'burn', actor: 'issuer', amount: '1000000' },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100' },
  ]);
  steps = moveTimelineStep(steps, 1, -1);
  const transferFirst = simulateTimeline(RWA, steps);
  assert.deepEqual(transferFirst.steps.map(s => s.allowed), [true, false]);
  assert.equal(transferFirst.steps[1].checks.find(c => c.name === 'Issuer balance').pass, false);
  assert.equal(transferFirst.finalSupplyBaseUnits, '1000000000000');
  assert.equal(transferFirst.balances.approved, '100000000');
  assert.equal(sum(transferFirst.balances), transferFirst.finalSupplyBaseUnits);
});

test('the studio wires the custom timeline builder into the Test step', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-action="timeline-customize"/);
  assert.match(app, /data-action="timeline-add-transfer"/);
  assert.match(app, /data-action="timeline-add-supply"/);
  assert.match(app, /data-timeline-field="kind"/);
  assert.match(app, /data-timeline-field="from"/);
  assert.match(app, /data-timeline-field="to"/);
  assert.match(app, /data-timeline-field="action"/);
  assert.match(app, /data-timeline-field="actor"/);
  assert.match(app, /data-timeline-field="amount"/);
  assert.match(app, /data-timeline-move/);
  assert.match(app, /data-timeline-remove/);
  assert.match(app, /updateTimelineStep\(timelineCustomSteps\(\)/);
  assert.match(app, /simulateTimeline\(state\.design,timelineSteps\(\)\)/);
  // Entering custom mode starts from the preset being viewed, and choosing a
  // preset (or a new template) leaves custom mode with a fresh slate.
  assert.match(app, /state\.timelineMode='custom';timelineCustomSteps\(\)/);
  assert.match(app, /state\.timelinePreset=target\.dataset\.timelinePreset;state\.timelineMode='preset'/);
  assert.match(app, /state\.timelineMode='preset';state\.timelineCustom=null/);
  // The builder explains the kind conversion and keeps the one-state boundary.
  assert.match(app, /Switching a step's kind converts it/);
  assert.match(app, /balances always sum to the modeled supply/);
});
