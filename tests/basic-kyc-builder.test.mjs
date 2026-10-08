import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromTemplate, simulateBasicKycSequence, blankBasicKycStep, copyBasicKycSteps, addBasicKycStep, removeBasicKycStep, moveBasicKycStep, updateBasicKycStep, MAX_BASIC_KYC_STEPS } from '../src/domain.js';

const design = fromTemplate('rwa'); // supply 1,000,000 PRA, 6 decimals
const LIFECYCLE = [
  { kind: 'transfer', from: 'issuer', to: 'approved', amount: '250', cert: 'valid', entity: 'entity-a' },
  { kind: 'trust', entity: 'entity-a', trusted: false },
  { kind: 'transfer', from: 'approved', to: 'pending', amount: '100', cert: 'valid', entity: 'entity-a' },
  { kind: 'trust', entity: 'entity-a', trusted: true },
  { kind: 'transfer', from: 'approved', to: 'pending', amount: '100', cert: 'valid', entity: 'entity-a' },
];
const sum = balances => Object.values(balances).reduce((a, v) => a + BigInt(v), 0n).toString();
const U = 1000000n;

test('blank basic-KYC steps are well-formed for all three kinds', () => {
  assert.deepEqual(blankBasicKycStep(), { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100', cert: 'valid', entity: 'entity-a' });
  assert.deepEqual(blankBasicKycStep('trust'), { kind: 'trust', entity: 'entity-a', trusted: true });
  assert.deepEqual(blankBasicKycStep('pause'), { kind: 'pause', paused: true });
  assert.notEqual(blankBasicKycStep(), blankBasicKycStep()); // a fresh object each call
  assert.throws(() => blankBasicKycStep('allowlist'));
  // A blank trust update applies (entity A is already trusted — an
  // idempotent state change), a blank transfer signed by it applies, and
  // a blank pause applies as a state change.
  const r = simulateBasicKycSequence(design, [blankBasicKycStep('trust'), blankBasicKycStep(), blankBasicKycStep('pause')]);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, true, true]);
  assert.equal(r.paused, true);
});

test('copying a lifecycle validates all three kinds and returns independent step objects', () => {
  const copy = copyBasicKycSteps(LIFECYCLE);
  assert.deepEqual(copy, LIFECYCLE);
  assert.notEqual(copy, LIFECYCLE);
  assert.notEqual(copy[0], LIFECYCLE[0]);
  copy[0].amount = '999';
  assert.equal(LIFECYCLE[0].amount, '250'); // the source list is untouched
  assert.throws(() => copyBasicKycSteps([]));
  assert.throws(() => copyBasicKycSteps(Array(13).fill(blankBasicKycStep())));
  assert.throws(() => copyBasicKycSteps('not-an-array'));
  assert.throws(() => copyBasicKycSteps([null]));
  assert.throws(() => copyBasicKycSteps([{ kind: 'seize', amount: '1' }]));
  assert.throws(() => copyBasicKycSteps([{ kind: 'transfer', from: 'stranger', to: 'approved', amount: '1', cert: 'valid', entity: 'entity-a' }]));
  assert.throws(() => copyBasicKycSteps([{ kind: 'transfer', from: 'issuer', to: 'approved', amount: 1, cert: 'valid', entity: 'entity-a' }]));
  assert.throws(() => copyBasicKycSteps([{ kind: 'transfer', from: 'issuer', to: 'approved', amount: '1', cert: 'forged', entity: 'entity-a' }]));
  // There is deliberately no 'untrusted' certificate state in this lab —
  // trust is the evolving list — so the builder can never construct one.
  assert.throws(() => copyBasicKycSteps([{ kind: 'transfer', from: 'issuer', to: 'approved', amount: '1', cert: 'untrusted', entity: 'entity-a' }]), /no untrusted state here/);
  assert.throws(() => copyBasicKycSteps([{ kind: 'transfer', from: 'issuer', to: 'approved', amount: '1', cert: 'valid', entity: 'entity-z' }]));
  assert.throws(() => copyBasicKycSteps([{ kind: 'trust', entity: 'entity-z', trusted: true }]));
  assert.throws(() => copyBasicKycSteps([{ kind: 'trust', entity: 'entity-a', trusted: 'yes' }])); // the flag is a boolean, not a string
  assert.throws(() => copyBasicKycSteps([{ kind: 'pause', paused: 'true' }])); // the flag is a boolean, not a string
});

test('adding a lifecycle step appends any kind without mutating the original list', () => {
  const one = [blankBasicKycStep()];
  const two = addBasicKycStep(one);
  assert.equal(one.length, 1);
  assert.equal(two.length, 2);
  assert.deepEqual(two[1], blankBasicKycStep());
  const withTrust = addBasicKycStep(one, blankBasicKycStep('trust'));
  assert.deepEqual(withTrust[1], { kind: 'trust', entity: 'entity-a', trusted: true });
  assert.throws(() => addBasicKycStep(one, { kind: 'trust', entity: 'nobody', trusted: true }));
  const full = Array.from({ length: MAX_BASIC_KYC_STEPS }, () => blankBasicKycStep());
  assert.throws(() => addBasicKycStep(full), /at most 12/);
  assert.equal(MAX_BASIC_KYC_STEPS, 12);
});

test('removing a lifecycle step keeps at least one and never mutates the original', () => {
  const removed = removeBasicKycStep(LIFECYCLE, 1);
  assert.deepEqual(removed.map(s => s.kind), ['transfer', 'transfer', 'trust', 'transfer']);
  assert.equal(LIFECYCLE.length, 5);
  assert.throws(() => removeBasicKycStep([blankBasicKycStep()], 0), /at least one/);
  assert.throws(() => removeBasicKycStep(LIFECYCLE, 5));
  assert.throws(() => removeBasicKycStep(LIFECYCLE, -1));
  assert.throws(() => removeBasicKycStep(LIFECYCLE, 1.5));
});

test('moving a lifecycle step swaps neighbours across kinds; the edges return an unchanged copy', () => {
  const down = moveBasicKycStep(LIFECYCLE, 0, 1);
  assert.deepEqual(down.map(s => s.kind), ['trust', 'transfer', 'transfer', 'trust', 'transfer']);
  assert.equal(LIFECYCLE[0].kind, 'transfer'); // original order untouched
  const edge = moveBasicKycStep(LIFECYCLE, 0, -1);
  assert.deepEqual(edge, LIFECYCLE);
  assert.notEqual(edge, LIFECYCLE);
  assert.deepEqual(moveBasicKycStep(LIFECYCLE, 4, 1), LIFECYCLE);
  assert.throws(() => moveBasicKycStep(LIFECYCLE, 0, 2));
  assert.throws(() => moveBasicKycStep(LIFECYCLE, 0, 0));
  assert.throws(() => moveBasicKycStep(LIFECYCLE, 9, 1));
});

test('updating a lifecycle step patches only the fields its kind carries', () => {
  const edited = updateBasicKycStep(LIFECYCLE, 0, { to: 'pending', amount: '300', cert: 'expired', entity: 'entity-b' });
  assert.deepEqual(edited[0], { kind: 'transfer', from: 'issuer', to: 'pending', amount: '300', cert: 'expired', entity: 'entity-b' });
  assert.deepEqual(LIFECYCLE[0], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '250', cert: 'valid', entity: 'entity-a' }); // untouched
  const distrusted = updateBasicKycStep(LIFECYCLE, 3, { trusted: false });
  assert.deepEqual(distrusted[3], { kind: 'trust', entity: 'entity-a', trusted: false });
  assert.throws(() => updateBasicKycStep(LIFECYCLE, 0, { trusted: true }), /has no trusted field/);
  assert.throws(() => updateBasicKycStep(LIFECYCLE, 1, { amount: '5' }), /has no amount field/);
  assert.throws(() => updateBasicKycStep(LIFECYCLE, 1, { cert: 'valid' }), /has no cert field/);
  assert.throws(() => updateBasicKycStep([{ kind: 'pause', paused: true }], 0, { entity: 'entity-a' }), /has no entity field/);
  assert.throws(() => updateBasicKycStep(LIFECYCLE, 0, { note: 'x' }), /has no note field/);
  assert.throws(() => updateBasicKycStep(LIFECYCLE, 0, { kind: 'allowlist' }));
  assert.throws(() => updateBasicKycStep(LIFECYCLE, 1, { trusted: 'false' })); // the flag is a boolean, not a string
  assert.throws(() => updateBasicKycStep(LIFECYCLE, 0, { cert: 'untrusted' }), /no untrusted state here/);
  assert.throws(() => updateBasicKycStep(LIFECYCLE, 0, { entity: 'entity-z' }));
  assert.throws(() => updateBasicKycStep(LIFECYCLE, 0, { amount: 5 }));
  assert.throws(() => updateBasicKycStep(LIFECYCLE, 0, null));
  assert.throws(() => updateBasicKycStep(LIFECYCLE, 7, { amount: '1' }));
});

test('switching a step kind keeps the modeled entity across transfer and trust, and nothing else', () => {
  const toTrust = updateBasicKycStep(LIFECYCLE, 0, { kind: 'trust' });
  assert.deepEqual(toTrust[0], { kind: 'trust', entity: 'entity-a', trusted: true }); // the signer becomes the subject; amount and cert dropped
  const signerB = [{ kind: 'transfer', from: 'issuer', to: 'approved', amount: '10', cert: 'valid', entity: 'entity-b' }];
  assert.deepEqual(updateBasicKycStep(signerB, 0, { kind: 'trust' })[0], { kind: 'trust', entity: 'entity-b', trusted: true }); // entity B kept, not defaulted back to A
  const fromTrust = updateBasicKycStep([{ kind: 'trust', entity: 'entity-b', trusted: false }], 0, { kind: 'transfer' });
  assert.deepEqual(fromTrust[0], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100', cert: 'valid', entity: 'entity-b' }); // the subject becomes the signer; the rest defaulted
  const overridden = updateBasicKycStep(LIFECYCLE, 0, { kind: 'trust', entity: 'entity-b', trusted: false });
  assert.deepEqual(overridden[0], { kind: 'trust', entity: 'entity-b', trusted: false }); // a patch naming an entity overrides the kept one
  const toPause = updateBasicKycStep(LIFECYCLE, 0, { kind: 'pause' });
  assert.deepEqual(toPause[0], { kind: 'pause', paused: true }); // a pause carries no entity — nothing is kept
  const fromPause = updateBasicKycStep([{ kind: 'pause', paused: false }], 0, { kind: 'transfer' });
  assert.deepEqual(fromPause[0], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100', cert: 'valid', entity: 'entity-a' }); // defaulted — the pause had no entity to keep
  assert.deepEqual(LIFECYCLE[0], { kind: 'transfer', from: 'issuer', to: 'approved', amount: '250', cert: 'valid', entity: 'entity-a' }); // untouched
});

test('a lifecycle built with the helpers simulates end to end', () => {
  // Start from the revocation shape, then append a pause round: the pause
  // blocks an otherwise-valid transfer, clearing it restores the transfer.
  let steps = copyBasicKycSteps(LIFECYCLE);
  steps = addBasicKycStep(steps, { kind: 'pause', paused: true });
  steps = addBasicKycStep(steps, { kind: 'transfer', from: 'approved', to: 'issuer', amount: '50', cert: 'valid', entity: 'entity-a' });
  steps = addBasicKycStep(steps, { kind: 'pause', paused: false });
  steps = addBasicKycStep(steps, { kind: 'transfer', from: 'approved', to: 'issuer', amount: '50', cert: 'valid', entity: 'entity-a' });
  const r = simulateBasicKycSequence(design, steps);
  assert.deepEqual(r.steps.map(s => s.allowed), [true, true, false, true, true, true, false, true, true]);
  assert.equal(r.appliedCount, 7);
  assert.equal(r.transferredBaseUnits, (400n * U).toString());
  assert.equal(sum(r.balances), (1000000n * U).toString());
});

test('the builder can construct the second-entity lifecycle: an untrusted signer fails until a trust step names it', () => {
  let steps = [{ kind: 'transfer', from: 'issuer', to: 'approved', amount: '200', cert: 'valid', entity: 'entity-b' }];
  steps = addBasicKycStep(steps, blankBasicKycStep('trust'));
  steps = updateBasicKycStep(steps, 1, { entity: 'entity-b' });
  steps = addBasicKycStep(steps, { kind: 'transfer', from: 'issuer', to: 'approved', amount: '200', cert: 'valid', entity: 'entity-b' });
  const r = simulateBasicKycSequence(design, steps);
  assert.deepEqual(r.steps.map(s => s.allowed), [false, true, true]);
  assert.deepEqual(r.steps[0].checks.filter(c => !c.pass).map(c => c.name), ['Trusted KYC entity']);
  assert.equal(r.transferredBaseUnits, (200n * U).toString());
  assert.deepEqual(r.trusted, ['entity-a', 'entity-b']);
});

test('order matters across kinds: revoking before funding blocks what funding first allows', () => {
  const fundFirst = [
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100', cert: 'valid', entity: 'entity-a' },
    { kind: 'trust', entity: 'entity-a', trusted: false },
  ];
  assert.deepEqual(simulateBasicKycSequence(design, fundFirst).steps.map(s => s.allowed), [true, true]);
  const revokeFirst = simulateBasicKycSequence(design, [
    { kind: 'trust', entity: 'entity-a', trusted: false },
    { kind: 'transfer', from: 'issuer', to: 'approved', amount: '100', cert: 'valid', entity: 'entity-a' },
  ]);
  assert.deepEqual(revokeFirst.steps.map(s => s.allowed), [true, false]);
  assert.deepEqual(revokeFirst.steps[1].checks.filter(c => !c.pass).map(c => c.name), ['Trusted KYC entity']);
  assert.equal(revokeFirst.balances.approved, '0');
});

test('the studio wires the custom basic-KYC builder into the Test step', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-action="basic-kyc-customize"/);
  assert.match(app, /data-action="basic-kyc-add-transfer"/);
  assert.match(app, /data-action="basic-kyc-add-trust"/);
  assert.match(app, /data-action="basic-kyc-add-pause"/);
  assert.match(app, /data-basic-field="kind"/);
  assert.match(app, /data-basic-field="from"/);
  assert.match(app, /data-basic-field="to"/);
  assert.match(app, /data-basic-field="cert"/);
  assert.match(app, /data-basic-field="entity"/);
  assert.match(app, /data-basic-field="trusted"/);
  assert.match(app, /data-basic-field="paused"/);
  assert.match(app, /data-basic-field="amount"/);
  assert.match(app, /data-basic-move/);
  assert.match(app, /data-basic-remove/);
  assert.match(app, /updateBasicKycStep\(basicKycCustomSteps\(\)/);
  assert.match(app, /simulateBasicKycSequence\(state\.design,basicKycSteps\(\)\)/);
  // Entering custom mode starts from the preset being viewed, and choosing a
  // preset (or a new template) leaves custom mode with a fresh slate.
  assert.match(app, /state\.basicKycMode='custom';basicKycCustomSteps\(\)/);
  assert.match(app, /state\.basicKycPreset=target\.dataset\.basicKycPreset;state\.basicKycMode='preset'/);
  assert.match(app, /state\.basicKycMode='preset';state\.basicKycCustom=null/);
  // The builder explains the kind conversion and keeps the module-only boundary.
  assert.match(app, /Switching a step's kind converts it/);
  assert.match(app, /no on-chain trusted list is consulted/);
});
